import { createHash, timingSafeEqual } from "node:crypto";
import { obj, str } from "./mailcommon";

/**
 * What Brevo and Mailjet tell us after a send (their webhooks), read into one shape. Pure: no network, no database. The route is
 * src/app/api/notify/hook/[provider]/route.ts; the database half is notify_apply_events in supabase/events_r1_notify_prefs.sql.
 * Server only. Checked against the providers' own docs (links below); nothing here has ever received a real webhook.
 *
 * BREVO (https://developers.brevo.com/docs/transactional-webhooks)
 *   One JSON object per POST, or a batch if the webhook was made with batched=true (an array; the docs do not show the batch wrapper, so a bare
 *   array and { events: [...] } are both read). Fields: event, email, message-id, X-Mailin-custom, reason, tags, ts_event.
 *   event: request, delivered, deferred, soft_bounce, hard_bounce, invalid_email, blocked, spam, opened, click, unsubscribed, error, ...
 *   We keep delivered, hard_bounce, invalid_email (the address cannot receive: hard), soft_bounce, blocked (Brevo refused to send: soft, it
 *   tells us nothing new about the address), spam (a complaint). Brevo does NOT echo our X-Hoppaz-Queue header; it does echo X-Mailin-custom,
 *   which brevo.ts sets to the queue id. The message id of a webhook may lack the <angle brackets> the Send API returned: the database compares without them.
 *   Authentication: Brevo can send an Authorization: Bearer token (the "auth" field of Create a webhook), or take basic auth in the URL
 *   (https://user:password@host/...). It signs nothing.
 * MAILJET (https://dev.mailjet.com/docs/email-api/webhooks/event-types)
 *   One JSON object per POST; with "Group Events" on (eventcallbackurl version 2) an array. Fields: event, time, MessageID, Message_GUID,
 *   email, CustomID (the queue id, set by mailjet.ts), Payload, and per event: hard_bounce, blocked, error_related_to, error, comment (bounce),
 *   error_related_to, error (blocked), source (spam).
 *   event: sent, open, click, bounce, spam, blocked, unsub. Mailjet has no "delivered" event: "sent" means the recipient's server accepted it, so
 *   that is our delivered. bounce: hard when hard_bounce is true. blocked: hard only for the errors that mean the address does not exist
 *   (user unknown, invalid domain, mailbox inactive), else soft. spam is a complaint.
 *   Authentication: Mailjet signs nothing and has no token; its docs show basic auth in the URL (https://user:password@host/...).
 *   Retries: any answer but 200 is retried every 30 seconds for 24 hours.
 * So the secret may arrive as a bearer token, as the password of basic auth, or as ?key= in the address (a URL is free text to both providers).
 */

export const HOOK_PROVIDERS = ["brevo", "mailjet"] as const;
export type HookProvider = (typeof HOOK_PROVIDERS)[number];
export const isHookProvider = (p: string): p is HookProvider => (HOOK_PROVIDERS as readonly string[]).includes(p);

/** What the database takes (notify_apply_events). */
export type HookEvent = {
  event: "delivered" | "bounced" | "complained";
  message_id: string | null;
  /** Our own queue row, handed back by the provider (Brevo X-Mailin-custom, Mailjet CustomID). */
  queue_id: string | null;
  /** The address the event is about, lower case. */
  address: string | null;
  /** For bounced: the address is dead. */
  hard: boolean;
  reason: string | null;
};

/** No more than this many events are read from one request. */
export const MAX_EVENTS = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asList = (body: unknown): Record<string, unknown>[] => {
  const raw = Array.isArray(body) ? body : Array.isArray(obj(body).events) ? (obj(body).events as unknown[]) : [body];
  return raw.slice(0, MAX_EVENTS).map(obj);
};

const address = (v: unknown): string | null => {
  const s = str(v).trim().toLowerCase();
  return s.length >= 3 && s.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(s) ? s : null;
};

const queueId = (v: unknown): string | null => {
  const s = str(v).trim();
  return UUID.test(s) ? s.toLowerCase() : null;
};

const text = (v: unknown, max = 200): string | null => {
  const s = str(v).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const flag = (v: unknown): boolean => v === true || (typeof v === "string" && v.toLowerCase() === "true") || v === 1 || v === "1";

const norm = (v: unknown) => str(v).toLowerCase().replace(/[^a-z]/g, "");

export function parseBrevo(body: unknown): HookEvent[] {
  const out: HookEvent[] = [];
  for (const e of asList(body)) {
    const name = norm(e.event);
    const base = { message_id: text(e["message-id"], 200), queue_id: queueId(e["X-Mailin-custom"]), address: address(e.email), reason: text(e.reason) };
    if (name === "delivered") out.push({ ...base, event: "delivered", hard: false });
    else if (name === "hardbounce" || name === "invalidemail") out.push({ ...base, event: "bounced", hard: true, reason: base.reason ?? (name === "invalidemail" ? "invalid email" : null) });
    else if (name === "softbounce") out.push({ ...base, event: "bounced", hard: false });
    else if (name === "blocked") out.push({ ...base, event: "bounced", hard: false, reason: base.reason ?? "blocked" });
    else if (name === "spam") out.push({ ...base, event: "complained", hard: false });
  }
  return out;
}

/** The Mailjet errors that mean the address does not exist (docs: "values for errors"). */
const MAILJET_DEAD = /user unknown|invalid domain|mailbox inactive/i;

export function parseMailjet(body: unknown): HookEvent[] {
  const out: HookEvent[] = [];
  for (const e of asList(body)) {
    const name = norm(e.event);
    const why = [str(e.error_related_to), str(e.error)].filter(Boolean).join(": ");
    const base = { message_id: text(e.MessageID, 200), queue_id: queueId(e.CustomID), address: address(e.email), reason: text(why) ?? text(e.comment) };
    if (name === "sent") out.push({ ...base, event: "delivered", hard: false, reason: null });
    else if (name === "bounce") out.push({ ...base, event: "bounced", hard: flag(e.hard_bounce) });
    else if (name === "blocked") out.push({ ...base, event: "bounced", hard: MAILJET_DEAD.test(why), reason: base.reason ?? "blocked" });
    else if (name === "spam") out.push({ ...base, event: "complained", hard: false, reason: text(e.source) ?? base.reason });
  }
  return out;
}

export function parseHook(provider: HookProvider, body: unknown): HookEvent[] {
  return provider === "brevo" ? parseBrevo(body) : parseMailjet(body);
}

// ------------------------------------------------------------------ who may call ---
type Env = Record<string, string | undefined>;

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** A secret shorter than this is treated as not set. */
export const MIN_HOOK_SECRET = 16;

/**
 * Accepts NOTIFY_HOOK_SECRET as a bearer token (Brevo), as the password of basic auth (Brevo and Mailjet put user:password in the URL),
 * or as ?key= in the address. Constant time. With the secret unset, or too short, nobody gets in.
 */
export function hookAllowed(req: Request, env: Env = process.env): boolean {
  const secret = env.NOTIFY_HOOK_SECRET?.trim();
  if (!secret || secret.length < MIN_HOOK_SECRET) return false;
  const given: string[] = [];
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) given.push(bearer[1].trim());
  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
    const at = decoded.indexOf(":");
    given.push(at >= 0 ? decoded.slice(at + 1) : decoded);
  }
  try {
    const key = new URL(req.url).searchParams.get("key");
    if (key) given.push(key);
  } catch {
    // an address we cannot read has no key
  }
  let ok = false;
  for (const g of given) if (same(secret, g)) ok = true;
  return ok;
}

// ------------------------------------------------------------------ the request ---
export type ApplyCounts = { applied: number; duplicate: number; unmatched: number; ignored: number };

export type HookDeps = {
  env?: Env;
  /** Hands the events to notify_apply_events. Throws on a database error. null: no database configured. */
  apply: ((provider: HookProvider, events: HookEvent[]) => Promise<ApplyCounts>) | null;
};

const MAX_BODY = 1_000_000;

/** Anything shaped like an address becomes ***, so a log line never holds one. */
export const noAddress = (t: string): string => t.replace(/[^\s<>"',;]+@[^\s<>"',;]+/g, "***");
const headers = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers });

/**
 * One webhook call, start to finish. 404 for a provider we do not serve, 401 for a wrong or missing secret (checked before the body is
 * read), 400 for a body that is not JSON, 503 when no database is configured, 500 when the database fails (so the provider tries again),
 * and 200 once it is handled. A body with nothing we keep (opens, clicks) is handled: 200. Never writes an email address anywhere.
 */
export async function handleHook(req: Request, providerName: string, deps: HookDeps): Promise<Response> {
  if (!isHookProvider(providerName)) return reply(404, { error: "Unknown provider" });
  if (!hookAllowed(req, deps.env ?? process.env)) return reply(401, { error: "Not allowed" });
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "Too large" });
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Not JSON" });
  }
  const events = parseHook(providerName, body);
  if (!events.length) return reply(200, { ok: true, received: 0 });
  if (!deps.apply) return reply(503, { error: "Not configured" });
  try {
    const counts = await deps.apply(providerName, events);
    return reply(200, { ok: true, received: events.length, ...counts });
  } catch (e) {
    // The message is the database's own and holds no address. Answer 500 so the provider sends it again.
    console.warn(`[hoppaz] notify: ${providerName} webhook failed:`, noAddress((e as Error).message).slice(0, 200));
    return reply(500, { error: "Could not apply" });
  }
}
