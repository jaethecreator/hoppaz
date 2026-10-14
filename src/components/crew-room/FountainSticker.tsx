"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The featured event's flyer over the courtyard fountain, with the owner's ribbon (design section 11). Non solid, under avatars.
 *
 * WORLD LAYER stub, owned by PLACES. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). Everything here opts in to pointer events itself; the wrapper is click-through.
 */
export type FountainStickerProps = { crewId: string; layout: CampaignLayout };

export default function FountainSticker(props: FountainStickerProps) {
  void props;
  return null;
}
