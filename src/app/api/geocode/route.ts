import { NextResponse } from "next/server";
import { geocoder } from "@/lib/geocode";
import { cleanQuery, inLagosBox, MAX_QUERY } from "@/lib/geocode/lagos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Place search for the create-an-event Where step. The browser asks this route, the route asks the provider (Photon, see
 * src/lib/geocode), so the browser never calls it and a key could be added later without shipping it to the phone.
 *
 *   GET /api/geocode?q=ikeja city mall       -> { results: PlaceSuggestion[] }   (3 to 80 characters, up to 6 rows, Lagos only)
 *   GET /api/geocode?lat=6.44&lng=3.46       -> { address: string | null }       (a line for a pin dropped by hand)
 *
 * Open to people who are not signed in yet (the create page asks for sign up only when the event is made), so the guard is the
 * per IP rate limit, a short timeout and a cache of identical questions.
 */

const TTL_MS = 5 * 60_000;
const MAX_CACHED = 500;
const PER_MINUTE = 40;

type Hit<T> = { at: number; value: T };
const found = new Map<string, Hit<unknown>>();

function remembered<T>(key: string): T | undefined {
  const hit = found.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    found.delete(key);
    return undefined;
  }
  return hit.value as T;
}
function remember(key: string, value: unknown) {
  if (found.size >= MAX_CACHED) {
    // Oldest first: a Map keeps insertion order.
    const oldest = found.keys().next().value;
    if (oldest !== undefined) found.delete(oldest);
  }
  found.set(key, { at: Date.now(), value });
}

/** Per IP, same idea as the limiter the other routes use: true when this IP has asked `max` times in the last minute. */
const asked = new Map<string, number[]>();
function slowDown(key: string, max = PER_MINUTE, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (asked.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    asked.set(key, recent);
    return true;
  }
  recent.push(now);
  asked.set(key, recent);
  if (asked.size > 5000) for (const [k, times] of asked) if (!times.some((at) => now - at < windowMs)) asked.delete(k);
  return false;
}

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

const reply = (body: unknown, status = 200, cache = "no-store") =>
  NextResponse.json(body, { status, headers: { "Cache-Control": cache } });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const provider = geocoder();

  // A pin dropped by hand: an address line for the point.
  if (params.has("lat") || params.has("lng")) {
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!inLagosBox(lat, lng)) return reply({ error: "Hoppaz is Lagos only for now." }, 400);
    if (!provider.reverse) return reply({ address: null });
    if (slowDown(ipOf(request))) return reply({ error: "Give it a moment, then try again." }, 429);
    // About 11 metres: close enough to share a cache row, far enough not to blur two doors.
    const key = `r:${provider.name}:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = remembered<string | null>(key);
    if (cached !== undefined) return reply({ address: cached }, 200, "private, max-age=300");
    try {
      const address = await provider.reverse(lat, lng, request.signal);
      remember(key, address);
      return reply({ address }, 200, "private, max-age=300");
    } catch {
      return reply({ address: null });
    }
  }

  const q = cleanQuery(params.get("q"));
  if (!q) {
    const long = (params.get("q") ?? "").trim().length > MAX_QUERY;
    return reply({ error: long ? "That is too long to search for." : "Type at least 3 letters.", results: [] }, 400);
  }
  const key = `q:${provider.name}:${q.toLowerCase()}`;
  const cached = remembered<unknown[]>(key);
  if (cached) return reply({ results: cached }, 200, "private, max-age=300");
  if (slowDown(ipOf(request))) return reply({ error: "Give it a moment, then try again.", results: [] }, 429);

  try {
    const results = await provider.search(q, request.signal);
    remember(key, results);
    return reply({ results }, 200, "private, max-age=300");
  } catch {
    // The provider is slow or down: the page offers "Drop a pin" instead, so this is not an error the host has to fix.
    return reply({ error: "Search is not working right now.", results: [] }, 502);
  }
}
