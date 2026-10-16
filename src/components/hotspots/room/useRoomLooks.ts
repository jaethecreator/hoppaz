"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { anonLook, normalizeLook, randomLook, type Look } from "@/lib/avatar";
import { backoff, hidden, jitter } from "@/lib/idle";
import { getSupabase } from "@/lib/supabase/client";
import { readLooks } from "./api";

/**
 * Real looks in a hotspot room (Jae, 15 Oct 2026): people show their own Hopper, with their alias as the name. The look
 * comes from hotspot_room_looks (supabase/hotspot_looks.sql), keyed by the same key the heads and the chat authors carry.
 * Flip this to false and the room draws alias faces for everyone again, with no other change.
 */
export const REAL_LOOKS_IN_ROOM = true;

const LOOKS_MS = 60_000;
/** Someone new in the room is asked about at once, but never more often than this. People leaving ask for nothing. */
const NEW_FACE_GAP = 15_000;

/** A small seeded generator for the demo room: the same alias is always the same Hopper. */
const seeded = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
};

/**
 * The look to draw for each key in the room. `keys` are the heads' keys (and any chat authors you want covered);
 * a key with no real look is simply absent, and the caller falls back to anonLook(alias). Asked again when a key turns up
 * that was not in the last ask, and about once a minute (less when nobody touches the phone, never while the page is
 * hidden), only while the room is open on this screen.
 */
export function useRoomLooks(slug: string, active: boolean, people: { key: string; alias: string }[]): Record<string, Look> {
  const [real, setReal] = useState<Record<string, Look>>({});
  const keys = useMemo(() => people.map((p) => p.key).sort(), [people]);
  const sig = keys.join("|");
  // The keys the last ask carried, when it went, the keys now, and the ask of the running timer effect.
  const asked = useRef(new Set<string>());
  const askedAt = useRef(0);
  const keysNow = useRef<string[]>([]);
  const askNow = useRef<(() => void) | null>(null);

  // No database (the local demo): a made-up Hopper per alias, so the room can be looked at with real bodies in it.
  const demo = useMemo(() => {
    if (!REAL_LOOKS_IN_ROOM || !active || getSupabase()) return null;
    const out: Record<string, Look> = {};
    for (const p of people) out[p.key] = randomLook(seeded(p.alias));
    return out;
    // people is covered by sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sig]);

  useEffect(() => {
    keysNow.current = keys;
  }, [keys]);

  useEffect(() => {
    if (!REAL_LOOKS_IN_ROOM || !active || !getSupabase()) return;
    let dead = false;
    asked.current = new Set();
    const ask = async () => {
      asked.current = new Set(keysNow.current);
      askedAt.current = Date.now();
      const r = await readLooks(slug);
      if (dead || !r.ok) return;
      const out: Record<string, Look> = {};
      for (const [k, v] of Object.entries(r.looks ?? {})) out[k] = normalizeLook(v);
      setReal(out);
    };
    askNow.current = () => void ask();
    let t: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      t = setTimeout(() => {
        if (!hidden()) void ask();
        next();
      }, jitter(backoff(LOOKS_MS)));
    };
    void ask();
    next();
    return () => {
      dead = true;
      askNow.current = null;
      clearTimeout(t);
    };
  }, [slug, active]);

  // Someone new in the room: ask soon. A change that only takes people away leaves the steady poll alone.
  useEffect(() => {
    if (!askNow.current || !keys.some((k) => !asked.current.has(k))) return;
    const t = setTimeout(() => {
      // The steady poll may have covered them by now.
      if (!hidden() && keysNow.current.some((k) => !asked.current.has(k))) askNow.current?.();
    }, Math.max(0, NEW_FACE_GAP - (Date.now() - askedAt.current)));
    return () => clearTimeout(t);
    // keys is covered by sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return demo ?? real;
}

/** The look for one person: the real one if there is one, otherwise the alias face. */
export const lookFor = (looks: Record<string, Look>, key: string, alias: string, given?: unknown): Look =>
  looks[key] ?? normalizeLook(given ?? anonLook(alias));
