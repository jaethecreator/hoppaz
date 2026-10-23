"use client";

import { useEffect } from "react";
import { busIntroPending } from "@/lib/opening/busIntro";
import { OPENING_ENABLED } from "@/lib/opening/flags";
import { BACKGROUND_GAP_MS, OPENING_FADE_MS, OPENING_MS, OPENING_SKIP_PATH, OPENING_STILL_MS } from "@/lib/opening/timing";

/**
 * The part of the opening that needs script (src/components/opening/OpeningCover.tsx draws it, BOOT_SCRIPT starts it on a cold
 * start, and the CSS ends it by itself after OPENING_MS even if this never runs):
 *   - tidies up once it is over (takes html[data-opening] off), so it can play again
 *   - a tap, or Escape, takes it away at once (a short fade)
 *   - the app coming back after BACKGROUND_GAP_MS or more in the background plays it again, on any screen but the ones that never
 *     get it, and not before a first-time device has had its title sequence
 * Moving between screens inside the app never plays it: nothing here looks at the route except to leave the quiet screens out.
 */
export default function OpeningHost() {
  useEffect(() => {
    if (!OPENING_ENABLED) return;
    const root = document.documentElement;
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      root.removeAttribute("data-opening");
    };
    /** Fade, then off. */
    const leave = () => {
      if (root.getAttribute("data-opening") !== "in") return;
      clearTimeout(timer);
      root.setAttribute("data-opening", "out");
      timer = setTimeout(stop, OPENING_FADE_MS);
    };
    /** After `ms`, wherever the clock is now. */
    const endIn = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(stop, Math.max(0, ms));
    };
    const total = () => (reduced() ? OPENING_STILL_MS + OPENING_FADE_MS : OPENING_MS);

    // A cold start: the boot script already started it, at its own time zero (or a tap already sent it out before this was up).
    const now = root.getAttribute("data-opening");
    if (now === "in") {
      const t0 = (window as unknown as { __hzOpenT?: number }).__hzOpenT ?? 0;
      endIn(total() - (performance.now() - t0));
    } else if (now === "out") {
      endIn(OPENING_FADE_MS);
    }

    const replay = () => {
      stop();
      void root.offsetWidth; // the cover is off now; this makes the next change a fresh start for its animations
      root.setAttribute("data-opening", "in");
      endIn(total());
    };

    let hiddenAt = 0;
    const away = () => {
      if (!hiddenAt) hiddenAt = Date.now();
    };
    const back = () => {
      const gap = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (gap >= BACKGROUND_GAP_MS && !OPENING_SKIP_PATH.test(location.pathname) && !busIntroPending()) replay();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
    const onPageShow = (e: PageTransitionEvent) => e.persisted && back();
    const onTap = (e: Event) => {
      if (root.getAttribute("data-opening") !== "in") return;
      e.preventDefault();
      e.stopPropagation();
      leave();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") leave();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pointerdown", onTap, true);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", onTap, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
