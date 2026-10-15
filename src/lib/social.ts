"use client";

import { create } from "zustand";
import { getSupabase } from "./supabase/client";
import type { DmThread, Wave } from "./types";

/**
 * Crew = friends (supabase/crew_friends.sql). One store for everything the app knows about the people it is in touch with:
 *
 *   waves   waves waiting for me (WAVE BACK / PASS)
 *   crew    my crew friends (both ways), each with their chat id and what is unread
 *   dms     my chats, newest first, with unread counts
 *   unread  messages waiting, in all (the Chat tab badge)
 *
 * It is filled by ONE read, crew_friend_inbox(), kept fresh by SocialPing (src/components/social/SocialPing.tsx) and read
 * by the room card, the Chat tab (CHATS and CREW) and the tab bar. A person is crew when they are in `crew`; the room card shows
 * POKE for them and SAY HI for everyone else.
 *
 * FALLBACK. If the new calls are not on the server yet (the app deployed before crew_friends.sql ran), every call below
 * answers with the old one: my_waves / my_dms for the inbox, respond_wave for a wave back. `supported` says which world
 * this is. Then `crew` is empty (nobody is "crew"), SAY HI works as it always did and nothing breaks.
 */

export type CrewFace = { id: string; name: string; look: unknown; dm: string | null; unread: number };
export type WaveIn = { id: string; from: string | null; name: string; look: unknown; where: string | null; room: boolean; at: string };
export type ChatRow = DmThread & { other_id: string | null; unread: number; crew: boolean };

type SocialState = {
  /** The crew_friend_* calls are on the server: true / false once known, null until the first answer. */
  supported: boolean | null;
  loaded: boolean;
  waves: WaveIn[];
  crew: CrewFace[];
  dms: ChatRow[];
  unread: number;
  /** Who is in my crew (both ways), by user id. */
  crewIds: Record<string, CrewFace>;
  /** SHOW ME ON THE MAP: my own switch, off until I turn it on. Nothing draws friends on the map yet; this is what it must honour. */
  onMap: boolean;
  /** When I last poked each person (ms), so POKE reads POKED for the minute the server asks for. */
  pokedAt: Record<string, number>;
};

const EMPTY: SocialState = { supported: null, loaded: false, waves: [], crew: [], dms: [], unread: 0, crewIds: {}, onMap: false, pokedAt: {} };

export const useSocial = create<SocialState>(() => EMPTY);

/** A different Hopper (log in, log out) starts from nothing. */
export function resetSocial() {
  useSocial.setState({ ...EMPTY });
}

/** The server does not have this function (yet): PostgREST says so in one of these ways. */
export function isMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|schema cache|does not exist/i.test(error.message ?? "")
  );
}

export const POKE_GAP_MS = 60_000;

/* -------------------------------------------------------------------- read -- */

export type InboxDiff = { newWaves: WaveIn[]; newMessages: ChatRow[] };

/**
 * Who hears about what is new since the last read (SocialPing: the toasts). One listener list, so that two reads running at
 * once (a poll and a ping) can never tell it twice or lose it between them.
 */
const listeners = new Set<(diff: InboxDiff) => void>();
export function onInboxDiff(fn: (diff: InboxDiff) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type InboxJson = { waves?: WaveIn[]; crew?: CrewFace[]; dms?: ChatRow[]; unread?: number; on_map?: boolean };

function apply(next: { waves: WaveIn[]; crew: CrewFace[]; dms: ChatRow[]; unread: number; onMap?: boolean }, supported: boolean): InboxDiff {
  const prev = useSocial.getState();
  const diff: InboxDiff = { newWaves: [], newMessages: [] };
  if (prev.loaded) {
    const had = new Set(prev.waves.map((w) => w.id));
    diff.newWaves = next.waves.filter((w) => !had.has(w.id));
    const before = new Map(prev.dms.map((d) => [d.id, d.unread]));
    diff.newMessages = next.dms.filter((d) => d.unread > (before.get(d.id) ?? 0));
  }
  useSocial.setState({
    supported,
    loaded: true,
    waves: next.waves,
    crew: next.crew,
    dms: next.dms,
    unread: next.unread,
    crewIds: Object.fromEntries(next.crew.map((c) => [c.id, c])),
    onMap: next.onMap ?? false,
  });
  return diff;
}

async function fetchOnce(): Promise<InboxDiff> {
  const sb = getSupabase();
  if (!sb) return { newWaves: [], newMessages: [] };
  const { data, error } = await sb.rpc("crew_friend_inbox");
  if (!error && data) {
    const j = data as InboxJson;
    return apply({ waves: j.waves ?? [], crew: j.crew ?? [], dms: j.dms ?? [], unread: j.unread ?? 0, onMap: !!j.on_map }, true);
  }
  if (!isMissing(error)) return { newWaves: [], newMessages: [] }; // a bad connection says nothing either way
  // The old server: the waves and chats it always had, nobody "crew", nothing unread.
  const [w, d] = await Promise.all([sb.rpc("my_waves"), sb.rpc("my_dms")]);
  if (w.error && d.error) return { newWaves: [], newMessages: [] };
  const waves = ((w.data ?? []) as Wave[]).map((x) => ({
    id: x.id,
    from: null,
    name: x.from_alias,
    look: x.from_look,
    where: x.event_title,
    room: false,
    at: x.created_at,
  }));
  const dms = ((d.data ?? []) as DmThread[]).map((x) => ({ ...x, other_id: null, unread: 0, crew: false }));
  return apply({ waves, crew: [], dms, unread: 0 }, false);
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Read the inbox now. A call that lands while a read is on its way asks for one more after it, so a change that happened
 * mid-read is never lost. What is new (nothing on the very first read) goes to the onInboxDiff listeners.
 */
export function loadInbox(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const d = await fetchOnce();
      if (d.newWaves.length || d.newMessages.length) listeners.forEach((fn) => fn(d));
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Right after a mutual wave: the person is crew now, before the next read says so. */
export function rememberCrew(face: { id: string; name: string; look: unknown; dm: string | null }) {
  const s = useSocial.getState();
  const next: CrewFace = { unread: s.crewIds[face.id]?.unread ?? 0, ...face };
  useSocial.setState({ crew: [next, ...s.crew.filter((c) => c.id !== face.id)], crewIds: { ...s.crewIds, [face.id]: next } });
  void loadInbox();
}

/* ----------------------------------------------------------------- actions -- */

const ANSWER_TEXT: Record<string, string> = {
  gone: "THAT WAVE IS GONE",
  blocked: "YOU CAN'T CHAT WITH THEM",
  need_account: "MAKE AN ACCOUNT TO CHAT",
  no_session: "NOT SIGNED IN YET",
};

export type Answer = { dm: string | null; crew: boolean; passed?: boolean; text?: string; needAccount?: boolean };

/** WAVE BACK or PASS on a wave waiting for me, from the Chat tab. crew: this made them crew. */
export async function answerWave(id: string, accept: boolean): Promise<Answer> {
  const sb = getSupabase();
  if (!sb) return { dm: null, crew: false, text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc("crew_friend_respond", { p_wave: id, p_accept: accept });
  if (isMissing(error)) {
    // The old server: accept opens the chat and nothing more.
    const old = await sb.rpc("respond_wave", { p_wave: id, p_accept: accept });
    await loadInbox();
    if (old.error?.message.includes("need_account")) return { dm: null, crew: false, needAccount: true };
    return { dm: (old.data as string | null) ?? null, crew: false, passed: !accept };
  }
  if (error) return { dm: null, crew: false, text: "COULD NOT ANSWER" };
  const r = String(data);
  await loadInbox();
  if (r.startsWith("crew:")) return { dm: r.slice(5), crew: true };
  if (r.startsWith("dm:")) return { dm: r.slice(3), crew: false };
  if (r === "passed") return { dm: null, crew: false, passed: true };
  if (r === "need_account") return { dm: null, crew: false, needAccount: true };
  return { dm: null, crew: false, text: ANSWER_TEXT[r] ?? "COULD NOT ANSWER" };
}

/** MESSAGE: the chat with a crew friend (made on the spot when there is none). */
export async function messageCrew(userId: string): Promise<{ dm: string | null; text?: string }> {
  const known = useSocial.getState().crewIds[userId]?.dm;
  if (known) return { dm: known };
  const sb = getSupabase();
  if (!sb) return { dm: null, text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc("crew_friend_open_dm", { p_peer: userId });
  if (error) return { dm: null, text: isMissing(error) ? "NOT AVAILABLE YET" : "COULD NOT OPEN THE CHAT" };
  const r = String(data);
  if (r.startsWith("dm:")) {
    const dm = r.slice(3);
    const face = useSocial.getState().crewIds[userId];
    if (face) rememberCrew({ ...face, dm });
    return { dm };
  }
  return { dm: null, text: r === "blocked" ? "YOU BLOCKED THEM" : r === "need_account" ? "MAKE AN ACCOUNT TO CHAT" : "NOT IN YOUR CREW YET" };
}

const POKE_TEXT: Record<string, string> = {
  slow_down: "GIVE THEM A MINUTE",
  daily: "THAT'S A LOT OF POKES TODAY",
  not_crew: "NOT IN YOUR CREW YET",
  blocked: "YOU BLOCKED THEM",
  self: "THAT'S YOU",
  need_account: "MAKE AN ACCOUNT TO POKE",
  no_session: "NOT SIGNED IN YET",
};

/** POKE a crew friend. */
export async function pokeCrew(userId: string): Promise<{ ok: boolean; text: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc("crew_friend_poke", { p_peer: userId });
  if (error) return { ok: false, text: isMissing(error) ? "NOT AVAILABLE YET" : "COULD NOT POKE" };
  const r = String(data);
  if (r === "sent") {
    useSocial.setState((s) => ({ pokedAt: { ...s.pokedAt, [userId]: Date.now() } }));
    return { ok: true, text: "POKED" };
  }
  if (r === "slow_down") useSocial.setState((s) => ({ pokedAt: { ...s.pokedAt, [userId]: Date.now() } }));
  return { ok: false, text: POKE_TEXT[r] ?? "COULD NOT POKE" };
}

/** I have read this chat up to now (clears its unread count on the server, then here). */
export async function markRead(dm: string): Promise<void> {
  const s = useSocial.getState();
  if (s.supported === false) return;
  const row = s.dms.find((d) => d.id === dm);
  if (row && row.unread > 0) {
    const unread = Math.max(0, s.unread - row.unread);
    useSocial.setState({
      unread,
      dms: s.dms.map((d) => (d.id === dm ? { ...d, unread: 0 } : d)),
      crew: s.crew.map((c) => (c.dm === dm ? { ...c, unread: 0 } : c)),
    });
  }
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("crew_friend_read", { p_dm: dm });
  if (isMissing(error)) useSocial.setState({ supported: false });
}

/** SHOW ME ON THE MAP, on or off. Shown at once, put back if the server says no. */
export async function setMapShare(on: boolean): Promise<boolean> {
  const before = useSocial.getState().onMap;
  useSocial.setState({ onMap: on });
  const sb = getSupabase();
  if (!sb) {
    useSocial.setState({ onMap: before });
    return false;
  }
  const { data, error } = await sb.rpc("crew_friend_map", { p_on: on });
  if (error || data === null) {
    useSocial.setState({ onMap: before });
    return false;
  }
  return true;
}
