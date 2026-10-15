"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Saying hi to a head in a hotspot room, and becoming crew from it (Jae, 15 Oct 2026): you wave at an alias, they wave
 * back, and a mutual wave makes you crew both ways and shows each of you the other's real name. Nobody can search for a
 * person they only know by an alias, so this is the way from a hotspot to a crew.
 *
 * THE SERVER AND THE REAL HELPER belong to the crew-waves work: `crew_friend_hotspot_wave(p_key text)` in
 * supabase/crew_friends.sql, and `hotspotWave(key)` in src/lib/social. This file is the thin stub the room is built
 * against, with the same name and the result shape below, so that when that branch is merged the import in
 * HeadCard.tsx and WaveChip.tsx changes from "./wave" to "@/lib/social" and nothing else moves:
 *
 *   status     sent | matched | already | already_crew | slow_down | not_met | gone | self | blocked
 *              | need_account | no_session
 *   name       (matched, already_crew) the other person's real name, only ever sent once you are crew
 *   dm         (matched, already_crew) the direct message thread id, when there is one
 *
 * The stub calls that RPC and reads its answer as text ("sent", "matched:<dm>", "already_crew") or as an object
 * ({status, name, dm}); a database without the function answers "soon". With no database at all (the local demo) it
 * makes up an answer so the screen can be looked at.
 */
export const HOTSPOT_WAVES = true;

export type HotspotWave =
  | { status: "sent" }
  | { status: "matched"; name: string; dm?: string }
  | { status: "already_crew"; name?: string; dm?: string }
  | { status: "already" | "slow_down" | "not_met" | "gone" | "self" | "blocked" | "need_account" | "no_session" | "soon" | "offline" | "error" };

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const DEMO_NAMES = ["Ada", "Tobi", "Chidi", "Zainab", "Kemi", "Femi", "Ife"];

export async function hotspotWave(key: string): Promise<HotspotWave> {
  const sb = getSupabase();
  if (!sb) {
    // The demo room: half of the heads wave back at once, the others take the wave.
    await new Promise((r) => setTimeout(r, 600));
    const h = hash(key);
    return h % 2 === 0 ? { status: "matched", name: DEMO_NAMES[h % DEMO_NAMES.length] } : { status: "sent" };
  }
  try {
    const { data, error } = await sb.rpc("crew_friend_hotspot_wave", { p_key: key });
    if (error) {
      if (error.code === "PGRST202" || /could not find the function|not found/i.test(error.message ?? "")) return { status: "soon" };
      return { status: "error" };
    }
    if (typeof data === "string") {
      if (data.startsWith("matched:")) return { status: "matched", name: "A new crew mate", dm: data.slice(8) || undefined };
      if (data.startsWith("already_crew:")) return { status: "already_crew", dm: data.slice(13) || undefined };
      return { status: data as HotspotWave["status"] } as HotspotWave;
    }
    if (data && typeof data === "object") {
      const d = data as { status?: string; name?: string; dm?: string };
      if (d.status === "matched") return { status: "matched", name: d.name ?? "A new crew mate", dm: d.dm };
      if (d.status === "already_crew") return { status: "already_crew", name: d.name, dm: d.dm };
      if (d.status) return { status: d.status } as HotspotWave;
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** The line to show under a head or on the chip for an answer. `crew` is true when the answer makes (or says) you are crew. */
export function waveCopy(r: HotspotWave, alias: string): { text: string; crew: boolean; tone: "ok" | "warn" } {
  switch (r.status) {
    case "sent":
      return { text: `You said hi to ${alias}. If they say hi back, you are crew and you see each other's names.`, crew: false, tone: "ok" };
    case "matched":
      return { text: `${r.name} is in your crew`, crew: true, tone: "ok" };
    case "already_crew":
      return { text: r.name ? `${r.name} is in your crew` : `${alias} is already in your crew`, crew: true, tone: "ok" };
    case "already":
      return { text: `You already said hi to ${alias}.`, crew: false, tone: "ok" };
    case "slow_down":
      return { text: "That is a lot of hellos today. Try again tomorrow.", crew: false, tone: "warn" };
    case "blocked":
      return { text: `You blocked ${alias}.`, crew: false, tone: "warn" };
    case "gone":
      return { text: `${alias} is not around any more.`, crew: false, tone: "warn" };
    case "self":
      return { text: "That is you.", crew: false, tone: "warn" };
    case "need_account":
    case "no_session":
      return { text: "Make an account to say hi.", crew: false, tone: "warn" };
    case "not_met":
      return { text: "You can say hi to people who are in this hotspot with you.", crew: false, tone: "warn" };
    case "soon":
      return { text: "Saying hi from a hotspot is coming soon.", crew: false, tone: "warn" };
    default:
      return { text: "Could not say hi. Try again.", crew: false, tone: "warn" };
  }
}

/** Someone who said hi to you in this hotspot: their alias and the place, and the key to say hi back with. */
export type IncomingWave = { id: string; key: string; alias: string; place: string };

/**
 * The hellos waiting for you from this hotspot. The server side of the inbox is crew-waves' (a wave from a hotspot head
 * carries the alias and the hotspot, never the person); until that is merged this is empty, and in the local demo one
 * head waves at you after a while so the chip can be seen.
 */
export function useIncomingHotspotWaves(heads: { key: string; alias: string }[], place: string, active: boolean): IncomingWave[] {
  const [list, setList] = useState<IncomingWave[]>([]);
  const first = heads[0];
  useEffect(() => {
    if (!HOTSPOT_WAVES || !active || getSupabase() || !first) return;
    const t = setTimeout(() => setList([{ id: `demo-wave-${first.key}`, key: first.key, alias: first.alias, place }]), 9000);
    return () => clearTimeout(t);
  }, [active, first, place]);
  return list;
}
