/**
 * The database's jsonb as the types the screens use. The SQL drafts return the same field names as types.ts, so this is
 * mostly tidying: timestamps in one format (ISO with Z, like the fake layer), numbers as numbers, the parked pin for an
 * event with no place, and the few fields the database cannot know.
 */
import { haversineKm, LAGOS_CENTER } from "../../geo";
import type {
  EventChat, HostRef, Pop, R1Event, RegQuestion, Registration, Report, RoomAnnouncement, RoomMessage, RoomSummary, Ticket, TicketType,
} from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

/** "2026-10-23 18:00:00+00" or "...+00:00" as "2026-10-23T18:00:00.000Z". null stays null. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
const isoOr = (v: unknown, fallback = ""): string => iso(v) ?? fallback;

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

export function mapTicketType(j: J): TicketType {
  return {
    id: String(j.id),
    event_id: String(j.event_id),
    name: String(j.name),
    price_naira: num(j.price_naira),
    capacity: numOrNull(j.capacity),
    sold: num(j.sold),
    spots_left: numOrNull(j.spots_left),
  };
}

function mapHost(j: J, fallbackId: string): HostRef {
  return {
    id: String(j?.id ?? fallbackId),
    name: String(j?.name ?? "Host"),
    roomId: j?.roomId ?? null,
    roomName: j?.roomName ?? null,
    verified: !!j?.verified,
  };
}

/**
 * An event. The database says hidden, pending or rejected for an event staff took down: the screens have three states
 * (live, cancelled, ended) so those read as cancelled (closed). An event with no place sits on the parked pin, as in the
 * fake layer, with an empty venue_name.
 */
export function mapEvent(j: J): R1Event {
  const placed = j.lat !== null && j.lat !== undefined && j.lng !== null && j.lng !== undefined;
  const lat = placed ? num(j.lat) : LAGOS_CENTER.lat;
  const lng = placed ? num(j.lng) : LAGOS_CENTER.lng;
  const status = j.status === "live" || j.status === "ended" ? j.status : "cancelled";
  const types: TicketType[] = Array.isArray(j.ticket_types) ? j.ticket_types.map(mapTicketType) : [];
  return {
    id: String(j.id),
    title: String(j.title),
    venue_name: String(j.venue_name ?? ""),
    area: j.area ?? null,
    lat,
    lng,
    starts_at: isoOr(j.starts_at),
    price_naira: num(j.price_naira),
    vibe: String(j.vibe ?? "culture"),
    source: j.source === "hoppaz" || j.source === "instagram" || j.source === "partner" ? j.source : "hopper",
    ig_url: j.ig_url ?? null,
    flyer_url: j.flyer_url ?? null,
    distance_m: haversineKm(LAGOS_CENTER.lat, LAGOS_CENTER.lng, lat, lng) * 1000,
    heat: num(j.heat),
    checkins: num(j.checkins),
    swipes_in: num(j.swipes_in),
    here_now: num(j.here_now),
    description: String(j.description ?? ""),
    host: mapHost(j.host, ""),
    ends_at: iso(j.ends_at),
    timezone: String(j.timezone ?? "Africa/Lagos"),
    kind: j.kind === "online" || j.kind === "hybrid" ? j.kind : "in_person",
    visibility: j.visibility === "community" || j.visibility === "invite" ? j.visibility : "public",
    status,
    capacity: numOrNull(j.capacity),
    requires_approval: !!j.requires_approval,
    waitlist_on: !!j.waitlist_on,
    link_type: j.link_type ?? null,
    online_link: j.online_link ?? null,
    room_id: j.room_id ?? null,
    going: num(j.going),
    spots_left: numOrNull(j.spots_left),
    ticket_types: types,
    created_at: isoOr(j.created_at),
    slug: String(j.slug ?? j.id),
  };
}

export function mapRegistration(j: J): Registration {
  return {
    id: String(j.id),
    event_id: String(j.event_id),
    user_id: String(j.user_id),
    name: String(j.name ?? ""),
    email: String(j.email ?? ""),
    phone: j.phone ?? null,
    status: j.status,
    ticket_type_id: String(j.ticket_type_id ?? ""),
    ticket_name: String(j.ticket_name ?? "General"),
    quantity: num(j.quantity, 1),
    answers: j.answers && typeof j.answers === "object" ? j.answers : {},
    referrer_id: j.referrer_id ?? null,
    referrer_name: j.referrer_name ?? null,
    created_at: isoOr(j.created_at),
    checked_in_at: iso(j.checked_in_at),
    waitlist_pos: numOrNull(j.waitlist_pos),
  };
}

/** One ticket; `seats` (more than one) comes from the list it was in. */
export function mapTicket(j: J, seats = 1): Ticket {
  const t: Ticket = {
    id: String(j.id),
    event_id: String(j.event_id),
    holder_name: String(j.holder_name ?? ""),
    ticket_name: String(j.ticket_name ?? "General"),
    code: String(j.code),
    token: String(j.token),
    version: num(j.version, 1),
    status: j.status === "used" || j.status === "void" ? j.status : "valid",
  };
  if (seats > 1) {
    t.seat_no = num(j.seat, 1);
    t.seats = seats;
  }
  return t;
}

export function mapPop(j: J): Pop {
  return {
    id: String(j.id),
    event_id: String(j.event_id),
    event_title: String(j.event_title ?? ""),
    author_name: String(j.author_name ?? "Host"),
    body: String(j.body ?? ""),
    audience: j.audience,
    also_room: !!j.also_room,
    send_at: iso(j.send_at),
    sent_at: iso(j.sent_at),
    status: j.status === "sent" ? "sent" : "scheduled",
    auto: j.auto ?? null,
    recipients: num(j.recipients),
    // Only an automatic Pop can be off; the others have no switch.
    ...(j.auto && j.enabled === false ? { enabled: false } : {}),
  };
}

export function mapAnnouncement(j: J): RoomAnnouncement {
  return {
    id: String(j.id),
    room_id: String(j.room_id),
    body: String(j.body ?? ""),
    created_at: isoOr(j.created_at),
    author_name: String(j.author_name ?? "The owner"),
    event_id: j.event_id ?? null,
    event_title: j.event_title ?? null,
  };
}

/** `extra` holds what the database cannot say from one call: is_owner, can_post, has_3d, online. */
export function mapRoom(j: J, extra: Partial<Pick<RoomSummary, "is_owner" | "can_post" | "has_3d" | "online">> = {}): RoomSummary {
  const kind = j.kind === "hq" || j.kind === "brand" ? j.kind : "crew";
  return {
    id: String(j.id),
    slug: String(j.slug ?? j.id),
    name: String(j.name ?? ""),
    kind,
    logo_url: j.logo_url ?? null,
    wallpaper_url: j.wallpaper_url ?? null,
    members: num(j.members),
    verified: !!j.verified,
    joined: !!j.joined,
    unread: num(j.unread),
    latest_announcement: j.latest_announcement ? mapAnnouncement(j.latest_announcement) : null,
    is_owner: extra.is_owner ?? false,
    can_post: extra.can_post ?? false,
    // Every crew can be entered (the 3D room is made on first entry). Hoppaz HQ is chat first.
    has_3d: extra.has_3d ?? kind !== "hq",
    online: extra.online ?? 0,
  };
}

export function mapChat(j: J): EventChat {
  return {
    event_id: String(j.event_id),
    event_title: String(j.event_title ?? ""),
    room_id: String(j.room_id),
    opens_at: isoOr(j.opens_at),
    closes_at: isoOr(j.closes_at),
    state: j.state === "open" || j.state === "closed" ? j.state : "upcoming",
    can_enter: !!j.can_enter,
  };
}

export function mapMessage(j: J, roomId: string, channel: string): RoomMessage {
  return {
    id: String(j.id),
    room_id: roomId,
    channel,
    author_name: String(j.author_name ?? "A Hopper"),
    body: String(j.body ?? ""),
    created_at: isoOr(j.created_at),
  };
}

export function mapReport(j: J): Report {
  return {
    id: String(j.id),
    event_id: String(j.event_id),
    event_title: String(j.event_title ?? ""),
    reporter_id: String(j.reporter_id),
    reporter_name: j.reporter_name ?? null,
    reason: j.reason,
    note: String(j.note ?? ""),
    created_at: isoOr(j.created_at),
    status: j.status === "reviewed" ? "reviewed" : "open",
  };
}

/** A question id the database accepts: lower case letters, digits and underscore, up to 40. (The host screen makes "q-xyz" ids.) */
export function cleanQuestionId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "q";
}

export function cleanQuestions(qs: RegQuestion[]): RegQuestion[] {
  return qs.map((q) => ({ ...q, id: q.builtin ? q.id : cleanQuestionId(q.id) }));
}
