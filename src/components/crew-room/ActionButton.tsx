"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The one thumb-sized pill above the bottom nav (design section 7). Renders useRoomStore().action; label and onPress come from whoever registered it.
 *
 * SCREEN CHROME stub, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 */
export type ActionButtonProps = { crewId: string; layout: CampaignLayout };

export default function ActionButton(props: ActionButtonProps) {
  void props;
  return null;
}
