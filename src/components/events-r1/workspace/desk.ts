/**
 * What the Hosting line on Me shows (CHANGE-003, mock-up host-entry-me-final.html), worked out from the data layer's answers. Pure, so the
 * check script can run it; useHostDesk.ts feeds it. Lagos time.
 *
 * Workspaces: Personal first, then each room the viewer owns or is an admin of (owners first, as rooms.managed() sorts them). A number
 * means join requests are waiting (RoomSummary.pending_requests). Live means one of that workspace's events is on right now.
 * Tonight: the soonest event the viewer hosts (their own, or one of a room they run) that is on today in Lagos, or under way, and has not
 * ended. needsYou: requests waiting or an event live (the green dot on the ME tab).
 */
import type { R1Event, RoomSummary } from "@/lib/events-r1/types";

export type Workspace = {
  /** "personal" or the room id. */
  key: string;
  name: string;
  logo: string | null;
  /** "Owner" or "Admin" under a room's name; null for Personal. */
  role: "Owner" | "Admin" | null;
  href: string;
  waiting: number;
  live: boolean;
};

export type Desk = {
  /** Has made an event or runs a room: the carousel. False: the one "Host something" row. */
  hosted: boolean;
  workspaces: Workspace[];
  tonight: R1Event | null;
  needsYou: boolean;
};

const HOUR = 3.6e6;

/** When an event ends: ends_at, or 3 hours after it starts (the same rule as everywhere else). */
export const endOf = (e: Pick<R1Event, "starts_at" | "ends_at">): number => (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 3 * HOUR);

/** On right now: started, not ended, not cancelled. */
export const liveNow = (e: Pick<R1Event, "starts_at" | "ends_at" | "status">, now: number): boolean =>
  e.status !== "cancelled" && Date.parse(e.starts_at) <= now && now < endOf(e);

const lagosDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (ms: number) => lagosDay.format(new Date(ms));

/** The first letter or two of a name, for a workspace with no logo. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "H";

export function buildDesk(input: { mine: R1Event[]; rooms: RoomSummary[]; roomEvents: Record<string, R1Event[]>; now: number }): Desk {
  const { mine, rooms, roomEvents, now } = input;
  const roomIds = new Set(rooms.map((r) => r.id));
  // An event in a room the viewer runs belongs to that room's icon; everything else they made is Personal.
  const personalEvents = mine.filter((e) => !e.room_id || !roomIds.has(e.room_id));
  const hosted = mine.length > 0 || rooms.length > 0;

  const workspaces: Workspace[] = hosted
    ? [
        { key: "personal", name: "Personal", logo: null, role: null, href: "/host", waiting: 0, live: personalEvents.some((e) => liveNow(e, now)) },
        ...rooms.map<Workspace>((r) => ({
          key: r.id,
          name: r.name,
          logo: r.logo_url,
          role: r.my_role === "owner" || r.is_owner ? "Owner" : "Admin",
          href: `/rooms/${encodeURIComponent(r.slug)}/admin`,
          waiting: Math.max(0, r.pending_requests || 0),
          live: [...(roomEvents[r.id] ?? []), ...mine.filter((e) => e.room_id === r.id)].some((e) => liveNow(e, now)),
        })),
      ]
    : [];

  const all = new Map<string, R1Event>();
  for (const e of [...mine, ...rooms.flatMap((r) => roomEvents[r.id] ?? [])]) all.set(e.id, e);
  const today = dayOf(now);
  const tonight =
    [...all.values()]
      .filter((e) => e.status !== "cancelled" && endOf(e) > now && (dayOf(Date.parse(e.starts_at)) === today || Date.parse(e.starts_at) <= now))
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id))[0] ?? null;

  const needsYou = workspaces.some((w) => w.waiting > 0 || w.live);
  return { hosted, workspaces, tonight, needsYou };
}
