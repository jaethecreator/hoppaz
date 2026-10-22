/**
 * Release 1 Roomz wording and small helpers: where a room lives, and the short time words of the Roomz screens.
 * Pure: nothing here reads the clock or the data layer. Times are Lagos time.
 */
import type { EventChat, RoomSummary } from "@/lib/events-r1/types";

const HOUR = 3.6e6;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hoppaz HQ lives at /rooms/hq; every other room at its slug. */
export const roomPath = (r: Pick<RoomSummary, "slug" | "kind">) => `/rooms/${r.kind === "hq" ? "hq" : encodeURIComponent(r.slug)}`;

/** Where Enter room goes: the walkable room when there is one, else the General chat. Hoppaz HQ is chat first: never the walkable room. */
export const enterPath = (r: Pick<RoomSummary, "slug" | "kind" | "id" | "has_3d">) =>
  r.has_3d && r.kind !== "hq" ? `/crew/${r.id}/room` : `${roomPath(r)}/general`;

export const memberWord = (n: number) => `${n.toLocaleString("en-NG")} ${n === 1 ? "member" : "members"}`;

type Stamp = { y: number; m: number; d: number; h: number; min: number; dow: number };
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function stamp(ms: number): Stamp {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
const two = (n: number) => String(n).padStart(2, "0");
const dayNo = (s: Stamp) => Math.floor(Date.UTC(s.y, s.m - 1, s.d) / DAY);

/** "Sun 25 Oct". */
export function dayWord(iso: string): string {
  const s = stamp(Date.parse(iso));
  return `${WEEKDAYS[s.dow]} ${s.d} ${MONTHS[s.m - 1]}`;
}

/** "14:05". */
export function clockWord(iso: string): string {
  const s = stamp(Date.parse(iso));
  return `${two(s.h)}:${two(s.min)}`;
}

/** "today 14:00", "Mon" (within the week), or "12 Oct". `now` is the data layer's clock. */
export function whenWord(iso: string, now: number): string {
  const t = stamp(Date.parse(iso));
  const gap = dayNo(stamp(now)) - dayNo(t);
  if (gap === 0) return `today ${two(t.h)}:${two(t.min)}`;
  if (gap === 1) return "yesterday";
  if (gap > 1 && gap < 7) return WEEKDAYS[t.dow];
  return `${t.d} ${MONTHS[t.m - 1]}`;
}

/** The line under an event chat on the Roomz tab. */
export function closesWord(chat: Pick<EventChat, "state" | "closes_at">): string {
  if (chat.state === "closed") return "Closed";
  if (chat.state === "upcoming") return "Closes 3 days after the event";
  return `Closes ${dayWord(chat.closes_at)}`;
}

/** The brand gradients behind a room with no wallpaper. The same room always gets the same one. */
const GRADIENTS: Array<[string, string]> = [
  ["#FF4D00", "#5B2EFF"],
  ["#22B8F0", "#5B2EFF"],
  ["#B83600", "#3A1A5E"],
  ["#5B2EFF", "#0E4A63"],
];

export function gradientFor(r: Pick<RoomSummary, "name" | "kind">): string {
  if (r.kind === "hq") return `linear-gradient(135deg, ${GRADIENTS[0][0]}, ${GRADIENTS[0][1]})`;
  let h = 0;
  for (const c of r.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = GRADIENTS[1 + (h % (GRADIENTS.length - 1))];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
