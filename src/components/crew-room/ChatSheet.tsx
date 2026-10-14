"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";
import type { CrewRoomConnection } from "@/lib/crew-room/types";

/**
 * The translucent chat sheet that slides up over the lower part of the world and pulls down to close (design section
 * 9). Owned by CHAT. Its EXPLORE tab renders <Explore crewId=... /> from ./Explore.
 *
 * SCREEN CHROME stub, mounted by CampaignExperience over the room (screen pixels), in a wrapper that fills the room
 * stage (the area between the header and the bottom nav) and is click-through: opt in to pointer events on the sheet.
 * Sheet state is useRoomStore().sheet ("peek" | "half" | "full"); the HUD chat button and the shell set it too.
 *
 * `room` and `userId` are passed by the shell so the sheet uses the one room connection (a second useCrewRoom would take
 * the walker over). The shell no longer mounts the old CrewRoomChat; this sheet replaces it.
 */
export type ChatSheetProps = { crewId: string; layout: CampaignLayout; room: CrewRoomConnection; userId: string };

export default function ChatSheet(props: ChatSheetProps) {
  void props;
  return null;
}
