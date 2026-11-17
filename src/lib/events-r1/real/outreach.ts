/**
 * Real outreach and claims.
 *   outreach (the staff desk): the token-guarded route /api/admin/outreach (service role). The desk has the shared token in
 *     sessionStorage and no account, so nothing here checks a viewer. No token is "Sign in first", a refused one "Not allowed".
 *   claims (organiser side): the database functions of supabase/events_r1_transfer.sql, called as the viewer.
 * The transfer token is made where the link is made and only its sha256 goes to the database: on the server for staff, here in the
 * browser for an owner handing a room over.
 */
import type { ClaimsApi, OutreachApi } from "../api";
import { randomToken, sha256Hex } from "../outreach/token";
import { siteOrigin } from "../siteUrl";
import type { Organiser, TransferLink } from "../types";
import { eventClaimsOn } from "../flags";
import { emit, rpc } from "./core";
import { eventIdOf, roomIdOf } from "./ids";
import { mapAccept, mapApproveMany, mapClaimable, mapClaimAsk, mapClaimLink, mapClaimRequest, mapImportReport, mapOrganiser, mapOrganiserDetail, mapPreview, mapPulled, mapTapCounts, mapTransfer, mapWeek } from "./map";
import { outreachReason } from "./reasons";
import { soft } from "./roomProfile";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/* ------------------------------------------------------- the desk token -- */

/** The same key the staff desk keeps its token under (src/app/admin/page.tsx). */
const TOKEN_KEY = "hoppaz-admin-token";

function staffToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------ the route -- */

const base = () => process.env.EVENTS_R1_API_BASE ?? "";

/** One call to /api/admin/outreach with the desk's token. GET for a read, POST with { action, ... } for the rest. Answers the route's `data`. */
async function send(query: string, body?: Obj): Promise<unknown> {
  const token = staffToken();
  if (!token) throw new Error("Sign in first");
  let res: Response;
  try {
    res = await fetch(`${base()}/api/admin/outreach${query}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error("No connection. Try again");
  }
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; data?: unknown };
  if (res.status === 401) throw new Error("Not allowed");
  if (!res.ok || out.ok === false) throw new Error(out.message || "That did not work. Try again");
  return out.data;
}

const read = (what: string, id?: string) => send(`?what=${encodeURIComponent(what)}${id ? `&id=${encodeURIComponent(id)}` : ""}`);
const write = (body: Obj) => send("", body);

const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** An organiser from a write's answer; if the function only said ok, read it back. */
async function organiserFrom(data: unknown, id: string): Promise<Organiser> {
  if (isObj(data) && typeof data.id === "string") return mapOrganiser(data);
  if (isObj(data) && isObj(data.organiser)) return mapOrganiser(data.organiser);
  return mapOrganiserDetail(await read("organiser", id)).organiser;
}

export const outreach: OutreachApi = {
  async queue() {
    return rows(await read("queue")).map(mapPulled);
  },

  async approve(pulledId, by, patch) {
    const out = (await write({ action: "approve", pulled: pulledId, by, patch })) as { eventId?: string; organiserId?: string };
    emit();
    return { eventId: String(out?.eventId ?? ""), organiserId: String(out?.organiserId ?? "") };
  },

  async edit(pulledId, patch) {
    const out = await write({ action: "edit", pulled: pulledId, patch });
    if (isObj(out) && typeof out.id === "string") return mapPulled(out);
    const again = rows(await read("queue")).find((r) => r.id === pulledId);
    if (!again) throw new Error(outreachReason("not_found"));
    return mapPulled(again);
  },

  async reject(pulledId, by, reason) {
    await write({ action: "reject", pulled: pulledId, by, reason });
    emit();
  },

  async merge(pulledId, intoPulledId, by) {
    await write({ action: "merge", pulled: pulledId, into: intoPulledId, by });
    emit();
  },

  async importBatch(batch, opts) {
    const report = mapImportReport((await write({ action: "import", batch, dryRun: opts.dryRun })) as Obj);
    if (!opts.dryRun) emit();
    return report;
  },

  async organisers() {
    return rows(await read("organisers")).map(mapOrganiser);
  },

  async organiser(id) {
    return mapOrganiserDetail(await read("organiser", id));
  },

  async saveOrganiser(id, patch) {
    const out = await write({ action: "save_organiser", id, patch });
    emit();
    return organiserFrom(out, id);
  },

  async logContact(id, input) {
    await write({ action: "log_contact", id, by: input.by, kind: input.kind, channel: input.channel ?? null, body: input.body });
    emit();
  },

  async setStage(id, stage, by) {
    const out = await write({ action: "set_stage", id, stage, by });
    emit();
    return organiserFrom(out, id);
  },

  async deleteListingAndRoom(id, confirmName, by) {
    const out = (await write({ action: "delete_listing", id, confirm: confirmName, by })) as { events?: number };
    emit();
    return { events: Number(out?.events) || 0 };
  },

  async createClaimLink(target, by) {
    const out = (await write({ action: "create_claim_link", ...("eventId" in target ? { event: target.eventId } : { id: target.organiserId }), by })) as { link?: Obj; url?: string };
    if (!out?.link || !out.url) throw new Error("That did not work. Try again");
    emit();
    return { link: mapClaimLink(out.link), url: out.url };
  },

  async revokeClaimLink(linkId, by) {
    await write({ action: "revoke_claim_link", id: linkId, by });
    emit();
  },

  async claimable() {
    return rows(await read("claimable")).map(mapClaimable);
  },

  async claimAsks() {
    return rows(await read("claim_asks")).map(mapClaimAsk);
  },

  async decideClaimAsk(askId, approve, by) {
    const out = (await write({ action: "decide_claim_ask", id: askId, approve, by })) as { moved_events?: number };
    emit();
    return { moved_events: Number(out?.moved_events) || 0 };
  },

  async tapCounts() {
    return mapTapCounts((await read("taps")) as Obj);
  },

  async approveMany(pulledIds, by) {
    const out = (await write({ action: "approve_many", pulled: pulledIds, by })) as Obj;
    emit();
    return mapApproveMany(out, outreachReason);
  },

  async createTransfer(organiserId, email, by, days) {
    const out = (await write({ action: "create_transfer", id: organiserId, email, by, ...(days ? { days } : {}) })) as { transfer?: Obj; link?: string };
    if (!out?.transfer || !out.link) throw new Error("That did not work. Try again");
    emit();
    return { transfer: mapTransfer(out.transfer), link: out.link };
  },

  async revokeTransfer(transferId, by) {
    await write({ action: "revoke_transfer", id: transferId, by });
    emit();
  },

  async claimRequests() {
    return rows(await read("claims")).map(mapClaimRequest);
  },

  async handleClaimRequest(id, by) {
    await write({ action: "handle_claim_request", id, by });
    emit();
  },

  async week() {
    return mapWeek((await read("week")) as Obj);
  },
};

/* --------------------------------------------------------------- claims -- */

/** A function that answers { ok: true, ... } or { ok: false, reason }: the answer, or an Error in plain words. */
async function ask(fn: string, args: Obj): Promise<Obj> {
  const out = await rpc<unknown>(fn, args);
  if (!isObj(out) || out.ok !== true) throw new Error(outreachReason(isObj(out) ? out.reason : null, isObj(out) ? out : null));
  return out;
}

export const claims: ClaimsApi = {
  async requestClaim(eventId, who) {
    await ask("ev_claim_request", {
      p_event: await eventIdOf(eventId),
      p_name: who.name.trim(),
      p_email: who.email.trim(),
      p_phone: who.phone?.trim() || null,
      p_note: who.note?.trim() ?? "",
    });
  },

  /** Ask to claim a listing, signed in. Hoppaz keeps the name on the account and the note, nothing else (ev_claim_ask in events_r1_outreach_ready.sql). */
  async askToClaim(eventId, who) {
    await ask("ev_claim_ask", { p_event: await eventIdOf(eventId), p_note: who.note?.trim() ?? "" });
  },

  /** Never throws for a bad link: the reason comes back as data. A network or database failure still throws. */
  async preview(token) {
    const t = token.trim();
    if (!t || t.length > 200) return { ok: false, reason: "not_found" };
    const hash = await sha256Hex(t);
    // A one-time claim link first (the event_claims flag); a hash that is not one of those is an email transfer. A database without the file reads as "not one".
    if (eventClaimsOn()) {
      const r = await soft<unknown>("ev_claim_link_preview", { p_hash: hash });
      if (!r.missing && !r.error && isObj(r.data) && !(r.data.ok === false && r.data.reason === "not_found")) return mapPreview(r.data);
    }
    return mapPreview(await rpc<unknown>("ev_transfer_preview", { p_hash: hash }));
  },

  async accept(token) {
    const hash = await sha256Hex(token.trim());
    if (eventClaimsOn()) {
      const r = await soft<unknown>("ev_claim_link_accept", { p_hash: hash });
      if (!r.missing && !r.error && isObj(r.data)) {
        // "invalid_link" means this hash is not a claim link at all: try it as an email transfer.
        if (r.data.ok === true) {
          emit();
          return mapAccept(r.data);
        }
        if (r.data.reason !== "invalid_link") throw new Error(outreachReason(r.data.reason, r.data));
      }
    }
    const out = await ask("ev_transfer_accept", { p_hash: hash });
    emit();
    return mapAccept(out);
  },

  async startHandover(roomId, email): Promise<TransferLink> {
    const room = await roomIdOf(roomId);
    if (!room) throw new Error("Room not found");
    const token = randomToken();
    const out = await ask("ev_transfer_create_owner", { p_room: room, p_email: email.trim(), p_hash: await sha256Hex(token) });
    if (!isObj(out.transfer)) throw new Error("That did not work. Try again");
    emit();
    return { transfer: mapTransfer(out.transfer), link: `${siteOrigin()}/claim/${token}` };
  },

  async transfersFor(roomId) {
    const room = await roomIdOf(roomId);
    if (!room) return [];
    const out = await rpc<unknown>("ev_transfers_for_room", { p_room: room });
    if (isObj(out)) throw new Error(outreachReason(out.reason, out));
    return rows(out).map(mapTransfer);
  },

  /** An owner cancels their own link. The desk (a shared token, no account) cancels through the staff route. */
  async revoke(transferId) {
    if (staffToken()) await write({ action: "revoke_transfer", id: transferId, by: "Staff" });
    else await ask("ev_transfer_revoke_owner", { p_id: transferId });
    emit();
  },
};
