/** The public read of listings (ev_listings, supabase/events_r1_listings.sql): one call per list, merged into the mapped events. */
import type { R1Event } from "../types";
import { shared } from "./core";
import { mapListing } from "./map";
import { soft } from "./roomProfile";

export type ListingsMap = Record<string, unknown>;

/**
 * { event id: listing } for every external event a visitor may see. One call, shared for a few seconds. Tolerant: before the
 * file is run (or on a hiccup) it answers empty, so every event reads as a normal Hoppaz event, as it did before.
 */
export function listingsMap(): Promise<ListingsMap> {
  return shared("events.listings", 4000, async () => {
    const r = await soft<ListingsMap>("ev_listings");
    const j = r.data;
    return !r.missing && !r.error && j && typeof j === "object" && !Array.isArray(j) ? j : {};
  });
}

/** A listing has no ticket list, no going count and no spots left: the screens show the listed price and a Get tickets link. */
export function withListing(ev: R1Event, listings: ListingsMap): R1Event {
  const j = listings[ev.id];
  if (!j || typeof j !== "object") return ev;
  const listing = mapListing(j);
  return { ...ev, listing, ticket_types: [], going: 0, spots_left: null, price_naira: listing.price_from ?? 0 };
}

/** A list of mapped events with the listings merged in (one ev_listings call for the whole list). */
export async function withListings(evs: R1Event[]): Promise<R1Event[]> {
  if (!evs.length) return evs;
  const listings = await listingsMap();
  return evs.map((e) => withListing(e, listings));
}
