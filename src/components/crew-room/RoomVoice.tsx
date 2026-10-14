"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * Ola's LiveKit voice, dark behind one flag (design section 14). Joins the room only when the flag is on.
 *
 * SCREEN CHROME stub, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 */
export type RoomVoiceProps = { crewId: string; layout: CampaignLayout };

export default function RoomVoice(props: RoomVoiceProps) {
  void props;
  return null;
}
