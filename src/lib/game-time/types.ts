/**
 * What the database says about a Game Time (docs/GAME-TIME.md, section 4). Plain data: the room, the hub, the global
 * ping and Me all read these shapes. Codes and hiding spots never appear here, except the Hopper's own winning code.
 */

export type GtStatus = "upcoming" | "live" | "over";
export type GtOverReason = "all_found" | "closed" | "time_up";
export type GtHint = "hot" | "warm" | "cold";
/** Why a crew member cannot hunt: the email on the account was never confirmed, or they joined the crew too late for this game. */
export type GtBlocked = "need_confirmed" | "joined_late";

/** Drop `i` of `n` in a series of mystery drops, read off the end of the game's title (drops.ts). */
export type GtDrop = { i: number; n: number };

export type GtFound = { id: number; at: string; name: string; object: string; boxes_left: number };

export type GtGame = {
  id: string;
  crew_id: string;
  crew_name: string;
  brand: string;
  /** Without the " · i/N" marker of a series. */
  title: string;
  /** Which drop of a series this game is; null for a plain game. */
  drop?: GtDrop | null;
  status: GtStatus;
  over_reason: GtOverReason | null;
  opens_at: string;
  closes_at: string;
  ended_at: string | null;
  boxes_total: number;
  boxes_left: number;
  search_gap_ms: number;
  room_ok: boolean;
  /** Joining the crew right now is early enough to hunt this game (false once a members-only minimum has passed). */
  join_in_time: boolean;
  /** The ids of the props that may hide a box. Only while live, only for a member, and only when room_ok. */
  objects: string[];
  feed_tail: number;
  found: GtFound[];
};

export type GtMe = { member: boolean; won: boolean; code: string | null; won_at: string | null; blocked: GtBlocked | null; can_search: boolean };

export type GtState = { server_now: string; game: GtGame | null; me: GtMe };

/** One row of game_time_list(): the global ping. */
export type GtListGame = {
  id: string;
  crew_id: string;
  crew_name: string;
  brand: string;
  verified: boolean;
  title: string;
  drop?: GtDrop | null;
  status: "upcoming" | "live";
  opens_at: string;
  closes_at: string;
  boxes_total: number;
  boxes_left: number;
  is_member: boolean;
  blocked: GtBlocked | null;
  join_in_time: boolean;
  won: boolean;
};

export type GtTicket = { id: string; game_id: string; crew_id: string; title: string; brand: string; code: string; won_at: string };

/** The refusals of game_time_search (error.message), plus the two this app adds for a dropped connection and a lock wait. */
export type GtReason =
  | "need_account"
  | "need_confirmed"
  | "joined_late"
  | "not_in_crew"
  | "no_game"
  | "not_open_yet"
  | "all_found"
  | "game_closed"
  | "already_won"
  | "room_changed"
  | "not_in_room"
  | "unknown_object"
  | "too_far"
  | "slow_down"
  | "busy"
  | "offline"
  | "unknown";

export type GtAnswer =
  | { kind: "nothing"; hint: GtHint; boxesLeft: number; tail: number; retryMs: number; object: string }
  | { kind: "win"; code: string; gameId: string; title: string; object: string; boxesLeft: number; gameOver: boolean; wonAt: string; tail: number; retryMs: number }
  | { kind: "refused"; reason: GtReason; waitMs: number };
