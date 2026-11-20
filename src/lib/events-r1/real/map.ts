/**
 * The database's jsonb as the types the screens use. The SQL drafts return the same field names as types.ts, so this is
 * mostly tidying: timestamps in one format (ISO with Z, like the fake layer), numbers as numbers, the parked pin for an
 * event with no place, and the few fields the database cannot know.
 */
import { haversineKm, LAGOS_CENTER } from "../../geo";
import type {
  AcceptOutcome, ApproveManyResult, Claimable, ClaimAsk, ClaimLink, ClaimRequest, ContactChannel, EventChat, HostRef, ImportReport, ListingInfo, Organiser, OrganiserDetail, OrganiserHandles, OrganiserLogEntry,
  OrganiserLogKind, OrganiserStage, Pop, PulledEvent, PulledFlag, PulledStatus, R1Event, RegQuestion, Registration, Report, RoomAnnouncement, RoomLinks, RoomMessage,
  RoomListing, RoomModeView, RoomRole, RoomSummary, ScoutEvent, TapCounts, Ticket, TicketType, Transfer, TransferPreview, WeekSummary,
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

/** `extra` holds what the database cannot say from one call: is_owner, can_post, my_role, online (and has_3d, three_d_on for an older answer). */
export function mapRoom(
  j: J,
  extra: Partial<Pick<RoomSummary, "is_owner" | "can_post" | "has_3d" | "three_d_on" | "online" | "my_role">> = {}
): RoomSummary {
  const kind = j.kind === "hq" || j.kind === "brand" ? j.kind : "crew";
  const role = j.my_role === "owner" || j.my_role === "admin" || j.my_role === "host" || j.my_role === "member" ? (j.my_role as RoomRole) : (extra.my_role ?? null);
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
    // The database says whether a walkable room can be made (a layout exists: every crew, Lagos HQ too) and whether the owner or
    // staff have it switched on (ev_room_3d_allowed: on by default, Lagos HQ included). An older answer without them: on.
    has_3d: typeof j.has_3d === "boolean" ? j.has_3d : (extra.has_3d ?? true),
    three_d_on: typeof j.three_d_on === "boolean" ? j.three_d_on : (extra.three_d_on ?? true),
    online: extra.online ?? 0,
    // The profile fields come from ev_room_profile (supabase/events_r1_room_profile.sql). The older readers do not have them: a room
    // then reads as open with no about and no links, which is how every room made before that file looks.
    about: typeof j.about === "string" ? j.about : "",
    links: mapLinks(j.links),
    join_mode: j.join_mode === "ask" || j.join_mode === "invite" ? j.join_mode : "open",
    my_role: role,
    request: j.request === "pending" || j.request === "declined" ? j.request : "none",
    pending_requests: num(j.pending_requests),
  };
}

export function mapLinks(v: unknown): RoomLinks {
  const out: RoomLinks = {};
  if (!v || typeof v !== "object") return out;
  for (const k of ["instagram", "x", "website", "whatsapp"] as const) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === "string" && s) out[k] = s;
  }
  return out;
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

/* ------------------------------------------------- outreach: listings, organisers, transfers -- */

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const list = (v: unknown): J[] => (Array.isArray(v) ? v : []);
const STAGES: OrganiserStage[] = ["pulled", "listed", "offered", "claimed", "declined"];
const stageOf = (v: unknown): OrganiserStage => (STAGES.includes(v as OrganiserStage) ? (v as OrganiserStage) : "pulled");

/** One entry of ev_listings(): where tickets are sold and what the source says they cost. null price = not known. */
export function mapListing(j: J): ListingInfo {
  return {
    ticket_url: strOrNull(j?.ticket_url),
    instagram_url: strOrNull(j?.instagram_url),
    price_from: numOrNull(j?.price_from),
    price_to: numOrNull(j?.price_to),
    sold_out: !!j?.sold_out,
    source_site: strOrNull(j?.source_site),
    claimed: !!j?.claimed,
    organiser_name: strOrNull(j?.organiser_name),
    ticket_platform: strOrNull(j?.ticket_platform),
    source_url: strOrNull(j?.source_url),
    flyer_credit: strOrNull(j?.flyer_credit),
    organiser_ig: strOrNull(j?.organiser_ig),
    organiser_x: strOrNull(j?.organiser_x),
  };
}

function mapHandles(v: unknown): OrganiserHandles {
  const out: OrganiserHandles = {};
  if (!v || typeof v !== "object") return out;
  for (const k of ["instagram", "x", "tiktok", "website", "whatsapp"] as const) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === "string" && s) out[k] = s;
  }
  return out;
}

export function mapTransfer(j: J): Transfer {
  const status = j.status === "accepted" || j.status === "revoked" || j.status === "expired" ? j.status : "pending";
  return {
    id: String(j.id),
    kind: j.kind === "handover" ? "handover" : "claim",
    room_id: String(j.room_id ?? ""),
    room_name: str(j.room_name),
    organiser_id: strOrNull(j.organiser_id),
    to_email: str(j.to_email),
    // An open link past its date reads as expired even if the database has not flipped the row yet.
    status: status === "pending" && (iso(j.expires_at) ?? "9999") < new Date().toISOString() ? "expired" : status,
    created_at: isoOr(j.created_at),
    created_by: strOrNull(j.created_by),
    expires_at: isoOr(j.expires_at),
    accepted_at: iso(j.accepted_at),
  };
}

export function mapOrganiser(j: J): Organiser {
  return {
    id: String(j.id),
    name: str(j.name),
    ig_handle: strOrNull(j.ig_handle),
    handles: mapHandles(j.handles),
    email: strOrNull(j.email),
    phone: strOrNull(j.phone),
    room_id: strOrNull(j.room_id),
    room_slug: strOrNull(j.room_slug),
    room_name: strOrNull(j.room_name),
    stage: stageOf(j.stage),
    do_not_contact: !!j.do_not_contact,
    last_contacted_at: iso(j.last_contacted_at),
    last_contacted_by: strOrNull(j.last_contacted_by),
    last_replied_at: iso(j.last_replied_at),
    notes: str(j.notes),
    claimed_at: iso(j.claimed_at),
    declined_at: iso(j.declined_at),
    created_at: isoOr(j.created_at),
    events_total: num(j.events_total),
    events_upcoming: num(j.events_upcoming),
    pulled_waiting: num(j.pulled_waiting),
    transfer_pending: !!j.transfer_pending,
    claim_requests: num(j.claim_requests),
  };
}

const LOG_KINDS: OrganiserLogKind[] = ["contact", "reply", "offer", "note", "stage", "transfer", "claim_request", "scrape", "delete"];
const CHANNELS: ContactChannel[] = ["instagram", "whatsapp", "email", "phone", "other"];

function mapLog(j: J): OrganiserLogEntry {
  return {
    id: String(j.id),
    organiser_id: String(j.organiser_id ?? ""),
    at: isoOr(j.at),
    by: strOrNull(j.by),
    kind: LOG_KINDS.includes(j.kind) ? j.kind : "note",
    channel: CHANNELS.includes(j.channel) ? j.channel : null,
    body: str(j.body),
  };
}

export function mapOrganiserDetail(j: J): OrganiserDetail {
  return {
    organiser: mapOrganiser(j.organiser ?? j),
    log: list(j.log).map(mapLog),
    events: list(j.events).map((e) => ({
      id: String(e.id),
      title: str(e.title),
      starts_at: isoOr(e.starts_at),
      status: e.status === "live" || e.status === "ended" ? e.status : "cancelled",
      ticket_url: strOrNull(e.ticket_url),
      upcoming: !!e.upcoming,
    })),
    transfers: list(j.transfers).map(mapTransfer),
    claim_links: list(j.claim_links).map(mapClaimLink),
    room_mode: mapRoomMode(j.room_mode),
  };
}

/** ev_o_room_mode: the desk's "Room: Open / Invite only" (CHANGE-006). null when missing (no room, or a database without the file). */
export function mapRoomMode(v: unknown): RoomModeView | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const j = v as J;
  const m = j.join_mode === "open" || j.join_mode === "ask" || j.join_mode === "invite" ? j.join_mode : null;
  if (!m) return null;
  return { join_mode: m, switchable: j.switchable === true, set_by_hand: j.set_by_hand === true };
}

/** ev_room_listing: the claim strip of an unclaimed organiser room (CHANGE-006). null for any other room. No email, no phone. */
export function mapRoomListing(v: unknown): RoomListing | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const j = v as J;
  const name = str(j.name);
  if (!name) return null;
  return { name, claim_event_id: strOrNull(j.claim_event_id), my_claim: j.my_claim === "pending" ? "pending" : "none", claims_on: j.claims_on === true };
}

/** One claim link (never the token or its hash). */
export function mapClaimLink(j: J): ClaimLink {
  const status = j.status === "used" || j.status === "revoked" || j.status === "expired" ? j.status : "pending";
  return {
    id: String(j.id),
    room_id: String(j.room_id ?? ""),
    room_name: str(j.room_name),
    organiser_id: strOrNull(j.organiser_id),
    event_id: strOrNull(j.event_id),
    // An open link past its date reads as expired even if the database has not flipped the row yet.
    status: status === "pending" && (iso(j.expires_at) ?? "9999") < new Date().toISOString() ? "expired" : status,
    created_at: isoOr(j.created_at),
    created_by: strOrNull(j.created_by),
    expires_at: isoOr(j.expires_at),
    used_at: iso(j.used_at),
  };
}

export function mapClaimable(j: J): Claimable {
  return {
    event_id: String(j.event_id),
    title: str(j.title),
    starts_at: isoOr(j.starts_at),
    organiser_id: strOrNull(j.organiser_id),
    organiser_name: strOrNull(j.organiser_name),
    room_name: strOrNull(j.room_name),
    went_to_buy: num(j.went_to_buy),
    link_open: !!j.link_open,
    asks: num(j.asks),
  };
}

export function mapClaimAsk(j: J): ClaimAsk {
  return {
    id: String(j.id),
    event_id: String(j.event_id ?? ""),
    event_title: str(j.event_title),
    organiser_id: strOrNull(j.organiser_id),
    organiser_name: strOrNull(j.organiser_name),
    name: str(j.name),
    note: str(j.note),
    status: j.status === "approved" || j.status === "declined" ? j.status : "new",
    created_at: isoOr(j.created_at),
    decided_by: strOrNull(j.decided_by),
  };
}

/** { events: { id: n }, organisers: { id: n } } with whole numbers only. */
export function mapTapCounts(j: J): TapCounts {
  const grab = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, n] of Object.entries(v as Record<string, unknown>)) out[k] = num(n);
    return out;
  };
  return { events: grab(j?.events), organisers: grab(j?.organisers) };
}

export function mapApproveMany(j: J, reasonText: (code: string) => string): ApproveManyResult {
  return {
    approved: list(j?.approved).map((a) => ({ id: String(a.id), event_id: String(a.event_id ?? "") })),
    skipped: list(j?.skipped).map((a) => ({ id: String(a.id), name: str(a.name), reason: str(a.reason), text: reasonText(str(a.reason)) })),
  };
}

const PULLED_STATUS: PulledStatus[] = ["new", "approved", "rejected", "merged", "blocked"];
const PULLED_FLAGS: PulledFlag[] = ["duplicate", "changed", "no_price", "no_time", "no_pin", "blocked", "moved", "gone"];

/** What the scout wrote, tidied: unknown stays null or empty, nothing is invented. */
function mapScoutEvent(f: J): ScoutEvent {
  return {
    source_site: str(f?.source_site),
    source_id: str(f?.source_id),
    name: str(f?.name),
    starts_at: iso(f?.starts_at),
    ends_at: iso(f?.ends_at),
    venue: strOrNull(f?.venue),
    area: strOrNull(f?.area),
    lat: numOrNull(f?.lat),
    lng: numOrNull(f?.lng),
    pin_by: f?.pin_by === "venues" || f?.pin_by === "source" || f?.pin_by === "osm" ? f.pin_by : null,
    description: str(f?.description),
    tickets: list(f?.tickets).map((t) => ({ name: str(t.name), price_naira: numOrNull(t.price_naira), sold_out: !!t.sold_out })),
    sold_out: !!f?.sold_out,
    ticket_url: strOrNull(f?.ticket_url),
    flyer_url: strOrNull(f?.flyer_url),
    category: strOrNull(f?.category),
    organiser_name: strOrNull(f?.organiser_name),
    organiser_handle: strOrNull(f?.organiser_handle),
    event_handle: strOrNull(f?.event_handle),
    // Hoppaz keeps no organiser phone or email: whatever an older row still holds is not read.
    organiser_email: null,
    organiser_phone: null,
    ticket_platform: strOrNull(f?.ticket_platform),
    source_url: strOrNull(f?.source_url),
    flyer_credit: strOrNull(f?.flyer_credit),
    organiser_x: strOrNull(f?.organiser_x),
    lineup: list(f?.lineup).map((l) => (l.time ? { time: str(l.time), name: str(l.name) } : { name: str(l.name) })),
    capacity: numOrNull(f?.capacity),
    last_seen: isoOr(f?.last_seen),
    confidence: f?.confidence === "lead" ? "lead" : "confirmed",
  };
}

/** One row of the review queue. */
export function mapPulled(j: J): PulledEvent {
  return {
    id: String(j.id),
    source_site: str(j.source_site),
    source_id: str(j.source_id),
    status: PULLED_STATUS.includes(j.status) ? j.status : "new",
    flags: list(j.flags).filter((f): f is PulledFlag => PULLED_FLAGS.includes(f)),
    edited: list(j.edited).map(String),
    confidence: j.confidence === "lead" ? "lead" : "confirmed",
    fields: mapScoutEvent({ ...(j.fields ?? {}), source_site: j.fields?.source_site ?? j.source_site, source_id: j.fields?.source_id ?? j.source_id }),
    organiser_id: strOrNull(j.organiser_id),
    organiser_name: strOrNull(j.organiser_name),
    organiser_stage: j.organiser_stage ? stageOf(j.organiser_stage) : null,
    event_id: strOrNull(j.event_id),
    duplicate_of: strOrNull(j.duplicate_of),
    also_at: list(j.also_at).map((a) => ({ source_site: str(a.source_site), source_id: str(a.source_id), ticket_url: strOrNull(a.ticket_url) })),
    first_seen_at: isoOr(j.first_seen_at),
    last_seen_at: isoOr(j.last_seen_at),
    missing_since: iso(j.missing_since),
  };
}

export function mapImportReport(j: J): ImportReport {
  const action = (a: unknown) => (a === "new" || a === "updated" || a === "blocked" || a === "skipped" ? a : "unchanged");
  return {
    dry_run: !!j.dry_run,
    total: num(j.total),
    new: num(j.new),
    updated: num(j.updated),
    unchanged: num(j.unchanged),
    blocked: num(j.blocked),
    skipped: num(j.skipped),
    flagged_gone: num(j.flagged_gone),
    organisers_matched: num(j.organisers_matched),
    organisers_new: num(j.organisers_new),
    lines: list(j.lines).map((l) => ({ source_site: str(l.source_site), source_id: str(l.source_id), name: str(l.name), action: action(l.action), note: str(l.note) })),
  };
}

/** The claim page's preview. A bad link is { ok: false, reason } in the words of the types: not_found, expired, used, revoked. */
export function mapPreview(j: J): TransferPreview {
  if (!j || j.ok !== true) {
    const r = String(j?.reason ?? "");
    const reason = r === "link_expired" || r === "expired" ? "expired" : r === "link_used" || r === "used" ? "used" : r === "link_revoked" || r === "revoked" ? "revoked" : "not_found";
    return { ok: false, reason };
  }
  return {
    ok: true,
    kind: j.kind === "handover" ? "handover" : j.kind === "link" ? "link" : "claim",
    room: { name: str(j.room?.name), slug: str(j.room?.slug), logo_url: strOrNull(j.room?.logo_url), about: str(j.room?.about) },
    events: list(j.events).map((e) => ({ id: String(e.id), title: str(e.title), starts_at: isoOr(e.starts_at) })),
    email_hint: j.kind === "link" ? null : str(j.email_hint),
    organiser_name: strOrNull(j.organiser_name),
    expires_at: isoOr(j.expires_at),
  };
}

export function mapAccept(j: J): AcceptOutcome {
  return { room_id: String(j.room_id), slug: str(j.slug), moved_events: num(j.moved_events), already_owned_other: !!j.already_owned_other };
}

export function mapClaimRequest(j: J): ClaimRequest {
  return {
    id: String(j.id),
    event_id: String(j.event_id ?? ""),
    event_title: str(j.event_title),
    organiser_id: strOrNull(j.organiser_id),
    organiser_name: strOrNull(j.organiser_name),
    name: str(j.name),
    email: str(j.email),
    phone: strOrNull(j.phone),
    note: str(j.note),
    status: j.status === "handled" ? "handled" : "new",
    created_at: isoOr(j.created_at),
  };
}

export function mapWeek(j: J): WeekSummary {
  const counts = (c: J) => ({ contacted: num(c?.contacted), replies: num(c?.replies), offers: num(c?.offers), claimed: num(c?.claimed), declined: num(c?.declined), listed: num(c?.listed) });
  const stages = { pulled: 0, listed: 0, offered: 0, claimed: 0, declined: 0 } as Record<OrganiserStage, number>;
  for (const k of STAGES) stages[k] = num(j.stages?.[k]);
  return {
    from: isoOr(j.from),
    to: isoOr(j.to),
    ...counts(j),
    pulled_new: num(j.pulled_new),
    rejected: num(j.rejected),
    claim_requests: num(j.claim_requests),
    stages,
    waiting: list(j.waiting).map((w) => ({ id: String(w.id), name: str(w.name), days: num(w.days) })),
    previous: counts(j.previous),
  };
}
