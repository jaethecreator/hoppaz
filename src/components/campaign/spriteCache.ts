"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LOOK, normalizeLook, type Look } from "@/lib/avatar";
import { avatarSvg } from "@/lib/avatarSvg";

/**
 * The room's Hopper sprites, made one at a time so a crowd never freezes the phone.
 *
 * A Hopper is drawn as an SVG of about 77 nodes (src/lib/avatarSvg.ts). Handing 60 different ones to the browser in one
 * go makes it parse, style and lay out 60 SVG documents on the main thread: on a 4x throttled phone that was one frame
 * of 2.7 s right after the room opened, and more long frames on the first walk (docs: the fixer's perf notes).
 *
 * So the room draws a Hopper in two steps:
 *   1. a flat blob in their skin, hair and clothes colours (AvatarSprite's AvatarBlob, one cheap node), at once;
 *   2. the real avatar, rasterised here to a small PNG in a queue (one SVG load, one canvas draw and one PNG encode per
 *      Hopper, with a frame or an idle moment between), nearest to me first. The picture is a plain bitmap after that:
 *      it costs the browser almost nothing to decode, scale or move, at any zoom.
 *
 * The PNG is made at about 2.4 to 3 times the CSS size (capped by the device pixel ratio), so the avatars are crisp on
 * a phone and never need the 3x raster of an SVG. If a canvas is not available the SVG itself is used, as before.
 */

const MAX = 240;
/** The first sprites of a queue run back to back (a frame between each); the rest wait for an idle moment. */
const EAGER = 10;

type Entry = { key: string; look: Look; url: string | null; failed: boolean; queued: boolean };
const entries = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();
let queue: string[] = [];
let pumping = false;

/** A look as it arrives (a fresh object every snapshot) to the key of its normalised drawing. */
const rawKeys = new Map<string, string>();
function touch(raw: unknown): string {
  const json = JSON.stringify(raw ?? null);
  let key = rawKeys.get(json);
  if (!key) {
    const look = normalizeLook(raw);
    key = JSON.stringify(look);
    if (rawKeys.size > 600) rawKeys.clear();
    rawKeys.set(json, key);
    if (!entries.has(key)) entries.set(key, { key, look, url: null, failed: false, queued: false });
  } else if (!entries.has(key)) {
    entries.set(key, { key, look: JSON.parse(key) as Look, url: null, failed: false, queued: false });
  }
  return key;
}

export const lookKey = touch;

const svgUrl = (look: Look) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(look, { uid: "sp" }))}`;

/** Pixels of the bitmap: 32 by 58 CSS px times 2 to 3, by the screen's pixel ratio. */
function bitmapSize() {
  const dpr = typeof window === "undefined" ? 2 : window.devicePixelRatio || 1;
  const f = Math.max(2, Math.min(dpr, 2.5) * 1.2);
  return { w: Math.round(32 * f), h: Math.round(58 * f) };
}

async function rasterise(e: Entry): Promise<string> {
  const src = svgUrl(e.look);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const { w, h } = bitmapSize();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  // willReadFrequently keeps this small canvas on the CPU. A GPU canvas costs a one-off setup of a second or more on a slow
  // phone (measured at 4x throttle) and a read-back stall for every picture.
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return src;
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  return blob ? URL.createObjectURL(blob) : src;
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
const quiet = () =>
  new Promise<void>((done) => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => done(), { timeout: 250 });
    else setTimeout(done, 32);
  });

function emit(key: string) {
  subs.get(key)?.forEach((cb) => cb());
}

function evict() {
  if (entries.size <= MAX) return;
  for (const [key, e] of entries) {
    if (entries.size <= MAX - 20) break;
    if (subs.get(key)?.size || e.queued) continue;
    if (e.url?.startsWith("blob:")) URL.revokeObjectURL(e.url);
    entries.delete(key);
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  let made = 0;
  try {
    while (queue.length) {
      const key = queue.shift()!;
      const e = entries.get(key);
      if (!e) continue;
      e.queued = false;
      if (e.url || e.failed) continue;
      if (made < EAGER) await nextFrame();
      else await quiet();
      try {
        e.url = await rasterise(e);
      } catch {
        e.failed = true;
      }
      made++;
      emit(key);
    }
  } finally {
    pumping = false;
    evict();
  }
}

function enqueue(key: string, front = false) {
  const e = entries.get(key);
  if (!e || e.url || e.failed || e.queued) return;
  e.queued = true;
  if (front) queue.unshift(key);
  else queue.push(key);
  void pump();
}

/**
 * Draw one look before anyone needs it. The first sprite of a page pays a one-off setup (the browser's SVG image engine and
 * the canvas encoder start): over 1 s at 4x throttle. The room's own "Walking in" screen is the place to pay it, while
 * nothing moves, so the open sequence never freezes on it.
 */
export function warmSprites() {
  const key = touch(DEFAULT_LOOK);
  enqueue(key, true);
}

/** Something is still waiting to be drawn. */
export const spritesPending = () => queue.length > 0;

/** Draw these looks next, in this order (me first, then the nearest Hopper). Looks already drawn are skipped. */
export function prioritise(raws: unknown[]) {
  const first: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const key = touch(raw);
    const e = entries.get(key);
    if (seen.has(key) || !e || e.url || e.failed) continue;
    seen.add(key);
    first.push(key);
  }
  if (!first.length) return;
  for (const key of first) {
    const e = entries.get(key)!;
    e.queued = true;
  }
  queue = [...first, ...queue.filter((key) => !seen.has(key))];
  void pump();
}

/** Resolves when these looks are drawn, or after `maxMs`, whichever is first. */
export function spritesReady(raws: unknown[], maxMs: number): Promise<void> {
  prioritise(raws);
  const keys = raws.map(touch);
  return new Promise((done) => {
    const t0 = performance.now();
    const check = () => {
      const all = keys.every((key) => {
        const e = entries.get(key);
        return !e || e.url || e.failed;
      });
      if (all || performance.now() - t0 >= maxMs) done();
      else setTimeout(check, 40);
    };
    check();
  });
}

function on(key: string, cb: () => void) {
  let set = subs.get(key);
  if (!set) subs.set(key, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (!set.size) subs.delete(key);
  };
}

/** The picture of this look once it is drawn (a bitmap URL), else null: the caller shows the blob meanwhile. */
export function useSprite(raw: unknown): { key: string; url: string | null } {
  const key = touch(raw);
  const subscribe = useCallback((cb: () => void) => on(key, cb), [key]);
  const url = useSyncExternalStore(
    subscribe,
    () => entries.get(key)?.url ?? null,
    () => null,
  );
  useEffect(() => {
    enqueue(key);
  }, [key]);
  return { key, url };
}

/** The normalised look behind a sprite key (for the blob's colours). */
export function lookOfKey(key: string): Look {
  return entries.get(key)?.look ?? (JSON.parse(key) as Look);
}
