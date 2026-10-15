"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import GameTimeLayer from "@/components/game-time/GameTimeLayer";
import Bubbles from "@/components/crew-room/Bubbles";
import ExitDoor from "@/components/crew-room/ExitDoor";
import FountainSticker from "@/components/crew-room/FountainSticker";
import PopUps from "@/components/crew-room/PopUps";
import VibeLayer from "@/components/crew-room/VibeLayer";
import type { Tile } from "@/lib/campaign/geometry";
import { areaArrival, canWalkScene, privateAreaAt, scenePath, sceneSize, type CampaignLayout, type CampaignZone } from "@/lib/campaign/layout";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection, RoomPeer, SocialWorld } from "@/lib/crew-room/types";
import { deviceTier } from "@/lib/deviceTier";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import AvatarSprite from "./AvatarSprite";
import ClubhouseArt from "./ClubhouseArt";
import EdgeArrows from "./EdgeArrows";
import { RoomCamera, type CamMode } from "./roomCamera";
import { prioritise, spritesPending, spritesReady } from "./spriteCache";
import css from "./Campaign.module.css";

/** A walker whose last heartbeat is this old (ms) is shown as away: a locked phone or another app. The server keeps them 45 s. */
const AWAY = 25_000;
/** Postgres writes microseconds; some browsers only read milliseconds. */
const when = (at: string) => Date.parse(at.replace(/(\.\d{3})\d+/, "$1"));
const isAway = (peer: RoomPeer, observedAt: string) => when(observedAt) - when(peer.last_seen) > AWAY;

/** My walk: one tile per 85 ms. */
const STEP_MS = 85;
/** Other walkers move between the server's snapshots (about 1.5 s apart), so they glide a little longer. */
const PEER_MS = 300;
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
};

/**
 * One walker: one positioned node (moved by transform, so the browser's compositor does the moving), one sprite, and a
 * name tag that keeps its size on screen at every zoom (it scales by --cam-inv).
 */
const Walker = memo(WalkerView, (a, b) => {
  for (const k of ["id", "x", "y", "name", "tile", "tag", "away", "me", "walking", "ring", "nudge"] as const) if (a[k] !== b[k]) return false;
  // A look arrives as a new object with every snapshot (about every 1.5 s); only a different drawing redraws the Hopper.
  return a.look === b.look || JSON.stringify(a.look) === JSON.stringify(b.look);
});

function WalkerView({ id, x, y, look, name, tile, tag, away, me, walking, ring, nudge }: WalkerProps) {
  const px = (x + 0.5) * tile;
  const py = (y + 0.6) * tile;
  const attrs = me ? { "data-player-tile": `${x},${y}` } : { "data-room-peer": id, "data-peer-tile": `${x},${y}`, "data-away": away || undefined };
  return (
    <div
      {...attrs}
      className={`${css.walker} ${me ? css.me : css.peer} ${away ? css.away : ""}`}
      style={{ transform: `translate3d(${px}px,${py}px,0)`, zIndex: 10 + y, transitionDuration: `${me ? STEP_MS : PEER_MS}ms` }}
    >
      {!!ring && <i key={ring} className={css.ring} aria-hidden />}
      <span className={`${css.sprite} ${walking ? css.walking : ""} ${nudge ? css.nudge : ""}`} style={nudge ? ({ "--nx": `${nudge}px` } as React.CSSProperties) : undefined}>
        <AvatarSprite look={look} label={me ? "Your character" : away ? `${name}'s character, away` : `${name}'s character`} />
      </span>
      {tag && <b className={css.nameTag}>{me ? "You" : away ? `${name} · away` : name}</b>}
    </div>
  );
}

/**
 * A tap that opens something under the finger (the Hopper menu, a hint) is followed about 30 ms later by the browser's own
 * click, which would land on the thing that just opened and press its first button. Swallow that one click.
 */
function eatGhostClick() {
  const eat = (event: Event) => {
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
  room,
  userId,
  zoneLines,
  onPhase,
}: {
  layout: CampaignLayout;
  look: unknown;
  brand: string;
  social?: SocialWorld;
  crewId?: string;
  room?: CrewRoomConnection;
  userId?: string;
  /** What a zone's card says when the owner has not filled that zone in, by zone id. */
  zoneLines?: Partial<Record<string, string>>;
  /** The open sequence: "hold" (the whole room), "zoom" (zooming to me), "done". */
  onPhase?: (phase: OpenPhase) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<RoomCamera | null>(null);
  const start = social?.reset ? { x: social.reset.x, y: social.reset.y } : layout.spawn;
  const [player, setPlayer] = useState<Tile>(start);
  const current = useRef<Tile>(start);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [walking, setWalking] = useState(false);
  const [destination, setDestination] = useState<Tile | null>(null);
  const [lod, setLod] = useState(0);
  const [ring, setRing] = useState(0);
  const [nudge, setNudge] = useState(0);
  const sheet = useRoomStore((s) => s.sheet);
  const [bump, setBump] = useState<{ x: number; y: number; k: number } | null>(null);
  const [say, setSay] = useState("");
  const uid = useId().replace(/:/g, "");
  const scene = sceneSize(layout);
  const tile = layout.grid.tile;
  const watching = !!social?.watching;
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
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
    cam.onMode = (mode: CamMode) => useRoomStore.getState().setView(mode === "follow" ? "me" : "full");
    cam.onScale = (s) => {
      const n = s >= NEAR_AREAS ? 2 : s >= NEAR ? 1 : 0;
      setLod((l) => (l === n ? l : n));
    };
    camRef.current = cam;
    // A new camera starts a new opening (React runs effects twice in development).
    phase.current = "init";
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      cam.setViewport(r.width, r.height, r.height - useRoomStore.getState().sheetHeight);
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
        sessionStorage.setItem(`hz:room-opened:${crewId ?? "x"}`, "1");
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
  }, [scene.width, scene.height, tile, crewId, setPhase, skipOpen]);

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
      seen = sessionStorage.getItem(`hz:room-opened:${crewId ?? "x"}`) === "1";
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
  }, [watching, crewId, setPhase, scene.width, scene.height, tile]);

  // Follow my avatar.
  useEffect(() => {
    camRef.current?.follow((player.x + 0.5) * tile, (player.y + 0.5) * tile);
  }, [player, tile]);

  // ---- Walking -------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!social?.reset) return;
    if (timer.current) clearTimeout(timer.current);
    const t = { x: social.reset.x, y: social.reset.y };
    current.current = t;
    setPlayer(t);
    setWalking(false);
    setDestination(null);
  }, [social?.reset]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const move = useCallback(
    (to: Tile, after?: () => void): boolean => {
      if (social?.watching) return false;
      const path = scenePath(layout, current.current, to);
      if (!path) return false;
      if (timer.current) clearTimeout(timer.current);
      setWalking(false);
      setDestination(path.length ? to : null);
      if (!path.length) {
        after?.();
        return true;
      }
      setWalking(true);
      useRoomStore.getState().setWalked();
      const step = () => {
        const next = path[0];
        if (!next) {
          setWalking(false);
          setDestination(null);
          after?.();
          return;
        }
        // The server has not taken the last step yet (no connection): wait and keep walking.
        if (social && !social.onStep(next)) {
          setWalking(false);
          timer.current = setTimeout(step, 200);
          return;
        }
        path.shift();
        setWalking(true);
        current.current = next;
        setPlayer(next);
        timer.current = setTimeout(step, STEP_MS);
      };
      step();
      return true;
    },
    [layout, social],
  );
  const moveRef = useRef(move);
  moveRef.current = move;

  const ensureFollow = useCallback(() => {
    const cam = camRef.current;
    if (!cam) return;
    if (phase.current === "hold") skipOpen(500);
    else if (cam.mode !== "follow") cam.goFollow(450);
  }, [skipOpen]);

  /** The nearest walkable tile within one tile of the one tapped (closest to the tap point first) that I can reach. */
  const snap = useCallback(
    (tx: number, ty: number, at?: { x: number; y: number }): Tile | null => {
      const px = at?.x ?? (tx + 0.5) * tile;
      const py = at?.y ?? (ty + 0.5) * tile;
      const options: Tile[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (canWalkScene(layout, { x: tx + dx, y: ty + dy })) options.push({ x: tx + dx, y: ty + dy });
      const dist = (c: Tile) => Math.hypot((c.x + 0.5) * tile - px, (c.y + 0.5) * tile - py);
      options.sort((a, b) => dist(a) - dist(b));
      return options.find((c) => scenePath(layout, current.current, c)) ?? null;
    },
    [layout, tile],
  );

  /** A tap with nowhere to go: a tiny bump, an X where I pressed and a one second hint. No status line. */
  const bumpAt = useCallback(
    (sceneX: number, sceneY: number) => {
      eatGhostClick();
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
      const target = snap(x, y);
      if (!target) return;
      ensureFollow();
      moveRef.current(target);
    },
    [snap, ensureFollow],
  );

  // The room store lets the screen chrome (outside this scaled world) see my tile and walk me: Game Time's banner and
  // win sheet, the Hopper menu's WALK TO. `walkTo` is the same call a tap on the floor makes.
  useEffect(() => {
    if (!crewId) return;
    const store = useRoomStore.getState();
    store.setTile(tile);
    store.setWalkTo(walkToTile);
    return () => useRoomStore.getState().reset();
  }, [crewId, tile, walkToTile]);
  useEffect(() => {
    if (crewId) useRoomStore.getState().setMe(watching ? null : player);
  }, [crewId, player, watching]);
  useEffect(() => {
    if (!crewId) return;
    useRoomStore.getState().setPeers(peers.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, look: p.look, key: (p as RoomPeer & { key?: string }).key })));
  }, [crewId, peers]);

  // The zone or conversation area I stand in (an area wins), for the pop-ups, the pills and the chat tabs.
  const hereArea = useMemo(() => privateAreaAt(layout, player), [layout, player]);
  const hereZone = useMemo(() => zoneAt(layout, player), [layout, player]);
  const zoneId = watching ? null : (hereArea?.id ?? hereZone);
  // The store's zone stays null through the whole-room moment, so no card pops over a camera that is still far away.
  useEffect(() => {
    if (crewId) useRoomStore.getState().setZone(opened ? zoneId : null);
  }, [crewId, zoneId, opened]);
  useEffect(() => {
    if (!zoneId) return;
    const place = hereArea ? hereArea.name : (layout.zones.find((z) => z.id === zoneId)?.name ?? "");
    if (place) setSay(`You are in ${shortName(place)}`);
  }, [zoneId, hereArea, layout.zones]);

  // A conversation area picked from the chat sheet (visit) arrives as a destination.
  const socialDestination = social?.destination;
  const socialDestinationHandled = social?.onDestinationHandled;
  useEffect(() => {
    if (!socialDestination) return;
    const area = privateAreaAt(layout, socialDestination);
    ensureFollow();
    move(area ? areaArrival(layout, area, socialPeers?.filter((p) => p.id !== socialSelf) ?? [], current.current) : socialDestination);
    socialDestinationHandled?.();
  }, [socialDestination, socialDestinationHandled, socialPeers, socialSelf, layout, move, ensureFollow]);

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

  // ---- Input: tap to walk, drag to look, pinch and wheel to zoom --------------------------------------------------
  useEffect(() => {
    const el = viewportRef.current;
    const cam = camRef.current;
    if (!el || !cam) return;
    const pts = new Map<number, { x: number; y: number }>();
    let down: { id: number; x: number; y: number; t: number; moved: boolean; object: boolean } | null = null;
    /** Pointers that began on a room object (the door plate, the fountain sticker), and whether a pinch used any of them. */
    const objectPointers = new Set<number>();
    let objectPinched = false;
    let pinch: { d0: number; s0: number; sx: number; sy: number } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    const rel = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    // Buttons, links and anything marked data-hit (a zone tag, the sticker, the door plate) take their own taps.
    const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('button, a, input, textarea, select, [role="button"], [data-hit]');

    /**
     * The Hopper under a point in the viewport, if any: a 44 px target around the avatar at whatever zoom. Avatars stacked
     * on one spot (the entrance fills up) are told apart by tapping again: `cycle` hands the tap to the next one under the
     * finger each time, so the one at the bottom of the pile can be picked too.
     */
    let lastPick = { id: "", t: 0 };
    const peerAt = (x: number, y: number, cycle = false): RoomPeer | null => {
      const reach = Math.max(14, Math.min(26, 30 * cam.s));
      const found: { p: RoomPeer; d: number }[] = [];
      for (const p of peersRef.current) {
        const at = cam.sceneToScreen((p.x + 0.5) * tile, (p.y + 0.5) * tile - 24);
        const d = Math.hypot(at.x - x, at.y - y);
        if (d < reach) found.push({ p, d });
      }
      if (!found.length) return null;
      found.sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1));
      const pile = found.filter((f) => f.d - found[0].d < 7);
      if (!cycle || pile.length < 2) return found[0].p;
      pile.sort((a, b) => (a.p.id < b.p.id ? -1 : 1));
      const prev = performance.now() - lastPick.t < 6000 ? pile.findIndex((f) => f.p.id === lastPick.id) : -1;
      const pick = pile[(prev + 1) % pile.length].p;
      lastPick = { id: pick.id, t: performance.now() };
      return pick;
    };

    const tap = (cx: number, cy: number) => {
      const { x, y } = rel(cx, cy);
      // Any tap during the whole-room moment shortens it, and is not a walk.
      if (phase.current === "hold") {
        skipOpen(500);
        return;
      }
      const now = performance.now();
      if (now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 28) {
        lastTap = { t: 0, x: 0, y: 0 };
        // Double tap: in close on that spot, or back to me.
        if (cam.s < cam.followScale * 1.3) cam.zoomAbout(x, y, Math.min(2.2, cam.followScale * 1.8), 320);
        else cam.goFollow(450);
        return;
      }
      lastTap = { t: now, x, y };
      // Another Hopper under the finger: a 44 px target around the avatar at whatever zoom. Close up the menu opens on
      // them; from far away the first tap just flies in.
      const hit = peerAt(x, y, true);
      if (hit) {
        if (cam.s >= NEAR) {
          eatGhostClick();
          useRoomStore.getState().setTappedPeer(hit.id);
        }
        else cam.focus((hit.x + 0.5) * tile, (hit.y + 0.5) * tile, 650);
        return;
      }
      const at = cam.screenToScene(x, y);
      const tx = Math.floor(at.x / tile);
      const ty = Math.floor(at.y / tile);
      if (watchingRef.current) {
        eatGhostClick();
        useRoomStore.getState().pushPopup({ id: "bump", title: "ROOM'S FULL", body: "You walk in when a spot opens.", tile: { x: tx, y: ty }, ttlMs: 1600 });
        return;
      }
      const target = tx >= 0 && ty >= 0 && tx < layout.grid.width && ty < layout.grid.height ? snap(tx, ty, at) : null;
      if (!target) {
        bumpAt(at.x, at.y);
        return;
      }
      ensureFollow();
      moveRef.current(target);
    };

    const onDown = (e: PointerEvent) => {
      let onObject = false;
      if (interactive(e.target)) {
        // The door plate and the fountain sticker sit under the avatars, and the sticker is big. A Hopper standing over one
        // is tapped as a Hopper (the tap then swallows the click that follows, so the plate does not also leave the room).
        // Anything else on one keeps its own tap, but a drag or a pinch that starts on it still moves the camera.
        const object = e.target instanceof Element && e.target.closest("[data-room-object]");
        if (!object) return;
        const at = rel(e.clientX, e.clientY);
        if (!(cam.s >= NEAR && peerAt(at.x, at.y))) onObject = true;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (onObject) objectPointers.add(e.pointerId);
      else {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer: no capture, the gesture still works */
        }
      }
      if (pts.size === 1) down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, object: onObject };
      else if (pts.size === 2) {
        down = null;
        if (objectPointers.size) objectPinched = true;
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
        if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
          down.moved = true;
          if (phase.current === "hold") skipOpen(0);
          cam.panBy(e.clientX - down.x, e.clientY - down.y);
          return;
        }
        if (down.moved) cam.panBy(dx, dy);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      const fromObject = objectPointers.delete(e.pointerId);
      if (pinch && pts.size < 2) {
        pinch = null;
        cam.pinchEnd();
      }
      if (down && down.id === e.pointerId) {
        const d = down;
        down = null;
        // A drag that began on an object is a camera move, not a press on it.
        if (d.moved && d.object) eatGhostClick();
        else if (!d.moved && !d.object && performance.now() - d.t < 450) tap(e.clientX, e.clientY);
      } else if (fromObject && objectPinched) eatGhostClick();
      if (!pts.size) objectPinched = false;
    };
    const onCancel = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      objectPointers.delete(e.pointerId);
      if (down?.id === e.pointerId) down = null;
      if (pinch && pts.size < 2) {
        pinch = null;
        cam.pinchEnd();
      }
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
  }, [layout, tile, snap, bumpAt, ensureFollow, skipOpen, scene.width]);

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
  const art = useMemo(() => <ClubhouseArt layout={layout} uid={uid} brand={brand} />, [layout, uid, brand]);
  const props = useMemo(
    () =>
      hasSocial && crewId ? (
        <>
          <FountainSticker crewId={crewId} layout={layout} />
          <ExitDoor crewId={crewId} layout={layout} />
        </>
      ) : null,
    [hasSocial, crewId, layout],
  );
  const cards = useMemo(() => (hasSocial && crewId ? <PopUps crewId={crewId} layout={layout} lines={zoneLines} /> : null), [hasSocial, crewId, layout, zoneLines]);
  const vibes = useMemo(() => (hasSocial && crewId ? <VibeLayer crewId={crewId} layout={layout} /> : null), [hasSocial, crewId, layout]);
  const bubbles = useMemo(() => (hasSocial && crewId && room && userId ? <Bubbles crewId={crewId} layout={layout} room={room} userId={userId} /> : null), [hasSocial, crewId, room, userId, layout]);

  return (
    <div className={css.worldShell}>
      <div className={css.viewport} ref={viewportRef} role="group" aria-label={`${brand} clubhouse. Tap the floor to walk. Arrow keys walk on a keyboard.`} tabIndex={0} data-lod={lod}>
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
                return <Walker key={peer.id} id={peer.id} x={peer.x} y={peer.y} look={peer.look} name={peer.name} tile={tile} tag={tagged.has(peer.id)} away={away} />;
              })}
              {!watching && <Walker id="me" me x={player.x} y={player.y} look={look} name="You" tile={tile} tag={lod >= 1} walking={walking} ring={ring} nudge={nudge} />}
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
                    onClick={() => chooseZone(zone)}
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
                      onClick={() => chooseArea(area.id)}
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
        <EdgeArrows layout={layout} camRef={camRef} enabled={opened && lod >= 1 && !watching && sheet !== "full"} onGo={chooseZone} />
        <p className="sr-only" role="status" aria-live="polite">
          {walking ? "Walking" : say}
        </p>
      </div>
    </div>
  );
}
