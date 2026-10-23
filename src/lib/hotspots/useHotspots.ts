"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { DEMO } from "@/components/me/demo";
import { ROOMS_SEAL } from "@/lib/events-r1/flags";
import { getSupabase } from "@/lib/supabase/client";
import { fetchHotspotRows } from "@/lib/publicApi";
import { read, write } from "@/lib/phoneCache";
import { DEMO_HOTSPOTS } from "./demo";
import { metresApart, nearestOthers, pinsFor, yoursOf } from "./geometry";
import type { Band, Hotspot, HotspotStatus, Pt, ZoneShape } from "./types";

/** The phone keeps the raw rows for a week: the zone shapes rarely change, and the counts refresh in the background. */
const KEY = "hotspots";
const KEEP_MS = 7 * 24 * 3.6e6;

/** How soon a sheet that is opened may ask for fresh counts. The list itself is fetched once per visit (see `cached`). */
const SHEET_REFRESH_MS = 60_000;

type Raw = {
  id?: string;
  slug?: string;
  name?: string;
  zone_name?: string;
  zone_label?: string;
  side?: string;
  junction?: string;
  road_a?: string;
  road_b?: string;
  lat?: number;
  lng?: number;
  wave?: number;
  status?: string;
  zone_geojson?: ZoneShape | null;
  here_band?: string;
  here_n?: number | null;
  today_band?: string;
  today_n?: number | null;
};

const BANDS: Band[] = ["quiet", "few", "some", "busy", "packed"];
const band = (v: string | undefined): Band => (BANDS.includes(v as Band) ? (v as Band) : "quiet");

function toHotspot(r: Raw): Hotspot | null {
  if (!r.id || !r.slug || typeof r.lat !== "number" || typeof r.lng !== "number") return null;
  const status: HotspotStatus = r.status === "open" || r.status === "paused" ? r.status : "planned";
  return {
    id: r.id,
    slug: r.slug,
    name: r.name ?? r.slug,
    zoneName: r.zone_name ?? "",
    zoneLabel: r.zone_label ?? "",
    side: r.side === "island" ? "island" : "mainland",
    junction: r.junction ?? r.name ?? r.slug,
    roadA: r.road_a ?? "",
    roadB: r.road_b ?? "",
    lat: r.lat,
    lng: r.lng,
    wave: r.wave ?? 4,
    status,
    zone: r.zone_geojson && (r.zone_geojson.type === "Polygon" || r.zone_geojson.type === "MultiPolygon") ? r.zone_geojson : null,
    hereBand: band(r.here_band),
    hereN: typeof r.here_n === "number" ? r.here_n : null,
    todayBand: band(r.today_band),
    todayN: typeof r.today_n === "number" ? r.today_n : null,
  };
}

/** Rows from the server (or the phone's copy) as the list the app uses: wave order, with Yaba, where the events are, leading. */
function toList(data: Raw[]): Hotspot[] {
  return data
    .map(toHotspot)
    .filter((h): h is Hotspot => !!h)
    .sort((a, b) => Number(b.slug === "yaba") - Number(a.slug === "yaba") || a.wave - b.wave);
}

/**
 * The list is the same for everyone and carries about 40 KB of zone shapes, so it is fetched once per visit: the map, the
 * crew hub and every sheet share this copy, and nothing polls. A sheet that opens may ask again for fresh counts, no more
 * than once a minute (see SHEET_REFRESH_MS). The phone also keeps the rows between visits, so the pins are there at once
 * on the next open while a fresh copy is fetched quietly (see phoneCache).
 */
let cached: { list: Hotspot[]; at: number } | null = null;
let inFlight: Promise<Hotspot[] | null> | null = null;
/** Every hook that is mounted hears a new list, whoever asked for it (the map, the first run's home base card, the crew hub). */
const listeners = new Set<(list: Hotspot[]) => void>();

/** Seed from the phone's own copy, once per page load. */
function seedFromPhone() {
  if (cached) return;
  const c = read<Raw[]>(KEY);
  if (!c || !Array.isArray(c.data) || Date.now() - c.at > KEEP_MS) return;
  const list = toList(c.data);
  if (list.length) cached = { list, at: c.at };
}
seedFromPhone();

/** One call for the list, shared by whoever asks while it is out. Null when it failed (an old database, a flaky network). */
function fetchList(): Promise<Hotspot[] | null> {
  if (!getSupabase()) return Promise.resolve(null);
  inFlight ??= (async () => {
    try {
      const res = await fetchHotspotRows();
      if (!res.ok) return null;
      const data = res.data as Raw[];
      const rows = toList(data);
      write(KEY, data);
      cached = { list: rows, at: Date.now() };
      listeners.forEach((f) => f(rows));
      return rows;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The hotspots (hotspot_list(), public even signed out) and what "near you" means for one Hopper. Everything about the
 * Hopper's position happens here, on the phone: the zone test uses the public shapes and the distances use the fixed
 * junction points. The server is never told where anyone is.
 *
 * `at` is the Hopper's position inside Lagos, or null (location off, or not in Lagos): then there is no "your
 * hotspot" and no distances, and the list runs in wave order with Yaba on top.
 *
 * `failed` is true when the last ask for the list did not come back; `loaded` stays true once a list has. A caller
 * with nothing to show says "Hotspots could not load" and offers `reload(true)`.
 */
export function useHotspots({ active, at }: { active: boolean; at: Pt | null }) {
  const [list, setList] = useState<Hotspot[]>(() => (DEMO && !ROOMS_SEAL ? DEMO_HOTSPOTS : []));
  const [loaded, setLoaded] = useState(DEMO);
  const [failed, setFailed] = useState(false);

  // The pins from the phone's own copy land before the first paint (and after hydration, so the server HTML still agrees).
  useIsoLayoutEffect(() => {
    if (DEMO || ROOMS_SEAL || !cached) return;
    setList(cached.list);
    setLoaded(true);
  }, []);

  /** `force` asks now; without it, a copy under a minute old is kept. Whatever is on the map stays when the call fails. */
  const reload = useCallback(async (force = false) => {
    // Release 1: sealed hotspots are an empty list, and nothing is asked of the server.
    if (DEMO || ROOMS_SEAL) return;
    if (!force && cached && Date.now() - cached.at < SHEET_REFRESH_MS) return;
    const rows = await fetchList();
    if (rows) {
      setList(rows);
      setLoaded(true);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const on = (rows: Hotspot[]) => {
      setList(rows);
      setLoaded(true);
      setFailed(false);
    };
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);

  // A copy under a minute old (from the crew hub, an earlier visit, or the phone) is used as it is. An older one is shown
  // and refreshed in the background; with none, ask now.
  useEffect(() => {
    if (!active || DEMO || ROOMS_SEAL) return;
    if (cached) {
      setList(cached.list);
      setLoaded(true);
      if (Date.now() - cached.at >= SHEET_REFRESH_MS) void reload(true);
    } else void reload(true);
  }, [active, reload]);

  // Position jitters every second; the answers only change by a street or two. Work from a ~110 m grid.
  const key = at ? `${at.lat.toFixed(3)},${at.lng.toFixed(3)}` : "";
  const here = useMemo<Pt | null>(() => {
    if (!key) return null;
    const [lat, lng] = key.split(",").map(Number);
    return { lat, lng };
  }, [key]);

  return useMemo(() => {
    const yours = yoursOf(list, here);
    const others = nearestOthers(list, here, yours?.slug ?? null, here ? 2 : 3);
    // With no position the row is wave order, open ones first, Yaba on top.
    const row = here
      ? [...(yours ? [yours] : []), ...others]
      : list.filter((h) => h.status === "open").slice(0, 3);
    const metres = (h: Hotspot) => (here ? metresApart(here, h) : null);
    const bySlug = (slug: string | null) => (slug ? (list.find((h) => h.slug === slug.toLowerCase()) ?? null) : null);
    return {
      list,
      loaded,
      /** The last ask for the list failed. With `loaded` false there is nothing to show. */
      failed,
      yours,
      row,
      pins: pinsFor(list, here, yours?.slug ?? null),
      /** Metres from the Hopper, or null when we do not know where they are. Never sent anywhere. */
      metres,
      located: !!here,
      bySlug,
      reload,
    };
  }, [list, loaded, failed, here, reload]);
}

export type HotspotsData = ReturnType<typeof useHotspots>;
