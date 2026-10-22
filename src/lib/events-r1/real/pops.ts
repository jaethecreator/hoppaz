/** Real Pops (supabase/events_r1_pops.sql). */
import type { PopsApi } from "../api";
import type { Pop } from "../types";
import { emit, rpc, rpcOk } from "./core";
import { eventIdOf } from "./ids";
import { mapPop } from "./map";

/** The longest a Pop may be: the room's announcements stop at 280 (the database allows 500 but cuts the room's copy). */
const MAX_POP = 280;

/** Pops this tab has seen, by id: shareText(popId) needs the Pop's text and event, and the database has no read by Pop id. */
/** What the automatic Pop calls answer, in the fake layer's words. */
const AUTO = { not_found: "Pop not found", already_sent: "Already sent", time_passed: "That time has passed", too_long: `Keep it under ${MAX_POP} characters` };

const seen = new Map<string, { body: string; event: string }>();
const remember = (p: Pop): Pop => {
  seen.set(p.id, { body: p.body, event: p.event_id });
  return p;
};

export const pops: PopsApi = {
  async listForEvent(eventId) {
    const rows = await rpc<Record<string, unknown>[] | null>("ev_host_pops", { p_event: await eventIdOf(eventId) });
    return (rows ?? []).map((r) => remember(mapPop(r)));
  },

  async visibleOnEvent(eventId) {
    const rows = await rpc<Record<string, unknown>[] | null>("ev_event_pops", { p_event: await eventIdOf(eventId) });
    return (rows ?? []).map((r) => remember(mapPop(r)));
  },

  async send({ eventId, body, audience, alsoRoom, sendAt }) {
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_POP) throw new Error(`Keep it under ${MAX_POP} characters`);
    const id = await eventIdOf(eventId);
    let when: string | null = null;
    if (sendAt) {
      const t = Date.parse(sendAt);
      if (!Number.isFinite(t)) throw new Error("Pick a time to send");
      if (t <= Date.now()) throw new Error("Pick a time in the future");
      const e = await rpc<{ starts_at?: string } | null>("ev_get_event", { p_id_or_slug: id });
      if (e?.starts_at && t > Date.parse(e.starts_at)) throw new Error("Pick a time before the event starts");
      when = new Date(t).toISOString();
    }
    const out = await rpcOk<{ pop: Record<string, unknown> }>(
      "ev_send_pop",
      { p_event: id, p_body: text, p_audience: audience, p_also_room: alsoRoom, p_send_at: when },
      { too_long: `Keep it under ${MAX_POP} characters` }
    );
    emit();
    return remember(mapPop(out.pop));
  },

  async shareText(popId) {
    const p = seen.get(popId);
    if (!p) throw new Error("Pop not found");
    const e = await rpc<{ slug?: string } | null>("ev_get_event", { p_id_or_slug: p.event });
    return `${p.body}\n\nhttps://hoppaz.fun/e/${e?.slug ?? p.event}`;
  },

  async cancelScheduled(popId) {
    await rpcOk("ev_cancel_pop", { p_pop: popId }, { not_found: "Pop not found", already_sent: "Already sent", use_switch: "Switch it off instead" });
    emit();
  },

  async setAuto(eventId, auto, enabled) {
    const out = await rpcOk<{ pop: Record<string, unknown> }>("ev_set_auto_pop", { p_event: await eventIdOf(eventId), p_auto: auto, p_enabled: enabled }, AUTO);
    emit();
    return remember(mapPop(out.pop));
  },

  async editAuto(eventId, auto, body) {
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_POP) throw new Error(`Keep it under ${MAX_POP} characters`);
    const out = await rpcOk<{ pop: Record<string, unknown> }>("ev_edit_auto_pop", { p_event: await eventIdOf(eventId), p_auto: auto, p_body: text }, AUTO);
    emit();
    return remember(mapPop(out.pop));
  },
};
