/**
 * The shared parts of the real layer: the Supabase client, the "who am I" mirror, RPC calls that turn the database's
 * answers into the fake layer's error messages, and the change emitter every subscribe() hangs on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../../supabase/client";
import { PAID_UNAVAILABLE } from "../constants";
import type { Unsub } from "../api";
import type { AuthUser } from "../types";

export function client(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error("Not connected");
  return sb;
}

/* ------------------------------------------------------------- who am I -- */

/**
 * The signed-in person, read from Supabase auth and kept here so AuthApi.current() can answer at once.
 * A guest (the app's anonymous session, no email) is "signed out" for these screens: they have to sign in to register.
 */
type Me = { id: string; email: string; anonymous: boolean; name: string | null };
let me: Me | null = null;
let meStarted = false;

const nameFromEmail = (email: string): string => {
  const local = email.split("@")[0].replace(/[0-9]+/g, " ").replace(/[._-]+/g, " ").trim();
  return (
    local
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ") || "Hopper"
  );
};

type SessionUser = { id: string; email?: string | null; is_anonymous?: boolean };

function adopt(user: SessionUser | null | undefined): void {
  if (!user) {
    if (me) {
      me = null;
      emit();
    }
    return;
  }
  const next: Me = { id: user.id, email: user.email ?? "", anonymous: !!user.is_anonymous, name: me && me.id === user.id ? me.name : null };
  const changed = !me || me.id !== next.id || me.email !== next.email || me.anonymous !== next.anonymous;
  me = next;
  if (changed) {
    emit();
    void loadName(user.id);
  }
}

/** The display name lives in profiles (the existing mechanism: the app and the Google callback write it there). */
async function loadName(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.from("profiles").select("display_name").eq("id", id).maybeSingle();
  const name = ((data as { display_name: string | null } | null)?.display_name ?? "").trim() || null;
  if (me && me.id === id && me.name !== name) {
    me = { ...me, name };
    emit();
  }
}

/** Start following the session (once). Safe to call from anywhere; the first call reads the stored session. */
export function watchSession(): void {
  if (meStarted) return;
  const sb = getSupabase();
  if (!sb) return;
  meStarted = true;
  sb.auth.onAuthStateChange((_event, session) => adopt(session?.user ?? null));
  void sb.auth.getSession().then(({ data }) => adopt(data.session?.user ?? null));
}

/** Tell the mirror the name changed (verifyCode just wrote it). */
export function setMyName(name: string): void {
  if (me) me = { ...me, name };
}

/** Make sure the mirror has read the session before the first answer (a Node script has no page load to do it). */
export async function ready(): Promise<void> {
  watchSession();
  const sb = client();
  const { data } = await sb.auth.getSession();
  if ((data.session?.user.id ?? null) !== (me?.id ?? null)) adopt(data.session?.user ?? null);
  else if (data.session?.user && me && (me.email !== (data.session.user.email ?? "") || me.anonymous !== !!data.session.user.is_anonymous)) adopt(data.session.user);
}

/** Someone with an account (an email). Null for a guest or nobody. */
export function who(): AuthUser | null {
  watchSession();
  if (!me || !me.email) return null;
  return { id: me.id, email: me.email, name: me.name || nameFromEmail(me.email) };
}

/** The session user id, guest or not (a guest may swipe), or null. Reads the session itself. */
export async function userId(): Promise<string | null> {
  const { data } = await client().auth.getSession();
  return data.session?.user.id ?? null;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await client().auth.getSession();
  return data.session?.access_token ?? null;
}

export const isAnonymous = (): boolean => !!me?.anonymous;

/* ------------------------------------------------------------- emitter -- */

const POLL_MS = 20_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Something changed (a write of ours, a sign-in, or the 20 second poll): every subscribed screen reloads. */
export function emit(): void {
  cache = new Map();
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one broken listener must not stop the rest */
    }
  }
}

/** Same call, same answer for a few seconds: three hooks asking for the Rooms list make one request. Cleared by emit(). */
export function shared<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function subscribe(fn: () => void): Unsub {
  watchSession();
  listeners.add(fn);
  if (!timer && typeof document !== "undefined") {
    timer = setInterval(() => {
      if (document.visibilityState === "visible") emit();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/* -------------------------------------------------------------- errors -- */

/**
 * The database's reason codes as the fake layer's words. One table for every function: where a code means different
 * things in different places the caller passes `over`.
 */
const REASONS: Record<string, string> = {
  no_session: "Sign in first",
  need_account: "Sign in first",
  not_found: "Event not found",
  not_allowed: "Not allowed",
  try_again_later: "Try again later",
  slow_down: "Slow down. Try again in a bit",
  // an event draft
  need_name: "Give your event a name",
  name_too_short: "Give your event a longer name",
  name_too_long: "Keep the name under 120 characters",
  bad_start: "Pick a start time",
  bad_end: "The event cannot end before it starts",
  end_before_start: "The event cannot end before it starts",
  bad_timezone: "Pick a time zone",
  bad_kind: "Pick In person, Online or Both",
  bad_place: "Check the place and try again",
  lagos_only: "Hoppaz is Lagos only for now",
  bad_link: "Paste a full link that starts with https://",
  bad_link_type: "Pick Zoom, Google Meet, WhatsApp call or Other",
  bad_capacity: "Capacity must be 1 or more",
  whatsapp_max_32: "WhatsApp calls hold up to 32 people",
  bad_visibility: "Pick Public, Community or Invite only",
  need_room: "Community events need a room. Create a room first.",
  bad_cover: "That cover picture did not work",
  bad_draft: "Check the details and try again",
  // ticket types
  currently_unavailable: PAID_UNAVAILABLE,
  payouts_not_ready: "Set up payouts before you sell paid tickets",
  tickets_needed: "Add at least one ticket type",
  too_many_tickets: "Up to 5 ticket types",
  bad_ticket: "Pick a ticket",
  need_ticket_name: "Give every ticket type a name",
  ticket_name_too_long: "Keep ticket names under 60 characters",
  duplicate_ticket: "Two ticket types have the same name",
  bad_price: "A price must be a whole number",
  bad_ticket_capacity: "Capacity must be 1 or more",
  // registering
  cancelled: "This event was cancelled",
  event_over: "This event is over",
  declined: "The host did not take your request",
  full: "This event is full",
  type_full: "That ticket is full",
  use_checkout: "Buy this ticket with checkout",
  too_many_answers: "Too many answers",
  answer_too_long: "Keep each answer under 500 characters",
  // The buyer's cancel. A host declining a paid registration gets its own words (registrations.decline).
  paid_use_refund: "You paid for this ticket. Ask the host for a refund.",
  not_open: "Not open yet",
  no_host: "Tickets for this event are not sold here",
  already_checked_in: "You are already checked in",
  nothing_to_approve: "Nothing to approve",
  not_waitlisted: "This person is not on the waitlist",
  no_free_place: "No free place. Raise the capacity first.",
  bad_action: "That did not work",
  // registration settings
  bad_settings: "Check the settings and try again",
  bad_questions: "Check the questions and try again",
  bad_question_id: "Check the questions and try again",
  bad_question_label: "Every question needs a label",
  duplicate_question: "Two questions have the same id",
  name_and_email_stay: "Name and Email cannot be removed",
  bad_messages: "Check the messages and try again",
  bad_message: "Keep each message between 1 and 500 characters",
  // pops
  empty: "Write a message first",
  too_long: "That is too long",
  bad_audience: "Pick who it is for",
  too_far: "Pick a time within 90 days",
  event_closed: "This event has closed",
  // door
  no_secret: "Tickets are not ready yet. Try again soon.",
  bad_mode: "That did not work",
  // reports
  bad_reason: "Pick a reason",
  note_too_long: "Keep the note under 1000 characters",
  own_event: "You cannot report your own event",
  // rooms
  not_staff: "Only the room's host can post here",
};

/** The message for a reason code. `extra` is the rest of the answer (some codes carry a name). */
export function reasonText(reason: unknown, over: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  const code = String(reason ?? "");
  if (code === "ticket_in_use") return `People already took ${String(extra.ticket ?? "that ticket")}. Keep that ticket.`;
  if (code === "answer_needed") return `Please answer: ${String(extra.question ?? "every required question")}`;
  return over[code] ?? REASONS[code] ?? "That did not work. Try again";
}

/** A raw database or network error as a plain line. */
export function failText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("permission denied") || m.includes("jwt") || m.includes("not authenticated") || m.includes("no_session")) return "Sign in first";
  if (m.includes("need_account")) return "Sign in first";
  if (m.includes("room_off")) return "The 3D room is off";
  if (m.includes("ticket_secret_missing")) return REASONS.no_secret;
  if (m.includes("slow_down")) return REASONS.slow_down;
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("fetch failed")) return "No connection. Try again";
  return "That did not work. Try again";
}

/** Call a database function. Raw errors become plain Errors; the answer is returned as it is. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) {
    if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") console.warn(`[hoppaz] ${fn}:`, error.message);
    throw new Error(failText(error.message));
  }
  return data as T;
}

/** For the functions that answer { ok: true, ... } or { ok: false, reason }. Throws the reason as the fake layer's words. */
export async function rpcOk<T extends Record<string, unknown>>(fn: string, args?: Record<string, unknown>, over: Record<string, string> = {}): Promise<T> {
  const out = await rpc<Record<string, unknown> | null>(fn, args);
  if (!out || out.ok !== true) throw new Error(reasonText(out?.reason, over, out ?? {}));
  return out as T;
}

/** For the functions that answer a short text: "ok" is fine, anything else is a reason code. */
export async function rpcText(fn: string, args?: Record<string, unknown>, over: Record<string, string> = {}): Promise<string> {
  const out = await rpc<string | null>(fn, args);
  if (out === "ok") return out;
  throw new Error(reasonText(out, over));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A random uuid. crypto.randomUUID needs a secure page (https or localhost); a phone on the local network has neither. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
