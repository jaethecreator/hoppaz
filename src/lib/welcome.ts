"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { supabaseConfigured } from "@/lib/supabase/client";
import { isTestHost } from "@/lib/testHost";
import { useSession } from "@/lib/useSession";

/**
 * The first run (docs/UI-UPGRADE.md sections 2 and 8): a new Hopper is shown where they are, looks into the nearest hotspot
 * room, makes their Hopper, steps in (the sign-up), spawns in that room, and is then taken to the map for a four-step tour
 * that points at the real controls. The room part is /welcome; the tour is on "/" (components/welcome).
 *
 * Nobody may get stuck in it: every step has a Skip, and finishing or skipping writes "done", which is final.
 * WELCOME_ENABLED is the kill switch.
 */
export const WELCOME_ENABLED = true;

/** Where the person is, and so what to resume at: "tour" means the room part is over and the map tour is next. */
export type WelcomeStep = "splash" | "place" | "peek" | "look" | "stepin" | "tour" | "done";
const STEPS: ReadonlyArray<WelcomeStep> = ["splash", "place", "peek", "look", "stepin", "tour", "done"];
const KEY = "hz-welcome-v1";

/** Private mode cannot save, so a step is also kept for this visit: the map must not bounce them back to /welcome every time. */
let remembered: WelcomeStep | null = null;

function readSaved(): WelcomeStep | null {
  if (remembered) return remembered;
  try {
    const v = localStorage.getItem(KEY);
    return STEPS.includes(v as WelcomeStep) ? (v as WelcomeStep) : null;
  } catch {
    return null;
  }
}

function save(step: WelcomeStep) {
  remembered = step;
  try {
    localStorage.setItem(KEY, step);
  } catch {
    /* private mode: kept for this visit only */
  }
}

type WelcomeState = {
  step: WelcomeStep | null;
  /** The saved step has been read (it needs the browser). */
  ready: boolean;
  hydrate: () => void;
  go: (step: WelcomeStep) => void;
  finish: () => void;
  /** Test hosts: start again from the top. */
  restart: () => void;
};

export const useWelcome = create<WelcomeState>((set, get) => ({
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
  restart: () => {
    remembered = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
    set({ step: null, ready: true });
  },
}));

/** The Hopper has been through the old Paz tour on this phone (its flags stayed in the saved settings): do not show them this one. */
function sawOldTour(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem("hoppaz.v1") ?? "null") as { state?: { seenTitle?: boolean; seenIntro?: boolean } } | null;
    return !!(raw?.state?.seenTitle || raw?.state?.seenIntro);
  } catch {
    return false;
  }
}

/** A link that takes someone to one thing (an event, a hotspot, a day) is never hijacked by the welcome. */
function isDeepLink(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has("e") || q.has("hotspot") || q.has("date");
}

/**
 * Mount on the map page. A Hopper who has not done the welcome is sent to /welcome (or, if they already have an account,
 * straight to the map tour). `?welcome` on a test host starts it again.
 */
export function useWelcomeGate() {
  const router = useRouter();
  const { hasAccount, state } = useSession();
  const { step, ready, hydrate, go, finish, restart } = useWelcome();
  useEffect(() => hydrate(), [hydrate]);
  useEffect(() => {
    if (!WELCOME_ENABLED || !ready || state === "loading") return;
    const forced = isTestHost() && new URLSearchParams(window.location.search).has("welcome");
    if (forced) {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      restart();
      return;
    }
    if (step === "done" || step === "tour") return;
    if (step === null) {
      // Nothing saved: a Hopper who did the old tour, or came for one thing, is left alone.
      if (sawOldTour()) return finish();
      if (isDeepLink()) return;
      // Someone who already has an account skips the room part and gets the tour once.
      if (hasAccount) return go("tour");
      go("splash");
      router.replace("/welcome");
      return;
    }
    // Part way through (they left, or came back from the sign-up): carry on in the room part.
    if (hasAccount && step === "stepin") go("tour");
    else router.replace("/welcome");
  }, [ready, state, step, hasAccount, router, go, finish, restart]);
}

/** Without a database (the local demo) nothing is gated, and the sign-up step has nowhere to go. */
export const welcomeNeedsAccount = () => supabaseConfigured();
