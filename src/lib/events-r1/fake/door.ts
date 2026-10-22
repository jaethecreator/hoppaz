/**
 * Fake door scan. A ticket is checked three ways: the signature (this fake's own key), that it is for this event, and
 * that the ticket and the registration are still good. Express checks in at once; Standard returns "confirm" first.
 * A typed registration code (or search by name) works when a QR will not scan. Host or staff only.
 */
import type { DoorApi } from "../api";
import type { Registration, ScanResult } from "../types";
import { readToken } from "./crypto";
import { assertManage, findEvent, isGoing, regsOf, statusOf, ensureTicket } from "./rules";
import { registrationCode } from "./registrations";
import { emit, now, S } from "./store";
import { clone } from "./util";

type Found = { reg: Registration } | { result: ScanResult };

const notValid = (reason: Extract<ScanResult, { kind: "not_valid" }>["reason"]): { result: ScanResult } => ({
  result: { ok: false, kind: "not_valid", reason },
});

function counts(eventId: string) {
  const regs = regsOf(eventId);
  const checked = regs.filter((r) => r.status === "checked_in").length;
  const going = regs.filter((r) => isGoing(r.status)).length;
  return { going, checked_in: checked, pending: regs.filter((r) => r.status === "requested").length, waitlist: regs.filter((r) => r.status === "waitlisted").length };
}

function used(reg: Registration): { result: ScanResult } {
  return { result: { ok: false, kind: "already_used", name: reg.name, at: reg.checked_in_at ?? new Date(now()).toISOString() } };
}

/** Work out who a scanned token or a typed code belongs to, and whether they may come in. */
async function find(eventId: string, input: string): Promise<Found> {
  const text = input.trim();
  const e = S().events[eventId];
  if (!e) return notValid("unknown");

  if (text.includes(".")) {
    const read = await readToken(text);
    if ("error" in read) return notValid("bad_signature");
    const { t, e: tokenEvent, v } = read.payload;
    if (tokenEvent !== eventId) return notValid("wrong_event");
    const ticket = S().tickets[t];
    if (!ticket || ticket.event_id !== eventId) return notValid("unknown");
    const reg = S().regs[ticket.reg_id];
    if (!reg) return notValid("unknown");
    if (ticket.version !== v || ticket.status === "void") return notValid("void");
    if (reg.status === "checked_in" || ticket.status === "used") return used(reg);
    if (!isGoing(reg.status)) return notValid("not_going");
    if (statusOf(e) === "cancelled") return notValid("void");
    return { reg };
  }

  // A typed code: the short registration code, or the full registration id.
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const reg = regsOf(eventId).find((r) => registrationCode(r) === code || r.id.replace(/-/g, "").toUpperCase() === code);
  if (!reg || code.length < 6) return notValid("unknown");
  if (reg.status === "checked_in") return used(reg);
  if (!isGoing(reg.status)) return notValid("not_going");
  return { reg };
}

function checkIn(reg: Registration): ScanResult {
  reg.status = "checked_in";
  reg.checked_in_at = new Date(now()).toISOString();
  ensureTicket(reg).status = "used";
  emit();
  const c = counts(reg.event_id);
  return { ok: true, kind: "checked_in", name: reg.name, ticket: "General", checked_in: c.checked_in, total: c.going };
}

function confirmCard(reg: Registration): ScanResult {
  const c = counts(reg.event_id);
  return { ok: true, kind: "confirm", name: reg.name, ticket: "General", checked_in: c.checked_in, total: c.going };
}

export const door: DoorApi = {
  async scan(eventId, token, mode) {
    assertManage(findEvent(eventId));
    const f = await find(eventId, token);
    if ("result" in f) return f.result;
    return mode === "express" ? checkIn(f.reg) : confirmCard(f.reg);
  },

  async confirm(eventId, token) {
    assertManage(findEvent(eventId));
    const f = await find(eventId, token);
    if ("result" in f) return f.result;
    return checkIn(f.reg);
  },

  async search(eventId, q) {
    assertManage(findEvent(eventId));
    const needle = q.trim().toLowerCase();
    return clone(
      regsOf(eventId)
        .filter((r) => isGoing(r.status) && (!needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 50)
    );
  },

  async checkInById(eventId, registrationId) {
    assertManage(findEvent(eventId));
    const reg = S().regs[registrationId];
    if (!reg || reg.event_id !== eventId) return notValid("unknown").result;
    if (reg.status === "checked_in") return used(reg).result;
    if (!isGoing(reg.status)) return notValid("not_going").result;
    return checkIn(reg);
  },

  async counts(eventId) {
    assertManage(findEvent(eventId));
    return counts(eventId);
  },
};

