/** Small words for the host dashboard: who is in which state, and how long ago. Pure; the clock is passed in. */
import type { RegStatus, Registration } from "@/lib/events-r1/types";

const DAY = 864e5;
const LAGOS = 3.6e6;

/** Whole Lagos calendar days from `iso` to `now` (0 = the same Lagos day). */
function daysSince(iso: string, now: number): number {
  const a = Math.floor((Date.parse(iso) + LAGOS) / DAY);
  const b = Math.floor((now + LAGOS) / DAY);
  return Math.max(0, b - a);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "Registered today", "Registered yesterday", "Registered 3 days ago". */
export function registeredWord(iso: string, now: number): string {
  const d = daysSince(iso, now);
  return d === 0 ? "Registered today" : d === 1 ? "Registered yesterday" : `Registered ${d} days ago`;
}

/** "Waited today", "Waited 1 day", "Waited 2 days". */
export function waitedWord(iso: string, now: number): string {
  const d = daysSince(iso, now);
  return d === 0 ? "Waited today" : `Waited ${plural(d, "day")}`;
}

const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Fri 23 Oct, 19:42" in Lagos time. */
export function stampWord(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(stamp.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

export const STATUS_WORD: Record<RegStatus, string> = {
  requested: "Pending",
  going: "Going",
  waitlisted: "Waitlist",
  declined: "Declined",
  cancelled: "Cancelled",
  checked_in: "Checked in",
};

/** The pill colour for a status (the app's pill tones). */
export const STATUS_TONE: Record<RegStatus, string> = {
  requested: "pill-danfo",
  going: "pill-keke",
  waitlisted: "pill-lagoon",
  declined: "pill-fireant",
  cancelled: "",
  checked_in: "pill-violet",
};

/** The grey line under a name: when they came, or how long they have waited. */
export function metaWord(r: Registration, now: number): string {
  if (r.status === "waitlisted") return waitedWord(r.created_at, now);
  if (r.status === "checked_in" && r.checked_in_at) return `Checked in ${stampWord(r.checked_in_at).split(", ")[1] ?? ""}`.trim();
  return registeredWord(r.created_at, now);
}

export type Counts = { going: number; pending: number; waitlist: number; checkedIn: number };

/** Going counts checked in people too, like the event's own going count. */
export function countsOf(regs: Registration[] | null | undefined): Counts {
  const c: Counts = { going: 0, pending: 0, waitlist: 0, checkedIn: 0 };
  for (const r of regs ?? []) {
    if (r.status === "going") c.going++;
    else if (r.status === "checked_in") {
      c.going++;
      c.checkedIn++;
    } else if (r.status === "requested") c.pending++;
    else if (r.status === "waitlisted") c.waitlist++;
  }
  return c;
}

/** A raw "events are off" code from the server reads as "Not open yet"; any other message is already plain. */
export const errWord = (e: unknown, fallback = "That did not work. Try again.") =>
  e instanceof Error && e.message ? (/events?_r1_off|r1_off|not_open_yet/i.test(e.message) ? "Not open yet" : e.message) : fallback;
