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
import type {
  AuthUser, Pop, R1Event, RegMessages, RegQuestion, Registration, Report, RoomAnnouncement, RoomMessage, RoomSummary, Ticket,
} from "../types";
import { buildSeed } from "./seed";
import { clone } from "./util";

export const STORAGE_KEY = "hz.r1.fake.v1";

export type UserRec = { id: string; name: string; email: string; staff?: boolean };

/** A ticket type as stored: what is worked out on read (sold, spots left) is not kept. */
export type TicketTypeRec = { id: string; name: string; price_naira: number; capacity: number | null };

/**
 * An event as stored: R1Event without what is worked out on read (counts, host card, distance). ticket_types is stored
 * lean and may be missing (seeded events, and events saved before ticket types existed): rules.typesOf() then gives the
 * one free "General" (or, for a seeded paid event, one General at the event's price).
 */
export type EventRec = Omit<
  R1Event,
  "going" | "spots_left" | "host" | "distance_m" | "heat" | "checkins" | "swipes_in" | "here_now" | "ticket_types"
> & { host_id: string; ticket_types?: TicketTypeRec[] };

export type RoomRec = Omit<RoomSummary, "members" | "joined" | "unread" | "latest_announcement" | "is_owner" | "can_post" | "has_3d" | "three_d_on" | "online"> & {
  owner_id: string | null;
  /** Missing means no walkable 3D room (the fake has none; a tester can switch one on with fakeDev.setHas3d). */
  has_3d?: boolean;
  /** The 3D room switch. Missing means the default: on when there is a 3D room, Lagos HQ included. */
  three_d_on?: boolean;
  /** Missing means not counted. */
  online?: number;
  description: string;
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
  /** "<userId>:<roomId>" */
  memberships: Record<string, boolean>;
  /** "<userId or guest>:<eventId>" */
  interest: Record<string, boolean>;
  /** "<userId>:<roomId>" to an ISO time: announcements before it are read. */
  reads: Record<string, string>;
  viewerId: string | null;
  pendingEmail: string | null;
  /** Fake clock: added to the real time. */
  offset: number;
  /** HMAC key (JWK) for the fake ticket signature. Real signing is Ola's. */
  key: JsonWebKey | null;
};

const COLLS = [
  "users", "events", "regs", "tickets", "pops", "announcements", "messages", "reports", "rooms",
  "orders", "payouts", "regSettings", "memberships", "interest", "reads",
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

let seed: FakeState = buildSeed(Date.now());
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
  seed = buildSeed(Date.now());
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
