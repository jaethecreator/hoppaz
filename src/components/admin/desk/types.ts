/**
 * The shapes the staff desk reads (src/app/api/admin/game-time, src/app/api/admin/game). One file so the desk's parts agree:
 * the shell (src/app/admin/page.tsx), the rooms (RoomsSection), the drops (DropsSection, DropCards) and the add-a-drop flow
 * (AddDrop). A "drop" on the desk is one Game Time (one row of game_times); a "series" is the drops that share a campaign key.
 */

export type Crew = {
  id: string;
  name: string;
  verified: boolean;
  visibility: string;
  template: string;
  width: number;
  /** Set on databases that have crew_rooms.sql (crews.logo_url). A path like /brands/360playlist.jpg or a storage URL. */
  logo_url?: string | null;
  invite_code?: string | null;
};

export type RoomObject = { id: string; label: string; kind: string; x: number; y: number; w: number; h: number };

export type Box = {
  id: string;
  code: string;
  spot: string | null;
  placed_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  handle: string | null;
  name: string | null;
};

export type GamePhase = "upcoming" | "live" | "all_found" | "closed" | "time_up";

export type Game = {
  id: string;
  crew_id: string;
  crew_name: string;
  brand: string;
  /** The raw title, with the drop marker (" · 2/8") when it is part of a mystery series. Read it with dropOf() in format.ts. */
  title: string;
  status: "upcoming" | "live" | "over";
  phase: GamePhase;
  opens_at: string;
  closes_at: string;
  ended_at: string | null;
  campaign_key: string;
  room_template: string;
  room_width: number;
  room_ok: boolean;
  relocate_minutes: number;
  hot_tiles: number;
  warm_tiles: number;
  min_member_minutes: number;
  push_sent_at: string | null;
  push_count: number;
  push_ready: boolean;
  cron_ready: boolean;
  room_capacity: number | null;
  boxes_total: number;
  boxes_left: number;
  searches: number;
  searchers: number;
  claims: number;
  members: number;
  in_room: number;
  /** Only on one game in full (GET ?id=). */
  objects?: { id: string; x: number; y: number; w: number; h: number }[];
  /** Only on one game in full (GET ?id=). */
  boxes?: Box[];
};

export type Winner = {
  game_id: string;
  title: string;
  crew_name: string;
  handle: string | null;
  name: string | null;
  email: string | null;
  code: string;
  object: string | null;
  won_at: string;
  account_created: string | null;
  email_confirmed: boolean;
  provider: string | null;
  joined_crew: string | null;
  joined_mins_before_open: number | null;
  account_mins_before_open: number | null;
  searches: number | null;
  secs_after_open: number | null;
  flags: string[];
};

/** GET /api/admin/game-time: every drop (newest first, no codes), the crews with their room, and each room's hiding spots by "template:width". */
export type Desk = { games: Game[]; crews: Crew[]; objects: Record<string, RoomObject[]> };

export type Announcement = { id: string; body: string; created_at: string; author: string | null };

/**
 * GET /api/admin/game-time?crew=<id>: the facts about one crew room the desk shows next to its drops. Every field can be
 * missing on a database that lacks the table it comes from (announcements before crew_announcements.sql, capacity before
 * crew_rooms.sql), so the desk shows what it gets and never breaks.
 */
export type CrewInfo = {
  id: string;
  name: string;
  members: number | null;
  joined_today: number | null;
  in_room: number | null;
  capacity: number | null;
  invite_code: string | null;
  logo_url: string | null;
  announcements: Announcement[];
};

/** A live event from GET /api/admin/game (queue.liveEvents). The desk lists these as event rooms. */
export type LiveEvent = { id: string; title: string; venue_name: string; area: string | null; starts_at?: string };

/** Which room the desk has open. Only crew rooms can hold a drop today; event and hotspot rooms need Ola's database update. */
export type RoomRef = { kind: "crew" | "event" | "hotspot"; id: string };

/** The desk's sections, in rail order. */
export type SectionKey = "rooms" | "drops" | "events" | "hotspots" | "safety" | "eventreports" | "roomz3d" | "quests" | "more";

/** POST an action to /api/admin/game-time. Resolves the answer, or null after telling staff why not (or after onError). */
export type GameTimeAct = (body: Record<string, unknown>, onError?: (message: string) => void) => Promise<{ ok?: boolean; game?: Game } | null>;

/** What useGameTimeDesk gives the parts of the desk. */
export type GameTimeDeskApi = {
  desk: Desk | null;
  error: string;
  busy: boolean;
  headers: { authorization: string };
  load: () => Promise<void>;
  act: GameTimeAct;
  /** Downloads the winners of one drop (game id) or of all (null) as CSV. */
  exportCsv: (game: string | null, filename: string) => Promise<void>;
};
