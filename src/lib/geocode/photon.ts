import { LAGOS_BOX, keepLagos } from "./lagos";
import type { GeocodeProvider, PlaceSuggestion } from "./types";

/**
 * Photon (https://photon.komoot.io): free, built on OpenStreetMap, made for search as you type. Server side only: the route
 * calls it so the browser never does. It is asked for Lagos with a bounding box, and a bias towards the middle of the city,
 * and what comes back is checked against the box again (lagos.ts keepLagos).
 *
 * Usage policy: a descriptive User-Agent, no bulk use. The route rate-limits and caches so one host typing stays well inside it.
 */

const BASE = process.env.PHOTON_URL?.replace(/\/+$/, "") || "https://photon.komoot.io";
export const USER_AGENT = "Hoppaz event place search, hoppaz.fun";
const TIMEOUT_MS = 4000;
/** Ask for more than we show: the box filter and the duplicate filter take some away. */
const ASK = 10;

type Props = {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  countrycode?: string;
};
type Feature = { geometry?: { type?: string; coordinates?: unknown }; properties?: Props };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The address line: street (with number), district, city. Anything equal to the name or already said is left out. */
function addressLine(p: Props, name: string): string {
  const street = [text(p.housenumber), text(p.street)].filter(Boolean).join(" ");
  const parts: string[] = [];
  for (const part of [street, text(p.district) || text(p.locality), text(p.city) || text(p.county)]) {
    if (!part || part.toLowerCase() === name.toLowerCase()) continue;
    if (parts.some((x) => x.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  return parts.join(", ");
}

/** Photon GeoJSON to suggestions. Pure, so it is checked without the network. Rows without a point or outside Nigeria are skipped. */
export function parsePhoton(json: unknown): PlaceSuggestion[] {
  const features = (json as { features?: Feature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceSuggestion[] = [];
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    const p = f?.properties ?? {};
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== "NG") continue;
    const [lng, lat] = c as [number, number];
    // A house with no name is searched by its street address.
    const name = text(p.name) || [text(p.housenumber), text(p.street)].filter(Boolean).join(" ");
    if (!name) continue;
    out.push({
      id: p.osm_id ? `${p.osm_type ?? "x"}${p.osm_id}` : `${name}@${lat.toFixed(5)},${lng.toFixed(5)}`,
      name,
      address: addressLine(p, name),
      lat,
      lng,
    });
  }
  return out;
}

async function get(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Photon answered ${res.status}`);
  return res.json();
}

export const photon: GeocodeProvider = {
  name: "photon",

  async search(query, signal) {
    const json = await get(
      "/api/",
      {
        q: query,
        limit: String(ASK),
        lang: "en",
        // minLon,minLat,maxLon,maxLat
        bbox: `${LAGOS_BOX.west},${LAGOS_BOX.south},${LAGOS_BOX.east},${LAGOS_BOX.north}`,
        // Among equal matches, the ones nearer the middle of the city come first.
        lat: "6.5244",
        lon: "3.3792",
      },
      signal,
    );
    return keepLagos(parsePhoton(json));
  },

  async reverse(lat, lng, signal) {
    const json = await get("/reverse", { lat: String(lat), lon: String(lng), lang: "en", limit: "1" }, signal);
    const [hit] = parsePhoton(json);
    if (!hit) return null;
    return [hit.name, hit.address].filter(Boolean).join(", ");
  },
};
