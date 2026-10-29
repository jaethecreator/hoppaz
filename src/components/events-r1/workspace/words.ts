/** Small words for the host workspace. Pure; Lagos time. */
import type { R1Event, RoomRole } from "@/lib/events-r1/types";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

function parts(iso: string) {
  const p = Object.fromEntries(f.formatToParts(new Date(Date.parse(iso))).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, day: Number(p.day), mon: MON[Number(p.month) - 1], clock: `${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}` };
}

/** The date tile: "OCT" over "30". */
export function tileOf(iso: string): { mon: string; day: number } {
  const p = parts(iso);
  return { mon: p.mon, day: p.day };
}

/** "Fri · 8:00 PM · Praia Lagos". */
export function whenLine(e: Pick<R1Event, "starts_at" | "venue_name" | "status">): string {
  const p = parts(e.starts_at);
  return [e.status === "cancelled" ? "Cancelled" : "", `${p.weekday} · ${p.clock}`, e.venue_name].filter(Boolean).join(" · ");
}

/** Owner, Admin, Member. Host is hidden for launch: a host reads as a Member. */
export function roleLabel(r: RoomRole | null): string {
  return r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Member";
}

/** Past: ended, or cancelled long ago (cancelled events collect with the past). */
export function isPast(e: Pick<R1Event, "starts_at" | "ends_at" | "status">, now: number): boolean {
  if (e.status === "ended") return true;
  return Date.parse(e.ends_at ?? e.starts_at) + (e.ends_at ? 0 : 3 * 3.6e6) < now;
}

export const going = (n: number) => `${n.toLocaleString("en-NG")}`;

/**
 * Members at the end of each of the last 8 weeks, oldest first. Worked back from today's count: each week's total is today's total
 * minus the members who joined after that week ended. People who left are not in the list, so a past week can read a little low,
 * never high.
 */
export function growthWeeks(total: number, joinedAt: string[], now: number, weeks = 8): number[] {
  const joins = joinedAt.map((d) => Date.parse(d)).filter((t) => Number.isFinite(t));
  return Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * 864e5;
    return Math.max(0, total - joins.filter((t) => t > end).length);
  });
}
