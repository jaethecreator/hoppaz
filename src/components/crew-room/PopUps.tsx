"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The small in-world cards: zone cards and one-second hints at a tap point (design section 5.5). Reads useRoomStore popups, dismissPopup.
 *
 * WORLD LAYER stub, owned by SOCIAL. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). Everything here opts in to pointer events itself; the wrapper is click-through.
 */
export type PopUpsProps = { crewId: string; layout: CampaignLayout };

export default function PopUps(props: PopUpsProps) {
  void props;
  return null;
}
