import type { GtListGame } from "@/lib/game-time/types";

/**
 * PLACEHOLDER for the edge plan's contract (branch jae/perf-edge-cache). The edge branch owns this file and replaces it:
 * when the two branches meet, take the edge version of this file whole. Until then the public list is "not available", and
 * the polling code falls back to the per-user game_time_list, which is exactly what the app did before.
 *
 * The contract the polling code relies on:
 *   ok     the answer is real (a cached copy from the CDN, possibly up to a minute old). Never throws.
 *   games  the open crews' Game Times that start within 6 hours or are live. The per-user fields may be missing.
 */
export type PublicGameTimeGame = Omit<GtListGame, "is_member" | "blocked" | "won" | "join_in_time"> &
  Partial<Pick<GtListGame, "is_member" | "blocked" | "won" | "join_in_time">>;

export async function fetchPublicGameTimeList(): Promise<{ ok: boolean; games: PublicGameTimeGame[] }> {
  return { ok: false, games: [] };
}
