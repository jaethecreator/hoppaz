"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { useServerNow } from "@/lib/game-time/clock";
import { isMystery } from "@/lib/game-time/drops";
import { pressSearch, showChip, startGameTime } from "@/lib/game-time/controller";
import { nearestSpot, spotRects, tilesFrom } from "@/lib/game-time/proximity";
import { useGameTime } from "@/lib/game-time/store";
import Banner from "./Banner";
import HintLayer from "./HintLayer";
import Hype from "./Hype";
import WinSheet from "./WinSheet";
import css from "./GameTime.module.css";

/**
 * The Game Time half that sits over the room, in screen pixels (design 13.8). It also runs the controller: one poll, one
 * Realtime channel, for both mounts. What it draws: the banner and the feed lines, the opening countdown, the win sheet.
 * What it wires: the SEARCH pill (the room store's action, priority 100), the "Leave the hunt?" flag, and one tip card.
 */
export type GameTimeChromeProps = { crewId: string; layout: CampaignLayout; isWatcher: boolean };

/** Standing still this long before SEARCH appears: the room sends my steps every 200 ms and the server checks its own copy. */
const SETTLE_MS = 450;
/** The pill stays while I am within this many tiles, so it does not flicker at the edge. */
const LEAVE_TILES = 2;
const PILL = "gt-search";

export default function GameTimeChrome({ crewId, layout, isWatcher }: GameTimeChromeProps) {
  useEffect(() => startGameTime(crewId), [crewId]);
  return (
    <>
      <HuntFlag isWatcher={isWatcher} />
      <SearchPill layout={layout} isWatcher={isWatcher} />
      <Hype isWatcher={isWatcher} />
      <HintLayer layout={layout} />
      <div className={css.top} data-below={isWatcher || undefined} data-gt-top>
        <Banner isWatcher={isWatcher} />
        <Feed />
        <TipCard isWatcher={isWatcher} />
      </div>
      <WinSheet />
    </>
  );
}

/** Under the banner: what the room just did. At most two lines, 2.5 s each. */
function Feed() {
  const feed = useGameTime((s) => s.feed);
  if (!feed.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ display: "contents" }}>
      {feed.map((f) => (
        <div key={f.k} className={css.feedChip} data-gt-feed>
          {f.text}
        </div>
      ))}
    </div>
  );
}

/** Tells the room a hunt is on (live, or opening within ten minutes) so the door and the rails ask "Leave the hunt?". */
function HuntFlag({ isWatcher }: { isWatcher: boolean }) {
  const game = useGameTime((s) => s.game);
  const mine = useGameTime((s) => s.me);
  const now = useServerNow(15_000);
  const active =
    !!game &&
    !isWatcher &&
    mine.member &&
    !mine.won &&
    !mine.blocked &&
    game.room_ok &&
    (game.status === "live" || (game.status === "upcoming" && !isMystery(game) && Date.parse(game.opens_at) - now <= 10 * 60_000));
  useEffect(() => {
    useRoomStore.getState().setHuntActive(active);
    return () => useRoomStore.getState().setHuntActive(false);
  }, [active]);
  return null;
}

/** Tips already shown this visit (the saved flag below carries it to the next one). */
const tipDone = new Set<string>();
const TIP_MS = 20_000;

/**
 * The one instruction, once per Game Time per device, in the banner column for the first 20 seconds it is live for me (or
 * until my first search). It sits under the banner, not in the room's pop-ups, so a zone card can never cover it. It also
 * says what HOT, WARM and COLD mean, because nothing else does.
 */
function TipCard({ isWatcher }: { isWatcher: boolean }) {
  const gameId = useGameTime((s) => (s.game?.status === "live" && s.game.room_ok && s.me.can_search && !s.me.won ? s.game.id : null));
  const searching = useGameTime((s) => !!s.searching);
  const [show, setShow] = useState(false);
  const key = gameId ? `hz-gt-tip-${gameId}` : "";

  useEffect(() => {
    if (!gameId || isWatcher || tipDone.has(gameId)) {
      setShow(false);
      return;
    }
    try {
      if (localStorage.getItem(key)) {
        tipDone.add(gameId);
        setShow(false);
        return;
      }
    } catch {
      /* storage blocked: the tip shows each visit, which is fine */
    }
    setShow(true);
    const t = setTimeout(() => done(gameId, key, setShow), TIP_MS);
    return () => clearTimeout(t);
  }, [gameId, isWatcher, key]);

  // My first search is the proof I understood.
  useEffect(() => {
    if (searching && show && gameId) done(gameId, key, setShow);
  }, [searching, show, gameId, key]);

  if (!show) return null;
  return (
    <div className={css.tip} role="status" data-gt-tip>
      <b>WALK NEXT TO A SHIMMER. PRESS SEARCH.</b>
      <span>HOT MEANS A BOX IS CLOSE. COLD MEANS FAR.</span>
    </div>
  );
}

function done(gameId: string, key: string, setShow: (v: boolean) => void) {
  tipDone.add(gameId);
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* nothing to do */
  }
  setShow(false);
}

/**
 * SEARCH, through the room's one action pill. It appears when I have stood still next to an object that may hide a box (one
 * tile, diagonals count: the server's rule), reads SEARCHING for the 2 second animation and WAIT for the rest of the 3 second
 * gap, and goes when I am two tiles away. Priority 100: Game Time wins the slot.
 */
function SearchPill({ layout, isWatcher }: { layout: CampaignLayout; isWatcher: boolean }) {
  const game = useGameTime((s) => s.game);
  const mine = useGameTime((s) => s.me);
  const searching = useGameTime((s) => s.searching);
  const cooling = useGameTime((s) => s.cooling);
  const meTile = useRoomStore((s) => s.me);

  const eligible = !isWatcher && !!game && game.status === "live" && game.room_ok && mine.member && mine.can_search && !mine.won;
  const objects = game?.objects;
  const spots = useMemo(() => (eligible && objects ? spotRects(layout, objects) : []), [eligible, layout, objects]);
  const spotsRef = useRef(spots);
  spotsRef.current = spots;

  const [target, setTarget] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const mx = meTile?.x;
  const my = meTile?.y;

  useEffect(() => {
    const clear = () => {
      shown.current = null;
      setTarget(null);
    };
    if (!eligible || mx === undefined || my === undefined) {
      clear();
      return;
    }
    const here = { x: mx, y: my };
    const near = nearestSpot(here, spotsRef.current, 1);
    const current = shown.current ? spotsRef.current.find((s) => s.id === shown.current) : null;
    if (shown.current) {
      if (!current || tilesFrom(here, current.rect) > LEAVE_TILES) {
        clear();
        return;
      }
      if (!near || near.id === shown.current) return;
    } else if (!near) return;
    const id = near.id;
    const timer = setTimeout(() => {
      shown.current = id;
      setTarget(id);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [eligible, mx, my, spots]);

  const label = searching ? "SEARCHING" : cooling ? "WAIT" : "SEARCH";
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const store = useRoomStore.getState();
    if (!target) {
      store.clearAction(PILL);
      return;
    }
    store.setAction({
      id: PILL,
      label,
      priority: 100,
      onPress: () => {
        const spot = spotsRef.current;
        const live = useRoomStore.getState().me;
        const now = live ? nearestSpot(live, spot, 1) : null;
        const id = now?.id ?? null;
        if (!id) {
          if (targetRef.current) showChip(targetRef.current, "warn", "GET CLOSER", 1500);
          return;
        }
        pressSearch(id);
      },
    });
  }, [target, label]);
  useEffect(() => () => useRoomStore.getState().clearAction(PILL), []);

  return null;
}
