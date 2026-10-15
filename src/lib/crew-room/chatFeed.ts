import type { RoomMessage } from "./types";
import type { Outgoing } from "./chatOutbox";

/**
 * What the chat list prints: messages in time order with day dividers, people's repeat lines folded under their
 * first one, and my own messages that are still on their way.
 */
export type FeedRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; message: RoomMessage; at: number; grouped: boolean; own: boolean }
  | { kind: "out"; key: string; out: Outgoing; grouped: boolean };

const LAGOS = "Africa/Lagos";
/** The same person talking again within this long (ms) drops their face and name. */
export const GROUP_MS = 120_000;

const dayKey = (at: number) => new Date(at).toLocaleDateString("en-CA", { timeZone: LAGOS });

/** "TODAY", "YESTERDAY", then "FRI 16 OCT". */
export function dayLabel(at: number, now = Date.now()) {
  const day = dayKey(at);
  if (day === dayKey(now)) return "TODAY";
  if (day === dayKey(now - 86_400_000)) return "YESTERDAY";
  const d = new Date(at);
  const weekday = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: LAGOS }).toUpperCase();
  const date = d.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: LAGOS }).toUpperCase();
  return `${weekday} ${date}`;
}

/** A time that works for the plain "2026-10-14T19:31:00.123456+00:00" REST format and the Realtime one. */
export const timeOf = (iso: string) => {
  const t = Date.parse(iso.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(t) ? Date.now() : t;
};

export function buildRows(messages: RoomMessage[], outs: Outgoing[], userId: string): FeedRow[] {
  const rows: FeedRow[] = [];
  let lastDay = "";
  let lastAuthor = "";
  let lastAt = 0;
  const push = (author: string, at: number, row: (grouped: boolean) => FeedRow) => {
    const day = dayKey(at);
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day-${day}`, label: dayLabel(at) });
      lastDay = day;
      lastAuthor = "";
    }
    const grouped = author === lastAuthor && at - lastAt < GROUP_MS;
    rows.push(row(grouped));
    lastAuthor = author;
    lastAt = at;
  };
  for (const message of messages) {
    const at = timeOf(message.created_at);
    push(message.author_id, at, (grouped) => ({ kind: "msg", key: message.id, message, at, grouped, own: message.author_id === userId }));
  }
  for (const out of outs) {
    push(userId, out.at, (grouped) => ({ kind: "out", key: out.id, out, grouped }));
  }
  return rows;
}
