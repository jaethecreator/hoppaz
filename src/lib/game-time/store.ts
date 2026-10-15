"use client";

import { create } from "zustand";
import type { GtGame, GtMe } from "./types";

/**
 * What the room knows about its Game Time right now. The chrome mount of GameTimeLayer runs the controller
 * (controller.ts) that fills this; the world mount, the banner, the pill and the win sheet only read it. One store, so
 * the two mounts of the layer never poll twice.
 */

/** A hint or a refusal drawn over an object: "NOTHING HERE · WARM", "GET CLOSER". */
export type GtChip = { k: number; object: string; tone: "cold" | "warm" | "hot" | "warn" | "info"; text: string };
/** A line under the banner about the room: "ADA FOUND A BOX. 6 LEFT." */
export type GtFeedChip = { k: number; text: string };
/** The win sheet. */
export type GtWin = { code: string; title: string; object: string; gameId: string; over: boolean; fresh: boolean };

export const NO_ME: GtMe = { member: false, won: false, code: null, won_at: null, can_search: false };

type GtStore = {
  crewId: string | null;
  /** The first answer has arrived. */
  ready: boolean;
  /** The last poll failed: the HUD keeps what it has and says nothing loud. */
  offline: boolean;
  game: GtGame | null;
  me: GtMe;
  /** A search is in its 2 second animation, on this object. */
  searching: { object: string } | null;
  /** The 3 second gap between searches is running. */
  cooling: boolean;
  chip: GtChip | null;
  feed: GtFeedChip[];
  /** Boxes found by other Hoppers: a puff on the object where it was, for a moment. */
  poofs: { k: number; object: string }[];
  /** My win: the burst on the object, before the sheet rises. */
  burst: { k: number; object: string } | null;
  /** Counts up at the GO of the opening, so every star bursts once. */
  go: number;
  win: GtWin | null;
  patch: (p: Partial<Omit<GtStore, "patch" | "reset">>) => void;
  reset: (crewId: string | null) => void;
};

const fresh = (crewId: string | null) => ({
  crewId,
  ready: false,
  offline: false,
  game: null as GtGame | null,
  me: NO_ME,
  searching: null as { object: string } | null,
  cooling: false,
  chip: null as GtChip | null,
  feed: [] as GtFeedChip[],
  poofs: [] as { k: number; object: string }[],
  burst: null as { k: number; object: string } | null,
  go: 0,
  win: null as GtWin | null,
});

export const useGameTime = create<GtStore>((set) => ({
  ...fresh(null),
  patch: (p) => set(p),
  reset: (crewId) => set(fresh(crewId)),
}));

/** The hunt as the room sees it, in one word. */
export type GtPhase = "none" | "upcoming" | "live" | "over";
export const phaseOf = (game: GtGame | null): GtPhase => (game ? game.status : "none");
