/**
 * The real side of a room's profile, join mode, requests, roles and "went but haven't joined": calls to
 * supabase/events_r1_room_profile.sql (a draft for Ola). Until that file is run each call degrades quietly, as real/looks.ts does:
 * a function that is not there answers "missing", and the layer uses what the app already has (create_crew, join_crew, ev_room) or an
 * empty answer, so nothing on the Roomz side breaks before Ola runs it. The profile fields (about, links, address, join mode) are only
 * saved once the file is run; before that a room is made with its name alone and reads as open.
 */
import type { RoomsApi } from "../api";
import { slugOk, SLUG_HELP, normalizeLinks } from "../roomRules";
import type { JoinOutcome, JoinRequest, RoomDraft, RoomGuests, RoomLinks, RoomMember, RoomNotice, RoomPatch, RoomRole, RoomSummary } from "../types";
import { client, emit, failText, reasonText, who } from "./core";
import { roomIdOf } from "./ids";
import { iso } from "./map";

type Row = Record<string, unknown>;

/** What a call to a function of the new file answered. missing: the function is not in the database yet. */
export type Soft<T> = { data: T | null; missing: boolean; error: string | null };

/** Call a function of events_r1_room_profile.sql without throwing: a missing function is `missing`, any other error is `error`. */
export async function soft<T>(fn: string, args?: Record<string, unknown>): Promise<Soft<T>> {
  const { data, error } = await client().rpc(fn, args);
  if (!error) return { data: data as T, missing: false, error: null };
  const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message);
  if (!missing && typeof console !== "undefined" && process.env.NODE_ENV !== "production") console.warn(`[hoppaz] ${fn}:`, error.message);
  return { data: null, missing, error: error.message };
}

export const ROOM_REASONS: Record<string, string> = {
  not_found: "Room not found",
  bad_name: "Give your room a name (2 to 50 characters)",
  bad_about: "Keep the about under 600 characters",
  bad_slug: SLUG_HELP,
  slug_taken: "That address is taken",
  bad_logo: "That logo picture did not work",
  bad_links: "Check your links. They start with https://",
  bad_mode: "Pick Open, Ask to join or Invite only",
  bad_role: "Pick Admin or Member",
  not_member: "They are not in this room",
  owner_fixed: "Nobody changes the owner",
  invite_only: "This room is invite only",
  declined: "The room's owner has not accepted your request",
  already_answered: "That request is already answered",
};

/** A { ok, reason } answer: the data, or an Error in the fake layer's words. */
function okOrThrow(r: Soft<Row>): Row {
  if (r.error) throw new Error(failText(r.error));
  if (!r.data || r.data.ok !== true) throw new Error(reasonText(r.data?.reason, ROOM_REASONS));
  return r.data;
}

/** A plain-text answer: 'ok', or a reason. */
function textOrThrow(r: Soft<string>): string {
  if (r.error) throw new Error(failText(r.error));
  if (r.data === "ok") return r.data;
  throw new Error(reasonText(r.data, ROOM_REASONS));
}

const patchJson = (p: RoomPatch): Row => {
  const o: Row = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.about !== undefined) o.about = p.about;
  if (p.slug !== undefined) o.slug = p.slug;
  if (p.logo_url !== undefined) o.logo_url = p.logo_url;
  if (p.links !== undefined) o.links = normalizeLinks(p.links);
  if (p.join_mode !== undefined) o.join_mode = p.join_mode;
  return o;
};

type Deps = {
  get: (id: string) => Promise<RoomSummary | null>;
  /** The no-profile way to make a room (create_crew), used while the new function is missing. */
  legacyCreate: (name: string, mode: RoomDraft["join_mode"]) => Promise<string>;
};

export function profileApi({ get, legacyCreate }: Deps): Pick<
  RoomsApi,
  "create" | "update" | "slugAvailable" | "join" | "requests" | "decideRequest" | "inviteCode" | "members" | "setRole" | "removeMember" | "guestsNotJoined" | "notices" | "markNoticesSeen"
> {
  const need = (): void => {
    if (!who()) throw new Error("Sign in first");
  };
  const idOrThrow = async (roomId: string): Promise<string> => {
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    return id;
  };

  return {
    async create(draft) {
      const name = draft.name.trim();
      if (!name) throw new Error("Give your room a name");
      if (name.length > 50) throw new Error("Keep the name under 50 characters");
      const about = (draft.about ?? draft.description ?? "").trim();
      if (about.length > 600) throw new Error("Keep the about under 600 characters");
      need();
      const links = normalizeLinks(draft.links as RoomLinks | undefined);
      const r = await soft<Row>("ev_create_room", {
        p_name: name, p_about: about, p_slug: draft.slug?.trim() || null, p_logo_url: draft.logo_url || null, p_links: links,
        p_join_mode: draft.join_mode ?? "open", p_events: draft.event_ids?.length ? draft.event_ids : null,
      });
      let id: string;
      if (r.missing) {
        // Before the file is run: the app's own create_crew, name only. Ask and invite are private, as the new function would make them.
        id = await legacyCreate(name, draft.join_mode);
      } else id = String(okOrThrow(r).id);
      emit();
      const made = await get(id);
      if (!made) throw new Error("That did not work. Try again");
      return made;
    },

    async update(roomId, patch) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<Row>("ev_update_room", { p_room: id, p_patch: patchJson(patch) });
      if (r.missing) throw new Error("Room settings are not open yet");
      okOrThrow(r);
      emit();
      const out = await get(id);
      if (!out) throw new Error("Room not found");
      return out;
    },

    async slugAvailable(slug, exceptRoomId) {
      const k = slug.trim().toLowerCase();
      if (!slugOk(k)) return false;
      const except = exceptRoomId ? await roomIdOf(exceptRoomId) : null;
      const r = await soft<boolean>("ev_slug_available", { p_slug: k, p_except: except });
      // Missing function (or a hiccup): the shape is fine, the database decides at Create room.
      return r.missing || r.error ? true : r.data === true;
    },

    async join(roomId, opts) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<string>("ev_join_room", { p_room: id, p_invite: opts?.invite ?? null });
      if (r.missing) {
        // The app's own join_crew (an open room by id, or any room by its invite code).
        const { data, error } = await client().rpc("join_crew", { p_invite: opts?.invite || id });
        if (error) throw new Error(failText(error.message));
        if (!data) throw new Error("Room not found");
        emit();
        return "joined";
      }
      if (r.error) throw new Error(failText(r.error));
      if (r.data === "joined" || r.data === "requested" || r.data === "already") {
        emit();
        return r.data as JoinOutcome;
      }
      throw new Error(reasonText(r.data, ROOM_REASONS));
    },

    async requests(roomId) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<Row[] | null>("ev_room_requests", { p_room: id });
      if (r.missing) return [];
      if (r.error) throw new Error(failText(r.error));
      if (!r.data) throw new Error("Not allowed");
      return r.data.map((q): JoinRequest => ({ id: String(q.id), room_id: String(q.room_id), user_id: String(q.user_id), name: String(q.name ?? "Hopper"), created_at: iso(q.created_at) ?? new Date().toISOString() }));
    },

    async decideRequest(requestId, approve) {
      need();
      const r = await soft<string>("ev_decide_room_request", { p_request: requestId, p_approve: !!approve });
      if (r.missing) throw new Error("Room requests are not open yet");
      textOrThrow(r);
      emit();
    },

    async inviteCode(roomId) {
      const id = await roomIdOf(roomId);
      if (!id || !who()) return null;
      const r = await soft<string | null>("ev_room_invite_code", { p_room: id });
      return r.data ?? null;
    },

    async members(roomId) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<Row[] | null>("ev_room_members", { p_room: id });
      if (r.missing) return [];
      if (r.error) throw new Error(failText(r.error));
      if (!r.data) throw new Error("Not allowed");
      return r.data.map((m): RoomMember => ({ user_id: String(m.user_id), name: String(m.name ?? "Hopper"), role: m.role as RoomRole, joined_at: iso(m.joined_at) ?? "" }));
    },

    async setRole(roomId, userId, role) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<string>("ev_set_room_role", { p_room: id, p_user: userId, p_role: role });
      if (r.missing) throw new Error("Room roles are not open yet");
      textOrThrow(r);
      emit();
    },

    async removeMember(roomId, userId) {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<string>("ev_remove_room_member", { p_room: id, p_user: userId });
      if (r.missing) throw new Error("Removing members is not open yet");
      textOrThrow(r);
      emit();
    },

    async guestsNotJoined(roomId): Promise<RoomGuests> {
      need();
      const id = await idOrThrow(roomId);
      const r = await soft<Row | null>("ev_room_guests_not_joined", { p_room: id });
      // Missing function: nobody to bring in yet (the done sheet then shows no "Bring your guests in" card).
      if (r.missing) return { count: 0, guests: [] };
      if (r.error) throw new Error(failText(r.error));
      if (!r.data) throw new Error("Not allowed");
      const guests = Array.isArray(r.data.guests) ? (r.data.guests as Row[]).map((g) => ({ user_id: String(g.user_id), name: String(g.name ?? "Guest") })) : [];
      return { count: Number(r.data.count) || 0, guests };
    },

    async notices() {
      if (!who()) return [];
      const r = await soft<Row[]>("ev_my_room_notices");
      if (!r.data) return [];
      return r.data.map((n): RoomNotice => ({
        id: String(n.id), room_id: String(n.room_id), room_name: String(n.room_name ?? ""), room_slug: String(n.room_slug ?? n.room_id),
        kind: "request_approved", created_at: iso(n.created_at) ?? "",
      }));
    },

    async markNoticesSeen(ids) {
      if (!who() || !ids.length) return;
      await soft<string>("ev_mark_room_notices_seen", { p_ids: ids });
      emit();
    },
  };
}
