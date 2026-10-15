import type { GtDrop } from "./types";

/**
 * Mystery drops. A series of tickets (one code per drop) is scheduled as one Game Time per drop, and the staff desk titles
 * each "<title> · i/N", for example "Dave's concert · 2/5". No column carries it: Hoppers' screens read the marker off the
 * end of the title, show the title without it, and work out the ticket count from it.
 *
 *   drop 1               keeps its countdown (it opens at the exact time staff set)
 *   drop 2 and onward    never show a countdown or an exact time: "next one can drop soon"
 *
 * A title with no marker is a plain game: countdown, no counter, as before.
 */

const MARK = /\s*·\s*(\d{1,2})\/(\d{1,2})\s*$/;

/** " · 2/5" for drop 2 of 5. */
export const dropMark = (i: number, n: number) => ` · ${i}/${n}`;

/** The longest marker the desk can add (24 drops). */
export const MARK_MAX = dropMark(24, 24).length;

/** "Dave's concert · 2/5" gives the title and the drop. Anything else comes back as it was, with no drop. */
export function parseDrop(raw: string): { title: string; drop: GtDrop | null } {
  const m = MARK.exec(raw);
  if (!m) return { title: raw, drop: null };
  const i = Number(m[1]);
  const n = Number(m[2]);
  const title = raw.slice(0, m.index).trim();
  if (!(n >= 2 && i >= 1 && i <= n) || !title) return { title: raw, drop: null };
  return { title, drop: { i, n } };
}

/** Wraps a raw game row from the database: the title without its marker, and the drop it names. */
export function withDrop<T extends { title: string }>(row: T): T & { drop: GtDrop | null } {
  const { title, drop } = parseDrop(typeof row.title === "string" ? row.title : "");
  return { ...row, title, drop };
}

/** Drop 2 onward: no countdown, no exact time. */
export const isMystery = (g: { drop?: GtDrop | null } | null | undefined): boolean => !!g?.drop && g.drop.i > 1;

/**
 * Tickets still to be found, from the drop this game is. Null for a plain game (no counter).
 *   before drop i opens          N - i + 1
 *   while drop i is live         boxes left + (N - i)
 *   after drop i has ended       N - i
 */
export function ticketsLeft(g: { drop?: GtDrop | null; status: "upcoming" | "live" | "over"; boxes_left: number }): number | null {
  const d = g.drop;
  if (!d) return null;
  if (g.status === "upcoming") return d.n - d.i + 1;
  if (g.status === "live") return g.boxes_left + (d.n - d.i);
  return d.n - d.i;
}

/** "5 tickets left", "1 ticket left". */
export const ticketsText = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"} left`;

/** 2530000 gives "0:42:10": always hours, minutes, seconds. Never negative. */
export function hms(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(total / 3600)}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}
