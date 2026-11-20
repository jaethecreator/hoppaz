/**
 * The fake layer's state: one in-memory object, a seed that is rebuilt on every load (so the events are always
 * "this week"), and a small layer of user-made changes kept in localStorage under "hz.r1.fake.v1".
 *
 * How persistence works: the seed ids are stable, so what is saved is only the difference from the seed (new records,
 * and changed fields of seeded ones) plus the viewer, the clock offset and the signing key. On load the seed is built,
 * then the saved changes are laid on top. "Reset all fake data" clears the saved layer.
 *
 * Importable under Node (the check script): every use of window and localStorage is guarded.
 */
import type { HostPayoutStatus, Order } from "../pay";
import { PAID_KEY } from "../flags";
import type { Lineup } from "../lineup";
import type {
  AuthUser, ClaimAsk, ClaimLink, ClaimRequest, JoinMode, JoinRequest, Organiser, OrganiserLogEntry, Pop, PulledEvent, R1Event, RegMessages, RegQuestion, Registration, Report, RoomAnnouncement,
  RoomLinks, RoomMessage, RoomNotice, RoomRole, RoomSummary, SavedDetails, Ticket, Transfer,
} from "../types";
import { applyPayoutsDemo } from "./payoutsDemo";
import { buildSeed } from "./seed";
import { clone } from "./util";

export const STORAGE_KEY = "hz.r1.fake.v1";

export type UserRec = {
  id: string;
  name: string;
  email: string;
  staff?: boolean;
  /** The Hoppaz Listings account: it owns unclaimed listings and dormant rooms, and nobody signs in as it (the dev sign-in list skips it). */
  hidden?: boolean;
};

/** A ticket type as stored: what is worked out on read (sold, spots left) is not kept. */
export type TicketTypeRec = { id: string; name: string; price_naira: number; capacity: number | null };

/**
 * An event as stored: R1Event without what is worked out on read (counts, host card, distance). ticket_types is stored
 * lean and may be missing (seeded events, and events saved before ticket types existed): rules.typesOf() then gives the
 * one free "General" (or, for a seeded paid event, one General at the event's price).
 */
export type EventRec = Omit<
  R1Event,
  "going" | "spots_left" | "host" | "distance_m" | "heat" | "checkins" | "swipes_in" | "here_now" | "ticket_types" | "listing"
> & {
  host_id: string;
  ticket_types?: TicketTypeRec[];
  /** Listing fields (the same columns as the SQL). Missing means a normal Hoppaz event. */
  ticket_mode?: "hoppaz" | "external";
  ticket_url?: string | null;
  instagram_url?: string | null;
  listed_price?: number | null;
  listed_price_max?: number | null;
  listing_sold_out?: boolean;
  source_site?: string | null;
  source_id?: string | null;
  organiser_id?: string | null;
  /** The outside ticket site in a word, the page the scout found the event on, the flyer credit, and the organiser's public handles (no phone, no email). */
  ticket_platform?: string | null;
  source_url?: string | null;
  flyer_credit?: string | null;
  organiser_name?: string | null;
  organiser_ig?: string | null;
  organiser_x?: string | null;
};

export type RoomRec = Omit<RoomSummary, "members" | "joined" | "unread" | "latest_announcement" | "is_owner" | "can_post" | "has_3d" | "three_d_on" | "online" | "about" | "links" | "join_mode" | "my_role" | "request" | "pending_requests"> & {
  owner_id: string | null;
  /** Missing means no walkable 3D room (the fake has none; a tester can switch one on with fakeDev.setHas3d). */
  has_3d?: boolean;
  /** The 3D room switch. Missing means the default: on when there is a 3D room, Lagos HQ included. */
  three_d_on?: boolean;
  /** Missing means not counted. */
  online?: number;
  /** The room's about text (RoomSummary.about). */
  description: string;
  links?: RoomLinks;
  /** Missing means open. */
  join_mode?: JoinMode;
  /** Who made the room (crews.created_by). A dormant room is made by the Listings account; accepting a transfer moves it to the new owner. */
  created_by?: string | null;
  /** Hoppaz made this room for a listed organiser (ev_room_profiles.listed_by_staff). Missing on older rooms: made by the Listings account counts. */
  listed_by_staff?: boolean;
  /** Staff set the mode by hand on the desk (ev_room_profiles.listed_mode_set): the open organiser rooms switch leaves it alone. */
  listed_mode_set?: boolean;
  /** Members before anyone joins in this browser. */
  base_members: number;
};

export type TicketRec = {
  id: string;
  event_id: string;
  reg_id: string;
  version: number;
  status: Ticket["status"];
  /** Paid tickets: the order that made it and the type it is for. A free ticket has neither (the registration's type). */
  order_id?: string;
  type_id?: string;
  /** Order of creation within the registration: seat 1, 2, 3. */
  seq?: number;
  checked_in_at?: string;
};

/** A paid order as stored: the Order a screen gets, plus what the fake needs to finish it. */
export type OrderRec = Order & {
  host_id: string;
  answers: Record<string, string>;
  referrer_id: string | null;
  /** When a card refund started (fake clock, ms); it settles a minute later. */
  refund_started_ms: number | null;
};

/** A host's Bachs setup. No record means Not started. balance_naira is what the host held before any sale here. */
export type PayoutRec = { id: string; status: HostPayoutStatus; balance_naira: number; bank_label?: string | null; withdrawals?: WithdrawalRec[] };

/** A fake withdrawal (fake clock ms). It reaches the bank, less a N50 fee, once execute_after_ms has passed. */
export type WithdrawalRec = { id: string; amount_naira: number; execute_after_ms: number; created_ms: number; paid_ms: number | null };

export type JoinRequestRec = JoinRequest & { status: "pending" | "approved" | "declined"; ticket_event_id?: string | null };
export type NoticeRec = RoomNotice & { user_id: string; seen: boolean };

/** An organiser as stored: what is worked out on read (room name, event counts, waiting items) is not kept. */
export type OrganiserRec = Omit<Organiser, "room_slug" | "room_name" | "events_total" | "events_upcoming" | "pulled_waiting" | "transfer_pending" | "claim_requests" | "last_replied_at"> & {
  name_key: string;
  claimed_by: string | null;
};

/** A pulled row as stored. The organiser's name and stage are read from the organiser. */
export type PulledRec = Omit<PulledEvent, "organiser_name" | "organiser_stage"> & { decided_at: string | null; reject_reason: string };

/** A transfer as stored: only the hash of the link is kept, never the link. attempts counts wrong-email tries (10 locks it). */
export type TransferRec = Transfer & { token_hash: string; attempts: number; accepted_by: string | null };

/** A claim link as stored: only the hash of the token is kept, never the token. */
export type ClaimLinkRec = ClaimLink & { token_hash: string };
/** A claim ask as stored: the asker is a signed in user. */
export type ClaimAskRec = ClaimAsk & { user_id: string };

export type RegSettings = { questions: RegQuestion[]; messages: RegMessages };

/** Every collection is a record by id, so the saved layer can be a plain difference. */
export type FakeState = {
  users: Record<string, UserRec>;
  events: Record<string, EventRec>;
  regs: Record<string, Registration>;
  tickets: Record<string, TicketRec>;
  pops: Record<string, Pop>;
  announcements: Record<string, RoomAnnouncement>;
  messages: Record<string, RoomMessage>;
  reports: Record<string, Report>;
  rooms: Record<string, RoomRec>;
  orders: Record<string, OrderRec>;
  /** By host user id. */
  payouts: Record<string, PayoutRec>;
  regSettings: Record<string, RegSettings>;
  /** By event id: the lineup or programme. */
  lineups: Record<string, Lineup>;
  /** "<userId>:<roomId>" */
  memberships: Record<string, boolean>;
  /** "<userId>:<roomId>" to a role. A member with no entry is a plain member; the owner is rooms[].owner_id. */
  roles: Record<string, Exclude<RoomRole, "owner" | "member">>;
  /** "<userId>:<roomId>" to an ISO time: when someone joined in this browser. A member with none joined before the seed (a month ago). */
  joinedAt: Record<string, string>;
  /** "<eventId>:<userId>" for people the host let scan at the door of that event. */
  doorStaff: Record<string, boolean>;
  /** Join requests by id: one per person per room (a decided one is kept, a new ask after a decline makes it pending again). */
  requests: Record<string, JoinRequestRec>;
  /** Notices by id (a request that was approved). */
  notices: Record<string, NoticeRec>;
  /** "<userId or guest>:<eventId>" */
  interest: Record<string, boolean>;
  /** "<userId>:<roomId>" to an ISO time: announcements before it are read. */
  reads: Record<string, string>;
  /** By user id: checkout details the person chose to keep (name, email, phone; never a host's own questions). */
  savedDetails: Record<string, SavedDetails>;
  /** Outreach: organisers, their contact log, the review queue, transfer links and "Is this your event?" requests. */
  organisers: Record<string, OrganiserRec>;
  organiserLog: Record<string, OrganiserLogEntry>;
  pulled: Record<string, PulledRec>;
  transfers: Record<string, TransferRec>;
  claimRequests: Record<string, ClaimRequest>;
  /** Event claims (the event_claims flag): one-time links with no email, and asks from people without a link. */
  claimLinks: Record<string, ClaimLinkRec>;
  claimAsks: Record<string, ClaimAskRec>;
  /** "<eventId>|<Lagos day>|<who>" to true: a person or device tapped the outside ticket link that day. One per key. */
  ticketTaps: Record<string, boolean>;
  /** The Hoppaz Listings user (always the seeded one, so a restore finds it again). null if the account is not set up. */
  listingsUserId: string | null;
  viewerId: string | null;
  pendingEmail: string | null;
  /** Fake clock: added to the real time. */
  offset: number;
  /** HMAC key (JWK) for the fake ticket signature. Real signing is Ola's. */
  key: JsonWebKey | null;
};

const COLLS = [
  "users", "events", "regs", "tickets", "pops", "announcements", "messages", "reports", "rooms",
  "orders", "payouts", "regSettings", "lineups", "memberships", "roles", "joinedAt", "doorStaff", "requests", "notices", "interest", "reads",
  "savedDetails", "organisers", "organiserLog", "pulled", "transfers", "claimRequests", "claimLinks", "claimAsks", "ticketTaps",
] as const;
type Coll = (typeof COLLS)[number];

type Layer = { added: Record<string, unknown>; patched: Record<string, unknown> };
type Saved = {
  v: 1;
  offset: number;
  viewerId: string | null;
  pendingEmail: string | null;
  key: JsonWebKey | null;
  coll: Partial<Record<Coll, Layer>>;
};

/* ---------------------------------------------------------------- state -- */

/** The seed, with the payouts demo laid on when this browser asked for one (payoutsDemo.ts, fake only). */
function seeded(): FakeState {
  const t = Date.now();
  const st = buildSeed(t);
  applyPayoutsDemo(st, t);
  return st;
}

let seed: FakeState = seeded();
let state: FakeState = clone(seed);
const listeners = new Set<() => void>();

/** The live state. Fake modules read and change this, then call emit(). */
export function S(): FakeState {
  return state;
}

/** Fake clock in epoch ms. */
export function now(): number {
  return Date.now() + state.offset;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tell every subscriber something changed, and save the user-made layer. */
export function emit(): void {
  persist();
  listeners.forEach((fn) => fn());
}

export function viewer(): UserRec | null {
  return state.viewerId ? (state.users[state.viewerId] ?? null) : null;
}

export function toAuthUser(u: UserRec): AuthUser {
  return { id: u.id, name: u.name, email: u.email };
}

/* ---------------------------------------------------------- persistence -- */

const hasStorage = () => typeof window !== "undefined";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** What differs from the seed, per collection. */
function diff(base: Record<string, unknown>, cur: Record<string, unknown>): Layer {
  const added: Record<string, unknown> = {};
  const patched: Record<string, unknown> = {};
  for (const id of Object.keys(cur)) {
    const c = cur[id];
    if (!(id in base)) {
      added[id] = c;
      continue;
    }
    const b = base[id];
    if (isObj(c) && isObj(b)) {
      const p: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(c), ...Object.keys(b)])) {
        if (JSON.stringify(c[k]) !== JSON.stringify(b[k])) p[k] = c[k] === undefined ? null : c[k];
      }
      if (Object.keys(p).length) patched[id] = p;
    } else if (JSON.stringify(c) !== JSON.stringify(b)) {
      patched[id] = c;
    }
  }
  return { added, patched };
}

function lay(base: Record<string, unknown>, layer: Layer | undefined): void {
  if (!layer) return;
  for (const [id, v] of Object.entries(layer.added ?? {})) base[id] = v;
  for (const [id, p] of Object.entries(layer.patched ?? {})) {
    const b = base[id];
    if (isObj(b) && isObj(p)) Object.assign(b, p);
    else if (!isObj(p)) base[id] = p;
  }
}

/** Save the user-made layer without telling subscribers (used when only the signing key changed). */
export function persist(): void {
  if (!hasStorage()) return;
  try {
    const coll: Saved["coll"] = {};
    for (const c of COLLS) {
      const l = diff(seed[c] as Record<string, unknown>, state[c] as Record<string, unknown>);
      if (Object.keys(l.added).length || Object.keys(l.patched).length) coll[c] = l;
    }
    const out: Saved = {
      v: 1, offset: state.offset, viewerId: state.viewerId, pendingEmail: state.pendingEmail, key: state.key, coll,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* private mode or full: the fake just forgets on reload */
  }
}

/** Lay a saved layer over a copy of the seed. */
function restore(saved: Saved | null): FakeState {
  const next = clone(seed);
  if (!saved || saved.v !== 1) return next;
  for (const c of COLLS) lay(next[c] as Record<string, unknown>, saved.coll?.[c]);
  next.offset = Number(saved.offset) || 0;
  next.viewerId = saved.viewerId && next.users[saved.viewerId] ? saved.viewerId : null;
  next.pendingEmail = saved.pendingEmail ?? null;
  next.key = saved.key ?? null;
  return next;
}

function read(): Saved | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** Start over: a fresh seed, no saved changes, signed out, real time. */
export function resetAll(): void {
  seed = seeded();
  state = clone(seed);
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}

state = restore(read());

// Another tab changed something (the dev panel, usually): take its saved layer and tell our screens.
if (hasStorage()) {
  window.addEventListener("storage", (e) => {
    if (e.key === PAID_KEY) {
      listeners.forEach((fn) => fn());
      return;
    }
    if (e.key !== STORAGE_KEY) return;
    state = restore(read());
    listeners.forEach((fn) => fn());
  });
}
