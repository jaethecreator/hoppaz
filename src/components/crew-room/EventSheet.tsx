"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The in-room sheet for the featured event: flyer, day, ribbon, OPEN ON MAP (design section 11.3).
 *
 * SCREEN CHROME stub, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 */
export type EventSheetProps = { crewId: string; layout: CampaignLayout };

export default function EventSheet(props: EventSheetProps) {
  void props;
  return null;
}
