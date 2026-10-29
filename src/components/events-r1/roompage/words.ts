/**
 * Words and small pure helpers of the room page (CHANGE-001). Times are Lagos time. Nothing here reads the clock or the data layer.
 */
import { oklchToRgb } from "@/lib/tint";
import type { EventChat, RoomMessage, RoomSummary } from "@/lib/events-r1/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 864e5;
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });

type Stamp = { y: number; m: number; d: number; h: number; min: number; dow: number };
function stamp(ms: number): Stamp {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
const dayNo = (s: Stamp) => Math.floor(Date.UTC(s.y, s.m - 1, s.d) / DAY);

/** "7:42 PM". */
export function clock12(iso: string): string {
  const s = stamp(Date.parse(iso));
  return `${s.h % 12 || 12}:${String(s.min).padStart(2, "0")} ${s.h < 12 ? "AM" : "PM"}`;
}

/** "Sun 1 Nov". */
export function dayShort(iso: string): string {
  const s = stamp(Date.parse(iso));
  return `${WEEKDAYS[s.dow]} ${s.d} ${MONTHS[s.m - 1]}`;
}

/** "today, 5:00 PM", "tomorrow, 5:00 PM" or "Sun 1 Nov, 5:00 PM". */
export function dayTime(iso: string, now: number): string {
  const gap = dayNo(stamp(Date.parse(iso))) - dayNo(stamp(now));
  const t = clock12(iso);
  if (gap === 0) return `today, ${t}`;
  if (gap === 1) return `tomorrow, ${t}`;
  return `${dayShort(iso)}, ${t}`;
}

/** "Tonight · 8:00 PM", "Tomorrow · 8:00 PM" or "Sat 5 Dec · 9:00 PM" (the next event card). */
export function whenCard(iso: string, now: number): string {
  const gap = dayNo(stamp(Date.parse(iso))) - dayNo(stamp(now));
  const t = clock12(iso);
  const s = stamp(Date.parse(iso));
  if (gap === 0) return `${s.h >= 17 ? "Tonight" : "Today"} · ${t}`;
  if (gap === 1) return `Tomorrow · ${t}`;
  return `${dayShort(iso)} · ${t}`;
}

/** {mon: "OCT", day: "30"} for the date chip. */
export function chip(iso: string): { mon: string; day: string } {
  const s = stamp(Date.parse(iso));
  return { mon: MONTHS[s.m - 1].toUpperCase(), day: String(s.d) };
}

/** Under five people the number is not said: a handful reads as an empty room. */
export const SMALL = 5;
export const showCount = (n: number) => n >= SMALL;

/** "New room": under five members. */
export const isNewRoom = (r: Pick<RoomSummary, "members">) => r.members < SMALL;

/** "You and 2 others" (a member's view of a new room). */
export function youAnd(members: number): string {
  const others = Math.max(0, members - 1);
  if (others === 0) return "Just you so far";
  return `You and ${others} ${others === 1 ? "other" : "others"}`;
}

/** The subtitle of the header: "Chat · 38 online", or the members when few are online. */
export function headSub(section: string, room: RoomSummary, insider: boolean): string {
  if (isNewRoom(room)) return `${section} · ${insider ? youAnd(room.members) : "New room"}`;
  if (showCount(room.online)) return `${section} · ${room.online.toLocaleString("en-NG")} online`;
  return `${section} · ${room.members.toLocaleString("en-NG")} members`;
}

/** A name's colour: the mock-up's avatar hues, so the same name is the same colour everywhere. */
const HUES = [26, 150, 220, 85, 300, 190, 50, 260, 120, 340];
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return oklchToRgb(0.78, 0.12, HUES[h % HUES.length]);
}

/** "General", "Announcements" or an event id: the channel ids of the room page. */
export const GENERAL = "general";
export const ANNOUNCEMENTS = "announcements";

export type ChannelState = EventChat["state"];

/** The line under an event channel in the list. */
export function chatSub(c: EventChat, now: number): string {
  if (c.state === "open") return `Open now · closes ${dayShort(c.closes_at)}`;
  if (c.state === "upcoming") return `Opens ${dayTime(c.opens_at, now)}`;
  return `Closed ${dayShort(c.closes_at)}`;
}

/** The last line of a chat as "Name: text", for the channel list. */
export function lastLine(lines: RoomMessage[] | null): string | null {
  const m = lines && lines.length ? lines[lines.length - 1] : null;
  return m ? `${m.author_name}: ${m.body}` : null;
}
