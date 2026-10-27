import { haversineKm, insideLagos } from "../geo";
import type { PlaceSpot, PlaceSuggestion } from "./types";

/**
 * Pure helpers for the place search: the Lagos box, cleaning what the host typed, and cleaning what a provider answered.
 * The box is the same one the database create function enforces (lat 6.30 to 6.80, lng 3.05 to 3.95, else lagos_only).
 */

export const LAGOS_BOX = { south: 6.3, north: 6.8, west: 3.05, east: 3.95 } as const;
export const MAX_RESULTS = 6;
export const MIN_QUERY = 3;
export const MAX_QUERY = 80;
export const MIN_NAME = 2;
export const MAX_NAME = 120;

/** Where a hand dropped pin starts: Yaba and Ebute Metta, on land and in the middle of the city (LAGOS_CENTER is in the lagoon). */
export const DROP_START = { lat: 6.5244, lng: 3.3792 } as const;

export const inLagosBox = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && insideLagos(lat, lng);

/** The nearest point inside the box. Used when a pin is dragged or tapped out of Lagos. */
export function clampToLagos(lat: number, lng: number): { lat: number; lng: number } {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { lat: c(lat, LAGOS_BOX.south, LAGOS_BOX.north), lng: c(lng, LAGOS_BOX.west, LAGOS_BOX.east) };
}

/** What was typed, tidied: one line, single spaces. Null when it is too short or too long to search for. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim();
  return q.length >= MIN_QUERY && q.length <= MAX_QUERY ? q : null;
}

/**
 * Provider results made safe: only well formed rows, only inside Lagos, no two rows for the same place (same name within 150 m),
 * at most MAX_RESULTS. Order is kept: the provider's own ranking is the best we have.
 */
export function keepLagos(rows: PlaceSuggestion[]): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  for (const r of rows) {
    if (!r || typeof r.name !== "string" || !r.name.trim() || !inLagosBox(r.lat, r.lng)) continue;
    const dupe = out.some((o) => o.name.toLowerCase() === r.name.toLowerCase() && haversineKm(o.lat, o.lng, r.lat, r.lng) < 0.15);
    if (dupe) continue;
    out.push(r);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** A suggestion as the form stores it. The name is cut to what the database accepts (2 to 120). */
export function spotFromSuggestion(s: PlaceSuggestion): PlaceSpot {
  const name = (s.name.trim().length >= MIN_NAME ? s.name.trim() : s.address.trim() || s.name.trim()).slice(0, MAX_NAME);
  return { place_name: name, address: s.address, lat: s.lat, lng: s.lng };
}

/** A saved spot read back from the draft: anything off (wrong types, outside Lagos) is dropped, never trusted. */
export function readSpot(v: unknown): PlaceSpot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!inLagosBox(o.lat, o.lng)) return null;
  return {
    place_name: typeof o.place_name === "string" ? o.place_name.slice(0, MAX_NAME) : "",
    address: typeof o.address === "string" ? o.address.slice(0, 200) : "",
    lat: o.lat as number,
    lng: o.lng as number,
    ...(o.manual === true ? { manual: true as const } : {}),
  };
}

/** A spot counts as a place once it has a usable name and a pin. */
export const spotName = (s: PlaceSpot | null): string => (s && s.place_name.trim().length >= MIN_NAME ? s.place_name.trim() : "");

/** A plain link to the spot in Google Maps. Free; the host uses it to check the pin. */
export const mapsUrl = (lat: number, lng: number): string => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
