/**
 * A listing is a pulled event: tickets are sold on the organiser's own page, not on Hoppaz. Every screen asks these helpers what to say,
 * so the map, the lists, the deck, the share cards and the event page cannot disagree. Pure: no clock, no data layer.
 * A normal Hoppaz event (listing missing or null) answers as it always did.
 */
import type { ListingInfo, R1Event } from "./types";

type Maybe = Pick<R1Event, "price_naira"> & { listing?: ListingInfo | null };

export const isListing = (e: { listing?: ListingInfo | null }): e is { listing: ListingInfo } => !!e.listing;

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** "Free", "₦5,000", "From ₦5,000" or "Check listing" (the source did not say). A normal event: its lowest ticket price, or Free. */
export function priceLine(e: Maybe): string {
  const l = e.listing;
  if (!l) return e.price_naira > 0 ? naira(e.price_naira) : "Free";
  if (l.price_from === null) return "Check listing";
  if (l.price_from === 0 && (l.price_to ?? 0) === 0) return "Free";
  if (l.price_to !== null && l.price_to > l.price_from) return `From ${naira(l.price_from)}`;
  return naira(l.price_from);
}

/** Where Get tickets goes: the organiser's ticket page, else their Instagram post, else nowhere. */
export function ticketHref(e: { listing?: ListingInfo | null }): string | null {
  return e.listing?.ticket_url ?? e.listing?.instagram_url ?? null;
}

/** The button: "Get tickets", or "See the listing" when the source says sold out or there is only an Instagram post. */
export function ticketButtonLabel(e: { listing?: ListingInfo | null }): string {
  const l = e.listing;
  if (!l) return "Get tickets";
  return l.sold_out || !l.ticket_url ? "See the listing" : "Get tickets";
}

/** "Listed by Hoppaz" while unclaimed, "Hosted by <organiser>" after. */
export function listedByLine(e: { listing?: ListingInfo | null }): string {
  const l = e.listing;
  if (!l) return "";
  return l.claimed ? `Hosted by ${l.organiser_name ?? "the organiser"}` : "Listed by Hoppaz";
}

/** Small note under the button: where the tickets are sold. */
export function soldAtLine(e: { listing?: ListingInfo | null }): string {
  const l = e.listing;
  if (!l) return "";
  if (l.sold_out) return "Sold out at the source";
  return l.source_site ? `Tickets are sold on ${l.source_site}` : "Tickets are sold by the organiser";
}

/** Going counts, spots left and the ticket list mean nothing for a listing: never show them. */
export const showsCounts = (e: { listing?: ListingInfo | null }): boolean => !e.listing;

/** What a screen says when a register or checkout path still reaches a listing. The database says the same (external_tickets). */
export const EXTERNAL_TICKETS_ERROR = "Tickets for this event are sold by the organiser";

/** The words for an error from a register or checkout call when the event turned out to be a listing; null for any other error. */
export function externalError(e: unknown): string | null {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /external_tickets|sold by the organiser/i.test(m) ? EXTERNAL_TICKETS_ERROR : null;
}

/** The way in for an organiser. */
export const CLAIM_ASK = "Is this your event?";

/** A short price for a tight place (a map pin): "FREE", "₦5K", "FROM ₦5K" or "CHECK LISTING". Capitals, like the map. */
export function priceShortCaps(e: Maybe, short: (n: number) => string): string {
  const l = e.listing;
  if (!l) return short(e.price_naira).toUpperCase();
  const p = priceLine(e).toUpperCase();
  if (l.price_from === null || l.price_from <= 0) return p;
  return p.startsWith("FROM") ? `FROM ${short(l.price_from)}` : short(l.price_from);
}
