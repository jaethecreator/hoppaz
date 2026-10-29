/** Real door scan (supabase/events_r1_tickets.sql). The database checks the signature, the event and the ticket; this only carries the answer. */
import type { DoorApi } from "../api";
import type { ScanResult } from "../types";
import { emit, reasonText, rpc, rpcText } from "./core";
import { soft } from "./roomProfile";
import { eventIdOf } from "./ids";
import { mapRegistration } from "./map";

type Row = Record<string, unknown>;

/** A scan answer is a ScanResult when it has a kind; otherwise it is { ok: false, reason } (not allowed, no session ...). */
function scanResult(out: Row | null): ScanResult {
  if (out && typeof out.kind === "string") return out as unknown as ScanResult;
  throw new Error(reasonText(out?.reason));
}

export const door: DoorApi = {
  async scan(eventId, token, mode) {
    const out = await rpc<Row | null>("ev_scan", { p_event: await eventIdOf(eventId), p_input: token, p_mode: mode });
    const r = scanResult(out);
    if (r.ok && r.kind === "checked_in") emit();
    return r;
  },

  async confirm(eventId, token) {
    const out = await rpc<Row | null>("ev_scan", { p_event: await eventIdOf(eventId), p_input: token, p_mode: "confirm" });
    const r = scanResult(out);
    if (r.ok) emit();
    return r;
  },

  async search(eventId, q) {
    const out = await rpc<Row[] | Row | null>("ev_door_search", { p_event: await eventIdOf(eventId), p_q: q });
    if (!Array.isArray(out)) throw new Error(reasonText((out as Row | null)?.reason));
    return out.map(mapRegistration);
  },

  async checkInById(eventId, registrationId) {
    const out = await rpc<Row | null>("ev_checkin_manual", { p_event: await eventIdOf(eventId), p_registration: registrationId });
    const r = scanResult(out);
    if (r.ok) emit();
    return r;
  },

  async counts(eventId) {
    const out = await rpc<Row | null>("ev_door_counts", { p_event: await eventIdOf(eventId) });
    if (!out || out.ok !== true) throw new Error(reasonText(out?.reason));
    const n = (v: unknown) => Number(v) || 0;
    return { going: n(out.going), checked_in: n(out.checked_in), pending: n(out.pending), waitlist: n(out.waitlist) };
  },

  /** The people added for this event. ev_door_staff_list is in events_r1_room_profile.sql (a draft): until it is run the list reads empty. */
  async staff(eventId) {
    const r = await soft<Row[] | null>("ev_door_staff_list", { p_event: await eventIdOf(eventId) });
    if (r.missing) return [];
    if (r.error) throw new Error("That did not work. Try again");
    if (!r.data) throw new Error("Not allowed");
    return r.data.map((p) => ({ user_id: String(p.user_id), name: String(p.name ?? "Hopper") }));
  },

  async setStaff(eventId, userId, on) {
    await rpcText("ev_set_door_staff", { p_event: await eventIdOf(eventId), p_user: userId, p_on: !!on }, {
      not_allowed: "Not allowed", no_such_user: "We can't find that person", too_many: "That is the most door staff for one event",
    });
    emit();
  },
};
