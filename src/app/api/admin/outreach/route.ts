import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getMailer } from "@/lib/events-r1/outreach/mailer";
import { outreachReason, outreachStatus } from "@/lib/events-r1/real/reasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The staff desk for the outreach flow (docs/OUTREACH-FLOW.md): the review queue, organisers, transfer links, the week and the scout import.
 * Guarded like the rest of the desk: Authorization: Bearer $HOPPAZ_ADMIN_TOKEN (timing safe). The ev_o_* functions are service-role only
 * (supabase/events_r1_outreach.sql, events_r1_transfer.sql), so they are called here with the service key.
 *
 *   GET  ?what=organisers | queue | claims | week      -> { ok: true, data }
 *   GET  ?what=organiser&id=<uuid>                      -> { ok: true, data: OrganiserDetail }
 *   POST { action, ...args }                            -> { ok: true, data, ...extra }
 *
 * Actions (args): approve { pulled, by, patch? } -> { eventId, organiserId } | edit { pulled, patch } | reject { pulled, by, reason? }
 *   | merge { pulled, into, by } | import { batch, dryRun } -> ImportReport (also under "report")
 *   | save_organiser { id, patch } | log_contact { id, by, kind, channel?, body } | set_stage { id, stage, by }
 *   | delete_listing { id, confirm, by } -> { events } | create_transfer { id, email, by, days? } -> data { transfer, link } and mail_connected
 *   | revoke_transfer { id, by } | handle_claim_request { id, by }
 *   | flyer { source_site, source_id, jpeg_base64 } -> { url } (also top level)
 *   | the reads above by name ({ action: "queue" }, "organisers", "organiser" with id, "claims", "week").
 * create_transfer makes the token here; only its sha256 hex is stored. The link is in the answer once and never logged.
 *
 * Answers when it says no: { ok: false, error, message } with 401 (no token), 400 (bad input), 404 (not found), 409 (a conflict such as
 * has_registrations or already_pending), 413 (too big), 429, 503 (not set up).
 */
const authorized = (req: Request) => {
  const secret = process.env.HOPPAZ_ADMIN_TOKEN ?? "";
  const received = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !received) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

const noStore = { "Cache-Control": "no-store" };
const refuse = (error: string, message: string, status: number) => NextResponse.json({ ok: false, error, message }, { status, headers: noStore });
const ok = (data: unknown, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, data, ...extra }, { headers: noStore });
const bad = (message: string) => refuse("bad_args", message, 400);

/* ------------------------------------------------------------ validation -- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY = 6 * 1024 * 1024;
const MAX_JPEG = 3 * 1024 * 1024;
const MAX_BATCH_EVENTS = 500;

type Obj = Record<string, unknown>;
type Check<T> = { value: T } | { error: string };
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const failed = <T,>(c: Check<T>): c is { error: string } => "error" in c;

/** A check that said no: the answer is a 400 with its words. */
class Bad extends Error {}
const need = <T,>(c: Check<T>): T => {
  if (failed(c)) throw new Bad(c.error);
  return c.value;
};

const uuidOf = (v: unknown, what: string): Check<string> => (typeof v === "string" && UUID.test(v) ? { value: v.toLowerCase() } : { error: `Send a valid ${what}` });

/** Text of a length, trimmed, no control characters. */
function text(v: unknown, what: string, min: number, max: number): Check<string> {
  if (typeof v !== "string") return { error: `Send ${what}` };
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (s.length < min) return { error: `${what} is needed` };
  if (s.length > max) return { error: `${what} is too long (up to ${max})` };
  return { value: s };
}
const textOrNull = (v: unknown, what: string, max: number): Check<string | null> => (v === null || v === "" ? { value: null } : text(v, what, 1, max));

function emailOf(v: unknown): Check<string> {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s.length <= 254 && EMAIL.test(s) ? { value: s } : { error: outreachReason("bad_email") };
}

function httpsUrl(v: unknown, what: string): Check<string | null> {
  if (v === null || v === "") return { value: null };
  if (typeof v !== "string" || v.length > 500) return { error: `Check ${what}` };
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? { value: u.toString() } : { error: `Check ${what}` };
  } catch {
    return { error: `Check ${what}` };
  }
}

function isoOrNull(v: unknown, what: string): Check<string | null> {
  if (v === null || v === "") return { value: null };
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return { error: `Check ${what}` };
  return { value: v };
}

const by = (v: unknown): Check<string> => (v === undefined || v === null || v === "" ? { value: "Staff" } : text(v, "Your name", 1, 60));

/** What the desk may change on a pulled row: PulledPatch. Only the keys sent come through. */
function pulledPatch(v: unknown): Check<Obj> {
  if (v === undefined || v === null) return { value: {} };
  if (!isObj(v)) return { error: "Send the changes as an object" };
  const out: Obj = {};
  const put = <T,>(key: string, c: Check<T>): string | null => {
    if (failed(c)) return c.error;
    out[key] = c.value;
    return null;
  };
  for (const [k, raw] of Object.entries(v)) {
    let err: string | null = null;
    switch (k) {
      case "name": err = put(k, text(raw, "The name", 1, 160)); break;
      case "starts_at": case "ends_at": err = put(k, isoOrNull(raw, "the time")); break;
      case "venue": case "area": case "category": case "organiser_name": case "organiser_handle": err = put(k, textOrNull(raw, k.replace("_", " "), 160)); break;
      case "description": err = put(k, typeof raw === "string" && raw.length <= 8000 ? { value: raw } : { error: "The description is too long" }); break;
      case "lat": err = put(k, raw === null || (typeof raw === "number" && raw >= -90 && raw <= 90) ? { value: raw } : { error: "Check the pin" }); break;
      case "lng": err = put(k, raw === null || (typeof raw === "number" && raw >= -180 && raw <= 180) ? { value: raw } : { error: "Check the pin" }); break;
      case "sold_out": err = put(k, typeof raw === "boolean" ? { value: raw } : { error: "Check sold out" }); break;
      case "ticket_url": case "flyer_url": err = put(k, httpsUrl(raw, k.replace("_", " "))); break;
      case "tickets": {
        if (!Array.isArray(raw) || raw.length > 20) { err = "Up to 20 ticket types"; break; }
        const tickets: Obj[] = [];
        for (const t of raw) {
          const n = isObj(t) ? text(t.name, "A ticket name", 1, 80) : { error: "Check the tickets" };
          if (failed(n)) { err = n.error; break; }
          const p = (t as Obj).price_naira;
          if (p !== null && !(typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 100_000_000)) { err = "A price must be a whole number"; break; }
          tickets.push({ name: n.value, price_naira: p, sold_out: (t as Obj).sold_out === true });
        }
        if (!err) out.tickets = tickets;
        break;
      }
      default: err = `Cannot change ${k}`;
    }
    if (err) return { error: err };
  }
  return { value: out };
}

const HANDLE_KEYS = ["instagram", "x", "tiktok", "website", "whatsapp"];
/** OrganiserPatch. */
function organiserPatch(v: unknown): Check<Obj> {
  if (!isObj(v)) return { error: "Send the changes as an object" };
  const out: Obj = {};
  for (const [k, raw] of Object.entries(v)) {
    switch (k) {
      case "name": { const c = text(raw, "The name", 1, 120); if (failed(c)) return c; out.name = c.value; break; }
      case "ig_handle": { const c = textOrNull(raw, "The handle", 60); if (failed(c)) return c; out.ig_handle = c.value; break; }
      case "phone": { const c = textOrNull(raw, "The phone", 40); if (failed(c)) return c; out.phone = c.value; break; }
      case "email": { if (raw === null || raw === "") { out.email = null; break; } const c = emailOf(raw); if (failed(c)) return c; out.email = c.value; break; }
      case "notes": { if (typeof raw !== "string" || raw.length > 4000) return { error: "Keep the notes under 4000 characters" }; out.notes = raw; break; }
      case "do_not_contact": { if (typeof raw !== "boolean") return { error: "Check do not contact" }; out.do_not_contact = raw; break; }
      case "handles": {
        if (!isObj(raw)) return { error: "Check the handles" };
        const h: Obj = {};
        for (const [hk, hv] of Object.entries(raw)) {
          if (!HANDLE_KEYS.includes(hk)) return { error: `Cannot save ${hk}` };
          if (hv === null || hv === "") continue;
          const c = text(hv, "A handle", 1, 200);
          if (failed(c)) return c;
          h[hk] = c.value;
        }
        out.handles = h;
        break;
      }
      default: return { error: `Cannot change ${k}` };
    }
  }
  return { value: out };
}

/** The scout's batch. The SQL skips one bad event with a note; here only the shape that would break the call is checked. */
function batchOf(v: unknown): Check<Obj> {
  if (!isObj(v)) return { error: "Send the batch" };
  const run = text(v.run_id, "run_id", 1, 120);
  if (failed(run)) return run;
  if (typeof v.scouted_at !== "string" || !Number.isFinite(Date.parse(v.scouted_at))) return { error: "Check scouted_at" };
  if (!Array.isArray(v.sources_covered) || v.sources_covered.length > 40 || v.sources_covered.some((s) => typeof s !== "string" || s.length > 60)) return { error: "Check sources_covered" };
  if (!Array.isArray(v.events) || v.events.length > MAX_BATCH_EVENTS) return { error: `Up to ${MAX_BATCH_EVENTS} events in a batch` };
  for (const [i, e] of v.events.entries()) {
    if (!isObj(e) || typeof e.source_site !== "string" || !e.source_site || e.source_site.length > 60 || typeof e.source_id !== "string" || !e.source_id || e.source_id.length > 200 || typeof e.name !== "string") {
      return { error: `Event ${i + 1}: check source_site, source_id and name` };
    }
  }
  return { value: v as Obj };
}

/* ------------------------------------------------------------ database -- */

type Rpc = { data: unknown; error: { message: string; code?: string } | null };

const notThere = (e: { message: string; code?: string }) => e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message);

/** Call a service function. A "no" from the function ({ ok: false, reason }) or a database error becomes the refusal; otherwise the data. */
async function call(sb: SupabaseClient, action: string, fn: string, args: Obj): Promise<{ data: unknown } | { response: NextResponse }> {
  const { data, error } = (await sb.rpc(fn, args)) as Rpc;
  if (error) {
    // The message of a database error never holds the arguments, but the transfer hash and the link are not logged anywhere here either way.
    console.error(`[outreach] ${action}: ${error.code ?? ""} ${error.message}`);
    if (notThere(error)) return { response: refuse("not_configured", "The outreach tools are not set up in the database yet", 503) };
    return { response: refuse("failed", "That did not work. Try again", 500) };
  }
  if (isObj(data) && data.ok === false) {
    const reason = String(data.reason ?? "failed");
    return { response: refuse(reason, outreachReason(reason, data as Parameters<typeof outreachReason>[1]), outreachStatus(reason)) };
  }
  return { data };
}

/** The reads (GET and POST). */
async function read(sb: SupabaseClient, what: string, id: unknown): Promise<NextResponse> {
  let r;
  switch (what) {
    case "organisers": r = await call(sb, what, "ev_o_organisers", {}); break;
    case "queue": r = await call(sb, what, "ev_o_queue", {}); break;
    case "claims": r = await call(sb, what, "ev_o_claim_requests", {}); break;
    case "week": r = await call(sb, what, "ev_o_week", {}); break;
    case "organiser": {
      const c = uuidOf(id, "organiser id");
      if (failed(c)) return bad(c.error);
      r = await call(sb, what, "ev_o_organiser", { p_id: c.value });
      break;
    }
    default: return bad("Ask for organisers, queue, claims, week or organiser");
  }
  return "response" in r ? r.response : ok(r.data ?? (what === "week" ? {} : []));
}

/* ------------------------------------------------------------- flyers -- */

const BUCKET = "event-flyers";
let bucketReady = false;

async function ensureBucket(sb: SupabaseClient): Promise<boolean> {
  if (bucketReady) return true;
  const have = await sb.storage.getBucket(BUCKET);
  if (have.error) {
    const made = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_JPEG, allowedMimeTypes: ["image/jpeg"] });
    if (made.error && !/already exists|duplicate/i.test(made.error.message)) return false;
  }
  bucketReady = true;
  return true;
}

const slugPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function flyer(sb: SupabaseClient, body: Obj): Promise<NextResponse> {
  const site = typeof body.source_site === "string" ? slugPart(body.source_site) : "";
  const sid = typeof body.source_id === "string" ? slugPart(body.source_id) : "";
  if (!site || !sid) return bad("Send source_site and source_id");
  if (typeof body.jpeg_base64 !== "string" || !body.jpeg_base64) return bad("Send the picture as jpeg_base64");
  const raw = body.jpeg_base64.replace(/^data:image\/jpeg;base64,/i, "");
  if (raw.length > Math.ceil((MAX_JPEG * 4) / 3) + 8) return refuse("too_big", "That picture is over 3 MB", 413);
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return bad("The picture is not valid base64");
  const buf = Buffer.from(raw, "base64");
  if (buf.length > MAX_JPEG) return refuse("too_big", "That picture is over 3 MB", 413);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return bad("The picture must be a JPEG");
  if (!(await ensureBucket(sb))) return refuse("not_configured", "The flyer storage is not set up", 503);
  const path = `scout/${site}-${sid}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true, cacheControl: "604800" });
  if (up.error) {
    console.error(`[outreach] flyer: ${up.error.message}`);
    return refuse("failed", "Could not save the picture", 500);
  }
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return ok({ url }, { url });
}

/* ---------------------------------------------------------------- routes -- */

const siteOf = (req: Request) => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "") || new URL(req.url).origin;
const STAGES = ["offered", "declined", "listed"];
const KINDS = ["contact", "reply", "note"];
const CHANNELS = ["instagram", "whatsapp", "email", "phone", "other"];

export async function GET(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  const q = new URL(req.url).searchParams;
  return read(sb, q.get("what") ?? "", q.get("id"));
}

export async function POST(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return refuse("too_big", "That is too big to send", 413);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  if (!isObj(parsed) || typeof parsed.action !== "string") return bad("Send { action, ... }");
  const b = parsed;
  const action = b.action as string;

  if (["queue", "organisers", "organiser", "claims", "week"].includes(action)) return read(sb, action, b.id);
  if (action === "flyer") return flyer(sb, b);

  /** Run a service function with the checked args, then shape the data. */
  const run = async (fn: string, args: Obj, shape: (data: unknown) => NextResponse = (d) => ok(d)): Promise<NextResponse> => {
    const r = await call(sb, action, fn, args);
    return "response" in r ? r.response : shape(r.data);
  };

  try {
    switch (action) {
      case "approve": {
        const pulled = need(uuidOf(b.pulled, "pulled id")), who = need(by(b.by)), patch = need(pulledPatch(b.patch));
        return await run("ev_o_approve", { p_pulled: pulled, p_by: who, p_patch: patch }, (d) => {
          const o = isObj(d) ? d : {};
          return ok({ eventId: String(o.event_id ?? ""), organiserId: String(o.organiser_id ?? "") });
        });
      }
      case "edit": {
        const pulled = need(uuidOf(b.pulled, "pulled id")), patch = need(pulledPatch(b.patch));
        return await run("ev_o_edit", { p_pulled: pulled, p_patch: patch }, (d) => ok(isObj(d) && isObj(d.pulled) ? d.pulled : d));
      }
      case "reject": {
        const pulled = need(uuidOf(b.pulled, "pulled id")), who = need(by(b.by));
        const why = b.reason === undefined || b.reason === null || b.reason === "" ? "" : need(text(b.reason, "The reason", 1, 500));
        return await run("ev_o_reject", { p_pulled: pulled, p_by: who, p_reason: why });
      }
      case "merge": {
        const pulled = need(uuidOf(b.pulled, "pulled id")), into = need(uuidOf(b.into, "target id")), who = need(by(b.by));
        if (pulled === into) return bad("Pick a different row to fold into");
        return await run("ev_o_merge", { p_pulled: pulled, p_into: into, p_by: who });
      }
      case "import": {
        const batch = need(batchOf(b.batch));
        const dry = b.dryRun ?? b.dry_run;
        if (typeof dry !== "boolean") return bad("Send dryRun true or false");
        return await run("ev_o_import", { p_batch: batch, p_apply: !dry }, (d) => ok(d, { report: d }));
      }
      case "save_organiser": {
        const id = need(uuidOf(b.id, "organiser id")), patch = need(organiserPatch(b.patch));
        return await run("ev_o_save_organiser", { p_id: id, p_patch: patch });
      }
      case "log_contact": {
        const id = need(uuidOf(b.id, "organiser id")), who = need(by(b.by)), body = need(text(b.body, "The note", 1, 2000));
        if (typeof b.kind !== "string" || !KINDS.includes(b.kind)) return bad("Pick contact, reply or note");
        const channel = b.channel === undefined || b.channel === null || b.channel === "" ? null : b.channel;
        if (channel !== null && (typeof channel !== "string" || !CHANNELS.includes(channel))) return bad("Pick a channel");
        return await run("ev_o_log", { p_id: id, p_by: who, p_kind: b.kind, p_channel: channel, p_body: body });
      }
      case "set_stage": {
        const id = need(uuidOf(b.id, "organiser id")), who = need(by(b.by));
        if (typeof b.stage !== "string" || !STAGES.includes(b.stage)) return bad("Pick offered, declined or listed");
        return await run("ev_o_set_stage", { p_id: id, p_stage: b.stage, p_by: who });
      }
      case "delete_listing": {
        const id = need(uuidOf(b.id, "organiser id")), who = need(by(b.by)), confirm = need(text(b.confirm, "The organiser name", 1, 120));
        return await run("ev_o_delete", { p_id: id, p_confirm: confirm, p_by: who }, (d) => {
          const o = isObj(d) ? d : {};
          const n = Array.isArray(o.events) ? o.events.length : Number(o.events ?? o.deleted_events ?? 0) || 0;
          return ok({ events: n });
        });
      }
      case "create_transfer": {
        const id = need(uuidOf(b.id, "organiser id")), email = need(emailOf(b.email)), who = need(by(b.by));
        const days = b.days === undefined || b.days === null ? 14 : b.days;
        if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 60) return bad("Days must be 1 to 60");
        // The token lives here only. The database keeps its sha256; the link goes back once and is never logged.
        const token = randomBytes(32).toString("base64url");
        const hash = createHash("sha256").update(token).digest("hex");
        return await run("ev_o_transfer_create", { p_org: id, p_email: email, p_hash: hash, p_days: days, p_by: who }, (d) => {
          const transfer = isObj(d) ? d.transfer : null;
          const link = `${siteOf(req)}/claim/${token}`;
          return ok({ transfer, link }, { transfer, link, mail_connected: getMailer().connected });
        });
      }
      case "revoke_transfer": {
        const id = need(uuidOf(b.id, "transfer id")), who = need(by(b.by));
        return await run("ev_o_transfer_revoke", { p_id: id, p_by: who });
      }
      case "handle_claim_request": {
        const id = need(uuidOf(b.id, "request id")), who = need(by(b.by));
        return await run("ev_o_handle_claim_request", { p_id: id, p_by: who });
      }
      default:
        return bad("Unknown action");
    }
  } catch (e) {
    if (e instanceof Bad) return bad(e.message);
    console.error(`[outreach] ${action}: ${e instanceof Error ? e.message : "failed"}`);
    return refuse("failed", "That did not work. Try again", 500);
  }
}
