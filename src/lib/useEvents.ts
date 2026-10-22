"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase/client";
import { demoEvents, demoHop } from "./demoData";
import { haversineKm, LAGOS_CENTER, pointFromGeog } from "./geo";
import { EVENTS_R1_FAKE } from "./events-r1/flags";
import { fetchFakeEventById, useFakeEvents } from "./events-r1/listBridge";
import { fetchEventsNearDirect, fetchLagosEvents, fetchNextHopRow } from "./publicApi";
import { lagosDate, read, revalidate, subscribe } from "./phoneCache";
import type { EventRow, Hop } from "./types";

type Fix = { lat: number; lng: number } | null;

/**
 * Sample events and the sample Hop are for local development only. In a
 * production build a player never sees them, even when the database is down.
 */
const DEV = process.env.NODE_ENV !== "production";

/** Fills distance_m locally so demo mode and live mode render identically. */
function withDistance(rows: EventRow[], fix: Fix): EventRow[] {
  const from = fix ?? LAGOS_CENTER;
  return rows
    .map((e) => ({ ...e, distance_m: haversineKm(from.lat, from.lng, e.lat, e.lng) * 1000 }))
    .sort((a, b) => b.heat - a.heat);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One live event by its id, wherever it is and whenever it starts, or null.
 * The list below only reaches 45 km around the Hopper, from a few hours ago; a
 * shared link must still open for a friend in Abuja, or for a night that began
 * a while back. Live events are public, so this reads the table directly (the
 * same row the share preview was built from) and the heat counts beside it.
 * Development with no database answers from the sample day, like the list does.
 */
export async function fetchEventById(id: string, fix: Fix): Promise<EventRow | null> {
  if (EVENTS_R1_FAKE) return fetchFakeEventById(id, fix);
  const sample = () => (DEV ? (withDistance(demoEvents(), fix).find((e) => e.id === id) ?? null) : null);
  const sb = getSupabase();
  if (!sb) return sample();
  if (!UUID.test(id)) return null;
  // The Lagos list the phone already holds has it: no calls. Only a copy under a day old, and only while the event is
  // inside the list's window (heldLagos checks both); otherwise this falls through and reads the row.
  const held = heldLagos()?.find((e) => e.id === id);
  if (held) return withDistance([held], fix)[0];
  const { data, error } = await sb
    .from("events")
    .select("id,title,venue_name,area,geog,starts_at,price_naira,vibe,source,ig_url,flyer_url")
    .eq("id", id)
    .eq("status", "live")
    .maybeSingle();
  if (error) {
    console.warn("[hoppaz] event lookup failed:", error.message);
    return sample();
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const at = pointFromGeog(row.geog);
  if (!at) return null;
  // The counts come from the heat view; if it cannot be read, the page just shows no crowd yet.
  const { data: heat } = await sb.from("event_heat").select("heat,checkins,swipes_in,here_now").eq("event_id", id).maybeSingle();
  const h = (heat ?? {}) as Record<string, number>;
  const from = fix ?? LAGOS_CENTER;
  return {
    id: String(row.id),
    title: String(row.title),
    venue_name: String(row.venue_name),
    area: (row.area as string | null) ?? null,
    lat: at.lat,
    lng: at.lng,
    starts_at: String(row.starts_at),
    price_naira: Number(row.price_naira) || 0,
    vibe: String(row.vibe ?? ""),
    source: row.source as EventRow["source"],
    ig_url: (row.ig_url as string | null) ?? null,
    flyer_url: (row.flyer_url as string | null) ?? null,
    distance_m: haversineKm(from.lat, from.lng, at.lat, at.lng) * 1000,
    heat: h.heat ?? 0,
    checkins: h.checkins ?? 0,
    swipes_in: h.swipes_in ?? 0,
    here_now: h.here_now ?? 0,
  };
}

/** The phone keeps the whole Lagos list; one copy serves the map, Today, Roomz, Chat and the event page. */
const LAGOS_KEY = "events.lagos";
/** A copy this young is used as it is, with no network. */
const LAGOS_FRESH_MS = 60_000;
/** An older copy still shows at once while a new one is fetched, up to a day. */
const LAGOS_KEEP_MS = 24 * 3.6e6;
const POLL_MS = 5 * 60 * 1000;
/** Beyond this from Lagos centre the shared list does not reach the Hopper, so the area is asked for directly. */
const FAR_KM = 65;
const HOUR = 3.6e6;

/** publicApi answers {ok}; the cache wants the rows, or null when the read failed. */
async function lagosRows(): Promise<EventRow[] | null> {
  const r = await fetchLagosEvents();
  return r.ok ? r.data : null;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** What the list shows: nothing that started more than 4 hours ago, nothing more than 45 days ahead. */
function inWindow(rows: EventRow[]): EventRow[] {
  const now = Date.now();
  return rows.filter((e) => {
    const t = Date.parse(e.starts_at);
    return t >= now - 4 * HOUR && t <= now + 45 * 24 * HOUR;
  });
}

/** The phone's copy of the Lagos list if it is under a day old. */
function heldLagos(): EventRow[] | null {
  const c = read<EventRow[]>(LAGOS_KEY);
  if (!c || !Array.isArray(c.data) || Date.now() - c.at > LAGOS_KEEP_MS) return null;
  return inWindow(c.data);
}

function useLiveEvents(fix: Fix, radiusKm: number) {
  const lat = fix?.lat ?? null;
  const lng = fix?.lng ?? null;
  const far = lat !== null && lng !== null && haversineKm(lat, lng, LAGOS_CENTER.lat, LAGOS_CENTER.lng) > FAR_KM;

  // Development starts on the sample day. Production starts empty (a calm
  // loading state on the map) and only ever shows what the database returns.
  // The phone's own copy lands in a layout effect, before the first paint and without disagreeing with the server HTML.
  const [lagos, setLagos] = useState<EventRow[] | null>(null);
  const [lagosReady, setLagosReady] = useState(false);
  const [lagosFailed, setLagosFailed] = useState(false);
  /** The area asked for directly, for a Hopper who is far from Lagos. Never kept on the phone. */
  const [farRows, setFarRows] = useState<{ key: string; rows: EventRow[] } | null>(null);
  const [farFailed, setFarFailed] = useState(false);
  /** True only while the list on screen is the dev sample day. */
  const [demo, setDemo] = useState(DEV);
  const [loading, setLoading] = useState(false);

  // Every mounted instance hears the same rows, and the copy on the phone paints at once.
  useIsoLayoutEffect(() => {
    const apply = () => {
      const rows = heldLagos();
      if (!rows) return;
      setLagos(rows);
      setLagosReady(true);
      setLagosFailed(false);
      setDemo(false);
    };
    apply();
    return subscribe(LAGOS_KEY, apply);
  }, []);

  /** Make sure the shared copy is current. Within a minute of the last fetch this costs nothing. */
  const pull = useCallback(async (force = false) => {
    // A Hopper far from Lagos is served by the direct ask below, not by the Lagos list.
    if (far) return;
    if (!getSupabase()) {
      if (DEV) setDemo(true);
      else setLagosFailed(true);
      setLagosReady(true);
      return;
    }
    setLoading(true);
    const rows = await revalidate(LAGOS_KEY, lagosRows, { freshMs: LAGOS_FRESH_MS, force });
    setLoading(false);
    setLagosReady(true);
    if (rows) {
      setLagosFailed(false);
      return;
    }
    // Nothing on the phone and the fetch failed.
    console.warn("[hoppaz] events could not be loaded");
    if (DEV) setDemo(true);
    else setLagosFailed(true);
  }, [far]);

  const farKey = far ? `${lat!.toFixed(3)},${lng!.toFixed(3)},${Math.max(radiusKm, 45)}` : "";
  const pullFar = useCallback(async () => {
    if (!farKey || lat === null || lng === null) return;
    const res = await fetchEventsNearDirect(lat, lng, Math.max(radiusKm, 45) * 1000);
    if (res.ok) {
      setFarRows({ key: farKey, rows: inWindow(res.data) });
      setFarFailed(false);
    } else {
      setFarRows((r) => (r && r.key === farKey ? r : { key: farKey, rows: [] }));
      setFarFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farKey]);

  useEffect(() => {
    void pull();
  }, [pull]);

  useEffect(() => {
    if (farKey) void pullFar();
  }, [farKey, pullFar]);

  // Keep the rolling event window current while someone has the app open.
  // Coming back to a background tab catches edits made while the app was suspended, but a quick flip does nothing:
  // both go through the shared copy, which is only fetched again once it is a minute old.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      void pull();
      if (farKey) void pullFar();
    };
    const timer = window.setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [pull, pullFar, farKey]);

  const events = useMemo(() => {
    if (far) return farRows && farRows.key === farKey ? withDistance(farRows.rows, fix) : [];
    if (lagos) {
      const from = fix ?? LAGOS_CENTER;
      const reach = Math.max(radiusKm, 45);
      return withDistance(lagos, fix).filter((e) => haversineKm(from.lat, from.lng, e.lat, e.lng) <= reach);
    }
    return DEV && demo ? withDistance(demoEvents(), fix) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [far, farRows, farKey, lagos, demo, lat, lng, radiusKm]);

  const reload = useCallback(async () => {
    await Promise.all([pull(true), farKey ? pullFar() : Promise.resolve()]);
  }, [pull, pullFar, farKey]);

  const ready = far ? !!farRows && farRows.key === farKey : lagosReady;
  const failed = far ? farFailed && !!farRows && farRows.rows.length === 0 : lagosFailed && !lagos;
  return { events, demo: !far && !lagos && demo, loading, ready, failed, reload };
}

// Release 1: with the fake data layer on (NEXT_PUBLIC_EVENTS_R1_FAKE=1) the lists come from it, with no network call.
const useEventsImpl = EVENTS_R1_FAKE ? useFakeEvents : useLiveEvents;
export function useEvents(fix: Fix, radiusKm: number) {
  return useEventsImpl(fix, radiusKm);
}

/**
 * The raw hop row, mapped the way the app reads it. Null when it has no usable stops. A copy that is not freshly read and
 * whose date has gone is dropped (`stale`): the phone must not keep showing last week's bus. A row the server has just
 * returned is shown as the server says.
 */
function parseHop(d: Record<string, unknown>, stale: boolean): Hop | null {
  if (stale && typeof d.hop_date === "string" && d.hop_date < lagosDate()) return null;
  const stops = ((d.hop_stops as Record<string, unknown>[]) ?? [])
    .map((s) => ({
      id: String(s.id),
      idx: Number(s.idx),
      name: String(s.name),
      area: (s.area as string) ?? null,
      // PostGIS geography comes back as hex EWKB from the REST API; pointFromGeog reads it.
      lat: pointFromGeog(s.geog)?.lat ?? 0,
      lng: pointFromGeog(s.geog)?.lng ?? 0,
      stop_time: String(s.stop_time),
      role: String(s.role),
    }))
    .filter((s) => s.lat !== 0)
    .sort((a, b) => a.idx - b.idx);
  return stops.length ? { ...(d as unknown as Hop), stops } : null;
}

const HOP_KEY = "hop";
const HOP_FRESH_MS = 5 * 60 * 1000;
const HOP_KEEP_MS = 3 * 24 * HOUR;

/** What the phone keeps for the Hop: the raw row, or null row when the server said there is none (an old copy must not outlive that). */
type HopCopy = { row: Record<string, unknown> | null };
async function hopCopy(): Promise<HopCopy | null> {
  const r = await fetchNextHopRow();
  return r.ok ? { row: r.data } : null;
}

export function useHop() {
  // The sample Hop (this coming Saturday) is a development convenience only.
  const [hop, setHop] = useState<Hop | null>(() => (DEV ? (demoHop() as Hop) : null));

  useIsoLayoutEffect(() => {
    const apply = () => {
      const c = read<HopCopy>(HOP_KEY);
      if (!c || Date.now() - c.at > HOP_KEEP_MS) return;
      // The server said there is no Hop: a copy of an earlier one must go (development keeps its sample).
      if (!c.data.row) return void (DEV || setHop(null));
      const h = parseHop(c.data.row, Date.now() - c.at >= HOP_FRESH_MS);
      if (h) setHop(h);
    };
    apply();
    return subscribe(HOP_KEY, apply);
  }, []);

  useEffect(() => {
    if (!getSupabase()) return;
    void revalidate(HOP_KEY, hopCopy, { freshMs: HOP_FRESH_MS });
  }, []);

  return hop;
}
