"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * A vibe a Hopper sent shows over their avatar for a moment (design section 8.2).
 *
 * WORLD LAYER stub, owned by SOCIAL. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). Everything here opts in to pointer events itself; the wrapper is click-through.
 */
export type VibeLayerProps = { crewId: string; layout: CampaignLayout };

export default function VibeLayer(props: VibeLayerProps) {
  void props;
  return null;
}
