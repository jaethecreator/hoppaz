"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import { serverNow } from "@/lib/game-time/clock";
import { isMystery } from "@/lib/game-time/drops";
import { DEFAULT_SIGHT, demoSeen, hasSearched, HUNT_DEMO_ON, markDemoSeen, markNudgeShown, nudgeShown, pickPractice, useHuntDemo, type DemoRun, type Sight } from "@/lib/game-time/huntDemo";
import { nearestSpot, tilesFrom, type Rect, type SpotRect } from "@/lib/game-time/proximity";
import { useGameTime, type GtChip } from "@/lib/game-time/store";
import { CHIP_MS, LEAVE_TILES, SEARCH_ANIMATION_MS, SETTLE_MS } from "@/lib/game-time/timing";
import { approachTile, Burst, layoutRect, Outline, SearchFx, Spot } from "./GameTimeWorld";
import { Hint } from "./HintLayer";
import css from "./GameTime.module.css";

/**
 * The practice hunt, the half that draws and plays it (the flag, the memory and the choice of objects are in
 * lib/game-time/huntDemo.ts). Three short beats in the real room, on the phone only: no server call, no real box, no code,
 * no win recorded. It reads the real Game Time store (is a hunt on? am I a member?) and the room store (where am I? walk me),
 * and writes only the practice store. Its two objects are props of the room named only in that store, so no one else sees them.
 *
 *   1  one object glows. "Boxes hide in things. Tap a glowing object." The avatar walks there, SEARCH appears (the room's
 *      one pill, priority 101, so it wins over a real SEARCH only while I stand at a practice object), and the search plays
 *      for the same 2 seconds as the real one.
 *   2  "Warm. A box is close." on the object (the real hint chip, in sentence case) and a second object glows.
 *   3  the same again on the second object: "Found it!", a small burst, then the closing line and DONE.
 *
 * WHEN IT SHOWS
 *   on its own, once    the first time a member is in a room where a Game Time is coming up, never searched and never saw it,
 *                       and the opening is more than two minutes off (so it is over long before GO)
 *   a one-line nudge    instead of that, while a hunt is live, a mystery drop could fall at any moment, or the opening is
 *                       close: "New here? Try a 20-second practice". It plays nothing until it is tapped
 *   on request, always  "How to hunt" on the banner and on the hub card, and the nudge
 * SKIP stops it at any time and remembers that on this phone. If a real hunt opens while a practice is running (one that
 * began before it was live), the practice ends on the spot and is not marked seen, so nobody misses a real box.
 */

export const HUNT_DEMO_COPY = {
  nudge: "New here? Try a 20-second practice",
  link: "How to hunt",
  label: "Practice",
  skip: "Skip",
  done: "Done",
  glow1: "Boxes hide in things. Tap a glowing object.",
  press: "Now press Search.",
  searching: "Searching.",
  warm: "Warm. A box is close.",
  glow2: "Warm means close. Tap the other glowing object.",
  found: "Found it!",
  end: "That's how Game Time works. Real boxes hide like this when a hunt is live.",
  closer: "Get closer.",
} as const;

const PILL = "gt-demo-search";
/** The burst plays this long before the closing line. */
const FOUND_MS = 1600;
/** The opening must be at least this far off for the practice to start by itself. */
const AUTO_LEAD_MS = 2 * 60_000;
/** The nudge goes by itself after this long (the link stays). */
const NUDGE_MS = 20_000;

/* ------------------------------------------------------------------ driver -- */

/** The practice is one at a time on one screen, so its clock and its room live here, not in a component. */
const timers = new Set<ReturnType<typeof setTimeout>>();
let layoutNow: CampaignLayout | null = null;
let seq = 0;

const patch = (p: Parameters<ReturnType<typeof useHuntDemo.getState>["patch"]>[0]) => useHuntDemo.getState().patch(p);
const later = (ms: number, fn: () => void) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};
const rectOf = (id: string): Rect | null => (layoutNow ? (layoutRect(layoutNow, id)?.rect ?? null) : null);

/** End the practice. `mark` writes "seen" on this phone (SKIP and DONE); a practice cut short by a real hunt does not. */
export function stopDemo(mark: boolean) {
  timers.forEach(clearTimeout);
  timers.clear();
  if (mark) markDemoSeen();
  patch({ run: null, armed: false, searching: null, chip: null, burst: null });
}

function showChip(object: string, tone: GtChip["tone"], text: string, ms = CHIP_MS) {
  const k = ++seq;
  patch({ chip: { k, object, tone, text } });
  later(ms, () => {
    if (useHuntDemo.getState().chip?.k === k) patch({ chip: null });
  });
}

/**
 * What the phone's screen shows around my avatar, from the real stage (the chrome layer fills it) and the camera's own
 * rule (roomCamera.ts followScale: about eleven tiles across; the avatar sits a little below the middle). The top 185 px
 * are the banner and the card, the bottom 76 px the CHAT button and the SEARCH pill. Half a tile is kept as a margin above and below, a tile and a bit at the sides.
 */
function sightOf(tile: number): Sight {
  const el = document.querySelector<HTMLElement>('[data-game-time-layer="chrome"]');
  const w = el?.clientWidth ?? 0;
  const h = el?.clientHeight ?? 0;
  if (w < 200 || h < 300) return DEFAULT_SIGHT;
  const px = tile * Math.min(Math.min(Math.max(w / 352, 0.95), 1.3), h / (tile * 9));
  return { side: Math.max(2, w / 2 / px - 1.3), up: Math.max(1.5, (h * 0.56 - 185) / px - 0.5), down: Math.max(1.5, (h * 0.44 - 76) / px - 0.5) };
}

/** Start the practice. False when there is nowhere to draw it or the room has no two objects for it. */
function startDemo(): boolean {
  const st = useHuntDemo.getState();
  if (st.run || !layoutNow) return false;
  if (!document.querySelector("[data-hunt-demo-world]")) return false;
  const game = useGameTime.getState().game;
  // While a real hunt is live the practice never glows a place a real box may be.
  const picked = pickPractice(layoutNow, useRoomStore.getState().me, game?.objects ?? [], sightOf(layoutNow.grid.tile));
  if (!picked) return false;
  timers.forEach(clearTimeout);
  timers.clear();
  patch({ run: { step: "find1", a: picked.a, b: picked.b, live: game?.status === "live" || isMystery(game) }, armed: false, searching: null, chip: null, burst: null, nudge: false });
  return true;
}

/** The practice SEARCH was pressed: the real search's 2 seconds, then the answer. */
function pressDemo() {
  const st = useHuntDemo.getState();
  const run = st.run;
  if (!run || st.searching) return;
  const step = run.step === "find1" || run.step === "find2" ? run.step : null;
  const object = step === "find1" ? run.a : step === "find2" ? run.b : null;
  const rect = object ? rectOf(object) : null;
  if (!step || !object || !rect) return;
  const here = useRoomStore.getState().me;
  if (!here || tilesFrom(here, rect) > 1) {
    showChip(object, "warn", HUNT_DEMO_COPY.closer, 1500);
    return;
  }
  patch({ searching: { object }, chip: null });
  sfx.swish();
  later(SEARCH_ANIMATION_MS, () => answer(step, object));
}

function answer(step: "find1" | "find2", object: string) {
  const cur = useHuntDemo.getState().run;
  if (!cur || cur.step !== step) return;
  patch({ searching: null, armed: false });
  if (step === "find1") {
    // The first object holds nothing, and it is warm: the second object glows.
    patch({ run: { ...cur, step: "find2" } });
    showChip(object, "warm", HUNT_DEMO_COPY.warm);
    sfx.chime(1);
    haptics.buzz("snap");
    return;
  }
  patch({ run: { ...cur, step: "found" }, burst: { k: ++seq, object }, chip: null });
  sfx.sparkle();
  haptics.buzz("burstBig");
  later(FOUND_MS, () => {
    const r = useHuntDemo.getState().run;
    if (r) patch({ run: { ...r, step: "end" }, burst: null });
  });
}

/* ---------------------------------------------------------------- director -- */

/** Decides when the practice starts, ends and offers itself (and mounts its SEARCH pill while it runs). Draws nothing. */
function Director({ layout, isWatcher, ready }: { layout: CampaignLayout; isWatcher: boolean; ready: boolean }) {
  const game = useGameTime((s) => s.game);
  const mine = useGameTime((s) => s.me);
  const loaded = useGameTime((s) => s.ready);
  const realSearching = useGameTime((s) => !!s.searching);
  const run = useHuntDemo((s) => s.run);
  const nudge = useHuntDemo((s) => s.nudge);
  const ask = useHuntDemo((s) => s.ask);
  const sheet = useRoomStore((s) => s.sheet);

  // A Hopper the practice is for: in the room, can walk, can hunt this one. (A watcher, a blocked member and a winner cannot.)
  const learner = ready && !isWatcher && loaded && !!game && game.room_ok && game.status !== "over" && mine.member && !mine.blocked && !mine.won;

  useLayoutEffect(() => {
    layoutNow = layout;
    return () => {
      layoutNow = null;
      stopDemo(false);
      patch({ nudge: false });
      useRoomStore.getState().clearAction(PILL);
    };
  }, [layout]);

  // Once a room opens with a Game Time in it: ?hunt=practice (the hub link) starts it, a first-timer gets it or the nudge.
  const decided = useRef(false);
  useEffect(() => () => void (decided.current = false), []);
  useEffect(() => {
    if (!learner || decided.current || sheet !== "closed" || !game) return;
    decided.current = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get("hunt") === "practice") {
      url.searchParams.delete("hunt");
      try {
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      } catch {
        /* the address stays as it is: harmless, the practice only starts once per visit */
      }
      startDemo();
      return;
    }
    if (demoSeen() || hasSearched()) return;
    const farOff = game.status === "upcoming" && !isMystery(game) && Date.parse(game.opens_at) - serverNow() > AUTO_LEAD_MS;
    if (farOff) {
      startDemo();
    } else if (!nudgeShown(game.id)) {
      markNudgeShown(game.id);
      patch({ nudge: true });
    }
  }, [learner, sheet, game]);

  // The banner link, the hub link and the nudge ask for it. An ask made before the room is ready waits for it.
  const handled = useRef(ask);
  useEffect(() => {
    if (ask === handled.current || !learner) return;
    handled.current = ask;
    startDemo();
  }, [ask, learner]);

  // A real hunt that opens, a win, or leaving the room ends a practice that is in the way.
  const status = game?.status;
  useEffect(() => {
    if (!run) return;
    if (!learner || (!run.live && status === "live")) stopDemo(false);
  }, [run, learner, status]);

  // The nudge goes by itself, and as soon as I search for real.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => patch({ nudge: false }), NUDGE_MS);
    return () => clearTimeout(t);
  }, [nudge]);
  useEffect(() => {
    if ((realSearching || !learner) && nudge) patch({ nudge: false });
  }, [realSearching, learner, nudge]);

  return run ? <Pill run={run} /> : null;
}

/**
 * The practice SEARCH pill, while a practice runs. It appears after 450 ms standing still within one tile of the glowing
 * object and goes at two tiles (the real pill's rule, the same timing), through the room's one action pill.
 */
function Pill({ run }: { run: DemoRun }) {
  const armed = useHuntDemo((s) => s.armed);
  const searching = useHuntDemo((s) => !!s.searching);
  const mx = useRoomStore((s) => s.me?.x);
  const my = useRoomStore((s) => s.me?.y);
  const target = run.step === "find1" ? run.a : run.step === "find2" ? run.b : null;

  useEffect(() => {
    if (!target) {
      if (armed) patch({ armed: false });
      return;
    }
    const rect = rectOf(target);
    const d = rect && mx !== undefined && my !== undefined ? tilesFrom({ x: mx, y: my }, rect) : 99;
    if (armed) {
      if (d > LEAVE_TILES && !searching) patch({ armed: false });
      return;
    }
    if (d > 1) return;
    const t = setTimeout(() => patch({ armed: true }), SETTLE_MS);
    return () => clearTimeout(t);
  }, [target, mx, my, armed, searching]);

  useEffect(() => {
    const store = useRoomStore.getState();
    if (!(armed && target)) {
      store.clearAction(PILL);
      return;
    }
    store.setAction({ id: PILL, label: searching ? "SEARCHING" : "SEARCH", priority: 101, onPress: pressDemo });
  }, [armed, target, searching]);
  useEffect(() => () => useRoomStore.getState().clearAction(PILL), []);

  return null;
}

/* ----------------------------------------------------------------- visuals -- */

/** The glow on the practice objects (the real stars and outlines), the search, the burst, and the hint chip. */
function Visuals({ layout }: { layout: CampaignLayout }) {
  const run = useHuntDemo((s) => s.run);
  const chip = useHuntDemo((s) => s.chip);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const running = !!run;
  useLayoutEffect(() => {
    setHost(running ? document.querySelector<HTMLElement>("[data-hunt-demo-world]") : null);
  }, [running]);

  return (
    <>
      {host && run && createPortal(<Glow layout={layout} run={run} />, host)}
      {chip && <Hint key={chip.k} chip={chip} layout={layout} soft />}
    </>
  );
}

/** In the scaled world (scene px): only mounted while a practice runs. */
function Glow({ layout, run }: { layout: CampaignLayout; run: DemoRun }) {
  const searching = useHuntDemo((s) => s.searching);
  const burst = useHuntDemo((s) => s.burst);
  const mx = useRoomStore((s) => s.me?.x);
  const my = useRoomStore((s) => s.me?.y);
  const full = useRoomStore((s) => s.view) === "full";
  const tile = layout.grid.tile;
  const { a, b } = run;
  const spots = useMemo<SpotRect[]>(() => [a, b].flatMap((id) => layoutRect(layout, id) ?? []), [layout, a, b]);
  const spotsRef = useRef(spots);
  spotsRef.current = spots;

  // A tap on a glowing object walks me next to it, to the tile where SEARCH can only mean that object.
  const goNear = useCallback(
    (id: string) => {
      const room = useRoomStore.getState();
      const rect = layoutRect(layout, id)?.rect;
      if (!room.me || !room.walkTo || !rect) return;
      const dest = approachTile(layout, room.me, id, rect, spotsRef.current);
      if (dest) room.walkTo(dest.x, dest.y);
    },
    [layout],
  );

  const glowing = run.step === "find1" ? a : run.step === "find2" ? b : undefined;
  const glow = glowing ? layoutRect(layout, glowing) : null;
  const searched = searching ? layoutRect(layout, searching.object) : null;
  const burstAt = burst ? layoutRect(layout, burst.object) : null;
  const here = mx === undefined || my === undefined ? null : { x: mx, y: my };
  const level = glow && here ? (nearestSpot(here, spots, 1)?.id === glow.id ? "in" : tilesFrom(here, glow.rect) <= 3 ? "near" : "far") : "far";

  return (
    <>
      {glow && !full && <Outline id={glow.id} rect={glow.rect} tile={tile} lit={level === "in"} />}
      {glow && <Spot id={glow.id} x={(glow.rect.x + glow.rect.w) * tile - 4} y={glow.rect.y * tile + 4} level={level} twinkle dot={full} pop={false} onGo={here ? goNear : null} />}
      {searched && <SearchFx rect={searched.rect} tile={tile} />}
      {burst && burstAt && <Burst key={burst.k} k={burst.k} rect={burstAt.rect} tile={tile} />}
    </>
  );
}

/**
 * The practice hunt, in the room's screen layer. Mount it where GameTimeChrome mounts the hint layer (a direct child of the
 * `data-game-time-layer="chrome"` wrapper), with <HuntDemoCard /> in the banner column. It draws the glow into the room's
 * `[data-hunt-demo-world]` layer (CampaignWorld). Nothing when the flag is off.
 */
export function HuntDemoStage({ layout, isWatcher, ready }: { layout: CampaignLayout; isWatcher: boolean; ready: boolean }) {
  if (!HUNT_DEMO_ON) return null;
  return (
    <>
      <Director layout={layout} isWatcher={isWatcher} ready={ready} />
      <Visuals layout={layout} />
    </>
  );
}

/* -------------------------------------------------------------------- card -- */

/** The one line of the practice, in the banner column under the banner, or the one-line nudge. */
export function HuntDemoCard() {
  const run = useHuntDemo((s) => s.run);
  const armed = useHuntDemo((s) => s.armed);
  const searching = useHuntDemo((s) => !!s.searching);
  const nudge = useHuntDemo((s) => s.nudge);
  if (!HUNT_DEMO_ON) return null;

  if (run) {
    const end = run.step === "end";
    const line = searching
      ? HUNT_DEMO_COPY.searching
      : run.step === "find1"
        ? armed
          ? HUNT_DEMO_COPY.press
          : HUNT_DEMO_COPY.glow1
        : run.step === "find2"
          ? armed
            ? HUNT_DEMO_COPY.press
            : HUNT_DEMO_COPY.glow2
          : run.step === "found"
            ? HUNT_DEMO_COPY.found
            : HUNT_DEMO_COPY.end;
    return (
      <div className={css.demo} role="status" aria-live="polite" data-gt-tip data-hunt-demo={run.step} data-hunt-objects={`${run.a},${run.b}`}>
        <div className={css.demoHead}>
          <span className={css.demoLabel}>{HUNT_DEMO_COPY.label}</span>
          {!end && (
            <button type="button" className={css.demoSkip} onClick={() => stopDemo(true)} data-hunt-demo-skip>
              {HUNT_DEMO_COPY.skip}
            </button>
          )}
        </div>
        <p className={css.demoLine}>{line}</p>
        {end && (
          <button type="button" className={`btn ${css.demoDone}`} onClick={() => stopDemo(true)} data-hunt-demo-done>
            {HUNT_DEMO_COPY.done}
          </button>
        )}
      </div>
    );
  }

  if (nudge) {
    return (
      <button type="button" className={css.demoNudge} data-gt-tip data-hunt-demo-nudge onClick={() => useHuntDemo.getState().askToStart()}>
        <Play size={13} fill="currentColor" aria-hidden />
        {HUNT_DEMO_COPY.nudge}
      </button>
    );
  }
  return null;
}

/**
 * "How to hunt", the quiet link on the Game Time banner. Only for a member who can hunt this Game Time (not a watcher, not
 * blocked, not already a winner), while the practice is not already running.
 */
export function HowToHunt({ isWatcher }: { isWatcher: boolean }) {
  const running = useHuntDemo((s) => !!s.run);
  const game = useGameTime((s) => s.game);
  const mine = useGameTime((s) => s.me);
  if (!HUNT_DEMO_ON || running || isWatcher || !game || !game.room_ok || game.status === "over" || !mine.member || mine.blocked || mine.won) return null;
  return (
    <button type="button" className={css.how} onClick={() => useHuntDemo.getState().askToStart()} data-hunt-demo-link>
      {HUNT_DEMO_COPY.link}
    </button>
  );
}
