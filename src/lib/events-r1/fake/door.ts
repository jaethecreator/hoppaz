/**
 * Fake door scan. A ticket is checked three ways: the signature (this fake's own key), that it is for this event, and
 * that the ticket and the registration are still good. Express checks in at once; Standard returns "confirm" first.
 * A typed registration code (or search by name) works when a QR will not scan. Host or staff only.
 * Check-in is per ticket: a paid order with 3 tickets has 3 QR codes, and each checks in on its own. The counts are tickets.
 */
import type { DoorApi } from "../api";
import type { Registration, ScanResult } from "../types";
import { readToken } from "./crypto";
import { assertManage, ensureTickets, findEvent, isGoing, regsOf, seatsOf, statusOf, ticketsOfReg, usedSeats } from "./rules";
import { registrationCode, ticketCode } from "./registrations";
import type { TicketRec } from "./store";
import { emit, now, S } from "./store";
import { clone } from "./util";

type Found = { reg: Registration; ticket: TicketRec } | { result: ScanResult };

const notValid = (reason: Extract<ScanResult, { kind: "not_valid" }>["reason"]): { result: ScanResult } => ({
  result: { ok: false, kind: "not_valid", reason },
});

/** The ticket type's name on the door card (a registration saved before types existed was General). */
const ticketOf = (reg: Registration) => reg.ticket_name || "General";

/** Seat number and seats, only when the order has more than one ticket. */
function seatOf(reg: Registration, t: TicketRec): { seat_no?: number; seats?: number } {
  const live = ticketsOfReg(reg.id).filter((x) => x.status !== "void");
  const i = live.findIndex((x) => x.id === t.id);
  return live.length > 1 && i >= 0 ? { seat_no: i + 1, seats: live.length } : {};
}

function counts(eventId: string) {
  const regs = regsOf(eventId);
  const checked = regs.reduce((n, r) => n + usedSeats(r), 0);
  const going = regs.filter((r) => isGoing(r.status)).reduce((n, r) => n + seatsOf(r), 0);
  return { going, checked_in: checked, pending: regs.filter((r) => r.status === "requested").length, waitlist: regs.filter((r) => r.status === "waitlisted").length };
}

function used(reg: Registration, t?: TicketRec): { result: ScanResult } {
  return {
    result: { ok: false, kind: "already_used", name: reg.name, at: t?.checked_in_at ?? reg.checked_in_at ?? new Date(now()).toISOString(), ...(t ? seatOf(reg, t) : {}) },
  };
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
    if (ticket.status === "used" || (reg.status === "checked_in" && ticketsOfReg(reg.id).length <= 1)) return used(reg, ticket);
    if (!isGoing(reg.status)) return notValid("not_going");
    if (statusOf(e) === "cancelled") return notValid("void");
    return { reg, ticket };
  }

  // A typed code: one ticket's short code (seat 1 uses the registration code), or the full registration id (its next ticket).
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 6) return notValid("unknown");
  for (const reg of regsOf(eventId)) {
    for (const t of ticketsOfReg(reg.id)) {
      if (t.status === "void" || ticketCode(reg, t) !== code) continue;
      if (t.status === "used") return used(reg, t);
      if (!isGoing(reg.status)) return notValid("not_going");
      return { reg, ticket: t };
    }
  }
  const reg = regsOf(eventId).find((r) => registrationCode(r) === code || r.id.replace(/-/g, "").toUpperCase() === code);
  if (!reg) return notValid("unknown");
  return nextOf(reg);
}

/** The next ticket of a registration that is not checked in yet. */
function nextOf(reg: Registration): Found {
  if (!isGoing(reg.status)) return notValid("not_going");
  const live = ensureTickets(reg);
  const next = live.find((t) => t.status !== "used");
  if (!next) return used(reg, live[live.length - 1]);
  return { reg, ticket: next };
}

function checkIn(reg: Registration, t: TicketRec): ScanResult {
  const at = new Date(now()).toISOString();
  t.status = "used";
  t.checked_in_at = at;
  reg.checked_in_at = reg.checked_in_at ?? at;
  const live = ticketsOfReg(reg.id).filter((x) => x.status !== "void");
  reg.checked_in_count = live.filter((x) => x.status === "used").length;
  if (live.every((x) => x.status === "used")) reg.status = "checked_in";
  emit();
  const c = counts(reg.event_id);
  return { ok: true, kind: "checked_in", name: reg.name, ticket: ticketOf(reg), checked_in: c.checked_in, total: c.going, ...seatOf(reg, t) };
}

function confirmCard(reg: Registration, t: TicketRec): ScanResult {
  const c = counts(reg.event_id);
  return { ok: true, kind: "confirm", name: reg.name, ticket: ticketOf(reg), checked_in: c.checked_in, total: c.going, ...seatOf(reg, t) };
}

export const door: DoorApi = {
  async scan(eventId, token, mode) {
    assertManage(findEvent(eventId));
    const f = await find(eventId, token);
    if ("result" in f) return f.result;
    return mode === "express" ? checkIn(f.reg, f.ticket) : confirmCard(f.reg, f.ticket);
  },

  async confirm(eventId, token) {
    assertManage(findEvent(eventId));
    const f = await find(eventId, token);
    if ("result" in f) return f.result;
    return checkIn(f.reg, f.ticket);
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
    const next = nextOf(reg);
    return "result" in next ? next.result : checkIn(next.reg, next.ticket);
  },

  async counts(eventId) {
    assertManage(findEvent(eventId));
    return counts(eventId);
  },
};

