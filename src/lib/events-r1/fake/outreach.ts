/**
 * Fake outreach (the staff desk) and claims (the organiser side). It is the executable spec of the SQL in events_r1_outreach.sql and
 * events_r1_transfer.sql: the same rules, the same reasons, the same texts (OUTREACH_REASONS, plus the few in outreach/reasons.ts).
 *
 * Every change that touches more than one record runs in transaction(): the touched collections are copied, the steps run on the copies,
 * and only when every step passed do the copies become the live state. A failed step, or a dry run, leaves the state untouched.
 */
import type { ClaimsApi, OutreachApi } from "../api";
import { eventClaimsOn, openOrganiserRoomsOn } from "../flags";
import { siteOrigin } from "../siteUrl";
import { isBlocked, lagosDay, maskEmail, nameKey, normEmail, normHandle, normX, plainText, stageRefusal } from "../outreach/match";
import { fail, OutreachError } from "../outreach/reasons";
import { OUTREACH_REASONS } from "../types";
import { randomToken, sha256Hex } from "../outreach/token";
import type {
  AcceptOutcome, ApproveManyResult, Claimable, ClaimAsk, ClaimLink, ClaimRequest, ContactChannel, ImportLine, ImportReport, Organiser, OrganiserDetail, OrganiserLogEntry, OrganiserLogKind, OrganiserPatch,
  OrganiserStage, PulledEvent, PulledFlag, PulledPatch, RoomModeView, ScoutBatch, ScoutEvent, Transfer, TransferLink, TransferPreview, WeekSummary,
} from "../types";
import { listingFields, priceRange } from "./listingRec";
import { eventEnd, isExternal, isUnclaimed, joinModeOf, listingOrgOf, requireViewer, roleOf, statusOf } from "./rules";
import { emit, now, persist, S, viewer } from "./store";
import type { ClaimAskRec, ClaimLinkRec, EventRec, OrganiserRec, PulledRec, RoomRec, TransferRec } from "./store";
import { allTaps } from "./taps";
import { clone, DAY, newId, slugFor } from "./util";

const iso = (ms: number) => new Date(ms).toISOString();
const staffLabel = (by: string) => (by ?? "").trim().slice(0, 60) || "Staff";

/* ------------------------------------------------------------ transaction -- */

/** Everything a staff action or an accept can touch (a deleted event takes its pops, chat lines and so on with it). */
const TX = [
  "events", "rooms", "memberships", "roles", "joinedAt", "organisers", "organiserLog", "pulled", "transfers", "claimRequests", "regs", "tickets", "pops",
  "announcements", "messages", "lineups", "regSettings", "interest", "reports", "requests", "notices", "claimLinks", "claimAsks",
] as const;

/** Test seam (fakeDev.failAcceptAt): make one step of accept fail, to prove nothing is left half done. */
export const faults: { acceptStep: string | null } = { acceptStep: null };
const stepOf = (name: string) => {
  if (faults.acceptStep === name) throw new Error(`Step "${name}" failed`);
};

/**
 * Copy the collections, run fn on the copies, keep them only if fn returns (and commit is true). A throw puts the originals back.
 * fn must be synchronous: nothing else can run in between.
 */
function transaction<T>(fn: () => T, commit = true): T {
  const s = S() as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const c of TX) {
    saved[c] = s[c];
    s[c] = clone(s[c]);
  }
  let out: T;
  try {
    out = fn();
  } catch (e) {
    for (const c of TX) s[c] = saved[c];
    throw e;
  }
  if (!commit) for (const c of TX) s[c] = saved[c];
  return out;
}

/* ---------------------------------------------------------------- helpers -- */

function listingsUid(): string {
  const id = S().listingsUserId;
  if (!id || !S().users[id]) return fail("no_listings_account");
  return id;
}

function organiserRec(id: string): OrganiserRec {
  return S().organisers[id] ?? fail("not_found");
}

function logLine(orgId: string, kind: OrganiserLogKind, body: string, by: string | null, channel: ContactChannel | null = null): void {
  const id = newId();
  S().organiserLog[id] = { id, organiser_id: orgId, at: iso(now()), by, kind, channel, body: body.slice(0, 2000) };
}

const eventsOfOrganiser = (orgId: string): EventRec[] => Object.values(S().events).filter((e) => e.organiser_id === orgId);

/** Pending links past their date become expired. Saved quietly, like the fake pay sweep. */
function settleTransfers(): void {
  let changed = false;
  for (const t of Object.values(S().transfers)) {
    if (t.status === "pending" && Date.parse(t.expires_at) <= now()) {
      t.status = "expired";
      changed = true;
    }
  }
  if (changed) persist();
}

const transferView = (t: TransferRec): Transfer => {
  const { token_hash, attempts, accepted_by, ...rest } = t;
  void token_hash; void attempts; void accepted_by;
  return clone(rest);
};

const hasPending = (orgId: string): boolean => Object.values(S().transfers).some((t) => t.organiser_id === orgId && t.status === "pending" && Date.parse(t.expires_at) > now());

function organiserView(o: OrganiserRec): Organiser {
  const room = o.room_id ? S().rooms[o.room_id] : undefined;
  const evs = eventsOfOrganiser(o.id).filter((e) => e.status !== "cancelled");
  const { name_key, claimed_by, ...rest } = o;
  void name_key; void claimed_by;
  return {
    ...clone(rest),
    room_slug: room?.slug ?? null,
    room_name: room?.name ?? null,
    events_total: evs.length,
    events_upcoming: evs.filter((e) => eventEnd(e) > now()).length,
    pulled_waiting: Object.values(S().pulled).filter((p) => p.organiser_id === o.id && p.status === "new").length,
    transfer_pending: hasPending(o.id),
    claim_requests: Object.values(S().claimRequests).filter((c) => c.organiser_id === o.id && c.status === "new").length,
    last_replied_at: Object.values(S().organiserLog).filter((l) => l.organiser_id === o.id && l.kind === "reply").map((l) => l.at).sort().pop() ?? null,
  };
}

/* ------------------------------------------------------------ pulled rows -- */

const STICKY: PulledFlag[] = ["moved", "changed"];

function staticFlags(p: PulledRec): PulledFlag[] {
  const f = p.fields;
  const out: PulledFlag[] = [];
  if (priceRange(f.tickets ?? []).from === null) out.push("no_price");
  if (!f.starts_at) out.push("no_time");
  if (typeof f.lat !== "number" || typeof f.lng !== "number") out.push("no_pin");
  if (p.status === "blocked") out.push("blocked");
  if (p.duplicate_of) out.push("duplicate");
  if (p.missing_since) out.push("gone");
  return out;
}

/** Flags worked out from the row; moved and changed stay until staff approve again. */
function reflag(p: PulledRec, add: PulledFlag[] = [], clear: PulledFlag[] = []): void {
  const keep = p.flags.filter((x) => STICKY.includes(x) && !clear.includes(x));
  p.flags = [...new Set([...staticFlags(p), ...keep, ...add])];
}

function pulledView(p: PulledRec): PulledEvent {
  const { decided_at, reject_reason, ...rest } = p;
  void decided_at; void reject_reason;
  const o = p.organiser_id ? S().organisers[p.organiser_id] : undefined;
  return { ...clone(rest), organiser_name: o?.name ?? p.fields.organiser_name ?? null, organiser_stage: o?.stage ?? null };
}

function pulledRec(id: string): PulledRec {
  return S().pulled[id] ?? fail("not_found");
}

/** What a staff edit or a patch may carry, checked and cleaned. */
const PATCH_KEYS = [
  "name", "starts_at", "ends_at", "venue", "area", "lat", "lng", "description", "tickets", "sold_out", "ticket_url", "flyer_url", "category", "organiser_name", "organiser_handle",
  "organiser_x", "ticket_platform", "source_url", "flyer_credit",
] as const;

function cleanPatch(patch: PulledPatch | undefined): Partial<ScoutEvent> {
  const out: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) {
    if (!patch || !(k in patch) || patch[k] === undefined) continue;
    const v = patch[k] as unknown;
    if (k === "name") {
      const n = String(v ?? "").trim();
      if (!n || n.length > 120) throw new Error("Give the event a name under 120 characters");
      out[k] = n;
    } else if (k === "starts_at" || k === "ends_at") {
      if (v !== null && !Number.isFinite(Date.parse(String(v)))) throw new Error("Check the time");
      out[k] = v === null ? null : iso(Date.parse(String(v)));
    } else if (k === "lat" || k === "lng") {
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) throw new Error("Check the pin");
      out[k] = v;
    } else if (k === "tickets") {
      if (!Array.isArray(v)) throw new Error("Check the tickets");
      out[k] = v.map((t: { name?: string; price_naira?: number | null; sold_out?: boolean }) => {
        const p = t.price_naira ?? null;
        if (p !== null && (!Number.isInteger(p) || p < 0)) throw new Error("A price must be a whole number");
        return { name: String(t.name ?? "").trim() || "Ticket", price_naira: p, sold_out: !!t.sold_out };
      });
    } else if (k === "sold_out") out[k] = !!v;
    else if (k === "ticket_url" || k === "flyer_url") {
      const u = v === null ? "" : String(v).trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error("Paste a full link that starts with https://");
      out[k] = u || null;
    } else if (k === "organiser_handle") out[k] = v === null ? null : (normHandle(String(v)) ?? String(v).trim());
    else if (k === "organiser_x") {
      const x = v === null || String(v).trim() === "" ? null : normX(String(v));
      if (v !== null && String(v).trim() !== "" && !x) throw new Error("Check the X handle");
      out[k] = x;
    } else if (k === "ticket_platform") out[k] = plainText(v === null ? null : String(v), 40);
    else if (k === "flyer_credit") out[k] = plainText(v === null ? null : String(v), 80);
    else if (k === "source_url") {
      const u = v === null ? "" : String(v).trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error("Paste a full link that starts with https://");
      out[k] = u || null;
    } else out[k] = v === null ? null : String(v).trim();
  }
  return out as Partial<ScoutEvent>;
}

const UPDATABLE: Array<keyof EventRec> = [
  "starts_at", "ends_at", "price_naira", "listed_price", "listed_price_max", "listing_sold_out", "ticket_url", "ig_url", "instagram_url", "flyer_url",
  "ticket_platform", "source_url", "flyer_credit",
];

/** Put a pulled row's values on its live listing: every field (staff edit, approve) or only what a rescrape may change. */
function syncEvent(ev: EventRec, f: ScoutEvent, all: boolean): void {
  const next = listingFields(f) as Record<string, unknown>;
  const keys = all ? Object.keys(next) : (UPDATABLE as string[]);
  for (const k of keys) (ev as unknown as Record<string, unknown>)[k] = next[k];
}

function sameScout(a: ScoutEvent, b: ScoutEvent): boolean {
  const strip = (x: ScoutEvent) => JSON.stringify({ ...x, last_seen: "" });
  return strip(a) === strip(b);
}

/* ------------------------------------------------------------- organisers -- */

function freeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "") || "room";
  const taken = (s: string) => Object.values(S().rooms).some((r) => r.slug === s);
  let slug = base.length < 3 ? `${base}-room` : base;
  let n = 2;
  while (taken(slug) || ["hq", "new", "admin", "api"].includes(slug)) slug = `${base.slice(0, 36)}-${n++}`;
  return slug;
}

/**
 * The organiser's one room, made on first use: the Listings account owns it, flagged as made by Hoppaz. Open while the open organiser rooms
 * switch is on (CHANGE-006), else invite only (dormant) as before. Reused after.
 */
function ensureRoom(o: OrganiserRec): RoomRec {
  const have = o.room_id ? S().rooms[o.room_id] : undefined;
  if (have) return have;
  const owner = listingsUid();
  const id = newId();
  const room: RoomRec = {
    id, slug: freeSlug(o.name), name: o.name, kind: "crew", logo_url: null, wallpaper_url: null, verified: false, owner_id: owner, description: "", base_members: 0,
    join_mode: openOrganiserRoomsOn() ? "open" : "invite", created_by: owner, listed_by_staff: true,
  };
  S().rooms[id] = room;
  S().memberships[`${owner}:${id}`] = true;
  o.room_id = id;
  return room;
}

/** The desk's "Room: Open / Invite only" view of an organiser's room (ev_o_room_mode). null with no room. */
function roomModeOf(o: OrganiserRec): RoomModeView | null {
  const room = o.room_id ? S().rooms[o.room_id] : undefined;
  if (!room) return null;
  return { join_mode: joinModeOf(room), switchable: listingOrgOf(room)?.id === o.id, set_by_hand: !!room.listed_mode_set };
}

function newOrganiser(f: { name: string; ig_handle: string | null; email: string | null; phone: string | null }): OrganiserRec {
  const id = newId();
  const o: OrganiserRec = {
    id, name: f.name, name_key: nameKey(f.name), ig_handle: f.ig_handle, handles: f.ig_handle ? { instagram: f.ig_handle } : {}, email: f.email, phone: f.phone,
    room_id: null, stage: "pulled", do_not_contact: false, last_contacted_at: null, last_contacted_by: null, notes: "", claimed_at: null, claimed_by: null,
    declined_at: null, created_at: iso(now()),
  };
  S().organisers[id] = o;
  return o;
}

function matchOrganiser(e: ScoutEvent): OrganiserRec | null {
  const all = Object.values(S().organisers);
  const handle = normHandle(e.organiser_handle);
  if (handle) {
    const h = all.find((o) => o.ig_handle === handle);
    if (h) return h;
  }
  const key = nameKey(e.organiser_name);
  if (key) {
    const k = all.find((o) => o.name_key === key);
    if (k) return k;
  }
  return null;
}

/* ----------------------------------------------------------------- import -- */

function runImport(batch: ScoutBatch, dryRun: boolean): ImportReport {
  if (!batch || !Array.isArray(batch.events)) throw new OutreachError("bad_input");
  const report: ImportReport = {
    dry_run: dryRun, total: batch.events.length, new: 0, updated: 0, unchanged: 0, blocked: 0, skipped: 0, flagged_gone: 0, organisers_matched: 0, organisers_new: 0, lines: [],
  };
  const matched = new Set<string>();
  const made = new Set<string>();
  const seen = new Set<string>();
  const t = now();

  for (const raw of batch.events) {
    const line: ImportLine = {
      source_site: String(raw?.source_site ?? ""), source_id: String(raw?.source_id ?? ""), name: String(raw?.name ?? ""), action: "skipped", note: "",
    };
    try {
      line.action = importOne(raw, batch, { matched, made }, line);
    } catch (e) {
      line.action = "skipped";
      line.note = (e as Error).message;
    }
    report[line.action === "new" ? "new" : line.action]++;
    if (line.source_site && line.source_id) seen.add(`${line.source_site}|${line.source_id}`);
    report.lines.push(line);
  }
  report.organisers_matched = matched.size;
  report.organisers_new = made.size;

  // A row of a source this run covered, for an event still to come, that this run did not see: gone.
  const covered = new Set((batch.sources_covered ?? []).map((s) => s.toLowerCase()));
  for (const p of Object.values(S().pulled)) {
    if (!covered.has(p.source_site.toLowerCase()) || seen.has(`${p.source_site}|${p.source_id}`)) continue;
    if (p.status !== "new" && p.status !== "approved") continue;
    const start = p.fields.starts_at ? Date.parse(p.fields.starts_at) : NaN;
    if (!Number.isFinite(start) || start <= t || p.missing_since) continue;
    p.missing_since = iso(t);
    reflag(p);
    report.flagged_gone++;
  }
  return report;
}

function importOne(e: ScoutEvent, batch: ScoutBatch, count: { matched: Set<string>; made: Set<string> }, line: ImportLine): ImportLine["action"] {
  const site = (e.source_site ?? "").trim();
  const sid = String(e.source_id ?? "").trim();
  const name = (e.name ?? "").trim();
  if (!site || !sid || !name) {
    line.note = "Missing source, id or name";
    return "skipped";
  }
  if (e.starts_at && !Number.isFinite(Date.parse(e.starts_at))) {
    line.note = "The start time is not a time";
    return "skipped";
  }
  const seenAt = e.last_seen || batch.scouted_at || iso(now());
  // Hoppaz keeps no phone number or email of an organiser: a scout file that still carries them has them dropped here. The new fields are cleaned the
  // way the SQL cleans them (_ev_o_clean_fields): plain short text, public handles with no @, a full link for the source page.
  const fresh: ScoutEvent = {
    ...clone(e), source_site: site, source_id: sid, name, tickets: e.tickets ?? [], lineup: e.lineup ?? [], last_seen: seenAt,
    organiser_email: null, organiser_phone: null,
    ticket_platform: plainText(e.ticket_platform, 40), flyer_credit: plainText(e.flyer_credit, 80),
    source_url: /^https?:\/\//i.test(e.source_url ?? "") ? (e.source_url as string).slice(0, 600) : null,
    organiser_x: normX(e.organiser_x),
  };

  // The organiser: instagram handle, else name; else a new one at stage pulled.
  let org = matchOrganiser(fresh);
  if (org) {
    if (!count.made.has(org.id)) count.matched.add(org.id);
    const handle = normHandle(fresh.organiser_handle);
    if (!org.ig_handle && handle && !Object.values(S().organisers).some((x) => x.ig_handle === handle)) org.ig_handle = handle;
  } else {
    const handle = normHandle(fresh.organiser_handle);
    const oname = (fresh.organiser_name ?? "").trim() || handle;
    if (oname) {
      org = newOrganiser({ name: oname.slice(0, 120), ig_handle: handle, email: null, phone: null });
      count.made.add(org.id);
    }
  }
  const blocked = !!org && isBlocked(org);

  const existing = Object.values(S().pulled).find((p) => p.source_site === site && p.source_id === sid);
  if (!existing) {
    const p: PulledRec = {
      id: newId(), source_site: site, source_id: sid, status: blocked ? "blocked" : "new", flags: [], edited: [], confidence: fresh.confidence ?? "confirmed", fields: fresh,
      organiser_id: org?.id ?? null, event_id: null, duplicate_of: null, also_at: [], first_seen_at: iso(now()), last_seen_at: iso(now()), missing_since: null,
      decided_at: null, reject_reason: "",
    };
    const start = fresh.starts_at ? Date.parse(fresh.starts_at) : NaN;
    if (Number.isFinite(start)) {
      const twin = Object.values(S().pulled).find(
        (q) => q.status !== "rejected" && q.status !== "merged" && q.fields.starts_at && lagosDay(Date.parse(q.fields.starts_at)) === lagosDay(start) && nameKey(q.fields.name) === nameKey(name),
      );
      if (twin) p.duplicate_of = twin.id;
    }
    reflag(p);
    S().pulled[p.id] = p;
    if (org && !blocked) logLine(org.id, "scrape", `Found ${name} on ${site}`, null);
    line.note = blocked ? "They said no. Not listed" : p.duplicate_of ? "Looks like a duplicate" : "";
    return blocked ? "blocked" : "new";
  }

  // A row seen before: take the scout's new values except the fields staff edited.
  const p = existing;
  const merged: ScoutEvent = { ...fresh };
  for (const k of p.edited) (merged as unknown as Record<string, unknown>)[k] = (p.fields as unknown as Record<string, unknown>)[k];
  const changed = !sameScout(p.fields, merged);
  const startMoved = (p.fields.starts_at ?? null) !== (merged.starts_at ?? null);
  p.fields = merged;
  p.last_seen_at = iso(now());
  p.missing_since = null;
  if (!p.organiser_id && org) p.organiser_id = org.id;
  if (blocked && p.status === "new") p.status = "blocked";

  const add: PulledFlag[] = [];
  if (p.status === "approved" && p.event_id && S().events[p.event_id]) {
    const ev = S().events[p.event_id];
    if (isUnclaimed(ev)) {
      if (changed && merged.starts_at) syncEvent(ev, merged, false);
      if (startMoved) add.push("moved");
    } else if (changed) {
      add.push("changed"); // claimed: never touched
      line.note = "Claimed. Left as it is";
    }
  }
  reflag(p, add);
  if (!line.note && changed) line.note = startMoved ? "The start moved" : "Updated";
  return blocked && (p.status === "blocked" || p.status === "rejected") ? "blocked" : changed ? "updated" : "unchanged";
}

/* ---------------------------------------------------------------- approve -- */

function approveRow(pulledId: string, by: string, patch?: PulledPatch): { eventId: string; organiserId: string } {
  const p = pulledRec(pulledId);
  if (p.status === "blocked") return fail("blocked");
  if (p.status === "merged") return fail("not_found");
  const clean = cleanPatch(patch);
  const cleanKeys = Object.keys(clean);
  p.fields = { ...p.fields, ...clean };
  p.edited = [...new Set([...p.edited, ...cleanKeys])];
  listingsUid();

  let org = p.organiser_id ? S().organisers[p.organiser_id] : undefined;
  if (!org) {
    const f = p.fields;
    org = newOrganiser({ name: (f.organiser_name ?? "").trim() || f.name, ig_handle: normHandle(f.organiser_handle), email: null, phone: null });
    p.organiser_id = org.id;
  }
  if (isBlocked(org)) return fail("blocked");
  if (!p.fields.starts_at || !Number.isFinite(Date.parse(p.fields.starts_at))) return fail("no_time");
  if (p.fields.name.trim().length < 2) return fail("bad_name");

  const wasPulled = org.stage === "pulled";
  if (wasPulled) org.stage = "listed";
  const room = ensureRoom(org);
  // A claimed organiser's next event goes straight into their room, hosted by its owner. Otherwise the Listings account hosts it.
  const host = room.owner_id ?? listingsUid();

  let ev = p.event_id ? S().events[p.event_id] : undefined;
  if (ev) {
    if (isUnclaimed(ev)) syncEvent(ev, p.fields, true);
  } else {
    const id = newId();
    let slug = slugFor(p.fields.name, id);
    while (Object.values(S().events).some((x) => x.slug === slug)) slug = `${slug}x`;
    ev = { id, ...listingFields(p.fields), slug, host_id: host, room_id: room.id, organiser_id: org.id, created_at: iso(now()) };
    S().events[id] = ev;
  }
  p.status = "approved";
  p.event_id = ev.id;
  p.decided_at = iso(now());
  reflag(p, [], ["moved", "changed"]);
  logLine(org.id, "note", `Listed ${p.fields.name}${wasPulled ? " (first listing)" : ""}`, staffLabel(by));
  return { eventId: ev.id, organiserId: org.id };
}

/* ----------------------------------------------------------------- delete -- */

function purgeEvent(id: string): void {
  const s = S();
  delete s.events[id];
  delete s.lineups[id];
  delete s.regSettings[id];
  for (const k of Object.keys(s.interest)) if (k.endsWith(`:${id}`)) delete s.interest[k];
  for (const [k, v] of Object.entries(s.pops)) if (v.event_id === id) delete s.pops[k];
  for (const [k, v] of Object.entries(s.announcements)) if (v.event_id === id) delete s.announcements[k];
  for (const [k, v] of Object.entries(s.messages)) if (v.channel === id) delete s.messages[k];
  for (const [k, v] of Object.entries(s.reports)) if (v.event_id === id) delete s.reports[k];
  for (const [k, v] of Object.entries(s.tickets)) if (v.event_id === id) delete s.tickets[k];
  for (const [k, v] of Object.entries(s.regs)) if (v.event_id === id) delete s.regs[k];
}

function purgeRoom(id: string): void {
  const s = S();
  delete s.rooms[id];
  for (const k of Object.keys(s.memberships)) if (k.endsWith(`:${id}`)) delete s.memberships[k];
  for (const k of Object.keys(s.roles)) if (k.endsWith(`:${id}`)) delete s.roles[k];
  for (const k of Object.keys(s.joinedAt)) if (k.endsWith(`:${id}`)) delete s.joinedAt[k];
  for (const [k, v] of Object.entries(s.requests)) if (v.room_id === id) delete s.requests[k];
  for (const [k, v] of Object.entries(s.notices)) if (v.room_id === id) delete s.notices[k];
  for (const [k, v] of Object.entries(s.announcements)) if (v.room_id === id) delete s.announcements[k];
  for (const [k, v] of Object.entries(s.messages)) if (v.room_id === id) delete s.messages[k];
  for (const t of Object.values(s.transfers)) if (t.room_id === id && t.status === "pending") t.status = "revoked";
}

/** Registrations still holding a place, and orders with money or a hold on them, per event. */
function activeSales(events: EventRec[]): { title: string; count: number }[] {
  const out: { title: string; count: number }[] = [];
  for (const e of events) {
    const regs = Object.values(S().regs).filter((r) => r.event_id === e.id && r.status !== "cancelled" && r.status !== "declined").length;
    const orders = Object.values(S().orders).filter((o) => o.event_id === e.id && (o.status === "open" || o.status === "paid" || o.status === "refund_pending")).length;
    if (regs + orders > 0) out.push({ title: e.title, count: regs + orders });
  }
  return out;
}

/* ------------------------------------------------------------------- week -- */

function weekCounts(from: number, to: number) {
  const inWin = (s: string | null) => !!s && Date.parse(s) >= from && Date.parse(s) < to;
  const logs = Object.values(S().organiserLog).filter((l) => inWin(l.at));
  const orgs = Object.values(S().organisers);
  return {
    contacted: logs.filter((l) => l.kind === "contact").length,
    replies: logs.filter((l) => l.kind === "reply").length,
    offers: logs.filter((l) => l.kind === "offer").length,
    claimed: orgs.filter((o) => inWin(o.claimed_at)).length,
    declined: orgs.filter((o) => inWin(o.declined_at)).length,
    listed: Object.values(S().events).filter((e) => e.organiser_id && e.ticket_mode && inWin(e.created_at)).length,
  };
}

/* ---------------------------------------------------------- event claims -- */

/** One-time claim links (the event_claims flag): 14 days, single use, no email, at most 5 open per room. Only the hash of the token is kept. */
const LINK_DAYS = 14;
const MAX_OPEN_LINKS = 5;
/** Asks from people without a link: 3 per person per day, 300 a day overall. Wrong or used links: 10 a person an hour, then "Too many requests". */
const MAX_FAILED_PER_HOUR = 10;
const failedTries = new Map<string, number[]>();

const needOn = (): void => {
  if (!eventClaimsOn()) fail("not_on");
};

const linkView = (l: ClaimLinkRec): ClaimLink => {
  const { token_hash, ...rest } = l;
  void token_hash;
  return clone(rest);
};

function settleLinks(): void {
  let changed = false;
  for (const l of Object.values(S().claimLinks)) {
    if (l.status === "pending" && Date.parse(l.expires_at) <= now()) {
      l.status = "expired";
      changed = true;
    }
  }
  if (changed) persist();
}

const openLinksOf = (roomId: string): ClaimLinkRec[] => Object.values(S().claimLinks).filter((l) => l.room_id === roomId && l.status === "pending" && Date.parse(l.expires_at) > now());

async function findLink(token: string): Promise<ClaimLinkRec | null> {
  settleLinks();
  const hash = await sha256Hex(String(token ?? "").trim());
  return Object.values(S().claimLinks).find((l) => l.token_hash === hash) ?? null;
}

const linkClosedReason = (l: ClaimLinkRec): string | null => (l.status === "used" ? "link_used" : l.status === "revoked" ? "link_revoked" : l.status === "expired" ? "link_expired" : null);

/** Wrong-link tries per person. Pruned to the last hour. */
function tooManyFailed(userId: string): boolean {
  const cut = now() - 3.6e6;
  const list = (failedTries.get(userId) ?? []).filter((t) => t > cut);
  failedTries.set(userId, list);
  return list.length >= MAX_FAILED_PER_HOUR;
}
const noteFailed = (userId: string): void => {
  failedTries.set(userId, [...(failedTries.get(userId) ?? []), now()]);
};

/**
 * The room and its upcoming events go to one person, with nobody's email checked: the owner is replaced (Hoppaz Listings leaves, a person stays a
 * plain member), upcoming events get the new host, a dormant room opens, the organiser is claimed, every other open link of the room is cancelled
 * and every other open ask about it is declined. Used by a claim link and by an approved ask. The same steps as accept() in `claims`.
 */
function handOver(room: RoomRec, to: { id: string; name: string }, orgId: string | null, how: string): AcceptOutcome {
  const before = room.owner_id;
  const keptMode = joinModeOf(room);
  const alreadyOwnsOther = Object.values(S().rooms).some((r) => r.id !== room.id && r.kind !== "hq" && r.owner_id === to.id);
  const moving = upcomingOfRoom(room.id);
  if (before !== to.id && moving.some((e) => Object.values(S().orders).some((o) => o.event_id === e.id && (o.status === "paid" || o.status === "refund_pending")))) return fail("paid_sales");
  stepOf("owner");
  room.owner_id = to.id;
  S().memberships[`${to.id}:${room.id}`] = true;
  S().joinedAt[`${to.id}:${room.id}`] = S().joinedAt[`${to.id}:${room.id}`] ?? iso(now());
  delete S().roles[`${to.id}:${room.id}`];
  if (before && before !== to.id) {
    delete S().roles[`${before}:${room.id}`];
    if (before === S().listingsUserId) {
      delete S().memberships[`${before}:${room.id}`];
      delete S().joinedAt[`${before}:${room.id}`];
    } else {
      S().memberships[`${before}:${room.id}`] = true;
    }
  }
  room.created_by = to.id;
  // A dormant room opens on claim; while open organiser rooms are on, the room keeps the mode it shows (CHANGE-006).
  if (before === S().listingsUserId) room.join_mode = openOrganiserRoomsOn() ? keptMode : "open";
  stepOf("events");
  for (const e of moving) e.host_id = to.id;
  stepOf("organiser");
  const o = orgId ? S().organisers[orgId] : undefined;
  if (o) {
    o.stage = "claimed";
    o.claimed_at = iso(now());
    o.claimed_by = to.id;
    o.do_not_contact = false;
    o.declined_at = null;
    logLine(o.id, "stage", `Claimed by ${to.name} (${how}). ${moving.length} upcoming ${moving.length === 1 ? "event" : "events"} moved`, null);
  }
  for (const l of Object.values(S().claimLinks)) if (l.room_id === room.id && l.status === "pending") l.status = "revoked";
  for (const t of Object.values(S().transfers)) if (t.room_id === room.id && t.status === "pending") t.status = "revoked";
  for (const a of Object.values(S().claimAsks)) {
    if (a.status === "new" && S().events[a.event_id]?.room_id === room.id && a.user_id !== to.id) {
      a.status = "declined";
      a.decided_by = "system";
    }
  }
  return { room_id: room.id, slug: room.slug, moved_events: moving.length, already_owned_other: alreadyOwnsOther };
}

const askView = (a: ClaimAskRec): ClaimAsk => {
  const { user_id, ...rest } = a;
  void user_id;
  return clone(rest);
};


/* -------------------------------------------------------------- the desk -- */

export const outreach: OutreachApi = {
  async queue() {
    const want = Object.values(S().pulled).filter(
      (p) => p.status === "new" || p.status === "blocked" || (p.status === "approved" && p.flags.some((f) => f === "changed" || f === "moved" || f === "gone")),
    );
    return want.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at) || a.id.localeCompare(b.id)).map(pulledView);
  },

  async approve(pulledId, by, patch) {
    const out = transaction(() => approveRow(pulledId, by, patch));
    emit();
    return out;
  },

  async edit(pulledId, patch) {
    const out = transaction(() => {
      const p = pulledRec(pulledId);
      if (p.status === "merged") return fail("not_found");
      const clean = cleanPatch(patch);
      p.fields = { ...p.fields, ...clean };
      p.edited = [...new Set([...p.edited, ...Object.keys(clean)])];
      reflag(p);
      const ev = p.status === "approved" && p.event_id ? S().events[p.event_id] : undefined;
      if (ev && isUnclaimed(ev) && p.fields.starts_at) syncEvent(ev, p.fields, true);
      return pulledView(p);
    });
    emit();
    return out;
  },

  async reject(pulledId, by, reason) {
    transaction(() => {
      const p = pulledRec(pulledId);
      if (p.status === "approved") throw new Error("This one is already live. Delete it from the organiser");
      if (p.status === "merged") return fail("not_found");
      p.status = "rejected";
      p.decided_at = iso(now());
      p.reject_reason = (reason ?? "").trim().slice(0, 500);
      reflag(p);
      if (p.organiser_id) logLine(p.organiser_id, "note", `Rejected ${p.fields.name}${p.reject_reason ? `: ${p.reject_reason}` : ""}`, staffLabel(by));
    });
    emit();
  },

  async merge(pulledId, intoPulledId, by) {
    transaction(() => {
      const loser = pulledRec(pulledId);
      const winner = pulledRec(intoPulledId);
      if (loser.id === winner.id) throw new Error("Pick a different row to fold into");
      if (loser.status === "approved") throw new Error("This one is already live. Delete it from the organiser");
      if (winner.status === "rejected" || winner.status === "merged") return fail("not_found");
      loser.status = "merged";
      loser.duplicate_of = winner.id;
      loser.decided_at = iso(now());
      reflag(loser);
      winner.also_at = [...winner.also_at, { source_site: loser.source_site, source_id: loser.source_id, ticket_url: loser.fields.ticket_url ?? null }];
      if (winner.organiser_id) logLine(winner.organiser_id, "note", `Folded ${loser.source_site} into ${winner.source_site} for ${winner.fields.name}`, staffLabel(by));
    });
    emit();
  },

  async importBatch(batch, opts) {
    const dry = !!opts?.dryRun;
    const report = transaction(() => runImport(batch, dry), !dry);
    if (!dry) emit();
    return report;
  },

  async organisers() {
    settleTransfers();
    return Object.values(S().organisers)
      .map(organiserView)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async organiser(id) {
    settleTransfers();
    const o = organiserRec(id);
    const log = Object.values(S().organiserLog)
      .filter((l) => l.organiser_id === id)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
    const events = eventsOfOrganiser(id)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, status: statusOf(e), ticket_url: e.ticket_url ?? null, upcoming: statusOf(e) === "live" && eventEnd(e) > now() }));
    const transfers = Object.values(S().transfers)
      .filter((t) => t.organiser_id === id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(transferView);
    settleLinks();
    const claim_links = eventClaimsOn()
      ? Object.values(S().claimLinks).filter((l) => l.organiser_id === id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(linkView)
      : [];
    return { organiser: organiserView(o), log: clone(log) as OrganiserLogEntry[], events, transfers, claim_links, room_mode: roomModeOf(o) } satisfies OrganiserDetail;
  },

  async saveOrganiser(id, patch: OrganiserPatch) {
    const out = transaction(() => {
      const o = organiserRec(id);
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (!n || n.length > 120) throw new Error("Give the organiser a name under 120 characters");
        o.name = n;
        o.name_key = nameKey(n);
      }
      if (patch.ig_handle !== undefined) {
        const h = patch.ig_handle === null || patch.ig_handle.trim() === "" ? null : normHandle(patch.ig_handle);
        if (patch.ig_handle && patch.ig_handle.trim() && !h) throw new Error("Check the Instagram handle");
        if (h && Object.values(S().organisers).some((x) => x.id !== id && x.ig_handle === h)) return fail("handle_taken");
        o.ig_handle = h;
      }
      if (patch.handles !== undefined) o.handles = { ...patch.handles };
      if (patch.email !== undefined) {
        const e = patch.email === null || patch.email.trim() === "" ? null : normEmail(patch.email);
        if (patch.email && patch.email.trim() && !e) return fail("bad_email");
        o.email = e;
      }
      if (patch.phone !== undefined) o.phone = patch.phone === null || patch.phone.trim() === "" ? null : patch.phone.trim().slice(0, 40);
      if (patch.notes !== undefined) {
        if (patch.notes.length > 4000) throw new Error("Keep the notes under 4000 characters");
        o.notes = patch.notes;
      }
      if (patch.do_not_contact !== undefined && patch.do_not_contact !== o.do_not_contact) {
        o.do_not_contact = patch.do_not_contact;
        for (const p of Object.values(S().pulled).filter((x) => x.organiser_id === id)) {
          if (patch.do_not_contact && p.status === "new") p.status = "blocked";
          else if (!patch.do_not_contact && o.stage !== "declined" && p.status === "blocked") p.status = "new";
          reflag(p);
        }
      }
      return organiserView(o);
    });
    emit();
    return out;
  },

  async logContact(id, input) {
    transaction(() => {
      const o = organiserRec(id);
      const body = (input.body ?? "").trim();
      if (!["contact", "reply", "note"].includes(input.kind)) throw new OutreachError("bad_input");
      if (!body && input.kind !== "contact") throw new Error("Write a note first");
      if (body.length > 2000) throw new Error("Keep it under 2000 characters");
      logLine(id, input.kind, body, staffLabel(input.by), input.channel ?? null);
      if (input.kind === "contact") {
        o.last_contacted_at = iso(now());
        o.last_contacted_by = staffLabel(input.by);
      }
    });
    emit();
  },

  async setStage(id, stage, by) {
    const out = transaction(() => {
      const o = organiserRec(id);
      const why = stageRefusal(o, stage);
      if (why) return fail(why);
      if (stage === "declined") {
        o.stage = "declined";
        o.do_not_contact = true;
        o.declined_at = iso(now());
        for (const p of Object.values(S().pulled).filter((x) => x.organiser_id === id && x.status === "new")) {
          p.status = "blocked";
          reflag(p);
        }
        logLine(id, "stage", "Declined. Do not contact.", staffLabel(by));
      } else if (stage === "listed") {
        o.stage = "listed";
        o.do_not_contact = false;
        o.declined_at = null;
        for (const p of Object.values(S().pulled).filter((x) => x.organiser_id === id && x.status === "blocked")) {
          p.status = "new";
          reflag(p);
        }
        logLine(id, "stage", "Reopened", staffLabel(by));
      } else {
        o.stage = "offered";
        logLine(id, "offer", "Offer made", staffLabel(by));
      }
      return organiserView(o);
    });
    emit();
    return out;
  },

  async deleteListingAndRoom(id, confirmName, by) {
    const out = transaction(() => {
      const o = organiserRec(id);
      if ((confirmName ?? "").trim() !== o.name) return fail("confirm_name");
      if (o.stage === "claimed") return fail("is_claimed");
      const evs = eventsOfOrganiser(id);
      const busy = activeSales(evs);
      if (busy.length) throw new OutreachError("has_registrations", busy.map((b) => `${b.title} (${b.count})`).join(", "), busy);
      for (const e of evs) purgeEvent(e.id);
      if (o.room_id) purgeRoom(o.room_id);
      o.room_id = null;
      o.stage = "declined";
      o.do_not_contact = true;
      o.declined_at = o.declined_at ?? iso(now());
      for (const p of Object.values(S().pulled).filter((x) => x.organiser_id === id)) {
        if (p.status === "new") p.status = "blocked";
        else if (p.status === "approved") {
          p.status = "rejected";
          p.event_id = null;
          p.decided_at = iso(now());
        }
        reflag(p);
      }
      logLine(id, "delete", `Removed ${evs.length} ${evs.length === 1 ? "event" : "events"} and the room`, staffLabel(by));
      return { events: evs.length };
    });
    emit();
    return out;
  },

  async createClaimLink(target, by) {
    needOn();
    settleLinks();
    const token = randomToken();
    const hash = await sha256Hex(token);
    const rec = transaction(() => {
      const ev = "eventId" in target ? (S().events[target.eventId] ?? fail("not_found")) : null;
      if (ev && !isExternal(ev)) return fail("not_found");
      const orgId = "eventId" in target ? (ev?.organiser_id ?? null) : target.organiserId;
      const o = organiserRec(orgId ?? "");
      if (isBlocked(o)) return fail("organiser_declined");
      if (o.stage === "claimed" || (ev && !isUnclaimed(ev))) return fail("is_claimed");
      const room = ensureRoom(o);
      if (openLinksOf(room.id).length >= MAX_OPEN_LINKS) return fail("try_again_later");
      const id = newId();
      const l: ClaimLinkRec = {
        id, room_id: room.id, room_name: room.name, organiser_id: o.id, event_id: ev?.id ?? null, status: "pending", created_at: iso(now()), created_by: staffLabel(by),
        expires_at: iso(now() + LINK_DAYS * DAY), used_at: null, token_hash: hash,
      };
      S().claimLinks[id] = l;
      if (o.stage === "listed" || o.stage === "pulled") {
        o.stage = "offered";
        logLine(o.id, "offer", "Offer made", staffLabel(by));
      }
      logLine(o.id, "transfer", `Claim link made${ev ? ` for ${ev.title}` : ""}, open for ${LINK_DAYS} days`, staffLabel(by));
      return l;
    });
    emit();
    return { link: linkView(rec), url: `${siteOrigin()}/claim/${token}` };
  },

  async revokeClaimLink(linkId, by) {
    needOn();
    settleLinks();
    transaction(() => {
      const l = S().claimLinks[linkId] ?? fail("not_found");
      const closed = linkClosedReason(l);
      if (closed) return fail(closed);
      l.status = "revoked";
      if (l.organiser_id) logLine(l.organiser_id, "transfer", "Claim link cancelled", staffLabel(by));
    });
    emit();
  },

  async claimable() {
    needOn();
    settleLinks();
    const taps = allTaps();
    return Object.values(S().events)
      .filter((e) => isUnclaimed(e) && statusOf(e) === "live" && eventEnd(e) > now())
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id))
      .map((e): Claimable => {
        const o = e.organiser_id ? S().organisers[e.organiser_id] : undefined;
        return {
          event_id: e.id, title: e.title, starts_at: e.starts_at, organiser_id: o?.id ?? null, organiser_name: o?.name ?? null,
          room_name: e.room_id ? (S().rooms[e.room_id]?.name ?? null) : null, went_to_buy: taps.events[e.id] ?? 0,
          link_open: !!e.room_id && openLinksOf(e.room_id).length > 0,
          asks: Object.values(S().claimAsks).filter((a) => a.event_id === e.id && a.status === "new").length,
        };
      });
  },

  async claimAsks() {
    needOn();
    return Object.values(S().claimAsks)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
      .map(askView);
  },

  async decideClaimAsk(askId, approve, by) {
    needOn();
    const out = transaction(() => {
      const a = S().claimAsks[askId] ?? fail("not_found");
      if (a.status !== "new") return fail("already_handled");
      const ev = S().events[a.event_id] ?? fail("not_found");
      if (!approve) {
        a.status = "declined";
        a.decided_by = staffLabel(by);
        if (a.organiser_id) logLine(a.organiser_id, "claim_request", `Declined the ask from ${a.name} about ${ev.title}`, staffLabel(by));
        return { moved_events: 0 };
      }
      const o = organiserRec(a.organiser_id ?? ev.organiser_id ?? "");
      if (o.stage === "claimed" || !isUnclaimed(ev)) return fail("is_claimed");
      if (isBlocked(o)) return fail("organiser_declined");
      const asker = S().users[a.user_id] ?? fail("not_found");
      const room = ensureRoom(o);
      const done = handOver(room, { id: asker.id, name: asker.name }, o.id, `ask approved by ${staffLabel(by)}`);
      a.status = "approved";
      a.decided_by = staffLabel(by);
      return { moved_events: done.moved_events };
    });
    emit();
    return out;
  },

  async setRoomMode(organiserId, mode, by) {
    if (mode !== "open" && mode !== "invite") throw new Error("Pick Open or Invite only");
    const out = transaction(() => {
      const o = organiserRec(organiserId);
      const room = o.room_id ? S().rooms[o.room_id] : undefined;
      if (!room) return fail("not_found");
      if (listingOrgOf(room)?.id !== o.id) return fail("is_claimed");
      room.join_mode = mode;
      room.listed_mode_set = true;
      logLine(o.id, "note", `Room set to ${mode === "open" ? "Open" : "Invite only"}.`, by);
      return roomModeOf(o)!;
    });
    emit();
    return out;
  },

  async tapCounts() {
    return allTaps();
  },

  async approveMany(pulledIds, by) {
    const ids = [...new Set((pulledIds ?? []).map(String))];
    if (ids.length === 0) return fail("bad_ids");
    if (ids.length > 100) return fail("too_many");
    const out: ApproveManyResult = { approved: [], skipped: [] };
    for (const id of ids) {
      const p = S().pulled[id];
      const name = p?.fields.name ?? "Unknown row";
      const skip = (reason: string, text?: string) => out.skipped.push({ id, name, reason, text: text ?? OUTREACH_REASONS[reason] ?? reason });
      if (!p) {
        skip("not_found");
        continue;
      }
      // Only rows still waiting. A live row with changes is accepted one by one, where the changes can be read.
      if (p.status === "approved") {
        skip("already_listed");
        continue;
      }
      if (p.status === "rejected") {
        skip("already_handled");
        continue;
      }
      try {
        const r = transaction(() => approveRow(id, by));
        out.approved.push({ id, event_id: r.eventId });
      } catch (e) {
        if (e instanceof OutreachError) skip(e.reason, e.message);
        else skip("bad_input", e instanceof Error ? e.message : undefined);
      }
    }
    emit();
    return out;
  },

  async createTransfer(organiserId, email, by, days = 14) {
    settleTransfers();
    const to = normEmail(email);
    if (!to) return fail("bad_email");
    const life = Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14;
    const token = randomToken();
    const hash = await sha256Hex(token);
    const rec = transaction(() => {
      const o = organiserRec(organiserId);
      if (isBlocked(o)) return fail("organiser_declined");
      if (o.stage === "claimed") return fail("is_claimed");
      const room = ensureRoom(o);
      if (Object.values(S().transfers).some((t) => t.room_id === room.id && t.to_email === to && t.status === "pending")) return fail("already_pending");
      const id = newId();
      const t: TransferRec = {
        id, kind: "claim", room_id: room.id, room_name: room.name, organiser_id: o.id, to_email: to, status: "pending", created_at: iso(now()), created_by: staffLabel(by),
        expires_at: iso(now() + life * DAY), accepted_at: null, token_hash: hash, attempts: 0, accepted_by: null,
      };
      S().transfers[id] = t;
      if (o.stage === "listed" || o.stage === "pulled") {
        o.stage = "offered";
        logLine(o.id, "offer", "Offer made", staffLabel(by));
      }
      if (!o.email) o.email = to;
      logLine(o.id, "transfer", `Link made for ${to}, open for ${life} days`, staffLabel(by));
      return t;
    });
    emit();
    return { transfer: transferView(rec), link: `${siteOrigin()}/claim/${token}` } satisfies TransferLink;
  },

  async revokeTransfer(transferId, by) {
    settleTransfers();
    transaction(() => {
      const t = S().transfers[transferId] ?? fail("not_found");
      if (t.status === "accepted") return fail("link_used");
      if (t.status === "revoked") return fail("link_revoked");
      if (t.status === "expired") return fail("link_expired");
      t.status = "revoked";
      if (t.organiser_id) logLine(t.organiser_id, "transfer", `Link for ${t.to_email} cancelled`, staffLabel(by));
    });
    emit();
  },

  async claimRequests() {
    return clone(Object.values(S().claimRequests).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id)));
  },

  async handleClaimRequest(id, by) {
    transaction(() => {
      const c = S().claimRequests[id] ?? fail("not_found");
      c.status = "handled";
      if (c.organiser_id) logLine(c.organiser_id, "note", `Dealt with the request from ${c.name}`, staffLabel(by));
    });
    emit();
  },

  async week() {
    const t = now();
    const wk = 7 * DAY;
    const cur = weekCounts(t - wk, t + 1);
    const prev = weekCounts(t - 2 * wk, t - wk);
    const inWin = (s: string) => Date.parse(s) >= t - wk && Date.parse(s) <= t;
    const orgs = Object.values(S().organisers);
    const stages: Record<OrganiserStage, number> = { pulled: 0, listed: 0, offered: 0, claimed: 0, declined: 0 };
    for (const o of orgs) stages[o.stage]++;
    const waiting = orgs
      .filter((o) => (o.stage === "listed" || o.stage === "offered") && !o.do_not_contact)
      .map((o) => ({ id: o.id, name: o.name, since: o.last_contacted_at ? Date.parse(o.last_contacted_at) : Date.parse(o.created_at) }))
      .filter((o) => t - o.since >= wk)
      .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))
      .map((o) => ({ id: o.id, name: o.name, days: Math.floor((t - o.since) / DAY) }));
    return {
      from: iso(t - wk),
      to: iso(t),
      ...cur,
      pulled_new: Object.values(S().pulled).filter((p) => inWin(p.first_seen_at)).length,
      rejected: Object.values(S().pulled).filter((p) => p.status === "rejected" && p.decided_at && inWin(p.decided_at)).length,
      claim_requests: Object.values(S().claimRequests).filter((c) => inWin(c.created_at)).length,
      stages,
      waiting,
      previous: prev,
    } satisfies WeekSummary;
  },
};

/* ------------------------------------------------------------- the claims -- */

const MAX_ATTEMPTS = 10;

async function findTransfer(token: string): Promise<TransferRec | null> {
  settleTransfers();
  const hash = await sha256Hex(String(token ?? "").trim());
  return Object.values(S().transfers).find((t) => t.token_hash === hash) ?? null;
}

/** The refusal that fits a link that cannot be used, or null when it is open. */
function closedReason(t: TransferRec): string | null {
  if (t.status === "accepted") return "link_used";
  if (t.status === "revoked") return "link_revoked";
  if (t.status === "expired") return "link_expired";
  return null;
}

/** Events that move with a room: not cancelled and not over. */
const upcomingOfRoom = (roomId: string): EventRec[] => Object.values(S().events).filter((e) => e.room_id === roomId && e.status !== "cancelled" && eventEnd(e) > now());

export const claims: ClaimsApi = {
  async requestClaim(eventId, who) {
    const ev = S().events[eventId] ?? Object.values(S().events).find((e) => e.slug === eventId);
    if (!ev || ev.ticket_mode !== "external" || ev.visibility !== "public") return fail("not_found");
    const name = (who?.name ?? "").trim();
    if (!name || name.length > 120) throw new Error("Add your name");
    const email = normEmail(who?.email);
    if (!email) return fail("bad_email");
    const note = (who?.note ?? "").trim().slice(0, 1000);
    const phone = (who?.phone ?? "").trim().slice(0, 40) || null;
    const all = Object.values(S().claimRequests);
    // Asking twice with the same email about the same event is one request.
    if (all.some((c) => c.event_id === ev.id && c.email.toLowerCase() === email)) return;
    const since = now() - DAY;
    const recent = all.filter((c) => Date.parse(c.created_at) > since);
    if (recent.filter((c) => c.email.toLowerCase() === email).length >= 3 || recent.length >= 300) return fail("try_again_later");
    const org = ev.organiser_id ? S().organisers[ev.organiser_id] : undefined;
    const id = newId();
    const rec: ClaimRequest = {
      id, event_id: ev.id, event_title: ev.title, organiser_id: org?.id ?? null, organiser_name: org?.name ?? null, name, email, phone, note, status: "new", created_at: iso(now()),
    };
    S().claimRequests[id] = rec;
    if (org) logLine(org.id, "claim_request", `${name} asked about ${ev.title}`, name);
    emit();
  },

  async askToClaim(eventId, who) {
    needOn();
    const v = requireViewer();
    const ev = S().events[eventId] ?? Object.values(S().events).find((e) => e.slug === eventId);
    if (!ev || ev.ticket_mode !== "external" || ev.visibility !== "public") return fail("not_found");
    if (!isUnclaimed(ev)) return fail("is_claimed");
    const note = (who?.note ?? "").trim().slice(0, 500);
    const all = Object.values(S().claimAsks);
    // Asking twice about the same event is one ask.
    if (all.some((a) => a.event_id === ev.id && a.user_id === v.id && a.status === "new")) return;
    const since = now() - DAY;
    const recent = all.filter((a) => Date.parse(a.created_at) > since);
    if (recent.filter((a) => a.user_id === v.id).length >= 3 || recent.length >= 300) return fail("try_again_later");
    const org = ev.organiser_id ? S().organisers[ev.organiser_id] : undefined;
    const id = newId();
    S().claimAsks[id] = {
      id, event_id: ev.id, event_title: ev.title, organiser_id: org?.id ?? null, organiser_name: org?.name ?? null, name: v.name, note, status: "new",
      created_at: iso(now()), decided_by: null, user_id: v.id,
    };
    if (org) logLine(org.id, "claim_request", `${v.name} asked to claim ${ev.title}`, v.name);
    emit();
  },

  async preview(token): Promise<TransferPreview> {
    if (eventClaimsOn()) {
      const l = await findLink(token);
      if (l) {
        if (l.status === "used") return { ok: false, reason: "used" };
        if (l.status === "revoked") return { ok: false, reason: "revoked" };
        if (l.status === "expired") return { ok: false, reason: "expired" };
        const room = S().rooms[l.room_id];
        if (!room) return { ok: false, reason: "not_found" };
        const org = l.organiser_id ? S().organisers[l.organiser_id] : undefined;
        return {
          ok: true,
          kind: "link",
          room: { name: room.name, slug: room.slug, logo_url: room.logo_url, about: room.description },
          events: upcomingOfRoom(room.id)
            .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
            .map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at })),
          email_hint: null,
          organiser_name: org?.name ?? null,
          expires_at: l.expires_at,
        };
      }
    }
    const t = await findTransfer(token);
    if (!t) return { ok: false, reason: "not_found" };
    if (t.status === "accepted") return { ok: false, reason: "used" };
    if (t.status === "revoked") return { ok: false, reason: "revoked" };
    if (t.status === "expired") return { ok: false, reason: "expired" };
    const room = S().rooms[t.room_id];
    if (!room) return { ok: false, reason: "not_found" };
    const org = t.organiser_id ? S().organisers[t.organiser_id] : undefined;
    return {
      ok: true,
      kind: t.kind,
      room: { name: room.name, slug: room.slug, logo_url: room.logo_url, about: room.description },
      events: upcomingOfRoom(room.id)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at })),
      email_hint: maskEmail(t.to_email),
      organiser_name: org?.name ?? null,
      expires_at: t.expires_at,
    };
  },

  async accept(token): Promise<AcceptOutcome> {
    const v = requireViewer();
    if (eventClaimsOn()) {
      const l = await findLink(token);
      if (l) {
        // A claim link: no email to match. A closed one counts as a wrong try (10 an hour, then "Too many requests").
        if (tooManyFailed(v.id)) return fail("try_again_later");
        const closed = linkClosedReason(l);
        if (closed) {
          noteFailed(v.id);
          return fail(closed);
        }
        const result = transaction(() => {
          const lk = S().claimLinks[l.id];
          const room = S().rooms[lk.room_id] ?? fail("not_found");
          const done = handOver(room, { id: v.id, name: v.name }, lk.organiser_id, "claim link");
          stepOf("transfer");
          lk.status = "used";
          lk.used_at = iso(now());
          return done;
        });
        emit();
        return result;
      }
      // Not a link of ours. It may still be an email transfer; a token that is neither counts as a wrong try.
      if (!(await findTransfer(token))) {
        if (tooManyFailed(v.id)) return fail("try_again_later");
        noteFailed(v.id);
      }
    }
    const t = await findTransfer(token);
    if (!t) return fail("invalid_link");
    const closed = closedReason(t);
    if (closed) return fail(closed);

    // A wrong email does not use the link up. It counts, and the tenth wrong try locks the link.
    if (v.email.trim().toLowerCase() !== t.to_email) {
      t.attempts += 1;
      if (t.attempts >= MAX_ATTEMPTS) {
        t.status = "revoked";
        if (t.organiser_id) logLine(t.organiser_id, "transfer", `Link for ${t.to_email} locked after too many wrong tries`, null);
      }
      emit();
      return fail(t.status === "revoked" ? "link_revoked" : "wrong_email");
    }

    const result = transaction(() => {
      const tr = S().transfers[t.id];
      const room = S().rooms[tr.room_id] ?? fail("not_found");
      const before = room.owner_id;
      const alreadyOwnsOther = Object.values(S().rooms).some((r) => r.id !== room.id && r.kind !== "hq" && r.owner_id === v.id);
      const moving = upcomingOfRoom(room.id);
      if (moving.some((e) => Object.values(S().orders).some((o) => o.event_id === e.id && (o.status === "paid" || o.status === "refund_pending")))) return fail("paid_sales");

      // 1. The owner: the previous one is removed (Hoppaz Listings leaves; a person stays as a plain member).
      stepOf("owner");
      room.owner_id = v.id;
      S().memberships[`${v.id}:${room.id}`] = true;
      S().joinedAt[`${v.id}:${room.id}`] = S().joinedAt[`${v.id}:${room.id}`] ?? iso(now());
      delete S().roles[`${v.id}:${room.id}`];
      if (before && before !== v.id) {
        delete S().roles[`${before}:${room.id}`];
        if (before === S().listingsUserId) {
          delete S().memberships[`${before}:${room.id}`];
          delete S().joinedAt[`${before}:${room.id}`];
        } else {
          S().memberships[`${before}:${room.id}`] = true;
        }
      }
      room.created_by = v.id;
      // A dormant room (the Listings account owned it) opens now.
      // An email transfer (ev_transfer_accept) still opens a dormant room; only the CHANGE-005 claim keeps the mode (CHANGE-006).
      if (before === S().listingsUserId) room.join_mode = joinModeOf(room) === "invite" ? "open" : joinModeOf(room);

      // 2. The upcoming events: the new owner hosts them. Past events keep their old host.
      stepOf("events");
      for (const e of moving) e.host_id = v.id;

      // 3. The organiser is claimed (a handover leaves the organiser as it is).
      stepOf("organiser");
      if (tr.kind === "claim" && tr.organiser_id) {
        const o = S().organisers[tr.organiser_id];
        if (o) {
          o.stage = "claimed";
          o.claimed_at = iso(now());
          o.claimed_by = v.id;
          logLine(o.id, "stage", `Claimed by ${v.name}`, null);
        }
      }

      // 4. This link is used, and every other open link on the room is cancelled.
      stepOf("transfer");
      tr.status = "accepted";
      tr.accepted_at = iso(now());
      tr.accepted_by = v.id;
      stepOf("others");
      for (const other of Object.values(S().transfers)) if (other.id !== tr.id && other.room_id === room.id && other.status === "pending") other.status = "revoked";

      return { room_id: room.id, slug: room.slug, moved_events: moving.length, already_owned_other: alreadyOwnsOther } satisfies AcceptOutcome;
    });
    emit();
    return result;
  },

  async startHandover(roomId, email) {
    const v = requireViewer();
    settleTransfers();
    const room = S().rooms[roomId] ?? Object.values(S().rooms).find((r) => r.slug === roomId);
    if (!room || room.owner_id !== v.id) throw new Error("Not allowed");
    const to = normEmail(email);
    if (!to) return fail("bad_email");
    if (Object.values(S().transfers).some((x) => x.room_id === room.id && x.to_email === to && x.status === "pending")) return fail("already_pending");
    const token = randomToken();
    const hash = await sha256Hex(token);
    const org = Object.values(S().organisers).find((o) => o.room_id === room.id);
    const id = newId();
    const rec: TransferRec = {
      id, kind: "handover", room_id: room.id, room_name: room.name, organiser_id: org?.id ?? null, to_email: to, status: "pending", created_at: iso(now()), created_by: v.name,
      expires_at: iso(now() + 14 * DAY), accepted_at: null, token_hash: hash, attempts: 0, accepted_by: null,
    };
    S().transfers[id] = rec;
    if (org) logLine(org.id, "transfer", `${v.name} started handing the room to ${to}`, v.name);
    emit();
    return { transfer: transferView(rec), link: `${siteOrigin()}/claim/${token}` };
  },

  async transfersFor(roomId) {
    settleTransfers();
    const v = viewer();
    const room = S().rooms[roomId] ?? Object.values(S().rooms).find((r) => r.slug === roomId);
    if (!v || !room || (room.owner_id !== v.id && !v.staff)) throw new Error("Not allowed");
    return Object.values(S().transfers)
      .filter((t) => t.room_id === room.id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(transferView);
  },

  async revoke(transferId) {
    settleTransfers();
    const v = requireViewer();
    const t = S().transfers[transferId] ?? fail("not_found");
    const room = S().rooms[t.room_id];
    if (!room || (roleOf(room.id, v.id) !== "owner" && !v.staff)) throw new Error("Not allowed");
    const closed = closedReason(t);
    if (closed) return fail(closed);
    t.status = "revoked";
    if (t.organiser_id) logLine(t.organiser_id, "transfer", `Link for ${t.to_email} cancelled`, v.name);
    emit();
  },
};
