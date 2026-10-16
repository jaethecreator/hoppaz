"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase/client";
import { fetchDropEventIds } from "./publicApi";
import { read, revalidate, subscribe } from "./phoneCache";
import { NEED_ACCOUNT, requireAccount } from "./accountGate";

export type Collectible = { id: string; key: string; name: string; description: string; emoji: string; art_url: string | null };
export type CollectibleDrop = { id: string; event_id: string; collectible: Collectible };

/** Fetches a place's active collection drops and the current Hopper's claims. */
export function useEventCollectibles(eventId: string, userId: string | null) {
  const [drops, setDrops] = useState<CollectibleDrop[]>([]);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId || eventId.startsWith("demo-")) return;
    const [{ data: d }, { data: c }] = await Promise.all([
      sb.from("collectible_drops").select("id,event_id,collectible:collectibles!inner(id,key,name,description,emoji,art_url)").eq("event_id", eventId),
      sb.from("collections").select("drop_id").eq("user_id", userId),
    ]);
    setDrops((d ?? []) as unknown as CollectibleDrop[]);
    setClaimed(new Set((c ?? []).map((x) => x.drop_id)));
  }, [eventId, userId]);
  useEffect(() => { void reload(); }, [reload]);
  const collect = useCallback(async (dropId: string, fix: { lat: number; lng: number } | null) => {
    const sb = getSupabase();
    if (sb && !requireAccount("collect this")) return NEED_ACCOUNT;
    if (!sb || !fix) return "SET YOUR LOCATION FIRST";
    setBusy(dropId);
    const { data, error } = await sb.rpc("claim_collectible", { p_drop_id: dropId, p_lat: fix.lat, p_lng: fix.lng });
    setBusy(null);
    if (error) return "COULD NOT COLLECT";
    const result = data as { ok: boolean; reason?: string; name?: string };
    if (!result.ok) return result.reason === "too_far" ? "GET CLOSER TO THE EVENT" : result.reason === "already" ? "ALREADY IN YOUR COLLECTION" : "THIS COLLECTIBLE IS CLOSED";
    setClaimed((s) => new Set(s).add(dropId));
    return `${result.name?.toUpperCase() ?? "COLLECTIBLE"} ADDED TO YOUR COLLECTION`;
  }, []);
  return { drops, claimed, busy, collect, reload };
}

export type CollectionEntry = { drop_id: string; collected_at: string; event_title: string; collectible: Collectible };

/** The complete collection, including the event where each item was found. */
export async function loadCollection(userId: string | null) {
  const sb = getSupabase();
  if (!sb || !userId) return [] as CollectionEntry[];
  const { data } = await sb.from("collections").select("drop_id,collected_at,drop:collectible_drops!inner(event:events!inner(title),collectible:collectibles!inner(id,key,name,description,emoji,art_url))").eq("user_id", userId).order("collected_at", { ascending: false });
  return ((data ?? []) as unknown as { drop_id: string; collected_at: string; drop: { event: { title: string }; collectible: Collectible } }[]).map((r): CollectionEntry => ({ drop_id: r.drop_id, collected_at: r.collected_at, event_title: r.drop.event.title, collectible: r.drop.collectible }));
}

const DROP_KEY = "dropEvents";
async function dropIds(): Promise<string[] | null> {
  const r = await fetchDropEventIds();
  return r.ok ? r.data : null;
}
const DROP_FRESH_MS = 60_000;
const DROP_KEEP_MS = 6 * 3.6e6;

/** The phone's copy of the ids that have a drop, or null when there is none or it is over 6 hours old. */
function heldDropIds(): string[] | null {
  const c = read<string[]>(DROP_KEY);
  return c && Array.isArray(c.data) && Date.now() - c.at <= DROP_KEEP_MS ? c.data : null;
}

/**
 * Event IDs with at least one configured collectible, for map discovery markers. The ids of every event with a drop are
 * one shared, public list kept on the phone; this hook returns the ones among `eventIds`. A change in `eventIds` no
 * longer fetches anything.
 */
export function useCollectibleEventIds(eventIds: string[]) {
  const [held, setHeld] = useState<string[]>([]);
  const key = eventIds.join(",");
  // The drop list waits for the map: nothing is read or fetched while there are no event ids to match it against.
  const hasKey = !!key;
  useEffect(() => {
    if (!hasKey || !getSupabase()) return;
    const apply = () => setHeld(heldDropIds() ?? []);
    apply();
    const off = subscribe(DROP_KEY, apply);
    void revalidate(DROP_KEY, dropIds, { freshMs: DROP_FRESH_MS });
    return off;
  }, [hasKey]);
  return useMemo(() => {
    const wanted = new Set(key ? key.split(",") : []);
    return held.filter((id) => wanted.has(id) && !id.startsWith("demo-"));
  }, [held, key]);
}

export type DropReceipt = { drop_id: string; title: string; partner: string | null; reward: string; description: string; code: string | null; claimed_at: string; hunt_item?: string | null; event_title?: string | null };
export async function loadDropReceipts(userId: string | null) {
  const sb=getSupabase();if(!sb||!userId)return [] as DropReceipt[];const {data}=await sb.rpc("my_drop_claims");return (data??[]) as DropReceipt[];
}
