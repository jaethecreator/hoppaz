/**
 * How a pulled row (ScoutEvent) becomes the fields of a listing event. Pure: no state, so both the seed and approve use it.
 * Mirrors ev_o_approve: listed_price is the lowest known ticket price, ig_url is the ticket link else the Instagram post, the pin comes
 * from lat and lng or the event is parked at the Lagos centre (and so stays off the map).
 */
import type { Vibe } from "../../brand";
import { areaByName, insideLagos, LAGOS_CENTER, nearestArea } from "../../geo";
import { normHandle } from "../outreach/match";
import type { ScoutEvent } from "../types";
import type { EventRec } from "./store";

/** The Hoppaz vibe for a source category. Unknown gives culture. */
export function vibeFor(category: string | null | undefined): Vibe {
  const c = (category ?? "").toLowerCase();
  const rules: Array<[RegExp, Vibe]> = [
    [/comed|stand.?up|open mic/, "comedy"],
    [/amapiano/, "amapiano"],
    [/techno|house/, "techno"],
    [/rave|club|detty/, "rave"],
    [/afro|party|night|dance/, "afro"],
    [/beach/, "beach"],
    [/rooftop/, "rooftop"],
    [/music|concert|band|live|highlife|jazz/, "live band"],
    [/food|dinner|brunch|tasting|drink/, "food"],
    [/tech|business|network|conference|startup|workshop/, "tech"],
  ];
  return rules.find(([re]) => re.test(c))?.[1] ?? "culture";
}

/** Lowest and highest known ticket price, whole naira. null when no price is known. */
export function priceRange(tickets: ScoutEvent["tickets"]): { from: number | null; to: number | null } {
  const known = tickets.map((t) => t.price_naira).filter((p): p is number => typeof p === "number" && p >= 0);
  return known.length ? { from: Math.min(...known), to: Math.max(...known) } : { from: null, to: null };
}

/** The event fields a listing takes from a pulled row. The caller adds id, slug, host, room, organiser and created_at. */
export function listingFields(f: ScoutEvent): Omit<EventRec, "id" | "slug" | "host_id" | "room_id" | "organiser_id" | "created_at"> {
  const start = f.starts_at ? Date.parse(f.starts_at) : NaN;
  const end = f.ends_at ? Date.parse(f.ends_at) : NaN;
  const pinned = typeof f.lat === "number" && typeof f.lng === "number" && insideLagos(f.lat, f.lng);
  const area = pinned ? (areaByName(f.area)?.name ?? nearestArea(f.lat as number, f.lng as number).name) : (areaByName(f.area)?.name ?? f.area ?? null);
  const range = priceRange(f.tickets);
  const link = f.ticket_url ?? null;
  const handle = normHandle(f.event_handle);
  const ig = handle ? `https://instagram.com/${handle}` : null;
  return {
    title: f.name.trim(),
    venue_name: (f.venue ?? "").trim().slice(0, 120),
    area,
    lat: pinned ? (f.lat as number) : LAGOS_CENTER.lat,
    lng: pinned ? (f.lng as number) : LAGOS_CENTER.lng,
    starts_at: new Date(start).toISOString(),
    ends_at: Number.isFinite(end) && end > start ? new Date(end).toISOString() : null,
    timezone: "Africa/Lagos",
    kind: "in_person",
    price_naira: range.from ?? 0,
    vibe: vibeFor(f.category),
    source: "partner",
    ig_url: link ?? ig,
    flyer_url: f.flyer_url ?? null,
    description: (f.description ?? "").trim().slice(0, 2000),
    link_type: null,
    online_link: null,
    visibility: "public",
    status: "live",
    capacity: null,
    requires_approval: false,
    waitlist_on: false,
    ticket_mode: "external",
    ticket_url: link,
    instagram_url: ig,
    listed_price: range.from,
    listed_price_max: range.to,
    listing_sold_out: !!f.sold_out,
    source_site: f.source_site,
    source_id: f.source_id,
  };
}
