import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obj, str } from "./mailcommon";
import { eventUrl } from "./templates/copy";
import { formatWhen, oneLine, siteBase } from "./templates/format";
import { maskNumber, scrub, type WhatsAppSender } from "./whatsapp";

/**
 * Meta's WhatsApp webhook and the keyword bot behind it. Server only. The route is src/app/api/whatsapp/hook/route.ts; the database half is
 * supabase/events_r1_notify_whatsapp.sql (notify_wa_inbound, notify_wa_apply_statuses, notify_wa_record_reply).
 *
 * META'S WEBHOOK (webhooks/create-webhook-endpoint, webhooks/reference/messages, .../messages/status; checked 31 Oct 2026, never received for real):
 *   GET   hub.mode=subscribe, hub.challenge, hub.verify_token: if the token is ours, answer 200 with the challenge, else a non-200.
 *   POST  JSON, with X-Hub-Signature-256: "sha256=" and the hex HMAC-SHA256 of the payload, keyed with the app secret. We hash the raw bytes as
 *         received, never a re-serialised copy. Answer 200 for a valid call, anything else is retried (at once, then less often for 7 days), so
 *         the same event can come again: everything here is idempotent by message id. Calls may be batches of up to 1,000 updates.
 *   Body  { object: "whatsapp_business_account", entry: [{ id, changes: [{ field: "messages", value: { metadata: { display_phone_number,
 *         phone_number_id }, contacts, messages: [{ from, id, timestamp, type: "text", text: { body } }], statuses: [{ id, status, timestamp,
 *         recipient_id, pricing: { billable (deprecated), pricing_model, type, category }, errors: [{ code, title, message, error_data }] }] } }] }] }
 *   statuses: sent, delivered, read, played, failed. The pricing object appears in one webhook per message (sent, or delivered/read), never both.
 *   A billable message has pricing.type "regular"; the free service tier has "free_customer_service". The pricing object carries a category, no amount.
 *   NOT IN THE DOCS I COULD READ: the field names of a group message and of an echo of what the business app sent. They are guarded by what is known:
 *   a message with a group_id, a recipient_type of "group", from_me, or a sender that is not a plain international number is ignored, as is any change
 *   whose field is not "messages" (an echo arrives under its own field name).
 */

type Env = Record<string, string | undefined>;

export const WA_HELP = "This number sends your Hoppaz reminders. Reply TICKET for your ticket, STOP to stop.";
export const WA_STOP_DONE = "You're unsubscribed from Hoppaz WhatsApp reminders. Reply START to turn them back on.";
export const WA_START_DONE = "Hoppaz WhatsApp reminders are back on. Reply STOP to stop.";
export const WA_START_NO = "We can't turn this on from here. You can turn WhatsApp reminders on at checkout when you buy a ticket on Hoppaz.";
export const WA_TICKET_NONE = "We don't have an upcoming ticket for this number. Sign in on hoppaz.fun to see your tickets.";

export type Keyword = "stop" | "start" | "ticket" | "help" | "other";

/** Exact match on STOP, START, TICKET or HELP, ignoring case and any white space around the word. Anything else, "stop." and "please stop" included, is "other". */
export function matchKeyword(text: string): Keyword {
  const t = text.replace(/^[\s\u200b-\u200f\u2028\u2029\ufeff]+|[\s\u200b-\u200f\u2028\u2029\ufeff]+$/g, "").toLowerCase();
  return t === "stop" ? "stop" : t === "start" ? "start" : t === "ticket" ? "ticket" : t === "help" ? "help" : "other";
}

// ------------------------------------------------------------------ reading the webhook ---
export type WaStatusEvent = {
  message_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  /** The pricing object was in this webhook. */
  priced: boolean;
  billable: boolean;
  category: string | null;
  /** "code: title" for a failed status. Never the recipient. */
  error: string | null;
};

export type InMessage = { id: string; /** Digits only, no plus. */ from: string; text: string };

export type ParsedHook = { messages: InMessage[]; statuses: WaStatusEvent[]; ignored: number };

export const MAX_ITEMS = 1000;
const digits = (v: unknown) => str(v).replace(/\D/g, "");

export function parseWebhook(body: unknown): ParsedHook {
  const out: ParsedHook = { messages: [], statuses: [], ignored: 0 };
  const root = obj(body);
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return out;
  for (const entry of root.entry.slice(0, MAX_ITEMS)) {
    for (const change of Array.isArray(obj(entry).changes) ? (obj(entry).changes as unknown[]).slice(0, MAX_ITEMS) : []) {
      const c = obj(change);
      const value = obj(c.value);
      if (c.field !== "messages") {
        out.ignored++;
        continue;
      }
      const meta = obj(value.metadata);
      const ours = new Set([digits(meta.display_phone_number), digits(meta.phone_number_id)].filter(Boolean));

      for (const raw of Array.isArray(value.statuses) ? (value.statuses as unknown[]).slice(0, MAX_ITEMS) : []) {
        const s = obj(raw);
        const status = str(s.status);
        const id = str(s.id).trim();
        if (!id || (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed")) {
          out.ignored++;
          continue;
        }
        const pricing = s.pricing && typeof s.pricing === "object" ? obj(s.pricing) : null;
        // The docs: a billable message has type "regular" ("billable" is deprecated, used only when type is missing).
        const billable = pricing ? (pricing.type !== undefined ? pricing.type === "regular" : pricing.billable === true) : false;
        const first = Array.isArray(s.errors) ? obj((s.errors as unknown[])[0]) : {};
        out.statuses.push({
          message_id: id.slice(0, 200),
          status,
          priced: pricing !== null,
          billable,
          category: pricing ? str(pricing.category) || null : null,
          error: status === "failed" ? `${str(first.code) || "?"}: ${oneLine(str(first.title) || str(first.message) || "failed", 120)}` : null,
        });
      }

      for (const raw of Array.isArray(value.messages) ? (value.messages as unknown[]).slice(0, MAX_ITEMS) : []) {
        const m = obj(raw);
        const from = digits(m.from);
        const group = m.group_id !== undefined || m.recipient_type === "group" || obj(m).group !== undefined;
        const own = m.from_me === true || ours.has(from);
        const text = typeof obj(m.text).body === "string" ? (obj(m.text).body as string) : null;
        // Only a plain text message from one person to us gets a look. Reactions, images, stickers, system notes, groups, our own number: never answered.
        if (m.type !== "text" || text === null || group || own || !/^[1-9]\d{7,14}$/.test(from) || str(m.from) !== from || !str(m.id).trim()) {
          out.ignored++;
          continue;
        }
        out.messages.push({ id: str(m.id).trim().slice(0, 200), from, text: text.slice(0, 2000) });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ signatures ---
const SIG = /^sha256=([0-9a-f]{64})$/i;

/** The header Meta would send for this body. For the checks and for anyone testing the route by hand. */
export const signBody = (secret: string, body: Buffer | string): string => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/**
 * True only if the header is the HMAC-SHA256 of exactly these bytes with this secret. Constant time. With no secret there is no way in: false.
 * Nothing else decides this (no flag, no development exception).
 */
export function verifySignature(secret: string | undefined, header: string | null, body: Buffer): boolean {
  const key = secret?.trim();
  if (!key) return false;
  const m = SIG.exec((header ?? "").trim());
  if (!m) return false;
  const given = Buffer.from(m[1], "hex");
  const expected = createHmac("sha256", key).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ------------------------------------------------------------------ the database half ---
export type ApplyCounts = { applied: number; duplicate: number; unmatched: number; ignored: number };

export type InboundDecision = {
  status: "ignored" | "duplicate" | "ok";
  reply: null | "stop" | "start" | "start_no" | "ticket" | "ticket_none" | "help";
  ticket?: { event_id?: string; title?: string; slug?: string | null; starts_at?: string; timezone?: string | null; venue_name?: string | null };
  why?: string;
};

export interface WaBotDb {
  /** Logs the message by id, does what the keyword says, and says which reply (if any) to send. Idempotent by message id. */
  inbound(msgId: string, number: string, keyword: Keyword): Promise<InboundDecision>;
  /** A reply went out: log it so Meta's pricing for it can be matched. */
  recordReply(messageId: string): Promise<void>;
  applyStatuses(events: WaStatusEvent[]): Promise<ApplyCounts>;
}

export function supabaseWaDb(sb: SupabaseClient): WaBotDb {
  return {
    async inbound(msgId, number, keyword) {
      const { data, error } = await sb.rpc("notify_wa_inbound", { p_msg: msgId, p_number: `+${number}`, p_keyword: keyword });
      if (error) throw new Error(`notify_wa_inbound: ${error.message}`);
      const d = obj(data);
      const reply = str(d.reply);
      return {
        status: d.status === "ok" || d.status === "duplicate" ? d.status : "ignored",
        reply: (["stop", "start", "start_no", "ticket", "ticket_none", "help"] as const).find((r) => r === reply) ?? null,
        ticket: d.ticket && typeof d.ticket === "object" ? (d.ticket as InboundDecision["ticket"]) : undefined,
        why: str(d.why) || undefined,
      };
    },
    async recordReply(messageId) {
      const { error } = await sb.rpc("notify_wa_record_reply", { p_message_id: messageId });
      if (error) throw new Error(`notify_wa_record_reply: ${error.message}`);
    },
    async applyStatuses(events) {
      const { data, error } = await sb.rpc("notify_wa_apply_statuses", { p_events: events });
      if (error) throw new Error(`notify_wa_apply_statuses: ${error.message}`);
      const d = obj(data);
      const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
      return { applied: n("applied"), duplicate: n("duplicate"), unmatched: n("unmatched"), ignored: n("ignored") };
    },
  };
}

// ------------------------------------------------------------------ the replies ---
/** The words of a reply. null: nothing to say (a ticket with no event in it is not sent as a blank). */
export function replyText(d: InboundDecision, now: Date = new Date(), site?: string): string | null {
  switch (d.reply) {
    case "stop":
      return WA_STOP_DONE;
    case "start":
      return WA_START_DONE;
    case "start_no":
      return WA_START_NO;
    case "ticket_none":
      return WA_TICKET_NONE;
    case "help":
      return WA_HELP;
    case "ticket": {
      const t = d.ticket;
      if (!t || (!t.slug && !t.event_id)) return WA_TICKET_NONE;
      const title = oneLine(t.title || "your event", 80);
      const when = formatWhen(t.starts_at, t.timezone, now);
      return `Your next ticket: ${title}${when ? `, ${when}` : ""}. ${eventUrl({ slug: t.slug ?? "", event_id: t.event_id ?? "" }, siteBase(site))}`;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ the requests ---
const headers = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers });

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * GET: Meta's setup check. Answers the challenge as plain text when hub.mode is subscribe and the token is WHATSAPP_VERIFY_TOKEN; else 403.
 * With the token unset nobody passes. The challenge is echoed only if it is plain letters, digits, - and _ (Meta sends a number).
 */
export function handleVerify(req: Request, env: Env = process.env): Response {
  const expected = env.WHATSAPP_VERIFY_TOKEN?.trim();
  let q: URLSearchParams;
  try {
    q = new URL(req.url).searchParams;
  } catch {
    return reply(400, { error: "Bad address" });
  }
  const given = q.get("hub.verify_token") ?? "";
  const challenge = q.get("hub.challenge") ?? "";
  if (!expected || q.get("hub.mode") !== "subscribe" || !same(expected, given)) return reply(403, { error: "Not allowed" });
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return reply(400, { error: "Bad challenge" });
  return new Response(challenge, { status: 200, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export type WebhookDeps = {
  env?: Env;
  /** null: no database configured. */
  db: WaBotDb | null;
  /** null: replies cannot be sent (WhatsApp is not set up); STOP and START are still acted on. */
  sender: WhatsAppSender | null;
  /** Runs the replies after the 200 has gone back. Default: now, awaited. */
  schedule?: (work: () => Promise<void>) => void;
  now?: () => Date;
  log?: (line: string) => void;
};

const MAX_BODY = 5_000_000;

/**
 * One POST from Meta. 503 if WHATSAPP_APP_SECRET is not set (nothing is read or done), 401 for a missing or wrong signature (before the body
 * is parsed), 413 too large, 400 not JSON, 503 no database, 500 if the database fails (Meta then sends it again: replays are harmless),
 * 200 once handled. Status updates go to the send log; a text message from a guest becomes at most one reply, sent after the 200.
 */
export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const secret = env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) return reply(503, { error: "Not configured" });
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifySignature(secret, req.headers.get("x-hub-signature-256"), raw)) return reply(401, { error: "Not allowed" });
  if (raw.length > MAX_BODY) return reply(413, { error: "Too large" });
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return reply(400, { error: "Not JSON" });
  }
  const parsed = parseWebhook(body);
  if (!parsed.messages.length && !parsed.statuses.length) return reply(200, { ok: true, messages: 0, statuses: 0 });
  if (!deps.db) return reply(503, { error: "Not configured" });
  const db = deps.db;
  const now = deps.now ?? (() => new Date());

  const todo: { to: string; text: string }[] = [];
  let counts: ApplyCounts | null = null;
  try {
    if (parsed.statuses.length) counts = await db.applyStatuses(parsed.statuses);
    for (const m of parsed.messages) {
      const decision = await db.inbound(m.id, m.from, matchKeyword(m.text));
      const text = decision.status === "ok" ? replyText(decision, now()) : null;
      if (text) todo.push({ to: `+${m.from}`, text });
    }
  } catch (e) {
    log(`[hoppaz] whatsapp webhook failed: ${scrub((e as Error).message).slice(0, 200)}`);
    return reply(500, { error: "Could not apply" });
  }

  const send = async () => {
    const sender = deps.sender;
    if (!sender) {
      if (todo.length) log(`[hoppaz] whatsapp: ${todo.length} replies not sent, no sender is set up`);
      return;
    }
    for (const r of todo) {
      try {
        const res = await sender.sendText(r.to, r.text);
        if (res.ok) await (res.messageId === "unknown" ? Promise.resolve() : db.recordReply(res.messageId)).catch((e) => log(`[hoppaz] whatsapp: reply to ${maskNumber(r.to)} sent but not logged: ${scrub((e as Error).message).slice(0, 120)}`));
        else log(`[hoppaz] whatsapp: reply to ${maskNumber(r.to)} failed: ${scrub(res.error).slice(0, 160)}`);
      } catch (e) {
        log(`[hoppaz] whatsapp: reply to ${maskNumber(r.to)} failed: ${scrub((e as Error).message).slice(0, 120)}`);
      }
    }
  };
  if (todo.length) {
    if (deps.schedule) deps.schedule(send);
    else await send();
  }
  return reply(200, { ok: true, messages: parsed.messages.length, statuses: parsed.statuses.length, replies: todo.length, ...(counts ?? {}) });
}
