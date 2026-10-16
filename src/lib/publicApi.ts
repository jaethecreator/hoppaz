import { withDrop } from "./game-time/drops";
import type { GtListGame } from "./game-time/types";
import { LAGOS_CENTER } from "./geo";
import { getSupabase } from "./supabase/client";
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

/** Live events within 110 km of LAGOS_CENTER (6.5, 3.42), now-4h .. now+45d, heat desc. distance_m is from LAGOS_CENTER; callers recompute it. */
export async function fetchLagosEvents(): Promise<PublicResult<EventRow[]>> {
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
