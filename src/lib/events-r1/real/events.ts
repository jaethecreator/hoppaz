/** Real events: ev_list_events, ev_get_event, ev_create_event and friends (supabase/events_r1_events.sql, events_r1_registrations.sql). */
import type { EventsApi } from "../api";
import type { R1Event, ViewerState } from "../types";
import { client, emit, ready, rpc, rpcOk, rpcText, subscribe, userId, who } from "./core";
import { cleanQuestions, mapEvent, mapRegistration } from "./map";
import { eventIdOf, roomIdOf } from "./ids";

/** An id, or a slug the database also finds. */
const key = (idOrSlug: string) => String(idOrSlug).trim();

/** The event as a screen gets it, or the reason it cannot be had. */
async function visible(idOrSlug: string): Promise<R1Event> {
  const j = await rpc<Record<string, unknown> | null>("ev_get_event", { p_id_or_slug: key(idOrSlug) });
  if (!j) throw new Error("Event not found");
  return mapEvent(j);
}

export const events: EventsApi = {
  async list() {
    const rows = await rpc<Record<string, unknown>[] | null>("ev_list_events");
    return (rows ?? []).map(mapEvent);
  },

  async get(idOrSlug) {
    const j = await rpc<Record<string, unknown> | null>("ev_get_event", { p_id_or_slug: key(idOrSlug) });
    return j ? mapEvent(j) : null;
  },

  async listMine() {
    const rows = await rpc<Record<string, unknown>[] | null>("ev_my_events");
    return (rows ?? []).map(mapEvent);
  },

  async listForRoom(roomId) {
    const id = await roomIdOf(roomId);
    if (!id) return [];
    const rows = await rpc<Record<string, unknown>[] | null>("ev_room_events", { p_room: id });
    return (rows ?? []).map(mapEvent);
  },

  async create(draft) {
    const out = await rpcOk<{ event: Record<string, unknown> }>("ev_create_event", { p_draft: draft });
    emit();
    return mapEvent(out.event);
  },

  async update(id, patch) {
    const out = await rpcOk<{ event: Record<string, unknown> }>("ev_update_event", { p_event: await eventIdOf(id), p_patch: patch });
    emit();
    return mapEvent(out.event);
  },

  async clone(id) {
    const out = await rpcOk<{ event: Record<string, unknown> }>("ev_clone_event", { p_event: await eventIdOf(id) });
    emit();
    return mapEvent(out.event);
  },

  async cancel(id) {
    const out = await rpcOk<{ event: Record<string, unknown> }>("ev_cancel_event", { p_event: await eventIdOf(id) });
    emit();
    return mapEvent(out.event);
  },

  /** Swipe right: the app's own swipes table (there is no function for it). A guest session may swipe. */
  async setInterested(id, on) {
    const event = await visible(id);
    const me = await userId();
    if (!me) throw new Error("Sign in first");
    const sb = client();
    // Swipes can be inserted and deleted but not updated, so an earlier "pass" is cleared first (as the app does).
    const cleared = await sb.from("swipes").delete().eq("user_id", me).eq("event_id", event.id);
    if (cleared.error) throw new Error("That did not work. Try again");
    if (on) {
      const { error } = await sb.from("swipes").insert({ user_id: me, event_id: event.id, decision: "in" });
      if (error) throw new Error("That did not work. Try again");
    }
    emit();
  },

  async viewerState(id) {
    const j = await rpc<Record<string, unknown> | null>("ev_viewer_state", { p_event: await eventIdOf(id) });
    if (!j) throw new Error("Event not found");
    // A guest (the app's anonymous session) has an auth.uid() but no account: the database says signedIn false for them, and so do we.
    await ready();
    return { ...(j as unknown as ViewerState), signedIn: j.signedIn === true && who() !== null, registration: j.registration ? mapRegistration(j.registration) : null };
  },

  async getRegistrationSettings(id) {
    const j = await rpc<{ questions: unknown; messages: unknown } | null>("ev_get_registration_settings", { p_event: await eventIdOf(id) });
    if (!j) throw new Error("Event not found");
    return j as Awaited<ReturnType<EventsApi["getRegistrationSettings"]>>;
  },

  async setRegistrationSettings(id, s) {
    const settings: Record<string, unknown> = {};
    if (s.questions) settings.questions = cleanQuestions(s.questions);
    if (s.messages) settings.messages = s.messages;
    await rpcText("ev_set_registration_settings", { p_event: await eventIdOf(id), p_settings: settings });
    emit();
  },

  subscribe,
};
