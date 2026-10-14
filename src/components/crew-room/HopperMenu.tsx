"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The small menu that opens on a Hopper you tap: VIBE, SAY HI, WALK TO, PROFILE (design section 8). Reads useRoomStore tappedPeer and peers, clears with setTappedPeer(null).
 *
 * SCREEN CHROME stub, owned by SOCIAL. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 */
export type HopperMenuProps = { crewId: string; layout: CampaignLayout };

export default function HopperMenu(props: HopperMenuProps) {
  void props;
  return null;
}
