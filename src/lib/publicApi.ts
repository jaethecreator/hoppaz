import { withDrop } from "./game-time/drops";
import type { GtListGame } from "./game-time/types";
import { LAGOS_CENTER } from "./geo";
import { getSupabase, supabaseConfigured } from "./supabase/client";
import type { EventRow } from "./types";

/**
 * The public reads of the app (the same for every Hopper), behind one door.
 *
 * Every function answers with a PublicResult and never throws. `via` says where the answer came from: "edge" (a Next route
 * the CDN caches, see src/app/api/public) or "direct" (the Supabase call the hooks always made). Callers that need a
 * per-Hopper field (distance_m) compute it on the phone.
 */
export type PublicResult<T> = { ok: true; data: T; via: "edge" | "direct" } | { ok: false; error: string };

const ok = <T,>(data: T): PublicResult<T> => ({ ok: true, data, via: "direct" });
const fail = (error: string): PublicResult<never> => ({ ok: false, error });
const NO_DB = "no database";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** After the edge failed, go straight to the database for this long, so a broken route does not double every wait. */
const EDGE_COOLDOWN_MS = 60_000;
const EDGE_TIMEOUT_MS = 8000;
let edgeDownUntil = 0;

/**
 * One read from the CDN-cached routes. The path and the credentials mode must stay exactly what the preload links in
 * src/app/layout.tsx say (same path, no query, same-origin), or the browser fetches twice. Undefined on any failure (null is a real answer: no Hop).
 */
async function getJSON<T>(path: string, valid: (data: unknown) => data is T): Promise<T | undefined> {
  if (typeof window === "undefined" || Date.now() < edgeDownUntil) return undefined;
  try {
    const res = await fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(EDGE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown } | null;
    if (!body || !valid(body.data)) throw new Error("unexpected body");
    return body.data;
  } catch {
    edgeDownUntil = Date.now() + EDGE_COOLDOWN_MS;
    return undefined;
  }
}

const isArray = (d: unknown): d is unknown[] => Array.isArray(d);
const isRowOrNull = (d: unknown): d is Record<string, unknown> | null => d === null || (typeof d === "object" && !Array.isArray(d));
const hasGames = (d: unknown): d is { games: GtListGame[] } =>
  !!d && typeof d === "object" && Array.isArray((d as { games?: unknown }).games);

const viaEdge = <T,>(data: T): PublicResult<T> => ({ ok: true, data, via: "edge" });

/** Live events within 110 km of LAGOS_CENTER (6.5, 3.42), now-4h .. now+45d, heat desc. distance_m is from LAGOS_CENTER; callers recompute it. */
export async function fetchLagosEvents(): Promise<PublicResult<EventRow[]>> {
  if (!supabaseConfigured()) return fail(NO_DB);
  const rows = await getJSON("/api/public/events", isArray);
  if (rows) return viaEdge((rows as EventRow[]).slice().sort((a, b) => b.heat - a.heat));
  return fetchEventsNearDirect(LAGOS_CENTER.lat, LAGOS_CENTER.lng, 110_000);
}

/** Direct events_near around a fix (for a fix > 65 km from LAGOS_CENTER). Keeps today's JWT-expired refresh/retry. */
export async function fetchEventsNearDirect(lat: number, lng: number, radiusM: number): Promise<PublicResult<EventRow[]>> {
  const sb = getSupabase();
  if (!sb) return fail(NO_DB);
  try {
    const fetchNear = () =>
      sb.rpc("events_near", {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: radiusM,
        // Upcoming listings stay available for calendar browsing; the map narrows them.
        p_to: new Date(Date.now() + 45 * 24 * 3.6e6).toISOString(),
      });
    let { data, error } = await fetchNear();
    // A stored session that went stale while the tab slept makes every request fail with "JWT expired".
    // Refresh it and try again; if it cannot be refreshed, drop it (events are public).
    if (error && /jwt/i.test(error.message)) {
      const { error: refreshError } = await sb.auth.refreshSession();
      if (refreshError) await sb.auth.signOut({ scope: "local" });
      ({ data, error } = await fetchNear());
    }
    if (error || !Array.isArray(data)) return fail(error?.message ?? "no data");
    return ok((data as EventRow[]).slice().sort((a, b) => b.heat - a.heat));
  } catch (e) {
    return fail(msg(e));
  }
}

/** hotspot_list() rows, unmapped. */
export async function fetchHotspotRows(): Promise<PublicResult<unknown[]>> {
  if (!supabaseConfigured()) return fail(NO_DB);
  const rows = await getJSON("/api/public/hotspots", isArray);
  if (rows) return viaEdge(rows);
  const sb = getSupabase();
  if (!sb) return fail(NO_DB);
  try {
    const { data, error } = await sb.rpc("hotspot_list");
    if (error || !Array.isArray(data)) return fail(error?.message ?? "no data");
    return ok(data as unknown[]);
  } catch (e) {
    return fail(msg(e));
  }
}

/** Next announced/selling Hop with hop_stops(*), unmapped, or null. */
export async function fetchNextHopRow(): Promise<PublicResult<Record<string, unknown> | null>> {
  if (!supabaseConfigured()) return fail(NO_DB);
  const row = await getJSON("/api/public/hop", isRowOrNull);
  if (row !== undefined) return viaEdge(row);
  const sb = getSupabase();
  if (!sb) return fail(NO_DB);
  try {
    const { data, error } = await sb
      .from("hops")
      .select("*, hop_stops(*)")
      .in("status", ["announced", "selling"])
      .order("hop_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return fail(error.message);
    return ok((data as Record<string, unknown> | null) ?? null);
  } catch (e) {
    return fail(msg(e));
  }
}

/** Every event id that has a collectible drop or a live public game drop. */
export async function fetchDropEventIds(): Promise<PublicResult<string[]>> {
  if (!supabaseConfigured()) return fail(NO_DB);
  const ids = await getJSON("/api/public/drop-events", isArray);
  if (ids) return viaEdge(ids.filter((id): id is string => typeof id === "string"));
  const sb = getSupabase();
  if (!sb) return fail(NO_DB);
  try {
    const [legacy, live] = await Promise.all([
      sb.from("collectible_drops").select("event_id"),
      sb.from("game_drops").select("event_id").eq("active", true).gt("closes_at", new Date().toISOString()).not("event_id", "is", null),
    ]);
    if (legacy.error) return fail(legacy.error.message);
    if (live.error) return fail(live.error.message);
    const ids = [...(legacy.data ?? []), ...(live.data ?? [])].map((r) => (r as { event_id: string | null }).event_id);
    return ok([...new Set(ids.filter((id): id is string => !!id))]);
  } catch (e) {
    return fail(msg(e));
  }
}

/** game_time_list() as an anonymous caller sees it: open crews only, is_member=false, won=false, blocked=null. */
export async function fetchPublicGameTimeList(): Promise<PublicResult<{ games: GtListGame[] }>> {
  if (!supabaseConfigured()) return fail(NO_DB);
  const list = await getJSON("/api/public/game-time", hasGames);
  // The routes' copy is the anonymous one; if the edge is down the direct rpc answers per Hopper, which is still right for the ping.
  if (list) return viaEdge({ games: list.games.map(withDrop) });
  const sb = getSupabase();
  if (!sb) return fail(NO_DB);
  try {
    const { data, error } = await sb.rpc("game_time_list");
    if (error || !data) return fail(error?.message ?? "no data");
    const games = (data as { games?: GtListGame[] }).games;
    return ok({ games: Array.isArray(games) ? games.map(withDrop) : [] });
  } catch (e) {
    return fail(msg(e));
  }
}
