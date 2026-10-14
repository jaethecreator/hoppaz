"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";
import type { CrewRoomConnection } from "@/lib/crew-room/types";

/**
 * New messages as short bubbles over the speaker's avatar (design section 9.8). Owned by CHAT.
 *
 * WORLD LAYER stub, mounted by CampaignWorld inside the world container (the scaled `.world` div), so children are
 * positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile (tile = useRoomStore().tile). Peers and
 * their tiles are in useRoomStore().peers; my tile is useRoomStore().me.
 *
 * `room` and `userId` are passed by the shell so this layer reads the same connection the chat sheet does (a second
 * useCrewRoom would take the walker over). Messages are room.threads["general"] and room.threads[circleId].
 */
export type BubblesProps = { crewId: string; layout: CampaignLayout; room: CrewRoomConnection; userId: string };

export default function Bubbles(props: BubblesProps) {
  void props;
  return null;
}
