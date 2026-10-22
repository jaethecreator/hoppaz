/** Small time words for the event page. The event's own clock is Lagos unless it says otherwise; these are for "now" things. */
import type { R1Event } from "@/lib/events-r1/types";

const HOUR = 3.6e6;
const DAY = 24 * HOUR;

/** When the event is over: its end, or three hours after the start (the data layer's own rule). */
export function endOf(e: Pick<R1Event, "starts_at" | "ends_at">): number {
  const start = Date.parse(e.starts_at);
  const end = e.ends_at ? Date.parse(e.ends_at) : NaN;
  return Number.isFinite(end) && end > start ? end : start + 3 * HOUR;
}

/** "Starts in 2 days", "Starts in 5 hours", "Starts in 40 minutes", "Happening now". */
export function startsIn(e: Pick<R1Event, "starts_at" | "ends_at">, now: number): string {
  const start = Date.parse(e.starts_at);
  if (now >= endOf(e)) return "This event has ended";
  if (now >= start) return "Happening now";
  const diff = start - now;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (diff >= DAY) return `Starts in ${plural(Math.floor(diff / DAY), "day")}`;
  if (diff >= HOUR) return `Starts in ${plural(Math.floor(diff / HOUR), "hour")}`;
  return `Starts in ${plural(Math.max(1, Math.ceil(diff / 60_000)), "minute")}`;
}

const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Wed 28 Oct · 14:00" in Lagos time. */
export function popWhen(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(stamp.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute}`;
}
