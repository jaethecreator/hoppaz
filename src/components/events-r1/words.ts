/**
 * Release 1 wording for the Map, Events and the event card: plain sentence case, Lagos time, 24 hour clock.
 * Everything here is pure. Nothing reads the clock or the data layer, so a list and a card cannot disagree.
 */
import { NEXT_COUNT, nightOf } from "@/lib/filters";
import { isEventLead } from "@/lib/geo";
import type { R1Event } from "@/lib/events-r1/types";
import type { EventRow } from "@/lib/types";

export const EVENTS_TITLE = "Events in Lagos";
export const NEXT_LINE = `Showing the next ${NEXT_COUNT} events`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3.6e6;

/** The event as the new screens know it, or null for a plain row (a live listing the new fields do not reach yet). */
export function asR1(e: EventRow): R1Event | null {
  const r = e as Partial<R1Event>;
  return r.host && r.kind ? (e as R1Event) : null;
}

/** The real going count (approved and checked-in people) when the row carries one; never the swipe count. */
export function realGoing(e: EventRow): number | null {
  const g = (e as Partial<R1Event>).going;
  return typeof g === "number" ? g : null;
}

/** "Friday 23 Oct", from a night key (the 6am to 6am night an event belongs to). */
export function nightName(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Events on Friday 23 Oct". */
export const dayHeading = (key: string) => `Events on ${nightName(key)}`;

type Stamp = { y: number; m: number; d: number; h: number; min: number; dow: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date and clock of an instant in a time zone (Lagos unless the event says otherwise). */
function stamp(ms: number, tz: string): Stamp {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

const two = (n: number) => String(n).padStart(2, "0");
const clock = (s: Stamp) => `${two(s.h)}:${two(s.min)}`;
const shortDay = (s: Stamp) => `${DAY_NAMES[s.dow].slice(0, 3)} ${s.d} ${MONTHS[s.m - 1]}`;
const tzOf = (e: EventRow) => (e as Partial<R1Event>).timezone || "Africa/Lagos";

/** "19:00". A lead (a listing nobody has confirmed) has no time yet. */
export function timeWord(e: EventRow): string {
  return isEventLead(e) ? "Time to be confirmed" : clock(stamp(Date.parse(e.starts_at), tzOf(e)));
}

/** "Thu 29 Oct · 19:00 to 00:00". The end shows its own day only when it is more than a night away. */
export function whenRange(e: EventRow): string {
  const tz = tzOf(e);
  const start = Date.parse(e.starts_at);
  const a = stamp(start, tz);
  const head = `${shortDay(a)} · ${clock(a)}`;
  const endIso = (e as Partial<R1Event>).ends_at;
  const end = endIso ? Date.parse(endIso) : NaN;
  if (!Number.isFinite(end) || end <= start) return head;
  const b = stamp(end, tz);
  return end - start > 20 * HOUR ? `${head} to ${shortDay(b)} · ${clock(b)}` : `${head} to ${clock(b)}`;
}

/** "Free" or the naira. The price in sentence case; a lead says to check the listing. */
export function priceWord(e: Pick<EventRow, "title" | "price_naira">): string {
  if (isEventLead(e)) return "Check listing";
  return e.price_naira > 0 ? `₦${e.price_naira.toLocaleString("en-NG")}` : "Free";
}

export const isOnline = (e: EventRow) => (e as Partial<R1Event>).kind === "online";

/** Where, for a list row: the area (or venue), or "Online" when there is no place. */
export function placeWord(e: EventRow): string {
  if (isOnline(e)) return "Online";
  return e.area || e.venue_name || "";
}

/** Where, for the card: "The Terrace Rooftop, Victoria Island", or "Online". */
export function placeLine(e: EventRow): string {
  if (isOnline(e)) return "Online";
  const venue = (e.venue_name || "").trim();
  const area = (e.area || "").trim();
  if (venue && area && !venue.toLowerCase().includes(area.toLowerCase())) return `${venue}, ${area}`;
  return venue || area;
}

/** The meta line of a list row: "19:00 · Maroko · Free". */
export function rowMeta(e: EventRow): string {
  return [timeWord(e), placeWord(e), priceWord(e)].filter(Boolean).join(" · ");
}

export type NightGroup = { key: string; heading: string; events: EventRow[] };

/** Rows grouped by the night they belong to (6am to 6am Lagos time), in the order given. */
export function groupByNight(events: EventRow[]): NightGroup[] {
  const out: NightGroup[] = [];
  for (const e of events) {
    const key = nightOf(Date.parse(e.starts_at));
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, heading: dayHeading(key), events: [e] });
  }
  return out;
}
