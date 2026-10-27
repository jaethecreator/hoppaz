import type { PlaceSuggestion } from "./types";

/** The browser side of the place search: it only ever calls our own /api/geocode. */

/** Suggestions for what was typed. Throws a short sentence on a failure; an aborted call throws the AbortError. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  const body = (await res.json().catch(() => null)) as { results?: PlaceSuggestion[]; error?: string } | null;
  if (!res.ok) throw new Error(body?.error || "Search is not working right now.");
  return Array.isArray(body?.results) ? body.results : [];
}

/** An address line for a point, or null when there is none (or the call failed: it is only a nicety). */
export async function addressFor(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`/api/geocode?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: string | null };
    return typeof body.address === "string" && body.address ? body.address : null;
  } catch {
    return null;
  }
}
