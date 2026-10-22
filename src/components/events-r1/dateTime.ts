/**
 * Pure date and time helpers for the Hoppaz date and time picker. Everything is Lagos time (UTC+1 all year), and an
 * instant is passed around as an ISO string with the +01:00 offset ("2026-10-23T19:00:00+01:00"). No React, no imports:
 * the check script runs these under Node.
 *
 * A picked date is the calendar day in Lagos. (Events elsewhere belong to a 6am to 6am "night"; that is for listing them,
 * not for choosing when one starts.)
 */

const HOUR = 3.6e6;
const DAY = 864e5;
export const STEP_MIN = 15;
/** How far ahead a day can be picked. */
export const MAX_DAYS_AHEAD = 365;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** "2026-10-23T19:00:00+01:00" for an instant. */
export const lagosIso = (ms: number): string => `${new Date(ms + HOUR).toISOString().slice(0, 16)}:00+01:00`;

/** "2026-10-23", the Lagos calendar day of an instant. */
export const dayKeyOf = (ms: number): string => new Date(ms + HOUR).toISOString().slice(0, 10);

/** Minutes since midnight, Lagos. */
export function minutesOf(ms: number): number {
  const d = new Date(ms + HOUR);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The instant for a Lagos day and a minute of that day. */
export const instantOf = (dayKey: string, minutes: number): number => Date.parse(`${dayKey}T00:00:00+01:00`) + minutes * 60_000;

/** "19:00". */
export const clockOf = (minutes: number): string => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;

/** "Fri 23 Oct", the way the event page prints a day. */
export function shortDay(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 23 Oct · 19:00". Empty for a value that is not a date. */
export function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${shortDay(dayKeyOf(ms))} · ${clockOf(minutesOf(ms))}` : "";
}

/** Today, Tomorrow, then "Sat 24" and so on: `count` days from today. */
export function dayChips(nowMs: number, count = 10): Array<{ key: string; label: string }> {
  const today = dayKeyOf(nowMs);
  return Array.from({ length: count }, (_, i) => {
    const key = dayKeyOf(nowMs + i * DAY);
    const d = new Date(`${key}T12:00:00Z`);
    return { key, label: key === today ? "Today" : i === 1 ? "Tomorrow" : `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}` };
  });
}

/** Every start time of a day, in 15 minute steps (96 of them). */
export const TIMES: number[] = Array.from({ length: (24 * 60) / STEP_MIN }, (_, i) => i * STEP_MIN);

/** The same moment on another day. */
export function withDay(iso: string, dayKey: string): string {
  const ms = Date.parse(iso);
  return lagosIso(instantOf(dayKey, Number.isFinite(ms) ? minutesOf(ms) : 19 * 60));
}

/** The same day at another time. */
export function withMinutes(iso: string, minutes: number): string {
  const ms = Date.parse(iso);
  return lagosIso(instantOf(Number.isFinite(ms) ? dayKeyOf(ms) : dayKeyOf(Date.now()), minutes));
}

/** Starts moved: Ends keeps the same length (3 hours when there was none). */
export function moveEnd(oldStart: string, oldEnd: string, newStart: string, defaultLength = 3 * HOUR): string {
  const a = Date.parse(oldStart);
  const b = Date.parse(oldEnd);
  const n = Date.parse(newStart);
  const len = Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : defaultLength;
  return lagosIso(n + len);
}

/** One plain line when Ends is not after Starts, else "". */
export function endError(start: string, end: string): string {
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b <= a ? "Ends must be after Starts" : "";
}

/** "2026-10" moved by k months. */
export function shiftMonth(key: string, k: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + k, 1, 12)).toISOString().slice(0, 7);
}

/** The cells of a month, Monday first: blanks, then every day as "2026-10-17". */
export function monthCells(key: string): Array<string | null> {
  const [y, m] = key.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay() + 6) % 7;
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= len; d++) cells.push(`${key}-${two(d)}`);
  return cells;
}

/** "October 2026". */
export const monthTitle = (key: string): string =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
