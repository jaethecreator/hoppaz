/**
 * The rules the fake layer shares between its modules: capacity, the waitlist, who may see what, and how a stored
 * event becomes the R1Event a screen gets. Nothing here is async or touches the network.
 */
import type { EventChat, EventStatus, HostRef, R1Event, RegStatus, Registration, RoomSummary, TicketType } from "../types";
import { haversineKm, LAGOS_CENTER } from "../../geo";
import type { EventRec, RoomRec, TicketRec, TicketTypeRec, UserRec } from "./store";
import { S, now, viewer } from "./store";
import { clone, HOUR, DAY, seedId } from "./util";

export const GOING: RegStatus[] = ["going", "checked_in"];
export const isGoing = (s: RegStatus) => s === "going" || s === "checked_in";

/* --------------------------------------------------------------- lookups -- */

export function userById(id: string | null): UserRec | null {
  return id ? (S().users[id] ?? null) : null;
}

export function regsOf(eventId: string): Registration[] {
  return Object.values(S().regs).filter((r) => r.event_id === eventId);
}

/** The person's one registration for an event, in any status (a cancelled one is kept and brought back on re-register). */
export function regOf(eventId: string, userId: string): Registration | undefined {
  return Object.values(S().regs).find((r) => r.event_id === eventId && r.user_id === userId);
}

export function goingCount(eventId: string): number {
  return regsOf(eventId).filter((r) => isGoing(r.status)).length;
}

export function hostRoom(userId: string): RoomRec | null {
  return Object.values(S().rooms).find((r) => r.owner_id === userId) ?? null;
}

export function isMember(roomId: string | null): boolean {
  const v = viewer();
  if (!roomId || !v) return false;
  const room = S().rooms[roomId];
  if (!room) return false;
  return room.kind === "hq" || room.owner_id === v.id || !!S().memberships[`${v.id}:${roomId}`];
}

export function isHostOf(e: EventRec): boolean {
  const v = viewer();
  return !!v && e.host_id === v.id;
}

/** Host or staff. */
export function canManage(e: EventRec): boolean {
  const v = viewer();
  return !!v && (e.host_id === v.id || !!v.staff);
}

export function assertManage(e: EventRec | undefined | null): EventRec {
  if (!e) throw new Error("Event not found");
  if (!viewer()) throw new Error("Sign in first");
  if (!canManage(e)) throw new Error("Not allowed");
  return e;
}

export function requireViewer(): UserRec {
  const v = viewer();
  if (!v) throw new Error("Sign in first");
  return v;
}

/* ---------------------------------------------------------------- events -- */

export function eventEnd(e: EventRec): number {
  return e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 3 * HOUR;
}

export function statusOf(e: EventRec): EventStatus {
  if (e.status === "cancelled") return "cancelled";
  return now() > eventEnd(e) ? "ended" : "live";
}

export function isFull(e: EventRec): boolean {
  return e.capacity !== null && goingCount(e.id) >= e.capacity;
}

/* --------------------------------------------------------- ticket types -- */

/** The event's ticket types. Always at least one: a missing list is one General at the event's own price, no limit. */
export function typesOf(e: EventRec): TicketTypeRec[] {
  if (e.ticket_types && e.ticket_types.length) return e.ticket_types;
  return [{ id: seedId(`ticket-type:${e.id}`), name: "General", price_naira: e.price_naira, capacity: null }];
}

/** The type a registration holds (one saved before types existed holds the first). */
export function typeOfReg(e: EventRec, r: Pick<Registration, "ticket_type_id">): TicketTypeRec {
  const ts = typesOf(e);
  return ts.find((t) => t.id === r.ticket_type_id) ?? ts[0];
}

/** Going and checked-in people holding this type. */
export function soldOf(e: EventRec, typeId: string): number {
  return regsOf(e.id).filter((r) => isGoing(r.status) && typeOfReg(e, r).id === typeId).length;
}

/** Places left on a type: its own capacity and the event's, whichever is tighter. null = no limit. */
export function typeSpotsLeft(e: EventRec, t: TicketTypeRec): number | null {
  const own = t.capacity === null ? null : Math.max(0, t.capacity - soldOf(e, t.id));
  const ev = e.capacity === null ? null : Math.max(0, e.capacity - goingCount(e.id));
  if (own === null) return ev;
  return ev === null ? own : Math.min(own, ev);
}

export const typeFull = (e: EventRec, t: TicketTypeRec) => typeSpotsLeft(e, t) === 0;

/** Free types (price 0): the only ones a person can take in R1. */
export const freeTypes = (e: EventRec) => typesOf(e).filter((t) => t.price_naira === 0);

export function typeView(e: EventRec, t: TicketTypeRec): TicketType {
  return { id: t.id, event_id: e.id, name: t.name, price_naira: t.price_naira, capacity: t.capacity, sold: soldOf(e, t.id), spots_left: typeSpotsLeft(e, t) };
}

/** Find by id or slug. Does not check who may see it. */
export function findEvent(idOrSlug: string): EventRec | undefined {
  const all = Object.values(S().events);
  return S().events[idOrSlug] ?? all.find((e) => e.slug === idOrSlug);
}

/** May this viewer open the event page? Invite works by link; Community only for the room's members. */
export function canOpen(e: EventRec): boolean {
  if (isHostOf(e) || viewer()?.staff) return true;
  if (e.visibility === "community") return isMember(e.room_id);
  return true;
}

/** Open reports at which an event drops out of the lists until staff have checked it. */
export const HIDE_AT_REPORTS = 3;

/** May this viewer see the event in lists? Hosts see their own whatever the visibility. Staff still see an event hidden by reports. */
export function canList(e: EventRec): boolean {
  if (isHostOf(e)) return true;
  if (!viewer()?.staff && Object.values(S().reports).filter((r) => r.event_id === e.id && r.status === "open").length >= HIDE_AT_REPORTS) return false;
  if (e.visibility === "invite") return false;
  if (e.visibility === "community") return isMember(e.room_id);
  return true;
}

export function hostRef(userId: string): HostRef {
  const u = userById(userId);
  const room = hostRoom(userId);
  return {
    id: userId,
    name: u?.name ?? "Host",
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    verified: !!room?.verified,
  };
}

/** Does this viewer get the online link? The registered (going or checked in) and the host. */
export function canSeeLink(e: EventRec): boolean {
  const v = viewer();
  if (!v) return false;
  if (e.host_id === v.id) return true;
  const r = regOf(e.id, v.id);
  return !!r && isGoing(r.status);
}

/** The stored event as a screen gets it: counts worked out, the online link only for those who may have it. */
export function eventView(e: EventRec, opts: { revealLink?: boolean } = {}): R1Event {
  const { host_id, ticket_types: _stored, ...rest } = e;
  void _stored;
  const types = typesOf(e);
  const going = goingCount(e.id);
  const interested = Object.keys(S().interest).filter((k) => S().interest[k] && k.endsWith(`:${e.id}`)).length;
  const checked = regsOf(e.id).filter((r) => r.status === "checked_in").length;
  return clone({
    ...rest,
    price_naira: Math.min(...types.map((t) => t.price_naira)),
    ticket_types: types.map((t) => typeView(e, t)),
    status: statusOf(e),
    going,
    spots_left: e.capacity === null ? null : Math.max(0, e.capacity - going),
    host: hostRef(host_id),
    online_link: opts.revealLink || canSeeLink(e) ? e.online_link : null,
    distance_m: haversineKm(LAGOS_CENTER.lat, LAGOS_CENTER.lng, e.lat, e.lng) * 1000,
    heat: Math.min(100, Math.round(going * 2.5)),
    checkins: checked,
    swipes_in: interested,
    here_now: 0,
  });
}

/* ------------------------------------------------------------- waitlist -- */

/** Waitlist positions: 1 = next, in the order people joined. */
export function renumberWaitlist(eventId: string): void {
  const waiting = regsOf(eventId)
    .filter((r) => r.status === "waitlisted")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  waiting.forEach((r, i) => {
    r.waitlist_pos = i + 1;
  });
  for (const r of regsOf(eventId)) if (r.status !== "waitlisted") r.waitlist_pos = null;
}

export function ticketIdFor(regId: string): string {
  return seedId(`ticket:${regId}`);
}

/** A person who is going has one valid ticket. A returning person gets a new version, so an old QR stops working. */
export function ensureTicket(reg: Registration): TicketRec {
  const id = ticketIdFor(reg.id);
  const t = S().tickets[id];
  if (!t) {
    const fresh: TicketRec = { id, event_id: reg.event_id, reg_id: reg.id, version: 1, status: "valid" };
    S().tickets[id] = fresh;
    return fresh;
  }
  if (t.status === "void") {
    t.version += 1;
    t.status = "valid";
  }
  return t;
}

export function voidTicket(reg: Registration): void {
  const t = S().tickets[ticketIdFor(reg.id)];
  if (t) t.status = "void";
}

/** Make someone going: stamp the ticket. The caller has checked there is room. */
export function admit(reg: Registration): void {
  reg.status = "going";
  reg.waitlist_pos = null;
  ensureTicket(reg);
}

/**
 * When places open (someone cancels or is declined, capacity goes up), move waitlisted people up in order.
 * A free event with approval on only moves them to "requested": the host still decides.
 */
export function fillFromWaitlist(eventId: string): void {
  const e = S().events[eventId];
  if (!e || e.status === "cancelled") return;
  const waiting = regsOf(eventId)
    .filter((r) => r.status === "waitlisted")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const requestedOf = (typeId?: string) =>
    regsOf(eventId).filter((r) => r.status === "requested" && (!typeId || typeOfReg(e, r).id === typeId)).length;
  // Each person moves up only if their own ticket type has a place (and the event does); a full type is skipped, not a wall.
  for (const r of waiting) {
    const t = typeOfReg(e, r);
    if (e.requires_approval) {
      const eventRoom = e.capacity === null ? Infinity : e.capacity - goingCount(eventId) - requestedOf();
      const typeRoom = t.capacity === null ? Infinity : t.capacity - soldOf(e, t.id) - requestedOf(t.id);
      if (eventRoom > 0 && typeRoom > 0) {
        r.status = "requested";
        r.waitlist_pos = null;
      }
    } else if (!typeFull(e, t)) {
      admit(r);
    }
  }
  renumberWaitlist(eventId);
}

/* ----------------------------------------------------------- event chat -- */

export const CHAT_OPENS_BEFORE = HOUR;
export const CHAT_CLOSES_AFTER = 3 * DAY;

export function chatFor(e: EventRec): EventChat | null {
  if (!e.room_id) return null;
  const opens = Date.parse(e.starts_at) - CHAT_OPENS_BEFORE;
  const closes = eventEnd(e) + CHAT_CLOSES_AFTER;
  const t = now();
  const state = e.status === "cancelled" || t >= closes ? "closed" : t >= opens ? "open" : "upcoming";
  return {
    event_id: e.id,
    event_title: e.title,
    room_id: e.room_id,
    opens_at: new Date(opens).toISOString(),
    closes_at: new Date(closes).toISOString(),
    state,
    can_enter: canEnterChat(e),
  };
}

/** Who may come in follows the event: public = anyone registered, approval = approved only, community = room members. */
function canEnterChat(e: EventRec): boolean {
  const v = viewer();
  if (!v) return false;
  if (e.host_id === v.id || v.staff) return true;
  const r = regOf(e.id, v.id);
  if (e.visibility === "community") return isMember(e.room_id);
  if (!r) return false;
  if (e.requires_approval) return isGoing(r.status);
  return r.status !== "cancelled" && r.status !== "declined";
}

export function roomSummary(room: RoomRec): RoomSummary {
  const s = S();
  const v = viewer();
  const joinedHere = Object.keys(s.memberships).filter((k) => s.memberships[k] && k.endsWith(`:${room.id}`)).length;
  const anns = Object.values(s.announcements)
    .filter((a) => a.room_id === room.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const joined = room.kind === "hq" || isMember(room.id);
  // Unread: announcements after the last time the viewer opened the room, or from the two days before this load.
  const lastRead = v ? Date.parse(s.reads[`${v.id}:${room.id}`] ?? "") : NaN;
  const since = Number.isFinite(lastRead) ? lastRead : now() - 2 * DAY;
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    kind: room.kind,
    logo_url: room.logo_url,
    wallpaper_url: room.wallpaper_url,
    members: room.base_members + joinedHere,
    verified: room.verified,
    joined,
    unread: joined ? anns.filter((a) => Date.parse(a.created_at) > since).length : 0,
    latest_announcement: anns[0] ? clone(anns[0]) : null,
    is_owner: !!v && room.owner_id === v.id,
    can_post: !!v && (room.owner_id === v.id || !!v.staff),
    has_3d: !!room.has_3d,
    online: room.online ?? 0,
  };
}
