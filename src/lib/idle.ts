"use client";

import { useSyncExternalStore } from "react";

/**
 * Small helpers the pollers share so a phone that nobody is touching, or a tab nobody is looking at, asks the database
 * for less.
 *
 *   idleMs()     how long since the last tap, key press, touch or wheel
 *   hidden()     the page is not in front
 *   backoff()    a poll gap that stretches the longer the person is idle (x1, then x2, then x4), up to a cap
 *   jitter()     a gap with a random spread, so a thousand phones do not knock together
 *   mapShown()   the map has drawn (or 4 s have passed, or this is not the map page): non-critical reads may start
 */

const INPUTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
let lastInput = 0;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  lastInput = Date.now();
  const on = () => {
    lastInput = Date.now();
  };
  for (const name of INPUTS) window.addEventListener(name, on, { passive: true, capture: true });
}

/** Milliseconds since the last pointerdown, keydown, touchstart or wheel. The listeners are installed on first use. */
export function idleMs(): number {
  install();
  return lastInput ? Date.now() - lastInput : 0;
}

/** True while the page is not in front (a background tab, a locked phone). */
export function hidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** `base` while the person is active, x2 after `after1` ms idle, x4 after `after2` ms idle, never more than `max`. */
export function backoff(base: number, opts: { after1?: number; after2?: number; max?: number } = {}): number {
  const { after1 = 60_000, after2 = 180_000, max = Infinity } = opts;
  const idle = idleMs();
  const factor = idle >= after2 ? 4 : idle >= after1 ? 2 : 1;
  return Math.min(base * factor, max);
}

/** `ms` spread by +/- `frac` (0.2 gives 80% to 120%). */
export function jitter(ms: number, frac = 0.2): number {
  return Math.round(ms * (1 - frac + Math.random() * 2 * frac));
}

/* ------------------------------------------------------------- the map -- */

/** If nothing says the map drew, the deferred reads start this long after the first one asked. */
const MAP_FALLBACK_MS = 4000;

let shown = false;
let fallbackArmed = false;
const listeners = new Set<() => void>();

function set() {
  if (shown) return;
  shown = true;
  listeners.forEach((fn) => fn());
}

function arm() {
  if (shown || fallbackArmed || typeof window === "undefined") return;
  fallbackArmed = true;
  setTimeout(set, MAP_FALLBACK_MS);
}

/** The map page calls this when the map has loaded. Reads that can wait for the pins start now. */
export function markMapShown() {
  set();
}

/**
 * Can the non-critical reads start? True once the map has loaded, 4 s after the first ask on any page (the map may never
 * load: no WebGL, offline), and at once on every page that is not the map.
 */
export function mapShown(): boolean {
  if (shown) return true;
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== "/") {
    // Staying true for this page load: coming back to the map later must not close the gate again.
    shown = true;
    return true;
  }
  arm();
  return false;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  arm();
  return () => {
    listeners.delete(fn);
  };
}

/** `mapShown()` for a component: it renders again when the map draws. */
export function useMapShown(): boolean {
  return useSyncExternalStore(subscribe, mapShown, () => false);
}
