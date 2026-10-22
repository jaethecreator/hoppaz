/**
 * Real rooms and chat. The room list, announcements and event chat state come from supabase/events_r1_rooms.sql and
 * events_r1_pops.sql. Making and joining a room, and posting an announcement, use the app's existing functions
 * (create_crew, join_crew, crew_announce). Chat lines use the app's existing chat tables: General is crew_room_messages
 * (crew_room_send to write), an event's chat is the `messages` table with the event id as its channel.
 */
import type { RoomsApi } from "../api";
import type { EventChat, RoomAnnouncement, RoomMessage, RoomSummary } from "../types";
import { client, emit, failText, reasonText, rpc, rpcText, shared, subscribe, userId, uuid, who } from "./core";
import { eventIdOf, roomIdOf } from "./ids";
import { iso, mapAnnouncement, mapChat, mapMessage, mapPop, mapRoom } from "./map";

type Row = Record<string, unknown>;

/** The database's limit on a chat line (crew_room_messages and messages both stop at 400). */
const MAX_LINE = 400;

/* ------------------------------------------------------- the staff desk -- */

/** The same key the staff desk keeps its token under (src/app/admin/page.tsx). */
const TOKEN_KEY = "hoppaz-admin-token";

function staffToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** One call to /api/admin/event-rooms with the desk's token: no token is "Sign in first", a refused one "Not allowed". */
async function desk<T>(json?: { room: string; on: boolean }): Promise<T> {
  const token = staffToken();
  if (!token) throw new Error("Sign in first");
  const base = process.env.EVENTS_R1_API_BASE ?? "";
  const res = await fetch(`${base}/api/admin/event-rooms`, {
    method: json ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (res.status === 401) throw new Error("Not allowed");
  if (!res.ok || out.ok === false) throw new Error(out.message || "That did not work. Try again");
  return out as T;
}

/* ------------------------------------------------------------ my roles -- */

/** My role in each room I am in, from the app's own membership table (readable for my own rows). owner | admin | member. */
async function roles(): Promise<Map<string, string>> {
  return shared("rooms.roles", 3000, async () => {
    const out = new Map<string, string>();
    const me = await userId();
    if (!me) return out;
    const { data } = await client().from("crew_members").select("crew_id, role").eq("user_id", me);
    for (const r of (data ?? []) as { crew_id: string; role: string }[]) out.set(r.crew_id, r.role);
    return out;
  });
}

/** What the database cannot say in one call: do I own it, may I post, and (Lagos HQ) who is in the room now. The 3D switch comes in the room's own answer. */
function extras(roomId: string, role: Map<string, string>) {
  const r = role.get(roomId);
  return { is_owner: r === "owner", can_post: !!r && r !== "member" };
}

async function hqOnline(id: string): Promise<number> {
  try {
    const card = await rpc<{ in_room?: number } | null>("crew_card", { p_crew: id, p_code: null });
    return Number(card?.in_room) || 0;
  } catch {
    return 0;
  }
}

/** Lagos HQ when there is no staff account to own it yet: a room that is there but cannot be used. */
const NO_HQ: RoomSummary = {
  id: "hq", slug: "hq", name: "Lagos HQ", kind: "hq", logo_url: null, wallpaper_url: null, members: 0, verified: true, joined: false,
  unread: 0, latest_announcement: null, is_owner: false, can_post: false, has_3d: false, three_d_on: false, online: 0,
};

type List = { hq: RoomSummary; mine: RoomSummary[]; discover: RoomSummary[]; eventChats: EventChat[] };

function loadList(): Promise<List> {
  return shared("rooms.list", 3000, async () => {
    const j = await rpc<{ hq: Row | null; mine: Row[]; discover: Row[]; eventChats: Row[] } | null>("ev_rooms_for_me");
    const role = await roles();
    const hqRow = j?.hq ?? null;
    const hq = hqRow ? mapRoom(hqRow, { ...extras(String(hqRow.id), role), online: await hqOnline(String(hqRow.id)) }) : NO_HQ;
    const room = (r: Row) => mapRoom(r, extras(String(r.id), role));
    return {
      hq,
      mine: (j?.mine ?? []).map(room),
      discover: (j?.discover ?? []).map(room),
      eventChats: (j?.eventChats ?? []).map(mapChat),
    };
  });
}

/* ------------------------------------------------------- event chat access -- */

/**
 * The existing chat table lets in people who swiped "in" or checked in (in_room in chat_accounts.sql); it does not know about
 * registrations yet. A person who may enter a Release 1 event chat (going, or the host) gets the swipe, which is what
 * "I'm going" has always been in the app. Until in_room learns registrations (a question for Ola), this is how they get in.
 */
const swiped = new Set<string>();
async function ensureChatAccess(eventId: string): Promise<void> {
  const me = await userId();
  if (!me) return;
  const mark = `${me}:${eventId}`;
  if (swiped.has(mark)) return;
  const sb = client();
  const { data } = await sb.from("swipes").select("decision").eq("user_id", me).eq("event_id", eventId).maybeSingle();
  if ((data as { decision: string } | null)?.decision !== "in") {
    await sb.from("swipes").delete().eq("user_id", me).eq("event_id", eventId);
    await sb.from("swipes").insert({ user_id: me, event_id: eventId, decision: "in" });
  }
  swiped.add(mark);
}

async function chatOf(eventId: string): Promise<EventChat | null> {
  let id: string;
  try {
    id = await eventIdOf(eventId);
  } catch {
    return null;
  }
  const j = await rpc<Row | null>("ev_event_chat", { p_event: id });
  return j ? mapChat(j) : null;
}

/** A database error from the app's chat code as the fake layer's words. */
function chatError(message: string): Error {
  const m = message.toLowerCase();
  if (m.includes("not_in_crew")) return new Error("Join the room to chat");
  if (m.includes("not_at_event")) return new Error("You are not in this chat");
  if (m.includes("room_closed")) return new Error("This event has closed");
  if (m.includes("invalid_message")) return new Error("Write a message first");
  return new Error(failText(message));
}

/* ------------------------------------------------------------------ api -- */

export const rooms: RoomsApi = {
  async list() {
    const l = await loadList();
    return { hq: l.hq, mine: l.mine, discover: l.discover, eventChats: l.eventChats };
  },

  async get(idOrSlug) {
    const id = await roomIdOf(idOrSlug);
    if (!id) return null;
    const j = await rpc<Row | null>("ev_room", { p_room: id });
    if (!j) return null;
    const role = await roles();
    return mapRoom(j, { ...extras(id, role), ...(j.kind === "hq" ? { online: await hqOnline(id) } : {}) });
  },

  async mine() {
    if (!who()) return [];
    return (await loadList()).mine.filter((r) => r.is_owner);
  },

  async create(draft) {
    const name = draft.name.trim();
    if (!name) throw new Error("Give your room a name");
    if (name.length > 50) throw new Error("Keep the name under 50 characters");
    const { data, error } = await client().rpc("create_crew", { p_name: name, p_visibility: "open" });
    if (error) throw chatError(error.message);
    emit();
    const made = await rooms.get(String(data));
    if (!made) throw new Error("That did not work. Try again");
    return made;
  },

  async join(roomId) {
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    const { data, error } = await client().rpc("join_crew", { p_invite: id });
    if (error) throw chatError(error.message);
    if (!data) throw new Error("Room not found");
    emit();
  },

  /** The owner or staff: ev_set_room_3d answers ok or a reason. The entry function refuses a walker when it is off (see EVENTS_R1_ORDER.md). */
  async setThreeD(roomId, on) {
    if (!who()) throw new Error("Sign in first");
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    await rpcText("ev_set_room_3d", { p_room: id, p_on: !!on }, { not_found: "Room not found" });
    emit();
  },

  /** Staff: every room (ev_admin_rooms answers null to anyone who is not staff). */
  async listForStaff() {
    if (!who()) throw new Error("Sign in first");
    const rows = await rpc<Row[] | null>("ev_admin_rooms");
    if (!rows) throw new Error("Not allowed");
    const role = await roles();
    return rows.map((r) => mapRoom(r, extras(String(r.id), role)));
  },

  /** The /admin desk has the shared token and no account: the same list through the staff route (service role). */
  async listForDesk() {
    const out = await desk<{ rooms: Row[] }>();
    return out.rooms.map((r) => mapRoom(r));
  },

  async setThreeDFromDesk(roomId, on) {
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    await desk({ room: id, on: !!on });
    emit();
  },

  async announcements(roomId) {
    const id = await roomIdOf(roomId);
    if (!id) return [];
    const rows = await rpc<Row[] | null>("ev_room_announcements", { p_room: id });
    return (rows ?? []).map(mapAnnouncement);
  },

  async postAnnouncement(roomId, body): Promise<RoomAnnouncement> {
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > 280) throw new Error("Keep it under 280 characters");
    const out = await rpc<string | null>("crew_announce", { p_crew: id, p_body: text });
    if (!out || !out.startsWith("sent:")) {
      throw new Error(reasonText(out, { slow_down: "Two announcements a day is the limit. Try again tomorrow", too_long: "Keep it under 280 characters" }));
    }
    emit();
    const newId = out.slice(5);
    const all = await rooms.announcements(id);
    return (
      all.find((a) => a.id === newId) ?? {
        id: newId, room_id: id, body: text, created_at: new Date().toISOString(), author_name: who()?.name ?? "The owner", event_id: null, event_title: null,
      }
    );
  },

  async eventChats(roomId) {
    const id = await roomIdOf(roomId);
    if (!id) return [];
    return (await loadList()).eventChats.filter((c) => c.room_id === id);
  },

  async eventChat(eventId) {
    return chatOf(eventId);
  },

  async markRead(roomId) {
    const id = await roomIdOf(roomId);
    if (!id || !who()) return;
    await rpc("ev_room_mark_read", { p_room: id });
    emit();
  },

  async messages(roomId, channel) {
    const id = await roomIdOf(roomId);
    if (!id) return [];
    const sb = client();
    const byTime = (a: RoomMessage, b: RoomMessage) => Date.parse(a.created_at) - Date.parse(b.created_at);

    if (channel === "general") {
      const { data } = await sb
        .from("crew_room_messages")
        .select("id, author_name, body, created_at")
        .eq("crew_id", id)
        .eq("scope", "general")
        .order("created_at", { ascending: false })
        .limit(80);
      return ((data ?? []) as Row[]).map((m) => mapMessage(m, id, "general")).sort(byTime);
    }

    const chat = await chatOf(channel);
    if (!chat || chat.room_id !== id || !chat.can_enter) return [];
    await ensureChatAccess(chat.event_id);
    const { data } = await sb
      .from("messages")
      .select("id, author_name, body, created_at")
      .eq("channel", chat.event_id)
      .order("created_at", { ascending: false })
      .limit(80);
    const lines = ((data ?? []) as Row[]).map((m) => mapMessage(m, id, chat.event_id));
    // The host's Pops for this event come with the chat, pinned.
    const popRows = (await rpc<Row[] | null>("ev_event_pops", { p_event: chat.event_id })) ?? [];
    const popLines: RoomMessage[] = popRows.map((r) => {
      const p = mapPop(r);
      return {
        id: `pop:${p.id}`, room_id: id, channel: chat.event_id, author_name: p.author_name, body: p.body, created_at: p.sent_at ?? p.send_at ?? "",
        pinned_pop: { event_id: chat.event_id, event_title: chat.event_title },
      };
    });
    return [...lines, ...popLines].sort(byTime);
  },

  async send(roomId, channel, body) {
    const me = who();
    if (!me) throw new Error("Sign in first");
    const id = await roomIdOf(roomId);
    if (!id) throw new Error("Room not found");
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_LINE) throw new Error(`Keep it under ${MAX_LINE} characters`);
    const sb = client();
    const now = new Date().toISOString();

    if (channel === "general") {
      const { data, error } = await sb.rpc("crew_room_send", { p_crew: id, p_scope: "general", p_body: text, p_request: uuid() });
      if (error) throw chatError(error.message);
      emit();
      return { id: String(data), room_id: id, channel: "general", author_name: me.name, body: text, created_at: now };
    }

    const chat = await chatOf(channel);
    if (!chat || chat.room_id !== id) throw new Error("Chat not found");
    if (chat.state === "closed") throw new Error("This event has closed");
    if (chat.state === "upcoming") throw new Error("The chat is not open yet");
    if (!chat.can_enter) throw new Error("You are not in this chat");
    await ensureChatAccess(chat.event_id);
    const { data, error } = await sb
      .from("messages")
      .insert({ channel: chat.event_id, body: text, anon: false })
      .select("id, author_name, body, created_at")
      .single();
    if (error) throw chatError(error.message);
    emit();
    const m = mapMessage(data as Row, id, chat.event_id);
    return { ...m, created_at: iso(m.created_at) ?? now };
  },

  subscribe,
};
