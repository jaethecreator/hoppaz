"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The Game Time slot in a crew room: where the Friday ticket hunt draws and listens. This file is a stub that renders
 * nothing; the Game Time app owns everything under src/components/game-time/** and src/lib/game-time/** and fills it
 * in. The room mounts it TWICE, so a hunt can draw in both places:
 *
 *   worldLayer = true   inside the world container (CampaignWorld, the `.world` div, which is scaled by the camera).
 *                       Use this for things that sit on the scene: shimmering objects, the search animation, a
 *                       "found it" burst. It is a full-size, click-through wrapper, so children opt in to pointer
 *                       events themselves (`pointer-events: auto`).
 *   worldLayer = false  in the screen chrome (CampaignExperience, over the room, outside the scaled world). Use this
 *                       for the banner, the countdown and the win sheet. Screen pixels, not scene pixels.
 *
 * COORDINATES. A tile is `layout.grid.tile` scene pixels square (32). Tile (x, y) covers the scene rectangle
 * [x * tile, (x + 1) * tile) by [y * tile, (y + 1) * tile), measured from the top-left of the scene, which is the
 * origin of the world container. In a world layer, position a child with `left: x * tile, top: y * tile` and it lines
 * up with the art, whatever the zoom. A prop (layout.props, found by its stable id such as "courtyard-fountain") has
 * its own x, y, w, h in tiles. Walkers stand on a tile; `me` is the tile this Hopper stands on.
 *
 * ROOM FACTS. `roomId` is the crew id (one room per crew). Everyone who reaches the layer is signed in and in the
 * crew; `isWatcher` is true while the room is full and this Hopper only looks on (no avatar, `me` is null, `walkTo`
 * does nothing). The room also exposes `useRoomStore` (src/lib/crew-room/roomStore.ts): `huntActive` is the flag the
 * hunt sets while a Game Time is scheduled or live, so the door and the rails ask "Leave the hunt?" first.
 */
export type GameTimeLayerProps = {
  /** The crew the room belongs to. */
  crewId: string;
  /** The room's id: the crew id. */
  roomId: string;
  /** The room's layout (walls, props with stable ids, areas, grid.tile). Same object the world is drawn from. */
  layout: CampaignLayout;
  /** My tile right now, or null while watching a full room. */
  me: { x: number; y: number } | null;
  /** Signed in and in the crew. Always true inside the room today. */
  isMember: boolean;
  /** Looking on from a full room: no avatar, cannot walk, cannot search. */
  isWatcher: boolean;
  /** Walk my avatar to a tile (the same as tapping the floor). A no-op while watching. */
  walkTo: (x: number, y: number) => void;
  /** True when mounted inside the world container, so absolutely positioned children line up with tiles. */
  worldLayer: boolean;
};

export default function GameTimeLayer(props: GameTimeLayerProps) {
  void props;
  return null;
}
