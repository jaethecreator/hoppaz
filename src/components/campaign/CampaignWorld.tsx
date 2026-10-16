"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import GameTimeLayer from "@/components/game-time/GameTimeLayer";
import Bubbles from "@/components/crew-room/Bubbles";
import ExitDoor from "@/components/crew-room/ExitDoor";
import FountainSticker from "@/components/crew-room/FountainSticker";
import PopUps from "@/components/crew-room/PopUps";
import VibeLayer from "@/components/crew-room/VibeLayer";
import { floodFill, floodPath, nearestReachable, type Tile } from "@/lib/campaign/geometry";
import { areaArrival, canWalkScene, privateAreaAt, sceneBlocks, scenePath, sceneSize, type CampaignLayout, type CampaignZone } from "@/lib/campaign/layout";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection, RoomPeer, SocialWorld } from "@/lib/crew-room/types";
import { deviceTier } from "@/lib/deviceTier";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import AvatarSprite from "./AvatarSprite";
import RoomArt, { type RoomArtContent } from "./roomArt";
import { RoomCamera, type CamMode } from "./roomCamera";
import { prioritise, spritesPending, spritesReady } from "./spriteCache";
import { Motion } from "./walkMotion";
import css from "./Campaign.module.css";

/** A walker whose last heartbeat is this old (ms) is shown as away: a locked phone or another app. The server keeps them 45 s. */
const AWAY = 25_000;
/** Postgres writes microseconds; some browsers only read milliseconds. */
const when = (at: string) => Date.parse(at.replace(/(\.\d{3})\d+/, "$1"));
const isAway = (peer: RoomPeer, observedAt: string) => when(observedAt) - when(peer.last_seen) > AWAY;

/** A tap is a press that stays within this many px of where it landed and is over within this many ms (a drag or a hold is not one). */
const TAP_SLOP = 10;
const TAP_MS = 250;
/** Open sequence: the whole room, then a zoom to me. */
const HOLD_MS = 1500;
const HOLD_AGAIN_MS = 900;
const ZOOM_MS = 900;
/** The zoom waits this long at most (ms) for my avatar and the nearest Hopper to be drawn, so it never zooms onto blobs. */
const SPRITES_WAIT_MS = 900;
/** Hoppers drawn at once: every one in a crowd on a normal phone, the nearest 30 on a phone short of memory. */
const DRAW_MAX = 120;
const DRAW_MAX_LOW = 30;
/** Under this scale an avatar is too small to pick. */
const NEAR = 0.6;
/** From this scale the area tags show. */
const NEAR_AREAS = 0.9;

export type OpenPhase = "hold" | "zoom" | "done";

type WalkerProps = {
  id: string;
  x: number;
  y: number;
  look: unknown;
  name: string;
  tile: number;
  tag: boolean;
  away?: boolean;
  me?: boolean;
  walking?: boolean;
  ring?: number;
  nudge?: number;
  /** My user id, for my own walker (its `id` is "me"); a peer's `id` already is theirs. The voice room names speakers by it. */
  voiceId?: string;
  /** Hands the node to the motion loop (walkMotion.ts). */
  attach: (id: string, el: HTMLElement | null) => void;
};

/**
 * The speaking dot: a small speech bubble with a pulsing dot over the head of a walker whose voice is live (roomStore.speaking,
 * set by RoomVoice for normal proximity voice and for stage speakers alike). Each walker asks only "is my id in the list?",
 * so a change re-renders the one or two dots that flipped, never the 60 walkers, and nothing here runs per frame: the pulse is
 * a CSS animation on transform and opacity. A phone short of memory gets the dot without the pulse.
 */
function Talk({ who }: { who?: string }) {
  const speaking = useRoomStore((s) => !!who && s.speaking.includes(who));
  if (!speaking) return null;
  return <i className={`${css.talk} ${deviceTier() === "low" ? css.talkStill : ""}`} data-speaking aria-hidden />;
}

/**
 * One walker: one positioned node, one sprite, and a name tag that keeps its size on screen at every zoom (it scales by
 * --cam-inv). The node is moved by transform and drawn on the compositor, but not by React and not by a CSS transition:
 * walkMotion.ts writes its transform (and z-index) every frame from the clock. React only gives it the place it starts at;
 * those two style values never change after that, so a re-render never puts the node back on a tile.
 */
const Walker = memo(WalkerView, (a, b) => {
  for (const k of ["id", "x", "y", "name", "tile", "tag", "away", "me", "walking", "ring", "nudge", "voiceId"] as const) if (a[k] !== b[k]) return false;
  // A look arrives as a new object with every snapshot (about every 1.5 s); only a different drawing redraws the Hopper.
  return a.look === b.look || JSON.stringify(a.look) === JSON.stringify(b.look);
});

function WalkerView({ id, x, y, look, name, tile, tag, away, me, walking, ring, nudge, voiceId, attach }: WalkerProps) {
  const [first] = useState(() => ({ transform: `translate3d(${(x + 0.5) * tile}px,${(y + 0.6) * tile}px,0)`, zIndex: 10 + y }));
  const hold = useCallback((el: HTMLDivElement | null) => attach(id, el), [attach, id]);
  const attrs = me ? { "data-player-tile": `${x},${y}` } : { "data-room-peer": id, "data-peer-tile": `${x},${y}`, "data-away": away || undefined };
  return (
    <div {...attrs} ref={hold} className={`${css.walker} ${me ? css.me : css.peer} ${away ? css.away : ""}`} style={first}>
      {!!ring && <i key={ring} className={css.ring} aria-hidden />}
      <span className={`${css.sprite} ${walking ? css.walking : ""} ${nudge ? css.nudge : ""}`} style={nudge ? ({ "--nx": `${nudge}px` } as React.CSSProperties) : undefined}>
        <AvatarSprite look={look} label={me ? "Your character" : away ? `${name}'s character, away` : `${name}'s character`} />
      </span>
      <Talk who={me ? voiceId : id} />
      {tag && <b className={css.nameTag}>{me ? "You" : away ? `${name} · away` : name}</b>}
    </div>
  );
}

/**
 * A tap that opens something under the finger (the Hopper menu, a hint) is followed about 30 ms later by the browser's own
 * click, which would land on the thing that just opened and press its first button. Swallow that one click. Only the one
 * that lands where the finger was (a tap on the chat button a moment later, somewhere else, is its own tap), and never a
 * keyboard click (detail 0).
 */
function eatGhostClick(x?: number, y?: number) {
  const eat = (event: Event) => {
    const click = event as MouseEvent;
    if (click.detail === 0) return;
    if (x !== undefined && y !== undefined && Math.hypot(click.clientX - x, click.clientY - y) > 48) return;
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener("click", eat, true);
  };
  window.addEventListener("click", eat, true);
  window.setTimeout(() => window.removeEventListener("click", eat, true), 450);
}

const shortName = (name: string) => name.replace(/^The\s+/i, "");
const zoneAt = (layout: CampaignLayout, t: Tile) => layout.zones.find((z) => t.x >= z.x && t.x < z.x + z.w && t.y >= z.y && t.y < z.y + z.h)?.id ?? null;
const inRect = (r: { x: number; y: number; w: number; h: number }, t: Tile) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;

export default function CampaignWorld({
  layout,
  look,
  brand,
  social,
  crewId,
  placeId,
  room,
  userId,
  zoneLines,
  roomContent,
  onPhase,
}: {
  layout: CampaignLayout;
  look: unknown;
  brand: string;
  social?: SocialWorld;
  crewId?: string;
  /**
   * An event or hotspot room's key (`event-pool`, `hotspot-yaba`): the room is not a crew's, so there is no Game Time,
   * fountain sticker, vibes or bubbles, but the exit door, the zone cards and the room store are wired, as for a crew.
   */
  placeId?: string;
  room?: CrewRoomConnection;
  userId?: string;
  /** What a zone's card says when the owner has not filled that zone in, by zone id. */
  zoneLines?: Partial<Record<string, string>>;
  /** An event room's flyer, line-up and title for its walls (roomArt.tsx). The clubhouse ignores it. */
  roomContent?: RoomArtContent;
  /** The open sequence: "hold" (the whole room), "zoom" (zooming to me), "done". */
  onPhase?: (phase: OpenPhase) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<RoomCamera | null>(null);
  const start = social?.reset ? { x: social.reset.x, y: social.reset.y } : layout.spawn;
  const [player, setPlayer] = useState<Tile>(start);
  /** The tile I am on, or (mid-step) heading to: where the next path starts from. What is drawn lags it by up to one tile. */
  const current = useRef<Tile>(start);
  const [walking, setWalking] = useState(false);
  const [destination, setDestination] = useState<Tile | null>(null);
  const [lod, setLod] = useState(0);
  const [ring, setRing] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [bump, setBump] = useState<{ x: number; y: number; k: number } | null>(null);
  const [say, setSay] = useState("");
  /** What the room store and the open-sequence memory are keyed by: the crew's id, or the place's key. */
  const storeId = crewId ?? placeId;
  const uid = useId().replace(/:/g, "");
  const scene = sceneSize(layout);
  const tile = layout.grid.tile;
  const watching = !!social?.watching;
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  const socialRef = useRef(social);
  socialRef.current = social;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** Set when a press begins on a zone or area pill, so only a click that follows a real press on one walks (never a ghost click). */
  const pillArmed = useRef(0);
  // How I and everyone else move (walkMotion.ts): on the clock, one transform write a frame, no CSS transitions.
  const [motion] = useState(
    () =>
      new Motion(layout.grid.tile, start, {
        step: (next) => {
          const s = socialRef.current;
          return s ? s.onStep(next) : true;
        },
        began: (next) => {
          current.current = next;
        },
        arrived: (next) => setPlayer(next),
        walking: setWalking,
        follow: (px, py) => camRef.current?.follow(px, py),
        stopped: () => setDestination(null),
      }),
  );
  useEffect(() => () => motion.dispose(), [motion]);
  const phase = useRef<"init" | "hold" | "zoom" | "done" | "watching">("init");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomInRef = useRef<(ms: number) => void>(() => {});
  const phaseCb = useRef(onPhase);
  phaseCb.current = onPhase;

  const [opened, setOpened] = useState(false);
  const setPhase = useCallback((next: "hold" | "zoom" | "done" | "watching") => {
    phase.current = next;
    if (next === "done") setOpened(true);
    if (next !== "watching") phaseCb.current?.(next);
  }, []);
  /** Cut the whole-room moment short and zoom to me. */
  const skipOpen = useCallback((ms = 500) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (phase.current === "hold") zoomInRef.current(ms);
  }, []);

  const socialPeers = social?.peers;
  const socialSelf = social?.selfId;
  const peers = useMemo(() => socialPeers?.filter((peer) => peer.id !== socialSelf) ?? [], [socialPeers, socialSelf]);
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const lookRef = useRef(look);
  lookRef.current = look;
  const observedAt = social?.observedAt ?? "";

  // ---- The camera ----------------------------------------------------------------------------------------------
  useEffect(() => {
    const el = viewportRef.current;
    const world = worldRef.current;
    const layer = layerRef.current;
    if (!el || !world || !layer) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cam = new RoomCamera(world, layer, scene.width, scene.height, tile);
    cam.reduced = reduced;
    motion.reduced = reduced;
    cam.onMode = (mode: CamMode) => useRoomStore.getState().setView(mode === "follow" ? "me" : "full");
    cam.onScale = (s) => {
      const n = s >= NEAR_AREAS ? 2 : s >= NEAR ? 1 : 0;
      setLod((l) => (l === n ? l : n));
    };
    camRef.current = cam;
    // A new camera starts a new opening (React runs effects twice in development).
    phase.current = "init";
    const fit = () => {
      // The stage's own layout size, not its bounding box: a page transition or a zoom on a parent scales the box, never the layout.
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 10 || h < 10) return;
      cam.setViewport(w, h, h - useRoomStore.getState().sheetHeight);
      cam.paintNow();
      world.dataset.ready = "1";
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    cam.follow((current.current.x + 0.5) * tile, (current.current.y + 0.5) * tile);
    fit();
    const unsub = useRoomStore.subscribe((s, prev) => {
      // The chat sheet or the keyboard changes the free height: the camera re-centres over 250 ms.
      if (s.sheetHeight !== prev.sheetHeight) fit();
      // The HUD button asks for the other view.
      if (s.view !== prev.view) {
        if (s.view === "full" && cam.mode === "follow") cam.goFull(600);
        else if (s.view === "me" && cam.mode !== "follow") {
          if (phase.current === "hold") skipOpen(600);
          else cam.goFollow(600);
        }
      }
    });
    zoomInRef.current = (ms: number) => {
      try {
        sessionStorage.setItem(`hz:room-opened:${storeId ?? "x"}`, "1");
      } catch {
        /* storage blocked */
      }
      setPhase("zoom");
      cam.goFollow(ms);
      window.setTimeout(() => {
        if (camRef.current !== cam) return;
        setPhase("done");
        setRing((n) => n + 1);
      }, ms + 80);
    };
    return () => {
      unsub();
      ro.disconnect();
      cam.dispose();
      camRef.current = null;
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [scene.width, scene.height, tile, storeId, setPhase, skipOpen, motion]);

  // The open sequence: the whole room for a moment, then a zoom to me at the entrance. A full room only looks on.
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    if (watching) {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      cam.goFull(0);
      setPhase("watching");
      return;
    }
    if (phase.current === "done" || phase.current === "zoom") return;
    if (cam.reduced) {
      cam.goFollow(0);
      setPhase("done");
      return;
    }
    let seen = false;
    try {
      seen = sessionStorage.getItem(`hz:room-opened:${storeId ?? "x"}`) === "1";
    } catch {
      /* storage blocked: the long hold every time */
    }
    cam.goFull(0);
    setPhase("hold");
    holdTimer.current = setTimeout(
      () => {
        // Zoom once my avatar and the nearest few are drawn (they are first in the sprite queue), never onto blobs.
        const near = [...peersRef.current].sort((a, b) => Math.hypot(a.x - current.current.x, a.y - current.current.y) - Math.hypot(b.x - current.current.x, b.y - current.current.y));
        void spritesReady([lookRef.current, ...near.slice(0, 6).map((p) => p.look)], SPRITES_WAIT_MS).then(() => {
          if (phase.current === "hold" && camRef.current === cam) zoomInRef.current(ZOOM_MS);
        });
      },
      seen ? HOLD_AGAIN_MS : HOLD_MS,
    );
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [watching, storeId, setPhase, scene.width, scene.height, tile]);

  // ---- Walking -------------------------------------------------------------------------------------------------
  // The server put me somewhere (I came in, or it and this phone disagreed about where I stand): stand there and stop. A
  // report of the tile I am already heading for changes nothing, so a walk is never cut short by an echo.
  useEffect(() => {
    if (!social?.reset) return;
    const t = { x: social.reset.x, y: social.reset.y };
    if (t.x === current.current.x && t.y === current.current.y) return;
    current.current = t;
    motion.snapMe(t);
    setPlayer(t);
    setDestination(null);
  }, [social?.reset, motion]);

  // Everyone else glides to where the server last put them, along the room's tiles (walkMotion.ts).
  useLayoutEffect(() => {
    motion.syncPeers(peers, (from, to) => scenePath(layout, from, to));
  }, [peers, layout, motion]);

  const blocks = useMemo(() => sceneBlocks(layout), [layout]);

  /**
   * Where a tap on a tile sends me, and the path there: the tile itself when it is floor I can reach; otherwise (a prop, a
   * shrub, a chair, a wall edge) the tile beside it that is the fewest steps from where I am. Null only when nothing
   * within reach of it can be walked to. `point` is the finger in scene px, for breaking ties.
   */
  const aim = useCallback(
    (tx: number, ty: number, point: { x: number; y: number }): { to: Tile; path: Tile[] } | null => {
      const walkable = (x: number, y: number) => canWalkScene(layout, { x, y });
      const flood = floodFill(current.current, layout.grid.width, layout.grid.height, walkable);
      const to = nearestReachable(flood, { x: tx, y: ty }, point, tile, blocks);
      const path = to ? floodPath(flood, to) : null;
      return to && path ? { to, path } : null;
    },
    [layout, tile, blocks],
  );

  /** Walk along a path: the one place a walk starts. The destination ring shows where it ends. */
  const walkPath = useCallback(
    (path: Tile[], to: Tile) => {
      setDestination(path.length ? to : null);
      if (path.length) useRoomStore.getState().setWalked();
      motion.go(path);
    },
    [motion],
  );

  /** Walk to a tile, or to the nearest one beside it. */
  const move = useCallback(
    (to: Tile): boolean => {
      if (watchingRef.current) return false;
      const goal = aim(to.x, to.y, { x: (to.x + 0.5) * tile, y: (to.y + 0.5) * tile });
      if (!goal) return false;
      walkPath(goal.path, goal.to);
      return true;
    },
    [aim, walkPath, tile],
  );
  const moveRef = useRef(move);
  moveRef.current = move;

  const ensureFollow = useCallback(() => {
    const cam = camRef.current;
    if (!cam) return;
    if (phase.current === "hold") skipOpen(500);
    else if (cam.mode !== "follow") cam.goFollow(450);
  }, [skipOpen]);

  /** A tap with nowhere to go: a tiny bump, an X where I pressed and a one second hint. No status line. */
  const bumpAt = useCallback(
    (sceneX: number, sceneY: number, clientX?: number, clientY?: number) => {
      eatGhostClick(clientX, clientY);
      setBump({ x: sceneX, y: sceneY, k: Date.now() });
      setNudge(sceneX >= (current.current.x + 0.5) * tile ? 3 : -3);
      window.setTimeout(() => setNudge(0), 160);
      useRoomStore.getState().pushPopup({ id: "bump", title: "NOT THAT WAY", tile: { x: Math.floor(sceneX / tile), y: Math.floor(sceneY / tile) }, ttlMs: 1000 });
      sfx.knock();
      haptics.buzz("refused");
    },
    [tile],
  );

  const walkToTile = useCallback(
    (x: number, y: number) => {
      if (watchingRef.current) return;
      const goal = aim(x, y, { x: (x + 0.5) * tile, y: (y + 0.5) * tile });
      if (!goal) return;
      ensureFollow();
      walkPath(goal.path, goal.to);
    },
    [aim, walkPath, ensureFollow, tile],
  );

  // The room store lets the screen chrome (outside this scaled world) see my tile and walk me: Game Time's banner and
  // win sheet, the Hopper menu's WALK TO. `walkTo` is the same call a tap on the floor makes.
  useEffect(() => {
    if (!storeId) return;
    const store = useRoomStore.getState();
    store.setTile(tile);
    store.setWalkTo(walkToTile);
    return () => useRoomStore.getState().reset();
  }, [storeId, tile, walkToTile]);
  useEffect(() => {
    if (storeId) useRoomStore.getState().setMe(watching ? null : player);
  }, [storeId, player, watching]);
  useEffect(() => {
    if (!storeId) return;
    useRoomStore.getState().setPeers(peers.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, look: p.look, key: (p as RoomPeer & { key?: string }).key })));
  }, [storeId, peers]);

  // The zone or conversation area I stand in (an area wins), for the pop-ups, the pills and the chat tabs.
  const hereArea = useMemo(() => privateAreaAt(layout, player), [layout, player]);
  const hereZone = useMemo(() => zoneAt(layout, player), [layout, player]);
  const zoneId = watching ? null : (hereArea?.id ?? hereZone);
  // The store's zone stays null through the whole-room moment, so no card pops over a camera that is still far away.
  useEffect(() => {
    if (storeId) useRoomStore.getState().setZone(opened ? zoneId : null);
  }, [storeId, zoneId, opened]);
  useEffect(() => {
    if (!zoneId) return;
    const place = hereArea ? hereArea.name : (layout.zones.find((z) => z.id === zoneId)?.name ?? "");
    if (place) setSay(`You are in ${shortName(place)}`);
  }, [zoneId, hereArea, layout.zones]);

  // A conversation area picked from the chat sheet (visit) arrives as a destination. Each one is walked once: a new snapshot
  // (or a parent that has not cleared it yet) must never send me there again.
  const socialDestination = social?.destination;
  const walkedDestination = useRef<Tile | null>(null);
  useEffect(() => {
    if (!socialDestination || walkedDestination.current === socialDestination) return;
    walkedDestination.current = socialDestination;
    const area = privateAreaAt(layoutRef.current, socialDestination);
    ensureFollow();
    moveRef.current(area ? areaArrival(layoutRef.current, area, peersRef.current, current.current) : socialDestination);
    socialRef.current?.onDestinationHandled?.();
  }, [socialDestination, ensureFollow]);

  const chooseZone = useCallback(
    (zone: CampaignZone) => {
      if (phase.current === "hold") skipOpen(500);
      if (watchingRef.current) {
        camRef.current?.focus((zone.stop.x + 0.5) * tile, (zone.stop.y + 0.5) * tile, 650);
        return;
      }
      ensureFollow();
      move(zone.stop);
    },
    [move, ensureFollow, skipOpen, tile],
  );
  const chooseArea = useCallback(
    (areaId: string) => {
      const area = layout.privateAreas.find((a) => a.id === areaId);
      if (!area || watchingRef.current) return;
      ensureFollow();
      move(areaArrival(layout, area, peersRef.current, current.current));
    },
    [layout, move, ensureFollow],
  );

  /**
   * A zone or area label walks me only when a press began on a label a moment ago (the input effect arms it), or when it is a
   * keyboard or screen reader click (detail 0). A click with no press before it (the ghost click after a menu closes
   * under the finger) is not mine to obey.
   */
  const pillClick = useCallback((event: React.MouseEvent, go: () => void) => {
    const armed = performance.now() - pillArmed.current < 600;
    pillArmed.current = 0;
    if (event.detail === 0 || armed) go();
  }, []);

  // ---- Input: tap to walk, drag to look, pinch and wheel to zoom --------------------------------------------------
  // What a finger does is decided once, when it lands: where in the scene it is (read off the camera as it was drawn at that
  // instant, so a camera that is moving after me does not move the tap), and which Hoppers were under it. When it lifts,
  // it is a tap if it stayed within TAP_SLOP px and TAP_MS; anything else is a drag, a hold or a pinch and never a walk.
  useEffect(() => {
    const el = viewportRef.current;
    const cam = camRef.current;
    if (!el || !cam) return;
    type Pt = { x: number; y: number };
    type Hit = { p: RoomPeer; d: number };
    /** floor: a press on the room (or on a label that sits over a prop); object / pill: a press on a thing that has its own tap. */
    type Kind = "floor" | "object" | "pill";
    type Down = { id: number; x: number; y: number; t: number; moved: boolean; kind: Kind; via: boolean; scene: Pt; hits: Hit[] };
    const pts = new Map<number, Pt>();
    let down: Down | null = null;
    /** Pointers that began on an object or a pill (not captured: the thing takes the click), and whether a pinch used any of them. */
    const loose = new Set<number>();
    let loosePinched = false;
    let pinch: { d0: number; s0: number; sx: number; sy: number } | null = null;
    // Stage coordinates (px from the stage's top left corner). The stage's own rect is read at every press, so the header, the
    // safe areas and a page that is still sliding in never shift a tap; a scaled ancestor is divided out. devicePixelRatio does
    // not enter: pointer events, layout and the camera all count CSS px.
    const rel = (cx: number, cy: number): Pt => {
      const r = el.getBoundingClientRect();
      const kx = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const ky = el.offsetHeight ? r.height / el.offsetHeight : 1;
      return { x: (cx - r.left) / (kx || 1), y: (cy - r.top) / (ky || 1) };
    };
    // Buttons, links and anything marked data-hit (a zone tag, the sticker, the door plate) take their own taps.
    const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('button, a, input, textarea, select, [role="button"], [data-hit]');
    const solidAt = (t: Tile) => !canWalkScene(layout, t);

    /**
     * The Hoppers under a point in the stage, nearest first: a 44 px target around the avatar at whatever zoom, at the spot
     * the avatar is drawn (it may be mid-glide). Avatars stacked on one spot (the entrance fills up) are told apart by
     * tapping again: `pickPeer` hands the tap to the next one under the finger each time, so the one at the bottom of the
     * pile can be picked too.
     */
    const peersAt = (x: number, y: number): Hit[] => {
      const reach = Math.max(14, Math.min(26, 30 * cam.s));
      const found: Hit[] = [];
      for (const p of peersRef.current) {
        const v = motion.point(p.id) ?? p;
        const at = cam.sceneToScreen((v.x + 0.5) * tile, (v.y + 0.5) * tile - 24);
        const d = Math.hypot(at.x - x, at.y - y);
        if (d < reach) found.push({ p, d });
      }
      return found.sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1));
    };
    let lastPick = { id: "", t: 0 };
    const pickPeer = (found: Hit[]): RoomPeer | null => {
      if (!found.length) return null;
      const pile = found.filter((f) => f.d - found[0].d < 7);
      if (pile.length < 2) return found[0].p;
      pile.sort((a, b) => (a.p.id < b.p.id ? -1 : 1));
      const prev = performance.now() - lastPick.t < 6000 ? pile.findIndex((f) => f.p.id === lastPick.id) : -1;
      const pick = pile[(prev + 1) % pile.length].p;
      lastPick = { id: pick.id, t: performance.now() };
      return pick;
    };

    const tap = (d: Down) => {
      // A label over a prop gave this tap to the prop: the label's own click must not also walk me to the label's place.
      if (d.via) eatGhostClick(d.x, d.y);
      // Any tap during the whole-room moment shortens it, and is not a walk.
      if (phase.current === "hold") {
        skipOpen(500);
        return;
      }
      // Another Hopper under the finger. Close up the menu opens on them; from far away the first tap just flies in.
      const hit = pickPeer(d.hits);
      if (hit) {
        if (cam.s >= NEAR) {
          eatGhostClick(d.x, d.y);
          useRoomStore.getState().setTappedPeer(hit.id);
        } else {
          const v = motion.point(hit.id) ?? hit;
          cam.focus((v.x + 0.5) * tile, (v.y + 0.5) * tile, 650);
        }
        return;
      }
      const at = d.scene;
      // The stage shows up to half a tile of dark beyond the scene; further out than that is nothing to walk to.
      const inScene = at.x >= -tile / 2 && at.y >= -tile / 2 && at.x <= scene.width + tile / 2 && at.y <= scene.height + tile / 2;
      const tx = Math.min(layout.grid.width - 1, Math.max(0, Math.floor(at.x / tile)));
      const ty = Math.min(layout.grid.height - 1, Math.max(0, Math.floor(at.y / tile)));
      if (watchingRef.current) {
        eatGhostClick(d.x, d.y);
        useRoomStore.getState().pushPopup({ id: "bump", title: "ROOM'S FULL", body: "You walk in when a spot opens.", tile: { x: tx, y: ty }, ttlMs: 1600 });
        return;
      }
      const goal = inScene ? aim(tx, ty, at) : null;
      if (!goal) {
        bumpAt(at.x, at.y, d.x, d.y);
        return;
      }
      ensureFollow();
      // Already beside it: a ring at my feet says the tap was heard.
      if (!goal.path.length) setRing((n) => n + 1);
      walkPath(goal.path, goal.to);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      const at = rel(e.clientX, e.clientY);
      const scene = cam.screenToScene(at.x, at.y);
      const hits = peersAt(at.x, at.y);
      let kind: Kind = "floor";
      let via = false;
      if (interactive(target)) {
        const pill = target?.closest("[data-zone-tag], [data-area-tag]");
        const object = target?.closest("[data-room-object]");
        if (pill) {
          // A label sitting on a wall or a prop (the Courtyard Corner tag over the shrub) is that prop's tap: the label gives
          // way. On open floor it is the label's own tap, and a drag from it still moves the camera.
          if (solidAt({ x: Math.floor(scene.x / tile), y: Math.floor(scene.y / tile) })) via = true;
          else kind = "pill";
        } else if (object) {
          // The door plate and the fountain sticker sit under the avatars, and the sticker is big. A Hopper standing over
          // one is tapped as a Hopper (the tap then swallows the click that follows, so the plate does not also leave the
          // room). Anything else on one keeps its own tap, but a drag or a pinch that starts on it still moves the camera.
          if (cam.s >= NEAR && hits.length) via = true;
          else kind = "object";
        } else return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (kind !== "floor") loose.add(e.pointerId);
      else {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer: no capture, the gesture still works */
        }
      }
      if (kind === "pill") pillArmed.current = performance.now();
      if (pts.size === 1) down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, kind, via, scene, hits };
      else if (pts.size === 2) {
        down = null;
        pillArmed.current = 0;
        if (loose.size) loosePinched = true;
        const [a, b] = [...pts.values()];
        const m = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
        const sc = cam.screenToScene(m.x, m.y);
        pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: cam.s, sx: sc.x, sy: sc.y };
        if (phase.current === "hold") skipOpen(0);
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const m = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
        cam.pinch(pinch.s0, Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, pinch.sx, pinch.sy, m.x, m.y);
      } else if (down && down.id === e.pointerId) {
        if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) {
          down.moved = true;
          pillArmed.current = 0;
          if (phase.current === "hold") skipOpen(0);
          cam.panBy(e.clientX - down.x, e.clientY - down.y);
          return;
        }
        if (down.moved) cam.panBy(dx, dy);
      }
    };
    const endPinch = () => {
      pinch = null;
      cam.pinchEnd();
      // A finger left on the glass keeps dragging the camera, and lifting it is never a tap.
      const rest = [...pts.entries()][0];
      if (rest) down = { id: rest[0], x: rest[1].x, y: rest[1].y, t: 0, moved: true, kind: "floor", via: false, scene: { x: 0, y: 0 }, hits: [] };
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      const fromLoose = loose.delete(e.pointerId);
      if (pinch && pts.size < 2) endPinch();
      if (down && down.id === e.pointerId) {
        const d = down;
        down = null;
        if (d.kind === "floor") {
          const still = !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_SLOP;
          if (still && performance.now() - d.t <= TAP_MS) tap(d);
          else if (d.via) eatGhostClick(d.x, d.y);
        } else if (d.moved) {
          // A drag that began on an object or a pill is a camera move, not a press on it.
          eatGhostClick(d.x, d.y);
        } else if (d.kind === "pill") pillArmed.current = performance.now();
      } else if (fromLoose && loosePinched) eatGhostClick(e.clientX, e.clientY);
      if (!pts.size) loosePinched = false;
    };
    const onCancel = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      loose.delete(e.pointerId);
      if (down?.id === e.pointerId) down = null;
      if (pinch && pts.size < 2) endPinch();
    };
    const onWheel = (e: WheelEvent) => {
      if (interactive(e.target)) return;
      e.preventDefault();
      if (phase.current === "hold") skipOpen(0);
      const { x, y } = rel(e.clientX, e.clientY);
      cam.zoomAbout(x, y, cam.s * Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("wheel", onWheel);
    };
  }, [layout, tile, aim, bumpAt, ensureFollow, skipOpen, walkPath, motion, scene.width, scene.height]);

  // Desktop: arrow keys and WASD walk one tile. Nothing happens while a field has focus or a dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const t = event.target;
      if (t instanceof HTMLElement && (t.matches("input, textarea, select, button, a") || t.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
      const direction = ({ ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] } as Record<string, number[]>)[event.key];
      if (!direction || watchingRef.current) return;
      event.preventDefault();
      const to = { x: current.current.x + direction[0], y: current.current.y + direction[1] };
      if (!canWalkScene(layout, to)) return;
      ensureFollow();
      moveRef.current(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, ensureFollow]);

  // ---- What is drawn ---------------------------------------------------------------------------------------------
  const counts = useMemo(() => {
    const all: Tile[] = [...peers, ...(watching ? [] : [player])];
    const zones: Record<string, number> = {};
    for (const z of layout.zones) zones[z.id] = all.filter((t) => inRect(z, t)).length;
    const areas: Record<string, number> = {};
    for (const a of layout.privateAreas) areas[a.id] = all.filter((t) => inRect(a, t)).length;
    return { zones, areas };
  }, [layout, peers, player, watching]);

  // A phone short of memory draws the nearest few Hoppers only; the rest are still counted, heard and tappable in the menus.
  const tier = useMemo(() => deviceTier(), []);
  const drawn = useMemo(() => {
    const max = tier === "low" ? DRAW_MAX_LOW : DRAW_MAX;
    if (peers.length <= max) return peers;
    const far = (p: RoomPeer) => Math.hypot(p.x - player.x, p.y - player.y);
    return [...peers].sort((a, b) => far(a) - far(b)).slice(0, max);
  }, [peers, player, tier]);

  // The sprite queue (spriteCache.ts) draws me first and then the nearest Hopper, and follows me as I walk.
  useEffect(() => {
    if (!spritesPending()) return;
    const far = (p: RoomPeer) => Math.hypot(p.x - player.x, p.y - player.y);
    prioritise([look, ...[...drawn].sort((a, b) => far(a) - far(b)).map((p) => p.look)]);
  }, [drawn, player, look]);

  // Name tags: the nearest dozen within eight tiles of me, only once the avatars are big enough to pick. A tag that would
  // sit on top of a nearer one (or on mine) is left off: a crowd at the door reads as a few names, not one smear.
  const tagged = useMemo(() => {
    if (lod < 1) return new Set<string>();
    const ranked = peers
      .map((p) => ({ id: p.id, x: p.x, y: p.y, d: Math.hypot(p.x - player.x, p.y - player.y) }))
      .filter((p) => p.d <= 8)
      .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
    const placed: { x: number; y: number }[] = watching ? [] : [{ x: player.x, y: player.y }];
    const out = new Set<string>();
    for (const p of ranked) {
      if (out.size >= 12) break;
      if (placed.some((q) => Math.abs(q.x - p.x) < 2.4 && Math.abs(q.y - p.y) < 0.8)) continue;
      placed.push(p);
      out.add(p.id);
    }
    return out;
  }, [peers, player, lod, watching]);

  // Zone tags: all six while the whole room shows; once the avatars are big enough to pick, only the three nearest to me
  // (the zone I stand in is hidden by CSS, its card says it).
  const shownZones = useMemo(() => {
    if (lod < 1) return new Set(layout.zones.map((z) => z.id));
    const ranked = layout.zones
      .map((z) => ({ id: z.id, d: Math.hypot(z.stop.x - player.x, z.stop.y - player.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    return new Set(ranked.map((z) => z.id));
  }, [layout.zones, lod, player]);

  // The scene art is about 650 nodes and never changes while I walk. Held as one element, React skips it on every step
  // (it was 20 percent of the main thread on a 4x throttle when it was re-created 12 times a second).
  const hasSocial = !!social;
  const art = useMemo(() => <RoomArt layout={layout} uid={uid} brand={brand} content={roomContent} />, [layout, uid, brand, roomContent]);
  const props = useMemo(
    () =>
      hasSocial && storeId ? (
        <>
          {crewId && <FountainSticker crewId={crewId} layout={layout} />}
          <ExitDoor crewId={storeId} layout={layout} />
        </>
      ) : null,
    [hasSocial, crewId, storeId, layout],
  );
  const cards = useMemo(() => (hasSocial && storeId ? <PopUps crewId={storeId} layout={layout} lines={zoneLines} /> : null), [hasSocial, storeId, layout, zoneLines]);
  const vibes = useMemo(() => (hasSocial && crewId ? <VibeLayer crewId={crewId} layout={layout} /> : null), [hasSocial, crewId, layout]);
  const bubbles = useMemo(() => (hasSocial && crewId && room && userId ? <Bubbles crewId={crewId} layout={layout} room={room} userId={userId} /> : null), [hasSocial, crewId, room, userId, layout]);

  return (
    <div className={css.worldShell}>
      <div className={css.viewport} ref={viewportRef} role="group" aria-label={`${brand} ${placeId ? "room" : "clubhouse"}. Tap the floor to walk. Arrow keys walk on a keyboard.`} tabIndex={0} data-lod={lod}>
        <div className={css.world} ref={worldRef} style={{ width: scene.width, height: scene.height }}>
          <div className={css.art} aria-hidden>
            {art}
          </div>
          <div className={css.layer} ref={layerRef}>
            <div className={css.decals} aria-hidden>
              {social &&
                layout.privateAreas.map((area) => (
                  <div
                    key={area.id}
                    data-conversation-area={area.id}
                    className={`${css.privateArea} ${hereArea?.id === area.id ? css.privateAreaActive : ""}`}
                    style={{ left: area.x * tile, top: area.y * tile, width: area.w * tile, height: area.h * tile }}
                  />
                ))}
              {destination && <i className={css.destination} style={{ left: (destination.x + 0.5) * tile, top: (destination.y + 0.5) * tile }} />}
              {bump && <i key={bump.k} className={css.bumpMark} style={{ left: bump.x, top: bump.y }} />}
            </div>
            <div className={css.props}>
              {social && crewId && (
                <div className={css.gameTimeWorld} data-game-time-layer="world">
                  <GameTimeLayer crewId={crewId} roomId={crewId} layout={layout} me={watching ? null : player} isMember isWatcher={watching} walkTo={walkToTile} worldLayer />
                </div>
              )}
              {props}
            </div>
            <div className={css.walkers}>
              {drawn.map((peer) => {
                const away = !!social && isAway(peer, observedAt);
                return <Walker key={peer.id} id={peer.id} x={peer.x} y={peer.y} look={peer.look} name={peer.name} tile={tile} tag={tagged.has(peer.id)} away={away} attach={motion.attach} />;
              })}
              {!watching && <Walker id="me" me x={player.x} y={player.y} look={look} name="You" tile={tile} tag={lod >= 1} walking={walking} ring={ring} nudge={nudge} voiceId={userId} attach={motion.attach} />}
            </div>
            <div className={css.tags}>
              {layout.zones.filter((zone) => shownZones.has(zone.id)).map((zone) => {
                const n = counts.zones[zone.id] ?? 0;
                const inside = zoneId === zone.id;
                return (
                  <button
                    key={zone.id}
                    type="button"
                    data-hit
                    data-zone-tag={zone.id}
                    className={`${css.zoneTag} ${inside ? css.zoneTagHere : ""}`}
                    style={{ left: (zone.plaque.x + 0.5) * tile, top: (zone.id === "courtyard" ? zone.y : zone.plaque.y) * tile - 6 + (zone.id === "courtyard" ? -12 : 0) }}
                    aria-label={`${zone.name}${n ? `, ${n} here` : ""}. Walk there.`}
                    onClick={(e) => pillClick(e, () => chooseZone(zone))}
                  >
                    <span>{shortName(zone.name)}</span>
                    {n > 0 && <b>{n}</b>}
                  </button>
                );
              })}
              {social &&
                lod >= 2 &&
                layout.privateAreas.map((area) => {
                  const n = counts.areas[area.id] ?? 0;
                  const inside = hereArea?.id === area.id;
                  return (
                    <button
                      key={area.id}
                      type="button"
                      data-hit
                      data-area-tag={area.id}
                      className={`${css.areaTag} ${inside ? css.areaTagHere : ""}`}
                      style={{ left: area.x * tile + 2, top: area.y * tile }}
                      aria-label={`${area.name}. Walk in to chat here.`}
                      onClick={(e) => pillClick(e, () => chooseArea(area.id))}
                    >
                      <MessageCircle size={12} aria-hidden />
                      <span>{area.name.replace(/^Listening /, "")}</span>
                      {inside && n > 0 && <b>{n}</b>}
                    </button>
                  );
                })}
            </div>
            <div className={css.over}>
              {bubbles}
              {vibes}
            </div>
            <div className={css.cards}>{cards}</div>
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {walking ? "Walking" : say}
        </p>
      </div>
    </div>
  );
}
