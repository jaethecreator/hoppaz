"use client";

import { useEffect, type RefObject } from "react";
import { create } from "zustand";
import { getSupabase } from "@/lib/supabase/client";
import { wave as waveByKey } from "@/lib/chat";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";

/**
 * Tap a Hopper (design sections 8.1 to 8.3): the vibe stickers, SAY HI, and the little in-room hints they answer with.
 *
 *   VIBES        the fixed catalogue. A vibe is a sticker id and nothing else, never text (the server checks it too).
 *   sendVibe     one sticker to one person. Limits mirror supabase/crew_rails.sql so the sender hears "no" without a
 *                request: 1 every 3 s, 3 a minute to the same person, 12 a minute in all. The server has the last word.
 *   sayHi        the wave. With a room key it is src/lib/chat.ts wave(key); without one (crew room peers carry user
 *                ids) it is the crew_room_wave call, which answers the same way and opens the DM when it is mutual.
 *   subscribeVibes  the Realtime feed of vibes and wave taps for one crew (RLS keeps it to crew members).
 *   useVibes     what is on screen right now (stickers over heads, the one hint chip, the cooldown ring), shared by
 *                VibeLayer (draws and receives), HopperMenu (sends, shows the hint) and PopUps (nothing).
 *   useWorldScale  the screen scale of a world layer, so a label drawn in world pixels can stay one size at every zoom.
 */

export const VIBES = [
  { id: "outside", label: "WE OUTSIDE", lines: ["WE", "OUTSIDE"] },
  { id: "big", label: "BIG VIBES", lines: ["BIG", "VIBES"] },
  { id: "omo", label: "OMO", lines: ["OMO"] },
  { id: "fresh", label: "FRESH", lines: ["FRESH"] },
  { id: "wahala", label: "NO WAHALA", lines: ["NO", "WAHALA"] },
] as const;
export type VibeId = (typeof VIBES)[number]["id"];
export const isVibeId = (v: unknown): v is VibeId => VIBES.some((x) => x.id === v);
export const vibeLabel = (id: string) => VIBES.find((v) => v.id === id)?.label ?? "";

/** Height of an avatar above its tile centre, in world px: a sticker or card sits on the head, not the feet. */
export const HEAD_PX = 48;
/** Vibes reach people this many tiles from the sender (and always the target). */
export const NEAR_TILES = 8;
/** A vibe stays over a head this long (ms). */
export const VIBE_MS = 3000;
export const COOLDOWN_MS = 3000;
const SAME_PERSON_MAX = 3;
const TOTAL_PER_MINUTE = 12;

export type ActiveVibe = {
  id: string;
  sticker: VibeId;
  /** Sender's user id. */
  from: string;
  /** Target's user id. */
  to: string;
  at: number;
  /** I sent it (it shows over my own head). */
  mine: boolean;
};
export type Hint = { id: number; text: string; ttl: number; action?: { label: string; onPress: () => void } };

type VibeState = {
  active: ActiveVibe[];
  /** When the next vibe may go (ms timestamp). The menu draws the ring from it. */
  cooldownUntil: number;
  hint: Hint | null;
  /** People I waved at this visit (user ids), so SAY HI greys to WAVED. */
  waved: Record<string, true>;
  addVibe: (v: ActiveVibe) => void;
  removeVibe: (id: string) => void;
  say: (text: string, ttl?: number, action?: Hint["action"]) => void;
  clearHint: (id?: number) => void;
  markWaved: (userId: string) => void;
  reset: () => void;
};

let hintSeq = 0;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

export const useVibes = create<VibeState>((set, get) => ({
  active: [],
  cooldownUntil: 0,
  hint: null,
  waved: {},
  addVibe: (v) =>
    set((s) => {
      if (s.active.some((x) => x.id === v.id)) return s;
      // At most 3 on screen, 2 over one head: the oldest goes first.
      const mine = s.active.filter((x) => x.from === v.from);
      let next = mine.length >= 2 ? s.active.filter((x) => x !== mine[0]) : s.active;
      next = [...next, v];
      return { active: next.slice(-3) };
    }),
  removeVibe: (id) => set((s) => (s.active.some((x) => x.id === id) ? { active: s.active.filter((x) => x.id !== id) } : s)),
  say: (text, ttl = 2500, action) => {
    if (hintTimer) clearTimeout(hintTimer);
    const id = ++hintSeq;
    set({ hint: { id, text, ttl, action } });
    hintTimer = setTimeout(() => get().clearHint(id), ttl);
  },
  clearHint: (id) => {
    const h = get().hint;
    if (!h || (id != null && h.id !== id)) return;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    set({ hint: null });
  },
  markWaved: (userId) => set((s) => (s.waved[userId] ? s : { waved: { ...s.waved, [userId]: true } })),
  reset: () => {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    sent.length = 0;
    set({ active: [], cooldownUntil: 0, hint: null, waved: {} });
  },
}));

/** When I sent my recent vibes (ms) and to whom, for the limits. */
const sent: { at: number; to: string }[] = [];

export type SendResult = { ok: boolean; text: string };

/** Why a vibe to this person cannot go right now (the menu's label row says it), or null. Same limits as the server. */
export function vibeBlocked(to: string): string | null {
  const now = Date.now();
  while (sent.length && now - sent[0].at > 60_000) sent.shift();
  if (now < useVibes.getState().cooldownUntil) return REFUSED.slow_down;
  if (sent.filter((s) => s.to === to).length >= SAME_PERSON_MAX) return REFUSED.same_person;
  if (sent.length >= TOTAL_PER_MINUTE) return REFUSED.slow_down;
  return null;
}

const REFUSED: Record<string, string> = {
  slow_down: "SLOW DOWN",
  same_person: "GIVE THEM A MINUTE",
  gone: "THEY LEFT THE ROOM",
  not_in_room: "WALK IN FIRST, THEN VIBE",
  self: "THAT'S YOU",
  not_in_crew: "JOIN THE CREW FIRST",
  need_account: "MAKE AN ACCOUNT TO VIBE",
};

/**
 * Send one sticker to one person. It shows over my own head at once (with a sound and a tap); if the server says no,
 * it is taken back and the reason is returned for the menu's label row.
 */
export async function sendVibe(crewId: string, me: string, to: string, sticker: VibeId): Promise<SendResult> {
  const now = Date.now();
  const no = vibeBlocked(to);
  if (no) return { ok: false, text: no };
  const sb = getSupabase();
  if (!sb) return { ok: false, text: "NO CONNECTION" };

  const shown: ActiveVibe = { id: `mine-${now}`, sticker, from: me, to, at: now, mine: true };
  sent.push({ at: now, to });
  useVibes.setState({ cooldownUntil: now + COOLDOWN_MS });
  useVibes.getState().addVibe(shown);
  sfx.vibe();
  haptics.buzz("pick");
  try {
    const { data, error } = await sb.rpc("crew_room_vibe", { p_crew: crewId, p_to: to, p_sticker: sticker });
    const answer = String(data);
    if (error || answer !== "sent") {
      useVibes.getState().removeVibe(shown.id);
      sent.pop();
      return { ok: false, text: error ? "NO CONNECTION" : REFUSED[answer] ?? "COULD NOT SEND" };
    }
  } catch {
    useVibes.getState().removeVibe(shown.id);
    sent.pop();
    return { ok: false, text: "NO CONNECTION" };
  }
  return { ok: true, text: "SENT" };
}

export type HiResult = { kind: "sent" | "matched" | "already" | "failed"; text: string; dm?: string };

const HI_TEXT: Record<string, string> = {
  already: "ALREADY WAVED",
  blocked: "YOU BLOCKED THEM",
  slow_down: "THAT'S A LOT OF WAVES TODAY. TRY TOMORROW",
  self: "THAT'S YOU",
  gone: "THEY LEFT THE ROOM",
  not_met: "YOU CAN WAVE AT PEOPLE IN YOUR CREW ROOM",
  no_session: "NOT SIGNED IN YET",
  need_account: "MAKE AN ACCOUNT TO WAVE",
};

/** SAY HI. A room key goes through the existing wave(key); a crew room peer without one through crew_room_wave. */
export async function sayHi(crewId: string, peer: { id: string; name: string; key?: string }): Promise<HiResult> {
  const who = peer.name.toUpperCase();
  let result: HiResult;
  if (peer.key) {
    const r = await waveByKey(peer.key);
    if (r.dm) result = { kind: "matched", text: "YOU'RE CONNECTED", dm: r.dm };
    else if (r.text.startsWith("WAVE SENT")) result = { kind: "sent", text: `WAVED AT ${who}` };
    else if (r.text === "ALREADY WAVED") result = { kind: "already", text: r.text };
    else result = { kind: "failed", text: r.text };
  } else {
    const sb = getSupabase();
    if (!sb) return { kind: "failed", text: "NO CONNECTION" };
    const { data, error } = await sb.rpc("crew_room_wave", { p_crew: crewId, p_peer: peer.id });
    const answer = String(data);
    if (error) result = { kind: "failed", text: "NO CONNECTION" };
    else if (answer.startsWith("matched:")) result = { kind: "matched", text: "YOU'RE CONNECTED", dm: answer.slice(8) };
    else if (answer === "sent") result = { kind: "sent", text: `WAVED AT ${who}` };
    else if (answer === "already") result = { kind: "already", text: HI_TEXT.already };
    else result = { kind: "failed", text: HI_TEXT[answer] ?? "COULD NOT WAVE" };
  }
  if (result.kind === "sent" || result.kind === "matched" || result.kind === "already") useVibes.getState().markWaved(peer.id);
  return result;
}

/** Say what a wave came to: a mutual wave offers OPEN DM (never automatic), anything else is a short hint. */
export function sayResult(r: HiResult, open: (dm: string) => void) {
  const { say } = useVibes.getState();
  const dm = r.dm;
  if (r.kind === "matched" && dm) say(r.text, 7000, { label: "OPEN DM", onPress: () => open(dm) });
  else say(r.text, r.kind === "failed" ? 3500 : 2500);
}

export type IncomingVibe = { id: string; sticker: VibeId | "wave"; from: string; to: string; at: number };

/**
 * Vibes and wave taps for one crew, live. Row level security decides who gets a row (a crew member, not across a block,
 * a wave only its two people), so this only has to keep the stream tidy: the same id once, nothing stale.
 */
export function subscribeVibes(crewId: string, onVibe: (v: IncomingVibe) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const seen = new Set<string>();
  const channel = sb
    .channel(`crew-vibes:${crewId}:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_room_vibes", filter: `crew_id=eq.${crewId}` }, (payload) => {
      const row = payload.new as { id: string; from_user: string; to_user: string; sticker: string; dropped?: boolean; created_at: string };
      if (!row || row.dropped || seen.has(row.id)) return;
      if (row.sticker !== "wave" && !isVibeId(row.sticker)) return;
      const at = Date.parse(row.created_at.replace(/(\.\d{3})\d+/, "$1"));
      // A reconnect can replay the last rows: a vibe older than 8 s has already faded.
      if (Number.isFinite(at) && Date.now() - at > 8000) return;
      seen.add(row.id);
      if (seen.size > 200) seen.delete(seen.values().next().value as string);
      onVibe({ id: row.id, sticker: row.sticker as IncomingVibe["sticker"], from: row.from_user, to: row.to_user, at: Date.now() });
    })
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/** The nearest ancestor that hides overflow: the world viewport a layer in the scaled world is clipped to. */
export function findClip(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflow;
    if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * The screen scale of a layer drawn in world pixels inside the scaled world. While `active`, every animation frame
 * writes `--hz-inv` (1 / scale) on the layer, so `transform: scale(var(--hz-inv, 1))` keeps a label one size at every
 * zoom, and calls `onFrame(scale, layerRect, clipRect)` for layers that also clamp to the visible world.
 * The clip is the nearest ancestor that hides overflow: the world viewport.
 */
export function useWorldScale(
  root: RefObject<HTMLElement | null>,
  active: boolean,
  onFrame?: (scale: number, layer: DOMRect, clip: DOMRect, dt: number) => void
) {
  useEffect(() => {
    const el = root.current;
    if (!el || !active) return;
    const clip = findClip(el);
    let raf = 0;
    let last = performance.now();
    let written = 0;
    const loop = (t: number) => {
      const rect = el.getBoundingClientRect();
      const s = rect.width / (el.offsetWidth || 1) || 1;
      const inv = 1 / s;
      if (Math.abs(inv - written) > 0.0005) {
        el.style.setProperty("--hz-inv", inv.toFixed(4));
        written = inv;
      }
      onFrame?.(s, rect, (clip ?? document.documentElement).getBoundingClientRect(), Math.min(0.1, (t - last) / 1000));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // onFrame is read through the closure of the caller's latest render by design: callers pass a stable ref callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, active]);
}
