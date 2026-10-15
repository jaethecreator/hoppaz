"use client";

import { create } from "zustand";

/**
 * The first run, in layers over the app as it always was (no splash, no pager, no Next buttons):
 *   location  a small card: "Set your location to see the best events near you."
 *             Once it is set the map does its normal zoom to you and shows you on it.
 *   events    the second layer, a word from Paz at the side: the best events near you are on the map; zoom in, or pick any
 *             day. It stays out of the way.
 *   home      the third layer, brought in when the map has been looked at and then left still (or after a while): the
 *             map moves to the closest hotspot, your avatar runs there, the pin bobs, and its room opens.
 *   arrived   in the room, Paz says to chat with someone in your area. Then they are free.
 * Every layer can be closed, and closing ends the first run for good. FIRST_RUN_ENABLED is the kill switch. It is for
 * someone new: anyone with an account, and anyone who arrives on a link to one thing, never gets it.
 */
export const FIRST_RUN_ENABLED = true;

export type FirstRunStep = "location" | "events" | "home" | "arrived" | "done";
const STEPS: ReadonlyArray<FirstRunStep> = ["location", "events", "home", "arrived", "done"];
const KEY = "hz-first-v2";

/**
 * Ola's location ask on the Events page (src/components/today/LocationAsk.tsx, upstream 1c1ebe0) remembers its answer in
 * this key. The first run's location card reads and writes the same one, so a Hopper who answered either is not asked
 * again by the other.
 */
const ASK_KEY = "hoppaz.locationAsk";
export const locationAsked = (): boolean => {
  try {
    return !!localStorage.getItem(ASK_KEY);
  } catch {
    return false;
  }
};
export const rememberLocationAsk = (a: "yes" | "no") => {
  try {
    localStorage.setItem(ASK_KEY, a);
  } catch {
    /* private window: it asks again next visit, no harm */
  }
};
/**
 * The location question was put to this Hopper (by either card) and they moved on without answering. That is an answer for
 * this purpose: neither card asks again. It never overwrites a real "yes" or "no".
 */
export const markLocationAsked = () => {
  try {
    if (!localStorage.getItem(ASK_KEY)) localStorage.setItem(ASK_KEY, "seen");
  } catch {
    /* private window */
  }
};

/**
 * Private mode cannot save, so the step is also kept for this visit. It is only the fallback: what is saved wins, so a step
 * another tab saved (or its "done") is the one every tab goes by.
 */
let remembered: FirstRunStep | null = null;

function readSaved(): FirstRunStep | null {
  try {
    const v = localStorage.getItem(KEY);
    if (STEPS.includes(v as FirstRunStep)) return v as FirstRunStep;
    if (v === null) return remembered;
    return null;
  } catch {
    return remembered;
  }
}

/** The key a tab hears about when another tab changes the saved step (the `storage` event). */
export const FIRST_RUN_KEY = KEY;

function save(step: FirstRunStep) {
  remembered = step;
  try {
    localStorage.setItem(KEY, step);
  } catch {
    /* private mode: kept for this visit only */
  }
}

/**
 * Where a Hopper with nothing saved starts. Someone who went through the old Paz tour on this phone (its flags stayed in the
 * saved settings) is left alone; someone who has set a location already, or answered the location ask, starts at the events
 * layer.
 */
export function startingStep(): FirstRunStep {
  try {
    const raw = JSON.parse(localStorage.getItem("hoppaz.v1") ?? "null") as { state?: { seenTitle?: boolean; seenIntro?: boolean; fix?: unknown } } | null;
    if (raw?.state?.seenTitle || raw?.state?.seenIntro) return "done";
    if (raw?.state?.fix) return "events";
  } catch {
    /* unreadable settings: start from the top */
  }
  return locationAsked() ? "events" : "location";
}

type FirstRunState = {
  step: FirstRunStep | null;
  /** The saved step has been read (it needs the browser). */
  ready: boolean;
  hydrate: () => void;
  /** Another tab changed the saved step: follow it. */
  sync: () => void;
  go: (step: FirstRunStep) => void;
  finish: () => void;
};

export const useFirstRun = create<FirstRunState>((set, get) => ({
  step: null,
  ready: false,
  hydrate: () => {
    if (!get().ready) set({ step: readSaved(), ready: true });
  },
  sync: () => {
    const saved = readSaved();
    // "Done" in another tab is done here too; a step never walks backwards because of another tab.
    if (saved === "done" && get().step !== "done") set({ step: "done" });
  },
  go: (step) => {
    save(step);
    set({ step, ready: true });
  },
  finish: () => {
    save("done");
    set({ step: "done", ready: true });
  },
}));
