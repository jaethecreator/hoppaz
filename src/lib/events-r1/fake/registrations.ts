/**
 * Fake registrations. One per person per event. Free and no approval: going if there is room. Free with approval:
 * requested. Full: waitlisted if the waitlist is on, else closed. Places are counted from going and checked-in people
 * only, per ticket type and for the event as a whole. A paid ticket type is bought through pay.checkout, never registered
 * (registrations.register throws "use_checkout"); the paid order makes the registration (fake/pay.ts), with quantity N.
 */
import type { RegistrationsApi } from "../api";
import type { Registration, Ticket } from "../types";
import { PAID_UNAVAILABLE } from "../constants";
import { paidTicketsOn } from "../flags";
import { signToken } from "./crypto";
import { defaultQuestions } from "./defaults";
import {
  admit, assertManage, canOpen, ensureTickets, fillFromWaitlist, findEvent, isFull, isGoing, regOf, regsOf,
  renumberWaitlist, requireViewer, seatsOf, typeFull, typeOfReg, typesOf, userById, voidTicket,
} from "./rules";
import type { TicketRec } from "./store";
import { emit, now, persist, S, viewer } from "./store";
import { clone, newId } from "./util";

/** The short code for a registration, to type at the door when a QR will not scan: first 8 characters of its id. */
export const registrationCode = (reg: Registration): string => reg.id.replace(/-/g, "").slice(0, 8).toUpperCase();

function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The host's questions: Name and Email come from the account; a required custom question needs an answer. */
export function cleanAnswers(eventId: string, given?: Record<string, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [k, val] of Object.entries(given ?? {})) if (typeof val === "string" && val.trim()) answers[k] = val.trim();
  const qs = S().regSettings[eventId]?.questions ?? defaultQuestions();
  for (const q of qs) {
    if (q.builtin === "name" || q.builtin === "email" || q.enabled === false || !q.required) continue;
    if (!answers[q.id]) throw new Error(`Please answer: ${q.label}`);
  }
  return answers;
}

function regById(id: string): Registration {
  const r = S().regs[id];
  if (!r) throw new Error("Registration not found");
  return r;
}

/** The short code a door person types for a ticket: seat 1 uses the registration's code; the other seats use their own id. */
export const ticketCode = (reg: Registration, t: TicketRec): string =>
  (t.seq ?? 1) <= 1 ? registrationCode(reg) : t.id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Every live ticket of a going registration, seat 1 first. */
export async function ticketsFrom(reg: Registration): Promise<Ticket[]> {
  if (!isGoing(reg.status)) return [];
  const list = ensureTickets(reg);
  const ev = S().events[reg.event_id];
  const out: Ticket[] = [];
  for (const t of list) {
    const type = ev ? typeOfReg(ev, { ticket_type_id: t.type_id ?? reg.ticket_type_id }) : null;
    const ticket: Ticket = {
      id: t.id,
      event_id: reg.event_id,
      holder_name: reg.name,
      ticket_name: (t.type_id ? type?.name : reg.ticket_name) || type?.name || "General",
      code: ticketCode(reg, t),
      token: await signToken({ t: t.id, e: reg.event_id, v: t.version }),
      version: t.version,
      status: t.status === "used" || (reg.status === "checked_in" && list.length === 1) ? "used" : "valid",
    };
    // Seat numbers only matter when there is more than one.
    if (list.length > 1) {
      ticket.seat_no = out.length + 1;
      ticket.seats = list.length;
    }
    out.push(ticket);
  }
  return out;
}

export async function ticketFrom(reg: Registration): Promise<Ticket | null> {
  return (await ticketsFrom(reg))[0] ?? null;
}

export const registrations: RegistrationsApi = {
  async register(eventId, opts) {
    const v = requireViewer();
    const e = findEvent(eventId);
    if (!e || !canOpen(e)) throw new Error("Event not found");
    if (e.status === "cancelled") throw new Error("This event was cancelled");
    if (now() > (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 3 * 3.6e6)) throw new Error("This event is over");

    const existing = regOf(e.id, v.id);
    if (existing && existing.status !== "cancelled") {
      if (existing.status === "declined") throw new Error("The host did not take your request");
      return clone(existing);
    }

    // The ticket type: the one asked for, else the first free type with room (else the first free one: it is full).
    const types = typesOf(e);
    let type = types[0];
    if (opts?.ticketTypeId) {
      const asked = types.find((t) => t.id === opts.ticketTypeId);
      if (!asked) throw new Error("Pick a ticket");
      type = asked;
    } else {
      const free = types.filter((t) => t.price_naira === 0);
      type = free.find((t) => !typeFull(e, t)) ?? free[0] ?? types[0];
    }
    // A paid type is bought, not registered: switch off it is unavailable; on, the screen must use pay.checkout.
    if (type.price_naira > 0) throw new Error(paidTicketsOn() ? "use_checkout" : PAID_UNAVAILABLE);

    const answers = cleanAnswers(e.id, opts?.answers);

    // Full: waitlist if it is on, otherwise closed. Approval: requested. Else in.
    let status: Registration["status"];
    if (typeFull(e, type)) {
      if (!e.waitlist_on) throw new Error(isFull(e) ? "This event is full" : "That ticket is full");
      status = "waitlisted";
    } else status = e.requires_approval ? "requested" : "going";

    const ref = opts?.referrerId && opts.referrerId !== v.id ? userById(opts.referrerId) : null;
    const reg: Registration = existing ?? {
      id: newId(), event_id: e.id, user_id: v.id, name: v.name, email: v.email, phone: null, status, ticket_type_id: type.id,
      ticket_name: type.name, quantity: 1, answers: {},
      referrer_id: null, referrer_name: null, created_at: "", checked_in_at: null, waitlist_pos: null,
    };
    Object.assign(reg, {
      name: v.name,
      email: v.email,
      phone: answers.phone ?? null,
      ticket_type_id: type.id,
      ticket_name: type.name,
      quantity: 1,
      status,
      answers,
      referrer_id: ref ? ref.id : (existing?.referrer_id ?? null),
      referrer_name: ref ? ref.name : (existing?.referrer_name ?? null),
      created_at: new Date(now()).toISOString(),
      checked_in_at: null,
      waitlist_pos: null,
    });
    S().regs[reg.id] = reg;
    if (status === "going") admit(reg);
    renumberWaitlist(e.id);
    emit();
    return clone(reg);
  },

  async cancel(eventId) {
    const v = requireViewer();
    const e = findEvent(eventId);
    const reg = e ? regOf(e.id, v.id) : undefined;
    if (!e || !reg || reg.status === "cancelled") return;
    if (reg.status === "checked_in") throw new Error("You are already checked in");
    // A paid order is undone by a refund from the host, not by the buyer.
    if (isGoing(reg.status) && Object.values(S().tickets).some((t) => t.reg_id === reg.id && t.order_id && t.status !== "void")) {
      throw new Error("You paid for this ticket. Ask the host for a refund.");
    }
    const wasGoing = isGoing(reg.status);
    reg.status = "cancelled";
    reg.waitlist_pos = null;
    voidTicket(reg);
    if (wasGoing) fillFromWaitlist(e.id);
    else renumberWaitlist(e.id);
    emit();
  },

  async list(eventId) {
    const e = assertManage(findEvent(eventId));
    return clone(regsOf(e.id).filter((r) => r.status !== "cancelled").sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
  },

  async approve(registrationId) {
    const reg = regById(registrationId);
    const e = assertManage(S().events[reg.event_id]);
    if (reg.status !== "requested" && reg.status !== "waitlisted") throw new Error("Nothing to approve");
    if (!typeFull(e, typeOfReg(e, reg))) admit(reg);
    else reg.status = "waitlisted"; // no place left: the host's yes puts them on the waitlist
    renumberWaitlist(e.id);
    emit();
    return clone(reg);
  },

  async decline(registrationId) {
    const reg = regById(registrationId);
    const e = assertManage(S().events[reg.event_id]);
    if (reg.status === "cancelled" || reg.status === "declined") return clone(reg);
    const wasGoing = isGoing(reg.status);
    reg.status = "declined";
    reg.waitlist_pos = null;
    voidTicket(reg);
    if (wasGoing) fillFromWaitlist(e.id);
    else renumberWaitlist(e.id);
    emit();
    return clone(reg);
  },

  async promote(registrationId) {
    const reg = regById(registrationId);
    const e = assertManage(S().events[reg.event_id]);
    if (reg.status !== "waitlisted") throw new Error("This person is not on the waitlist");
    if (typeFull(e, typeOfReg(e, reg))) throw new Error("No free place. Raise the capacity first.");
    admit(reg);
    renumberWaitlist(e.id);
    emit();
    return clone(reg);
  },

  async exportCsv(eventId) {
    const e = assertManage(findEvent(eventId));
    const head = ["Name", "Email", "Phone", "Ticket", "Tickets", "Status", "Registered", "Checked in", "Invited by"];
    const rows = regsOf(e.id)
      .filter((r) => r.status !== "cancelled")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => [r.name, r.email, r.phone, r.ticket_name, String(seatsOf(r)), r.status, r.created_at, r.checked_in_at, r.referrer_name].map(csvCell).join(","));
    return [head.join(","), ...rows].join("\n") + "\n";
  },

  async ticketFor(eventId) {
    const v = viewer();
    const e = findEvent(eventId);
    const reg = v && e ? regOf(e.id, v.id) : undefined;
    if (!reg) return null;
    const t = await ticketFrom(reg);
    persist(); // a ticket made on demand is saved, but nothing else changed: no emit (a screen reading it would loop)
    return t;
  },

  async ticketsFor(eventId) {
    const v = viewer();
    const e = findEvent(eventId);
    const reg = v && e ? regOf(e.id, v.id) : undefined;
    if (!reg) return [];
    const list = await ticketsFrom(reg);
    persist();
    return list;
  },

  inviteRef(eventId) {
    const v = viewer();
    return v ? v.id : `guest-${eventId.slice(0, 8)}`;
  },
};

