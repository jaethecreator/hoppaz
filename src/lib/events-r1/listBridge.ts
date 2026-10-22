"use client";

/**
 * Release 1: lets useEvents and fetchEventById (src/lib/useEvents.ts) serve the Release 1 data layer's events when
 * NEXT_PUBLIC_EVENTS_R1=1 or NEXT_PUBLIC_EVENTS_R1_FAKE=1. With the fake flag on that is the in-memory layer (no network call).
 * With only EVENTS_R1=1 it is the real layer: ev_list_events and ev_get_event, so events with no place, community events for
 * members and the host's own invite events come with every R1 field filled. R1Event is an EventRow, so the map, the deck and
 * EventCard take it as it is; this only fills distance_m from the Hopper's fix (heat already comes from the going count).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { haversineKm, LAGOS_CENTER } from "../geo";
import type { EventRow } from "../types";
import { loadApi } from "./index";
import type { R1Event } from "./types";

type Fix = { lat: number; lng: number } | null;

function toRow(e: R1Event, fix: Fix): EventRow {
  const from = fix ?? LAGOS_CENTER;
  return { ...e, distance_m: haversineKm(from.lat, from.lng, e.lat, e.lng) * 1000 };
}

/** One event by id or short link, wherever and whenever it is. Invite only opens this way too. */
export async function fetchR1EventById(id: string, fix: Fix): Promise<EventRow | null> {
  const e = await (await loadApi()).events.get(id);
  return e ? toRow(e, fix) : null;
}

/** Same shape useEvents returns. Reloads when the data layer says something changed and every 30 seconds (the list window moves with time). */
export function useR1ListEvents(fix: Fix, radiusKm: number) {
  void radiusKm; // the Release 1 list is all of Lagos
  const lat = fix?.lat ?? null;
  const lng = fix?.lng ?? null;
  const [rows, setRows] = useState<R1Event[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const api = await loadApi();
      setRows(await api.events.list());
      setFailed(false);
    } catch (e) {
      console.warn("[hoppaz] events could not be loaded:", e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void load();
    void loadApi().then((api) => {
      off = api.events.subscribe(() => void load());
    }).catch(() => {});
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      off?.();
      window.clearInterval(timer);
    };
  }, [load]);

  const events = useMemo(
    () => (rows ?? []).map((e) => toRow(e, lat === null || lng === null ? null : { lat, lng })).sort((a, b) => b.heat - a.heat),
    [rows, lat, lng]
  );
  return { events, demo: false, loading, ready: rows !== null || failed, failed: failed && rows === null, reload: load };
}
