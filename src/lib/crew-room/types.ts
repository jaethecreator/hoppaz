import type { CampaignContent } from "@/lib/campaign/layout";
import type { Tile } from "@/lib/campaign/geometry";

/** Someone walking in the room, as the server last saw them. */
export type RoomPeer = Tile & { id: string; name: string; look: unknown; circle_id: string | null; last_seen: string };

/** What every room call hands back (_crew_room_snapshot in supabase/crew_rooms.sql). */
export type RoomSnapshot = {
  observed_at: string;
  crew: { id: string; name: string; is_owner: boolean; verified: boolean };
  room: { template?: string; width: 30 | 36; content: CampaignContent; version: number; capacity: number };
  peers: RoomPeer[];
  /** This Hopper's walker. Null while watching a full room. */
  self: (Tile & { seq: number; circle_id: string | null; session_id: string }) | null;
  circles: (Tile & { id: string; area_id: string })[];
  /** crew_room_enter only: the room was full, so this Hopper is watching. */
  watching?: boolean;
  /** crew_room_enter only: this tab took the walker over from another tab or phone. */
  took_over?: boolean;
};

export type RoomMessage = {
  id: string;
  crew_id: string;
  author_id: string;
  author_name: string;
  author_look: unknown;
  body: string;
  scope: "general" | "nearby";
  circle_id: string | null;
  created_at: string;
};

/** One conversation's loaded history, oldest first: General ("general"), or one area session (its circle id). */
export type Thread = { items: RoomMessage[]; more: boolean; loading: boolean; loaded: boolean };

export type PositionReset = Tile & { revision: number };

export type SocialWorld = {
  peers: RoomPeer[];
  circles: RoomSnapshot["circles"];
  selfId: string;
  circleId: string | null;
  areaId: string | null;
  /** The room is full: no avatar of your own, nothing to walk. */
  watching: boolean;
  /** When the snapshot was taken, to tell a peer who has gone quiet (a locked phone) from one who is here. */
  observedAt: string;
  reset: PositionReset;
  onStep: (tile: Tile) => boolean;
  onConversation?: () => void;
  destination?: Tile | null;
  onDestinationHandled?: () => void;
};

/**
 * loading   entering
 * ready     in the room, walking or (watching) looking on from a full room
 * replaced  this Hopper opened the room in another tab or on another phone, which has the walker now
 * error     could not enter: `reason` says why (not_in_crew shows the Join button)
 */
export type RoomStatus = "loading" | "ready" | "replaced" | "error";

export type CrewRoomConnection = {
  snapshot: RoomSnapshot | null;
  status: RoomStatus;
  /** The server's one-word reason for an error (not_in_crew, need_account, ...), or "". */
  reason: string;
  error: string;
  connected: boolean;
  watching: boolean;
  /** A short line to show once, then clear (dismissNotice): "You moved here from your other tab." */
  notice: string;
  dismissNotice: () => void;
  retry: () => void;
  world: SocialWorld | null;
  threads: Record<string, Thread>;
  loadEarlier: (key: string) => void;
  send: (scope: "general" | "nearby", text: string, circle: string | null) => Promise<string | null>;
  save: (width: 30 | 36, content: CampaignContent) => Promise<string | null>;
};
