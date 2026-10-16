"use client";

import { create } from "zustand";
import { floodFill } from "@/lib/campaign/geometry";
import { canWalkScene, MAP_TABLE, type CampaignLayout } from "@/lib/campaign/layout";
import { tilesFrom, type Rect, type Tile } from "./proximity";
import type { GtChip } from "./store";

/**
 * The practice hunt: a 20 second lesson in how to search, played on the phone and nowhere else. This file holds the
 * flag, the "seen" memory, the choice of the two practice objects and the little store the practice draws from. The
 * drawing and the beats are in components/game-time/HuntDemo.tsx. Nothing here talks to the server, and nothing here
 * writes the real Game Time store (store.ts): a practice object is only ever a name in this file's store.
 */

/**
 * NEXT_PUBLIC_HUNT_DEMO. Unset: on in development, off in production. "0", "false", "off" or "no": off. Anything else
 * ("1", "true"): on. Next inlines it at build time, so a change needs a new build.
 */
const RAW = process.env.NEXT_PUBLIC_HUNT_DEMO;
export const HUNT_DEMO_ON = RAW === undefined || RAW.trim() === "" ? process.env.NODE_ENV !== "production" : !/^(0|false|off|no)$/i.test(RAW.trim());

/* ------------------------------------------------------------------ memory -- */

/** The practice was finished or skipped on this phone. */
const SEEN = "hz-gt-demo-seen";
/** This phone has pressed SEARCH in a real hunt. */
const SEARCHED = "hz-gt-searched";
/** The live nudge has been shown for this Game Time on this phone. */
const nudgeKey = (gameId: string) => `hz-gt-demo-nudge-${gameId}`;

/** What this visit knows, for a phone that blocks storage: the practice still does not repeat inside one visit. */
const visit = new Set<string>();
function read(key: string): boolean {
  if (visit.has(key)) return true;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(key: string) {
  visit.add(key);
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage blocked: the visit memory above carries it until the page is closed */
  }
}

export const demoSeen = () => read(SEEN);
export const markDemoSeen = () => write(SEEN);
export const hasSearched = () => read(SEARCHED);
export const markSearched = () => write(SEARCHED);
export const nudgeShown = (gameId: string) => read(nudgeKey(gameId));
export const markNudgeShown = (gameId: string) => write(nudgeKey(gameId));

/** Forget what this phone remembers about the practice, as a first-timer's phone would be. For the dev page only. */
export function forgetDemo(gameId?: string) {
  for (const key of [SEEN, SEARCHED, gameId ? nudgeKey(gameId) : ""]) {
    if (!key) continue;
    visit.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked: nothing was kept */
    }
  }
}

/* ------------------------------------------------------------------- store -- */

/**
 * find1  the first object glows; tap it, walk there, press SEARCH
 * find2  "Warm": the second object glows
 * found  the burst
 * end    the closing line and DONE
 * A search in its two seconds is `searching`, not a step: the step stays put until the answer.
 */
export type DemoStep = "find1" | "find2" | "found" | "end";
export type DemoRun = {
  step: DemoStep;
  /** The first practice object, then the second (prop ids of the room's layout). */
  a: string;
  b: string;
  /** Started while a real hunt was on or could drop at any moment: the Hopper chose it, so a real hunt opening does not end it. */
  live: boolean;
};

type HuntDemoStore = {
  run: DemoRun | null;
  /** The practice SEARCH pill is showing (the Hopper stands still next to the glowing object). */
  armed: boolean;
  searching: { object: string } | null;
  chip: GtChip | null;
  burst: { k: number; object: string } | null;
  /** The one-line offer while a real hunt is live. */
  nudge: boolean;
  /** Counts up when the banner link, the nudge or the hub link asks for the practice. */
  ask: number;
  patch: (p: Partial<Omit<HuntDemoStore, "patch" | "askToStart">>) => void;
  askToStart: () => void;
};

export const useHuntDemo = create<HuntDemoStore>((set) => ({
  run: null,
  armed: false,
  searching: null,
  chip: null,
  burst: null,
  nudge: false,
  ask: 0,
  patch: (p) => set(p),
  askToStart: () => set((s) => ({ ask: s.ask + 1, nudge: false })),
}));

/* ------------------------------------------------------------ the objects -- */

export type Practice = { a: string; b: string };

/**
 * What the practice may glow: the solid props the real hunt may hide a box in (never the door, docs/GAME-TIME.md section 2),
 * and not the fountain, whose sticker (the crew's next event) sits over the floor beside it and takes the taps there.
 */
const FOUNTAIN = "courtyard-fountain";
function searchable(layout: CampaignLayout, avoid: readonly string[]) {
  return layout.props.filter((p) => p.solid && p.id !== MAP_TABLE && p.kind !== "maptable" && p.id !== FOUNTAIN && p.kind !== "fountain" && !avoid.includes(p.id) && p.w <= 5 && p.h <= 3);
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * How far from where I stand an object's star (its top right corner, where the tap is) still sits on the phone's screen,
 * in tiles: to either side, up and down. The follow camera keeps the avatar a little below the middle; the banner and the
 * card cover the top and the SEARCH pill the bottom (HuntDemo.tsx measures the real stage and works this out). The default
 * is a safe middle for a 390 by 844 phone.
 */
export type Sight = { side: number; up: number; down: number };
export const DEFAULT_SIGHT: Sight = { side: 4.5, up: 5, down: 5.5 };

function inSight(at: Tile, r: Rect, sight: Sight): boolean {
  const dx = r.x + r.w - (at.x + 0.5);
  const dy = r.y - (at.y + 0.5);
  return Math.abs(dx) <= sight.side && dy >= -sight.up && dy <= sight.down;
}

/** The tile beside a rectangle (one tile out, diagonals too) that is the fewest steps away on a flood, or null. */
function nearestApproach(layout: CampaignLayout, flood: ReturnType<typeof floodFill>, r: Rect): { tile: Tile; steps: number } | null {
  let best: { tile: Tile; steps: number } | null = null;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      if (!canWalkScene(layout, { x, y })) continue;
      const steps = flood.dist[y * flood.w + x];
      if (steps >= 0 && (!best || steps < best.steps)) best = { tile: { x, y }, steps };
    }
  }
  return best;
}

/** Steps beyond the straight way there: a wall or a doorway in between. */
const detour = (steps: number, a: Tile, b: Tile) => Math.max(0, steps - (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));

/**
 * Two objects for the practice, both on the phone's screen when they glow (a glow nobody can see teaches nothing). The
 * first is a short walk from `from` (about five steps, never right beside the Hopper, so there is something to tap). The
 * second is seen from where the Hopper will stand at the first, a short walk on with no wall between, clear of the first
 * so SEARCH can only mean one of them, and as "warm" as the room allows (between 5 and 10 tiles from the first, the way
 * the real rings say it). The pair is chosen together, lowest score wins, ties by id. `avoid` is the real hunt's own
 * objects: while one is live the practice never glows a place a real box may be. Null when the room has no two such objects.
 */
export function pickPractice(layout: CampaignLayout, from: Tile | null, avoid: readonly string[] = [], sight: Sight = DEFAULT_SIGHT): Practice | null {
  const start = from && canWalkScene(layout, from) ? from : layout.spawn;
  const w = layout.grid.width;
  const h = layout.grid.height;
  const walkable = (x: number, y: number) => canWalkScene(layout, { x, y });
  const flood = floodFill(start, w, h, walkable);
  const rects = searchable(layout, avoid).map((p) => ({ id: p.id, rect: { x: p.x, y: p.y, w: p.w, h: p.h } }));

  let best: { a: string; b: string; score: number } | null = null;
  for (const first of rects) {
    const near = nearestApproach(layout, flood, first.rect);
    if (!near || tilesFrom(start, first.rect) <= 1) continue;
    const scoreA = (inSight(start, first.rect, sight) ? 0 : 60) + Math.abs(near.steps - 5) + 2 * detour(near.steps, start, near.tile);

    const fromFirst = floodFill(near.tile, w, h, walkable);
    const f = centre(first.rect);
    for (const second of rects) {
      if (second.id === first.id || tilesFrom(near.tile, second.rect) <= 2) continue;
      const there = nearestApproach(layout, fromFirst, second.rect);
      if (!there) continue;
      const c = centre(second.rect);
      const apart = Math.hypot(c.x - f.x, c.y - f.y);
      const scoreB =
        (inSight(near.tile, second.rect, sight) ? 0 : 60) +
        (there.steps >= 3 && there.steps <= 9 ? 0 : 40) +
        6 * Math.max(0, detour(there.steps, near.tile, there.tile) - 2) +
        (apart > 5 && apart <= 10 ? 0 : 5) +
        Math.abs(apart - 7);
      const score = scoreA + scoreB;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && `${first.id}|${second.id}` < `${best.a}|${best.b}`)) best = { a: first.id, b: second.id, score };
    }
  }
  return best ? { a: best.a, b: best.b } : null;
}
