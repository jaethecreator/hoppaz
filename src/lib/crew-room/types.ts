import type { CampaignContent } from '@/lib/campaign/layout';
import type { Tile } from '@/lib/campaign/geometry';
export type RoomPeer = Tile & { id: string; name: string; look: unknown; circle_id: string | null; last_seen: string };
export type RoomSnapshot = {
  observed_at: string;
  crew: { id: string; name: string; is_owner: boolean };
  room: { width: 30 | 36; content: CampaignContent; version: number };
  peers: RoomPeer[];
  self: (Tile & { seq: number; circle_id: string | null; session_id: string }) | null;
  circles: (Tile & { id: string; area_id: string })[];
};
export type RoomMessage = { id: string; crew_id: string; author_id: string; author_name: string; author_look: unknown; body: string; scope: 'general' | 'nearby'; circle_id: string | null; created_at: string };
export type PositionReset = Tile & { revision: number };
export type SocialWorld = { peers: RoomPeer[]; circles: RoomSnapshot['circles']; selfId: string; circleId: string | null; areaId: string | null; reset: PositionReset; onStep: (tile: Tile) => boolean; onConversation?: () => void; destination?: Tile | null; onDestinationHandled?: () => void };
export type CrewRoomConnection = {
  snapshot: RoomSnapshot | null; messages: RoomMessage[]; status: 'loading' | 'ready' | 'error';
  error: string; connected: boolean; retry: () => void; world: SocialWorld | null;
  send: (scope: 'general' | 'nearby', text: string, circle: string | null) => Promise<string | null>;
  save: (width: 30 | 36, content: CampaignContent) => Promise<string | null>;
};
