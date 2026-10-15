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
 * Every layer can be closed, and closing ends the first run for good. FIRST_RUN_ENABLED is the kill switch.
 */
export const FIRST_RUN_ENABLED = true;

export type FirstRunStep = "location" | "events" | "home" | "arrived" | "done";
const STEPS: ReadonlyArray<FirstRunStep> = ["location", "events", "home", "arrived", "done"];
const KEY = "hz-firstrun-v1";

/** Private mode cannot save, so the step is also kept for this visit. */
let remembered: FirstRunStep | null = null;

function readSaved(): FirstRunStep | null {
  if (remembered) return remembered;
  try {
    const v = localStorage.getItem(KEY);
    return STEPS.includes(v as FirstRunStep) ? (v as FirstRunStep) : null;
  } catch {
    return null;
  }
}

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
 * saved settings) is left alone; someone who has set a location already starts at the events layer.
 */
export function startingStep(): FirstRunStep {
  try {
    const raw = JSON.parse(localStorage.getItem("hoppaz.v1") ?? "null") as { state?: { seenTitle?: boolean; seenIntro?: boolean; fix?: unknown } } | null;
    if (raw?.state?.seenTitle || raw?.state?.seenIntro) return "done";
    if (raw?.state?.fix) return "events";
  } catch {
    /* unreadable settings: start from the top */
  }
  return "location";
}

type FirstRunState = {
  step: FirstRunStep | null;
  /** The saved step has been read (it needs the browser). */
  ready: boolean;
  hydrate: () => void;
  go: (step: FirstRunStep) => void;
  finish: () => void;
};

export const useFirstRun = create<FirstRunState>((set, get) => ({
  step: null,
  ready: false,
  hydrate: () => {
    if (!get().ready) set({ step: readSaved(), ready: true });
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
