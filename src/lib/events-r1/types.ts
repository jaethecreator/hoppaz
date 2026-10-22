/**
 * Release 1 shared types. One file so every package agrees on the shapes.
 * The interface that uses them is in api.ts. Amounts are whole naira (R1 is free: 0).
 */
import type { EventRow } from "@/lib/types";

export type Visibility = "public" | "community" | "invite";
export type EventKind = "in_person" | "online" | "hybrid";
export type LinkType = "zoom" | "meet" | "whatsapp" | "other";
export type EventStatus = "live" | "cancelled" | "ended";

export type HostRef = {
  id: string;
  name: string;
  /** The host's room, if they have one. Event | Room on the event page opens it. */
  roomId: string | null;
  roomName: string | null;
  verified: boolean;
};

/**
 * An event for the new screens. It extends EventRow so the map, deck and EventCard keep working
 * unchanged. An event with no place has lat/lng parked on LAGOS_CENTER and venue_name "" (hasVenue()
 * then keeps it off the map), exactly like today's "no venue yet" leads.
 */
/** One kind of ticket for an event. An event always has at least one; the default is one free "General" with no limit. */
export type TicketType = {
  id: string;
  event_id: string;
  name: string;
  /** Whole naira. 0 = free. Paid types save only when paidTicketsOn() and the host can sell (see pay.ts). */
  price_naira: number;
  /** null = no limit of its own (the event's capacity still applies). */
  capacity: number | null;
  /** Going and checked-in people holding this type. */
  sold: number;
  /** Places left on this type, counting the event's own capacity too. null = no limit at all. */
  spots_left: number | null;
};

export type R1Event = EventRow & {
  description: string;
  host: HostRef;
  ends_at: string | null;
  timezone: string;
  kind: EventKind;
  visibility: Visibility;
  status: EventStatus;
  capacity: number | null;
  requires_approval: boolean;
  waitlist_on: boolean;
  /** Link type is public; the link itself is returned only to a registered person (and the host). */
  link_type: LinkType | null;
  online_link: string | null;
  room_id: string | null;
  /** Going counts approved and checked-in people only. */
  going: number;
  spots_left: number | null;
  /** The lowest ticket type price (0 when any type is free). */
  price_naira: number;
  /** Always at least one. */
  ticket_types: TicketType[];
  created_at: string;
  /** Short link slug for hoppaz.fun/e/<slug>. */
  slug: string;
};

export type RegStatus =
  | "requested" // free + approval on, waiting for the host
  | "going" // in
  | "waitlisted"
  | "declined"
  | "cancelled"
  | "checked_in";

/** `enabled` false = the question is switched off (Phone is off by default). Missing means on. */
export type RegQuestion = { id: string; label: string; required: boolean; builtin?: "name" | "email" | "phone"; enabled?: boolean };
export type RegMessages = { pending: string; going: string; declined: string };

export type Registration = {
  id: string;
  event_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: RegStatus;
  /** The ticket type this person took. */
  ticket_type_id: string;
  ticket_name: string;
  /** Seats held: 1 for free tickets, 1 to 5 for a paid order. */
  quantity: number;
  answers: Record<string, string>;
  /** Who invited this person (their own invite link), so the host sees who brought whom. */
  referrer_id: string | null;
  referrer_name: string | null;
  created_at: string;
  checked_in_at: string | null;
  /** Place in the waitlist, 1 = next. */
  waitlist_pos: number | null;
  /** How many of the tickets are checked in (a paid order can hold several). Missing means none; status is checked_in only when all are. */
  checked_in_count?: number;
};

/** What the one button on the event page should be, for this viewer. */
export type ViewerState = {
  signedIn: boolean;
  isHost: boolean;
  /** Swiped right: interested only. */
  interested: boolean;
  registration: Registration | null;
  /** Register | Request to join | Join waitlist | Get ticket (R2, disabled) | You're in | Pending | Closed | Cancelled */
  button:
    | "register"
    | "request"
    | "waitlist"
    | "get_ticket"
    | "going"
    | "pending"
    | "waitlisted"
    | "declined"
    | "closed";
  /** Online link is returned in R1Event.online_link only when this is true. */
  canSeeOnlineLink: boolean;
  /** Join call shows from 15 minutes before start (fake clock aware). */
  joinCallOpen: boolean;
};

export type Ticket = {
  id: string;
  event_id: string;
  holder_name: string;
  ticket_name: string; // the ticket type's name, e.g. "General"
  /** Short code a door person can type when a QR will not scan, e.g. "7K4M2Q9A". */
  code: string;
  /** Signed token drawn as the QR: <b64 payload>.<b64 signature>. Payload = ticket id, event id, version. */
  token: string;
  version: number;
  status: "valid" | "used" | "void";
  /** Seat number and seats in the order, e.g. 2 of 3, for a person who bought several tickets. */
  seat_no?: number;
  seats?: number;
};

export type PopAudience = "going" | "pending" | "waitlist" | "everyone";
export type PopAuto = "day_before" | "hour_before" | "doors_open";

export type Pop = {
  id: string;
  event_id: string;
  event_title: string;
  author_name: string;
  body: string;
  audience: PopAudience;
  also_room: boolean;
  /** null = sent at once. */
  send_at: string | null;
  sent_at: string | null;
  status: "scheduled" | "sent";
  auto: PopAuto | null;
  recipients: number;
  /** Automatic Pops only: false = switched off, never sent. Missing means on. */
  enabled?: boolean;
};

export type RoomKind = "hq" | "crew" | "brand";

export type RoomSummary = {
  id: string;
  slug: string;
  name: string;
  kind: RoomKind;
  logo_url: string | null;
  wallpaper_url: string | null;
  members: number;
  verified: boolean;
  /** Is the viewer a member. */
  joined: boolean;
  unread: number;
  latest_announcement: RoomAnnouncement | null;
  /** The viewer made this room. */
  is_owner: boolean;
  /** Owner or admin: may post an announcement. */
  can_post: boolean;
  /** The room has a walkable 3D room to enter. False: Enter room goes to General. Hoppaz HQ is chat first and may be false. */
  has_3d: boolean;
  /** People in the room right now (shown on Hoppaz HQ). 0 when not counted. */
  online: number;
};

export type RoomAnnouncement = {
  id: string;
  room_id: string;
  body: string;
  created_at: string;
  author_name: string;
  /** Set when it came from an event Pop: shown tagged with the event name. One way: never the reverse. */
  event_id: string | null;
  event_title: string | null;
};

/** "general" is the room's own chat; any other value is an event id (that event's chat). */
export type RoomChannel = string;

/** Marks a message as a host Pop for an event: shown pinned at the top of that event's chat. */
export type PopTag = { event_id: string; event_title: string };

export type RoomMessage = {
  id: string;
  room_id: string;
  channel: RoomChannel;
  author_name: string;
  body: string;
  created_at: string;
  /** Set on a host Pop: the chat pins it. */
  pinned_pop?: PopTag;
};

export type EventChatState = "upcoming" | "open" | "closed";
export type EventChat = {
  event_id: string;
  event_title: string;
  room_id: string;
  opens_at: string;
  closes_at: string; // 3 days after the event
  state: EventChatState;
  /** Whether the viewer may come in (follows the event's who-can-come-in setting). */
  can_enter: boolean;
};

export type ReportReason = "fake_or_scam" | "wrong_place" | "offensive" | "other";
export type Report = {
  id: string;
  event_id: string;
  event_title: string;
  reporter_id: string;
  /** The reporter's name, for staff. Optional: the list may not know it. */
  reporter_name?: string | null;
  reason: ReportReason;
  note: string;
  created_at: string;
  status: "open" | "reviewed";
};

export type ScanResult =
  /** Standard mode: a good ticket, shown to the door person. Nobody is checked in until door.confirm(). */
  | { ok: true; kind: "confirm"; name: string; ticket: string; checked_in: number; total: number; seat_no?: number; seats?: number }
  | { ok: true; kind: "checked_in"; name: string; ticket: string; checked_in: number; total: number; seat_no?: number; seats?: number }
  | { ok: false; kind: "already_used"; name: string; at: string; seat_no?: number; seats?: number }
  | { ok: false; kind: "not_valid"; reason: "bad_signature" | "wrong_event" | "void" | "unknown" | "not_going" };

export type AuthUser = { id: string; name: string; email: string };

/** Input for create and edit. A name is enough; everything else has a default. */
export type EventDraft = {
  title: string;
  starts_at?: string;
  ends_at?: string | null;
  timezone?: string;
  kind?: EventKind;
  /** Place name, e.g. "Maroko, Lagos". Empty for online. */
  place_name?: string;
  area?: string | null;
  lat?: number | null;
  lng?: number | null;
  link_type?: LinkType | null;
  online_link?: string | null;
  description?: string;
  capacity?: number | null;
  requires_approval?: boolean;
  waitlist_on?: boolean;
  visibility?: Visibility;
  cover_url?: string | null;
  vibe?: string;
  /** Ticket types, 1 to 5. Default: one free "General" with no limit. A paid type needs PAID_TICKETS. */
  tickets?: { name: string; price_naira: number; capacity: number | null }[];
  /** Put the event in the host's room. Default true when the host has a room; false keeps it out. */
  add_to_room?: boolean;
};

export type RoomDraft = { name: string; description?: string };
