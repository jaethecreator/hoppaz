/**
 * Fake rooms: Lagos HQ first, the viewer's rooms, discover, announcements (plain, and copies of event Pops tagged with
 * the event) and event chats. An event chat opens when the event goes live (1 hour before it starts) and closes 3 days
 * after it ends.
 */
import type { RoomsApi } from "../api";
import type { EventChat, RoomMessage, RoomSummary } from "../types";
import { flushDuePops, pops } from "./pops";
import { canList, chatFor, findEvent, isGoing, isHostOf, isMember, regOf, requireViewer, roomSummary } from "./rules";
import { emit, now, S, subscribe, viewer } from "./store";
import type { RoomRec } from "./store";
import { clone, DAY, newId } from "./util";

/** By id or slug. "hq" is Lagos HQ's short address (/rooms/hq). */
function findRoom(idOrSlug: string): RoomRec | undefined {
  const all = Object.values(S().rooms);
  return S().rooms[idOrSlug] ?? all.find((r) => r.slug === idOrSlug) ?? (idOrSlug === "hq" ? all.find((r) => r.kind === "hq") : undefined);
}

const MAX_LINE = 500;

function slugOf(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "room";
  let slug = base;
  let n = 2;
  while (Object.values(S().rooms).some((r) => r.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}

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
      discover: rest.filter((r) => !r.joined).sort((a, b) => b.members - a.members),
      eventChats: myChats(),
    };
  },

  async get(idOrSlug) {
    flushDuePops();
    const r = findRoom(idOrSlug);
    return r ? roomSummary(r) : null;
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
    if (name.length > 60) throw new Error("Keep the name under 60 characters");
    const id = newId();
    S().rooms[id] = {
      id, slug: slugOf(name), name, kind: "crew", logo_url: null, wallpaper_url: null, verified: false, owner_id: v.id,
      description: (draft.description ?? "").trim().slice(0, 500), base_members: 0,
    };
    S().memberships[`${v.id}:${id}`] = true;
    emit();
    return roomSummary(S().rooms[id]);
  },

  async join(roomId) {
    const v = requireViewer();
    const r = findRoom(roomId);
    if (!r) throw new Error("Room not found");
    S().memberships[`${v.id}:${r.id}`] = true;
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
