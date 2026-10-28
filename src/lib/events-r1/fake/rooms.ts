/**
 * Fake rooms: Lagos HQ first, the viewer's rooms, discover, announcements (plain, and copies of event Pops tagged with
 * the event) and event chats. An event chat opens when the event goes live (1 hour before it starts) and closes 3 days
 * after it ends.
 */
import type { RoomsApi } from "../api";
import type { EventChat, JoinRequest, RoomGuests, RoomMember, RoomMessage, RoomRole, RoomSummary } from "../types";
import { ABOUT_MAX } from "../types";
import { normalizeLinks, slugFromName, slugOk, slugShapeOk, SLUG_HELP } from "../roomRules";
import { flushDuePops, pops } from "./pops";
import {
  canHostInRoom, canList, canManageRoom, chatFor, findEvent, inviteCodeOf, isGoing, isHostOf, isMember, joinModeOf, myRole, regOf,
  requireViewer, roleOf, roomSummary,
} from "./rules";
import { emit, now, S, subscribe, viewer } from "./store";
import type { RoomRec } from "./store";
import { clone, DAY, newId } from "./util";

/** By id or slug. "hq" is Lagos HQ's short address (/rooms/hq). */
function findRoom(idOrSlug: string): RoomRec | undefined {
  const all = Object.values(S().rooms);
  return S().rooms[idOrSlug] ?? all.find((r) => r.slug === idOrSlug) ?? (idOrSlug === "hq" ? all.find((r) => r.kind === "hq") : undefined);
}

const MAX_LINE = 500;

const slugTaken = (slug: string, except?: string): boolean => Object.values(S().rooms).some((r) => r.slug === slug && r.id !== except);

/** A free address made from a name: a taken one gets -2, -3 and so on. */
function slugOf(name: string): string {
  const base = slugFromName(name);
  let slug = base;
  let n = 2;
  while (slugTaken(slug)) slug = `${base.slice(0, 36)}-${n++}`;
  return slug;
}

const needManager = (r: RoomRec | undefined): RoomRec => {
  if (!r) throw new Error("Room not found");
  if (!canManageRoom(r.id)) throw new Error("Not allowed");
  return r;
};

/** Chats the viewer may care about: events of rooms they are in, events they registered for or host. Closed ones stay for 2 weeks. */
function myChats(): EventChat[] {
  const v = viewer();
  const t = now();
  const out: EventChat[] = [];
  for (const e of Object.values(S().events)) {
    if (!e.room_id || e.status === "cancelled") continue;
    const reg = v ? regOf(e.id, v.id) : undefined;
    const mine = isHostOf(e) || (!!reg && isGoing(reg.status)) || (isMember(e.room_id) && canList(e));
    if (!mine) continue;
    const c = chatFor(e);
    if (!c) continue;
    if (c.state === "closed" && t - Date.parse(c.closes_at) > 14 * DAY) continue;
    out.push(c);
  }
  // Open first, then the ones about to open, then closed; soonest within each.
  const rank = { open: 0, upcoming: 1, closed: 2 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || Date.parse(a.opens_at) - Date.parse(b.opens_at));
}

export const rooms: RoomsApi = {
  async list() {
    flushDuePops();
    const all = Object.values(S().rooms).map((r) => roomSummary(r));
    const hq = all.find((r) => r.kind === "hq") as RoomSummary;
    const rest = all.filter((r) => r.kind !== "hq");
    const latest = (r: RoomSummary) => Date.parse(r.latest_announcement?.created_at ?? "") || 0;
    return {
      hq,
      mine: rest.filter((r) => r.joined).sort((a, b) => latest(b) - latest(a) || b.members - a.members),
      discover: rest.filter((r) => !r.joined && r.join_mode !== "invite").sort((a, b) => b.members - a.members),
      eventChats: myChats(),
    };
  },

  /** An invite only room opens for its members, staff, and a visitor with the right invite code. For everyone else it is not found. */
  async get(idOrSlug, opts) {
    flushDuePops();
    const r = findRoom(idOrSlug);
    if (!r) return null;
    if (joinModeOf(r) === "invite" && !isMember(r.id) && !viewer()?.staff && opts?.invite?.toUpperCase() !== inviteCodeOf(r)) return null;
    return roomSummary(r);
  },

  async mine() {
    const v = viewer();
    if (!v) return [];
    return Object.values(S().rooms)
      .filter((r) => r.owner_id === v.id && r.kind !== "hq")
      .map((r) => roomSummary(r));
  },

  async create(draft) {
    const v = requireViewer();
    const name = draft.name.trim();
    if (!name) throw new Error("Give your room a name");
    if (name.length < 2) throw new Error("Give your room a longer name");
    if (name.length > 50) throw new Error("Keep the name under 50 characters");
    const about = (draft.about ?? draft.description ?? "").trim();
    if (about.length > ABOUT_MAX) throw new Error(`Keep the about under ${ABOUT_MAX} characters`);
    let slug: string;
    if (draft.slug && draft.slug.trim()) {
      slug = draft.slug.trim().toLowerCase();
      if (!slugShapeOk(slug)) throw new Error(SLUG_HELP);
      if (!slugOk(slug) || slugTaken(slug)) throw new Error("That address is taken");
    } else slug = slugOf(name);
    const id = newId();
    S().rooms[id] = {
      id, slug, name, kind: "crew", logo_url: draft.logo_url ?? null, wallpaper_url: null, verified: false, owner_id: v.id,
      description: about, links: normalizeLinks(draft.links), join_mode: draft.join_mode ?? "open", base_members: 0,
    };
    S().memberships[`${v.id}:${id}`] = true;
    // The host's own events that were posted as themselves go into the room.
    for (const eid of draft.event_ids ?? []) {
      const e = S().events[eid];
      if (e && e.host_id === v.id) e.room_id = id;
    }
    emit();
    return roomSummary(S().rooms[id]);
  },

  async update(roomId, patch) {
    const r = needManager(findRoom(roomId));
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (n.length < 2) throw new Error("Give your room a name");
      if (n.length > 50) throw new Error("Keep the name under 50 characters");
      r.name = n;
    }
    if (patch.about !== undefined) {
      const a = patch.about.trim();
      if (a.length > ABOUT_MAX) throw new Error(`Keep the about under ${ABOUT_MAX} characters`);
      r.description = a;
    }
    if (patch.slug !== undefined && patch.slug !== r.slug) {
      const slug = patch.slug.trim().toLowerCase();
      if (!slugShapeOk(slug)) throw new Error(SLUG_HELP);
      if (!slugOk(slug) || slugTaken(slug, r.id)) throw new Error("That address is taken");
      r.slug = slug;
    }
    if (patch.logo_url !== undefined) r.logo_url = patch.logo_url;
    if (patch.links !== undefined) r.links = normalizeLinks(patch.links);
    if (patch.join_mode !== undefined) {
      if (!["open", "ask", "invite"].includes(patch.join_mode)) throw new Error("Pick Open, Ask to join or Invite only");
      r.join_mode = patch.join_mode;
    }
    emit();
    return roomSummary(r);
  },

  async slugAvailable(slug, exceptRoomId) {
    const k = slug.trim().toLowerCase();
    return slugOk(k) && !slugTaken(k, exceptRoomId);
  },

  async join(roomId, opts) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    if (isMember(r.id)) return "already";
    const mode = joinModeOf(r);
    const invited = !!opts?.invite && opts.invite.toUpperCase() === inviteCodeOf(r);
    const key = `${v.id}:${r.id}`;
    const mine = Object.values(S().requests).find((q) => q.room_id === r.id && q.user_id === v.id);
    if (mode === "invite" && !invited) throw new Error("This room is invite only");
    if (mode === "ask" && !invited) {
      if (mine?.status === "pending") return "requested";
      if (mine?.status === "declined") throw new Error("The room's host has not accepted your request");
      const id = newId();
      S().requests[id] = { id, room_id: r.id, user_id: v.id, name: v.name, created_at: new Date(now()).toISOString(), status: "pending" };
      emit();
      return "requested";
    }
    S().memberships[key] = true;
    if (mine && mine.status === "pending") mine.status = "approved";
    emit();
    return "joined";
  },

  async requests(roomId) {
    const r = needManager(findRoom(roomId));
    return clone(
      Object.values(S().requests)
        .filter((q) => q.room_id === r.id && q.status === "pending")
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((q): JoinRequest => ({ id: q.id, room_id: q.room_id, user_id: q.user_id, name: q.name, created_at: q.created_at }))
    );
  },

  async decideRequest(requestId, approve) {
    const q = S().requests[requestId];
    if (!q) throw new Error("Request not found");
    const r = needManager(S().rooms[q.room_id]);
    if (q.status !== "pending") throw new Error("That request is already answered");
    q.status = approve ? "approved" : "declined";
    if (approve) {
      S().memberships[`${q.user_id}:${r.id}`] = true;
      // A quiet notice the person finds in the app (no push): the room, and that they are in.
      const id = newId();
      S().notices[id] = { id, user_id: q.user_id, room_id: r.id, room_name: r.name, room_slug: r.slug, kind: "request_approved", created_at: new Date(now()).toISOString(), seen: false };
    }
    emit();
  },

  async inviteCode(roomId) {
    const r = findRoom(roomId);
    if (!r || !viewer() || !canManageRoom(r.id)) return null;
    return inviteCodeOf(r);
  },

  async members(roomId) {
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    if (!isMember(r.id) && !viewer()?.staff) throw new Error("Not allowed");
    const rank: Record<RoomRole, number> = { owner: 0, admin: 1, host: 2, member: 3 };
    const out: RoomMember[] = [];
    for (const u of Object.values(S().users)) {
      const role = roleOf(r.id, u.id);
      if (!role || r.kind === "hq") continue;
      out.push({ user_id: u.id, name: u.name, role, joined_at: new Date(now()).toISOString() });
    }
    return out.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  },

  async setRole(roomId, userId, role) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    const mine = myRole(r.id);
    if (!v.staff && mine !== "owner" && mine !== "admin") throw new Error("Not allowed");
    if (!["admin", "host", "member"].includes(role)) throw new Error("Pick Admin, Host or Member");
    const theirs = roleOf(r.id, userId);
    if (!theirs) throw new Error("They are not in this room");
    if (theirs === "owner") throw new Error("Nobody changes the owner");
    // Only the owner (or staff) makes or changes an admin.
    if (mine === "admin" && (role === "admin" || theirs === "admin")) throw new Error("Only the owner changes admins");
    const key = `${userId}:${r.id}`;
    if (role === "member") delete S().roles[key];
    else S().roles[key] = role;
    emit();
  },

  async guestsNotJoined(roomId): Promise<RoomGuests> {
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    if (!canHostInRoom(r.id)) throw new Error("Not allowed");
    const eventIds = new Set(Object.values(S().events).filter((e) => e.room_id === r.id && e.status !== "cancelled").map((e) => e.id));
    const seen = new Map<string, string>();
    for (const g of Object.values(S().regs)) {
      if (!eventIds.has(g.event_id) || !isGoing(g.status) || seen.has(g.user_id)) continue;
      if (roleOf(r.id, g.user_id)) continue;
      seen.set(g.user_id, g.name);
    }
    const all = [...seen].map(([user_id, name]) => ({ user_id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { count: all.length, guests: all.slice(0, 50) };
  },

  async notices() {
    const v = viewer();
    if (!v) return [];
    return clone(
      Object.values(S().notices)
        .filter((n) => n.user_id === v.id && !n.seen)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((n) => ({ id: n.id, room_id: n.room_id, room_name: n.room_name, room_slug: n.room_slug, kind: n.kind, created_at: n.created_at }))
    );
  },

  async markNoticesSeen(ids) {
    const v = viewer();
    if (!v) return;
    for (const id of ids) {
      const n = S().notices[id];
      if (n && n.user_id === v.id) n.seen = true;
    }
    emit();
  },

  /** The owner of the room or staff. Staff are the dev "Hoppaz Staff" user. */
  async setThreeD(roomId, on) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    if (r.owner_id !== v.id && !v.staff) throw new Error("Not allowed");
    r.three_d_on = !!on;
    emit();
  },

  /** Staff only: every room, Lagos HQ first, then the biggest. */
  async listForStaff() {
    const v = requireViewer();
    if (!v.staff) throw new Error("Not allowed");
    const all = Object.values(S().rooms).map((r) => roomSummary(r));
    return all.sort((a, b) => Number(b.kind === "hq") - Number(a.kind === "hq") || b.members - a.members || a.name.localeCompare(b.name));
  },

  /** The /admin desk: in the fake layer staff are the dev "Hoppaz Staff" user, so these are the same two. */
  async listForDesk() {
    return rooms.listForStaff();
  },

  async setThreeDFromDesk(roomId, on) {
    return rooms.setThreeD(roomId, on);
  },

  async announcements(roomId) {
    flushDuePops();
    const r = findRoom(roomId);
    if (!r) return [];
    return clone(
      Object.values(S().announcements)
        .filter((a) => a.room_id === r.id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    );
  },

  async postAnnouncement(roomId, body) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    if (r.owner_id !== v.id && !v.staff) throw new Error("Only the room's host can post here");
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    const a = {
      id: newId(), room_id: r.id, body: text, created_at: new Date(now()).toISOString(), author_name: v.name,
      event_id: null, event_title: null,
    };
    S().announcements[a.id] = a;
    emit();
    return clone(a);
  },

  async eventChats(roomId) {
    const r = findRoom(roomId);
    if (!r) return [];
    return myChats().filter((c) => c.room_id === r.id);
  },

  async eventChat(eventId) {
    const e = Object.values(S().events).find((x) => x.id === eventId || x.slug === eventId);
    if (!e || (e.status === "cancelled" && !isHostOf(e))) return null;
    return chatFor(e);
  },

  async markRead(roomId) {
    const v = viewer();
    const r = findRoom(roomId);
    if (!v || !r) return;
    S().reads[`${v.id}:${r.id}`] = new Date(now()).toISOString();
    emit();
  },

  async messages(roomId, channel) {
    flushDuePops();
    const r = findRoom(roomId);
    if (!r) return [];
    const byTime = (a: RoomMessage, b: RoomMessage) => Date.parse(a.created_at) - Date.parse(b.created_at);
    if (channel === "general") {
      return clone(Object.values(S().messages).filter((m) => m.room_id === r.id && m.channel === "general").sort(byTime));
    }
    const e = findEvent(channel);
    const chat = e && e.room_id === r.id ? chatFor(e) : null;
    if (!e || !chat || !chat.can_enter) return [];
    const lines = Object.values(S().messages).filter((m) => m.room_id === r.id && m.channel === e.id);
    // The host's Pops for this event come with the chat, pinned.
    const sent = await pops.visibleOnEvent(e.id);
    const popLines: RoomMessage[] = sent.map((p) => ({
      id: `pop:${p.id}`, room_id: r.id, channel: e.id, author_name: p.author_name, body: p.body, created_at: p.sent_at ?? p.send_at ?? "",
      pinned_pop: { event_id: e.id, event_title: e.title },
    }));
    return clone([...lines, ...popLines].sort(byTime));
  },

  async send(roomId, channel, body) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_LINE) throw new Error(`Keep it under ${MAX_LINE} characters`);
    if (channel === "general") {
      if (!isMember(r.id)) throw new Error("Join the room to chat");
    } else {
      const e = findEvent(channel);
      const chat = e && e.room_id === r.id ? chatFor(e) : null;
      if (!chat) throw new Error("Chat not found");
      if (chat.state === "closed") throw new Error("This event has closed");
      if (chat.state === "upcoming") throw new Error("The chat is not open yet");
      if (!chat.can_enter) throw new Error("You are not in this chat");
    }
    const m: RoomMessage = {
      id: newId(), room_id: r.id, channel: channel === "general" ? "general" : findEvent(channel)!.id, author_name: v.name, body: text,
      created_at: new Date(now()).toISOString(),
    };
    S().messages[m.id] = m;
    emit();
    return clone(m);
  },

  subscribe,
};
