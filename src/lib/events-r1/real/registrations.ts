/** Real registrations, tickets and the Audience (supabase/events_r1_registrations.sql, events_r1_tickets.sql). */
import type { RegistrationsApi } from "../api";
import { emit, reasonText, rpc, rpcOk, who } from "./core";
import { eventIdOf } from "./ids";
import { iso, mapRegistration, mapTicket } from "./map";

type Row = Record<string, unknown>;

/** A cell for the CSV. A guest chooses their own name, so a cell that starts like a formula gets a quote in front (spreadsheets run formulas). */
function csvCell(v: string | null | undefined): string {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Hands out the tickets of one event. */
async function tickets(eventId: string) {
  const rows = (await rpc<Row[] | null>("ev_my_tickets", { p_event: await eventIdOf(eventId) })) ?? [];
  return rows.map((r) => mapTicket(r, rows.length));
}

export const registrations: RegistrationsApi = {
  async register(eventId, opts) {
    const args: Record<string, unknown> = {};
    if (opts?.ticketTypeId) args.ticketTypeId = opts.ticketTypeId;
    if (opts?.answers) args.answers = opts.answers;
    if (opts?.referrerId) args.referrerId = opts.referrerId;
    const out = await rpcOk<{ registration: Row }>("ev_register", { p_event: await eventIdOf(eventId), p_opts: args });
    emit();
    return mapRegistration(out.registration);
  },

  async cancel(eventId) {
    const out = await rpc<string | null>("ev_cancel_registration", { p_event: await eventIdOf(eventId) });
    // Nothing to cancel is fine (the fake layer returns quietly too).
    if (out === "ok" || out === "not_registered" || out === "not_found") {
      emit();
      return;
    }
    throw new Error(reasonText(out));
  },

  async list(eventId) {
    const out = await rpcOk<{ registrations: Row[] | null }>("ev_audience", { p_event: await eventIdOf(eventId) });
    return (out.registrations ?? []).map(mapRegistration).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  },

  async approve(registrationId) {
    const out = await rpcOk<{ registration: Row }>("ev_decide", { p_registration: registrationId, p_action: "approve" }, { not_found: "Registration not found" });
    emit();
    return mapRegistration(out.registration);
  },

  async decline(registrationId) {
    const out = await rpcOk<{ registration: Row }>("ev_decide", { p_registration: registrationId, p_action: "decline" }, { not_found: "Registration not found" });
    emit();
    return mapRegistration(out.registration);
  },

  async promote(registrationId) {
    const out = await rpcOk<{ registration: Row }>("ev_promote", { p_registration: registrationId }, { not_found: "Registration not found" });
    emit();
    return mapRegistration(out.registration);
  },

  async exportCsv(eventId) {
    const rows = await rpc<Row[] | null>("ev_export", { p_event: await eventIdOf(eventId) });
    // The function answers nothing for a person who may not export; the screens only offer Export to the host.
    const head = ["Name", "Email", "Phone", "Ticket", "Status", "Registered", "Checked in", "Invited by"];
    const lines = (rows ?? []).map((r) =>
      [r.name, r.email, r.phone, r.ticket, r.status, iso(r.registered), iso(r.checked_in), r.invited_by].map((v) => csvCell(v == null ? null : String(v))).join(",")
    );
    return [head.join(","), ...lines].join("\n") + "\n";
  },

  async ticketFor(eventId) {
    if (!who()) return null;
    return (await tickets(eventId))[0] ?? null;
  },

  async ticketsFor(eventId) {
    if (!who()) return [];
    return tickets(eventId);
  },

  inviteRef(eventId) {
    const v = who();
    return v ? v.id : `guest-${eventId.slice(0, 8)}`;
  },
};
