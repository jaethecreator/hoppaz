import { getSupabase } from "@/lib/supabase/client";
import type { GtAnswer, GtHint, GtListGame, GtReason, GtState, GtTicket } from "./types";

/**
 * The Hopper calls of Game Time (docs/GAME-TIME.md, section 4). Every one is an rpc with the Hopper's own session; a
 * refusal is a Postgres error whose message is the reason. Nothing here ever throws: a dropped connection is an answer too.
 */

const REASONS: readonly GtReason[] = [
  "need_account",
  "not_in_crew",
  "no_game",
  "not_open_yet",
  "all_found",
  "game_closed",
  "already_won",
  "room_changed",
  "not_in_room",
  "unknown_object",
  "too_far",
  "slow_down",
];

/** Turns a Postgres error into one of our reasons. */
export function reasonOf(error: { message?: string; code?: string } | null | undefined): GtReason {
  const text = error?.message ?? "";
  const hit = REASONS.find((r) => text.includes(r));
  if (hit) return hit;
  if (error?.code === "55P03" || /lock timeout|deadlock|could not serialize/i.test(text)) return "busy";
  if (/fetch|network|load failed|timeout|offline|aborted/i.test(text) || !text) return "offline";
  return "unknown";
}

export type StateResult = { ok: true; state: GtState | null; sentAt: number; receivedAt: number } | { ok: false; sentAt: number; receivedAt: number };

/** game_time_state(crew): the HUD and the hub. `state` is null when the crew is private and the caller is not in it. */
export async function fetchState(crewId: string): Promise<StateResult> {
  const sb = getSupabase();
  const sentAt = Date.now();
  if (!sb) return { ok: false, sentAt, receivedAt: sentAt };
  try {
    const { data, error } = await sb.rpc("game_time_state", { p_crew: crewId });
    const receivedAt = Date.now();
    if (error) return { ok: false, sentAt, receivedAt };
    return { ok: true, state: (data as GtState | null) ?? null, sentAt, receivedAt };
  } catch {
    return { ok: false, sentAt, receivedAt: Date.now() };
  }
}

/** game_time_search(crew, object): the only way to learn anything about the boxes. */
export async function searchObject(crewId: string, object: string): Promise<GtAnswer> {
  const sb = getSupabase();
  if (!sb) return { kind: "refused", reason: "offline", waitMs: 1000 };
  try {
    const { data, error } = await sb.rpc("game_time_search", { p_crew: crewId, p_object: object });
    if (error) {
      const reason = reasonOf(error);
      const wait = Number(String(error.details ?? "").match(/\d+/)?.[0]);
      return { kind: "refused", reason, waitMs: reason === "slow_down" && wait > 0 ? Math.min(wait, 10_000) : 0 };
    }
    const a = data as Record<string, unknown> | null;
    if (!a || typeof a !== "object") return { kind: "refused", reason: "unknown", waitMs: 0 };
    const retryMs = Number(a.retry_ms) > 0 ? Number(a.retry_ms) : 3000;
    if (a.result === "win" && typeof a.code === "string") {
      return {
        kind: "win",
        code: a.code,
        gameId: String(a.game_id ?? ""),
        title: String(a.title ?? ""),
        object: String(a.object ?? object),
        boxesLeft: Number(a.boxes_left) || 0,
        gameOver: a.game_over === true,
        wonAt: String(a.won_at ?? new Date().toISOString()),
        tail: Number(a.feed_tail) || 0,
        retryMs,
      };
    }
    const hint: GtHint = a.hint === "hot" || a.hint === "warm" ? a.hint : "cold";
    return { kind: "nothing", hint, boxesLeft: Number(a.boxes_left) || 0, tail: Number(a.feed_tail) || 0, retryMs, object: String(a.object ?? object) };
  } catch {
    return { kind: "refused", reason: "offline", waitMs: 1000 };
  }
}

/** game_time_list(): games that start within 6 hours or are live, in crews the caller can see. For the global ping. */
export async function fetchList(): Promise<{ ok: boolean; games: GtListGame[]; serverNow: string | null }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, games: [], serverNow: null };
  try {
    const { data, error } = await sb.rpc("game_time_list");
    if (error || !data) return { ok: false, games: [], serverNow: null };
    const d = data as { server_now?: string; games?: GtListGame[] };
    return { ok: true, games: Array.isArray(d.games) ? d.games : [], serverNow: d.server_now ?? null };
  } catch {
    return { ok: false, games: [], serverNow: null };
  }
}

/** my_game_time_wins(): the tickets this Hopper has won, newest first. Signed in only. */
export async function fetchTickets(): Promise<{ ok: boolean; tickets: GtTicket[] }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, tickets: [] };
  try {
    const { data, error } = await sb.rpc("my_game_time_wins");
    if (error) return { ok: false, tickets: [] };
    return { ok: true, tickets: Array.isArray(data) ? (data as GtTicket[]) : [] };
  } catch {
    return { ok: false, tickets: [] };
  }
}
