"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The door's readable EXIT TO MAP label and its tap (design section 12). The prop id is MAP_TABLE (entry-map-table).
 *
 * WORLD LAYER stub, owned by PLACES. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). Everything here opts in to pointer events itself; the wrapper is click-through.
 */
export type ExitDoorProps = { crewId: string; layout: CampaignLayout };

export default function ExitDoor(props: ExitDoorProps) {
  void props;
  return null;
}
