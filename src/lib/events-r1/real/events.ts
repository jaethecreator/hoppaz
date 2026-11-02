/** Real events: ev_list_events, ev_get_event, ev_create_event and friends (supabase/events_r1_events.sql, events_r1_registrations.sql). */
import type { EventsApi } from "../api";
import { OUTREACH_REASONS, type R1Event, type ViewerState } from "../types";
import { client, emit, ready, rpc, rpcOk, rpcText, subscribe, userId, who } from "./core";
import { cleanQuestions, mapEvent, mapRegistration } from "./map";
import { eventIdOf, roomIdOf } from "./ids";
import { CREATE_LIMIT } from "../constants";
import { cleanLineup } from "../lineup";
import { soft } from "./roomProfile";
import { listingsMap, withListing } from "./listings";

/** An id, or a slug the database also finds. */
const key = (idOrSlug: string) => String(idOrSlug).trim();

type Row = Record<string, unknown>;

/** A list the database answered, as events with the listings merged in. One ev_listings call for the whole list, asked at the same time. */
async function mapAll(load: Promise<Row[] | null>): Promise<R1Event[]> {
  const [rows, listings] = await Promise.all([load, listingsMap()]);
  return (rows ?? []).map((r) => withListing(mapEvent(r), listings));
}

/** One event with its listing merged in (asked together). */
async function mapOne(load: Promise<Row | null>): Promise<R1Event | null> {
  const [j, listings] = await Promise.all([load, listingsMap()]);
  return j ? withListing(mapEvent(j), listings) : null;
}

/** The event as a screen gets it, or the reason it cannot be had. */
async function visible(idOrSlug: string): Promise<R1Event> {
  const ev = await mapOne(rpc<Row | null>("ev_get_event", { p_id_or_slug: key(idOrSlug) }));
  if (!ev) throw new Error("Event not found");
  return ev;
}

export const events: EventsApi = {
  async list() {
    return mapAll(rpc<Row[] | null>("ev_list_events"));
  },

  async get(idOrSlug) {
    return mapOne(rpc<Row | null>("ev_get_event", { p_id_or_slug: key(idOrSlug) }));
  },

  async listMine() {
    return mapAll(rpc<Row[] | null>("ev_my_events"));
  },

  async listForRoom(roomId) {
    const id = await roomIdOf(roomId);
    if (!id) return [];
    return mapAll(rpc<Row[] | null>("ev_room_events", { p_room: id }));
  },

  async create(draft) {
    const { room_id, ...rest } = draft;
    // Post as a room the host is an admin of: make the event, then put it in the room (ev_create_event only posts into the room the host owns).
    // Before ev_post_events_as_room is run the event goes to the host's own room if they own one, else stays their own.
    const asRoom = room_id && draft.add_to_room !== false ? await roomIdOf(room_id) : null;
    const out = await rpcOk<{ event: Record<string, unknown> }>("ev_create_event", { p_draft: asRoom ? { ...rest, add_to_room: false } : rest }, { try_again_later: CREATE_LIMIT });
    let ev = mapEvent(out.event);
    if (asRoom) {
      const moved = await soft<{ ok?: boolean; moved?: number } | null>("ev_post_events_as_room", { p_room: asRoom, p_events: [ev.id] });
      if (moved.missing) await rpcOk("ev_update_event", { p_event: ev.id, p_patch: { add_to_room: true } }).catch(() => undefined);
      const again = await rpc<Record<string, unknown> | null>("ev_get_event", { p_id_or_slug: ev.id });
      if (again) ev = mapEvent(again);
    }
    emit();
    return ev;
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
    const eventId = await eventIdOf(id);
    const [j, listings] = await Promise.all([rpc<Record<string, unknown> | null>("ev_viewer_state", { p_event: eventId }), listingsMap()]);
    if (!j) throw new Error("Event not found");
    // A guest (the app's anonymous session) has an auth.uid() but no account: the database says signedIn false for them, and so do we.
    await ready();
    const state: ViewerState = { ...(j as unknown as ViewerState), signedIn: j.signedIn === true && who() !== null, registration: j.registration ? mapRegistration(j.registration) : null };
    // A listing: tickets are sold by the organiser, whatever the database's button says (it is the one rule for every screen).
    return listings[eventId] ? { ...state, button: "external" } : state;
  },

  /** supabase/events_r1_lineup.sql. Until it is run this answers empty, quietly. */
  async getLineup(id) {
    const r = await soft<unknown>("ev_get_lineup", { p_event: await eventIdOf(id) });
    return cleanLineup(r.data as Parameters<typeof cleanLineup>[0]);
  },

  async setLineup(id, l) {
    const r = await soft<string>("ev_set_lineup", { p_event: await eventIdOf(id), p_lineup: cleanLineup(l) });
    if (r.missing) return; // the file is not run yet: nothing to save to, and nothing to scare the host with
    if (r.data === "not_allowed") throw new Error("Not allowed");
    if (r.data === "no_session") throw new Error("Sign in first");
    if (r.data !== "ok") throw new Error("That did not work. Try again");
    emit();
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

  /** Save the real ticket types, then switch the claimed listing from the organiser's page to Hoppaz tickets (supabase/events_r1_transfer.sql). */
  async sellOnHoppaz(id, tickets) {
    const event = await eventIdOf(id);
    await rpcOk("ev_update_event", { p_event: event, p_patch: { tickets } });
    await rpcOk("ev_listing_use_hoppaz", { p_event: event }, { ...OUTREACH_REASONS, not_found: "Event not found" });
    emit();
    return visible(event);
  },

  subscribe,
};
