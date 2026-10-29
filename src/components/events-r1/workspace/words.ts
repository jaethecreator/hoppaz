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
