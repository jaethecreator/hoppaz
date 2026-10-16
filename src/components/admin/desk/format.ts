import { parseDrop } from "@/lib/game-time/drops";
import type { Game, GamePhase } from "./types";

/**
 * Plain helpers for the staff desk: Lagos times as people read them, the drop and series a Game Time belongs to, the
 * mystery drop times, and the one-line summary of a drop. Lagos is UTC+1 all year (no daylight saving).
 */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
const LAGOS = "Africa/Lagos";

function parts(ms: number) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year"), hour: get("hour"), minute: get("minute") };
}
const msOf = (t: string | number) => (typeof t === "number" ? t : Date.parse(t));

/** "20:00", Lagos time. */
export function hhmm(t: string | number): string {
  const p = parts(msOf(t));
  return `${p.hour}:${p.minute}`;
}
/** "Fri 16 Oct", Lagos time. */
export function lagosDay(t: string | number): string {
  const p = parts(msOf(t));
  return `${p.weekday} ${p.day} ${p.month}`;
}
/** "Fri 16 Oct, 20:00", Lagos time. Empty for null. */
export function lagos(t: string | number | null): string {
  if (t === null || t === "") return "";
  return `${lagosDay(t)}, ${hhmm(t)}`;
}
/** "Thu 21:30", Lagos time. */
export function lagosShort(t: string | number): string {
  const p = parts(msOf(t));
  return `${p.weekday} ${p.hour}:${p.minute}`;
}
/** "YYYY-MM-DD" of a moment in Lagos. */
export function lagosDate(t: string | number): string {
  return new Date(msOf(t) + HOUR).toISOString().slice(0, 10);
}
/** "today", "tomorrow", or "Sat 17 Oct" for a moment, as seen from now in Lagos. */
export function dayWord(t: string | number, now = Date.now()): string {
  const d = lagosDate(t);
  if (d === lagosDate(now)) return "today";
  if (d === lagosDate(now + 24 * HOUR)) return "tomorrow";
  return lagosDay(t);
}
/** An ISO time as a datetime-local value in Lagos time ("2026-10-16T20:00"), the form the staff API takes. */
export const lagosInput = (t: string | number) => new Date(msOf(t) + HOUR).toISOString().slice(0, 16);
/** A Lagos wall time ("2026-10-16T20:00", or a date and "20:00") as ms; NaN when empty or invalid. */
export function lagosMs(v: string, time?: string): number {
  const s = time === undefined ? v : `${v}T${time}`;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? Date.parse(`${s}:00+01:00`) : NaN;
}

/** "5 min", "2 h 10 min", "3 days". */
export function span(mins: number | null): string {
  if (mins === null || !Number.isFinite(mins)) return "?";
  const m = Math.abs(Math.round(mins));
  const sign = mins < 0 ? "-" : "";
  if (m < 90) return `${sign}${m} min`;
  if (m < 2880) return `${sign}${Math.floor(m / 60)} h ${m % 60} min`;
  return `${sign}${Math.round(m / 1440)} days`;
}
/** "1 ticket", "3 tickets". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Over: found, closed or out of time. */
export const isOver = (p: GamePhase) => p === "all_found" || p === "closed" || p === "time_up";

/** The status pill of a drop: the pill class (globals.css) and its words. */
export const PHASE_PILL: Record<GamePhase, { cls: string; label: string }> = {
  upcoming: { cls: "", label: "COMING UP" },
  live: { cls: "pill-keke", label: "● LIVE" },
  all_found: { cls: "pill-violet", label: "ALL FOUND" },
  closed: { cls: "", label: "CLOSED" },
  time_up: { cls: "pill-danfo", label: "TIME UP" },
};

/** Live first, then coming up (soonest first), then over (newest first). */
const RANK: Record<GamePhase, number> = { live: 0, upcoming: 1, all_found: 2, closed: 2, time_up: 2 };
export function inPlayOrder(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (RANK[a.phase] !== RANK[b.phase]) return RANK[a.phase] - RANK[b.phase];
    const d = Date.parse(a.opens_at) - Date.parse(b.opens_at);
    return a.phase === "upcoming" ? d : -d;
  });
}

/** The title Hoppers see and, for a mystery series, the drop number: "Find the Dave ticket", drop 3 of 8. */
export function dropOf(g: Pick<Game, "title">): { title: string; i: number | null; n: number | null } {
  const { title, drop } = parseDrop(g.title);
  return { title, i: drop?.i ?? null, n: drop?.n ?? null };
}
/** "Drop 3 of 8 · Find the Dave ticket", or the title alone for a drop that is not part of a numbered series. */
export function dropLabel(g: Pick<Game, "title">): string {
  const d = dropOf(g);
  return d.i ? `Drop ${d.i} of ${d.n} · ${d.title}` : d.title;
}

/** The crew's own win rule ("one per person across every drop of this crew"): the key the database gives an empty campaign key. */
export const crewKey = (crewId: string) => `crew:${crewId}`;
export const isRehearsalKey = (key: string) => key.startsWith("rehearsal-");
/** A win rule as staff read it: “360 Dave tickets”, all 360Playlist drops, or a test run. */
export function seriesName(key: string, crewName: string): string {
  if (key.startsWith("crew:")) return `all ${crewName} drops`;
  if (isRehearsalKey(key)) return "a test run";
  return `“${key}”`;
}
/** People who already won under a win rule (one win per person per key): the wins of every drop with that key. */
export const winsOnKey = (games: Game[], key: string) => games.filter((g) => g.campaign_key === key).reduce((n, g) => n + g.claims, 0);

/** A key for a test run: unique, so it never uses up a Hopper's real win. "rehearsal-1016-2035-k3f9" */
export function newRehearsalKey(): string {
  const d = new Date(Date.now() + HOUR).toISOString();
  const rand = Math.random().toString(36).slice(2, 6);
  return `rehearsal-${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}-${rand}`;
}

/** "Mixing desk" from "mixing-desk". */
export const spotLabel = (id: string | null) => (id ? id.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");

/**
 * Codes from pasted text: one per line, or split by commas, semicolons, tabs or two or more spaces. Trimmed, blanks dropped.
 * Duplicates are kept so the desk can point at them.
 */
export const splitCodes = (text: string) =>
  text
    .split(/[\r\n,;\t]+|\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

/** A small seeded random number generator (mulberry32): the same seed gives the same mystery times, so a preview holds still. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The opening time of every drop in a series. Drop 1 opens at the first time exactly. With mystery on, drop i (from 2) opens
 * at a random minute inside its window [first + i * every, first + (i + 1) * every - length], so every drop keeps the same
 * length and drops never overlap. With it off the drops are exactly `every` apart. Same rule as the old desk.
 */
export function dropTimes(first: number, every: number, count: number, length: number, mystery: boolean, seed: number): number[] {
  const rand = seeded(seed);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0 || !mystery) {
      times.push(first + i * every);
      continue;
    }
    const lo = Math.max(first + i * every, times[i - 1] + length + MINUTE);
    const hi = Math.max(lo, first + (i + 1) * every - length);
    times.push(lo + Math.floor(rand() * ((hi - lo) / MINUTE + 1)) * MINUTE);
  }
  return times;
}

/** True when [opens, closes) meets a drop of this crew that has not ended. The database refuses those ("overlaps"). */
export function overlapsAny(games: Game[], crewId: string, opens: number, closes: number, except?: string): Game | null {
  return (
    games.find((g) => g.crew_id === crewId && g.id !== except && !isOver(g.phase) && Date.parse(g.opens_at) < closes && opens < Date.parse(g.closes_at)) ?? null
  );
}

/**
 * The plain line staff read before saving: "1 ticket, opens 12:00, closes 12:30, 3 hiding spots." A day word is added when
 * it is not today ("opens tomorrow 12:00"). A series reads "8 drops, 1 ticket each, first opens 12:00, every 3 hours, 3 hiding spots."
 */
export function summaryLine(o: { tickets: number; opens: number | null; closes: number | null; spots: number; drops?: number; everyHours?: number; startNow?: boolean; minutes?: number }): string {
  const at = (ms: number) => (dayWord(ms) === "today" ? hhmm(ms) : `${dayWord(ms)} ${hhmm(ms)}`);
  const spots = o.spots ? plural(o.spots, "hiding spot") : "no hiding spots yet";
  if (o.drops && o.drops > 1) {
    const first = o.opens !== null && Number.isFinite(o.opens) ? `first opens ${at(o.opens)}` : "first opening not set";
    return `${o.drops} drops, ${plural(o.tickets, "ticket")} each, ${first}, every ${plural(o.everyHours ?? 0, "hour")}, ${spots}.`;
  }
  if (o.startNow) return `${plural(o.tickets, "ticket")}, opens now, runs ${span(o.minutes ?? 0)}, ${spots}.`;
  const opens = o.opens !== null && Number.isFinite(o.opens) ? `opens ${at(o.opens)}` : "opening not set";
  const closes = o.closes !== null && Number.isFinite(o.closes) ? `closes ${at(o.closes)}` : "closing not set";
  return `${plural(o.tickets, "ticket")}, ${opens}, ${closes}, ${spots}.`;
}
