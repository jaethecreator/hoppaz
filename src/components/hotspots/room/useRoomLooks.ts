"use client";

import { useEffect, useMemo, useState } from "react";
import { anonLook, normalizeLook, randomLook, type Look } from "@/lib/avatar";
import { getSupabase } from "@/lib/supabase/client";
import { readLooks } from "./api";

/**
 * Real looks in a hotspot room (Jae, 15 Oct 2026): people show their own Hopper, with their alias as the name. The look
 * comes from hotspot_room_looks (supabase/hotspot_looks.sql), keyed by the same key the heads and the chat authors carry.
 * Flip this to false and the room draws alias faces for everyone again, with no other change.
 */
export const REAL_LOOKS_IN_ROOM = true;

const LOOKS_MS = 60_000;

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
 * a key with no real look is simply absent, and the caller falls back to anonLook(alias). Asked again when the people
 * change and about once a minute, only while the room is open on this screen.
 */
export function useRoomLooks(slug: string, active: boolean, people: { key: string; alias: string }[]): Record<string, Look> {
  const [real, setReal] = useState<Record<string, Look>>({});
  const sig = useMemo(() => people.map((p) => p.key).sort().join("|"), [people]);

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
    if (!REAL_LOOKS_IN_ROOM || !active || !getSupabase()) return;
    let dead = false;
    const ask = async () => {
      const r = await readLooks(slug);
      if (dead || !r.ok) return;
      const out: Record<string, Look> = {};
      for (const [k, v] of Object.entries(r.looks ?? {})) out[k] = normalizeLook(v);
      setReal(out);
    };
    void ask();
    const t = setInterval(() => document.visibilityState === "visible" && void ask(), LOOKS_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
    // sig: ask again as soon as someone new is in the room
  }, [slug, active, sig]);

  return demo ?? real;
}

/** The look for one person: the real one if there is one, otherwise the alias face. */
export const lookFor = (looks: Record<string, Look>, key: string, alias: string, given?: unknown): Look =>
  looks[key] ?? normalizeLook(given ?? anonLook(alias));
