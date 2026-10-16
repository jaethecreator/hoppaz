"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";
import GameTimeChrome from "./GameTimeChrome";
import GameTimeWorld from "./GameTimeWorld";

/**
 * The Game Time slot in a crew room: where the Friday ticket hunt draws and listens (docs/GAME-TIME.md for the server,
 * docs/ROOM-GAME-DESIGN.md section 13 for the look). The room mounts it TWICE, so a hunt can draw in both places:
 *
 *   worldLayer = true   inside the world container (CampaignWorld, the `.world` div, which is scaled by the camera).
 *                       Draws what sits on the scene: the shimmer on objects that may hide a box, the search animation, the
 *                       hint chip on the object, the burst of a win. A full-size, click-through wrapper; nothing takes a tap.
 *   worldLayer = false  in the screen chrome (CampaignExperience, over the room, outside the scaled world). Runs the
 *                       controller (one poll and one Realtime channel for both mounts), and draws the banner, the feed lines,
 *                       the opening countdown and the win sheet. Registers SEARCH as the room's action pill (priority 100)
 *                       and tells the room a hunt is on (roomStore huntActive) so the exits ask "Leave the hunt?".
 *
 * COORDINATES. A tile is `layout.grid.tile` scene pixels square (32). Tile (x, y) covers the scene rectangle
 * [x * tile, (x + 1) * tile) by [y * tile, (y + 1) * tile), measured from the top-left of the scene, which is the
 * origin of the world container. A prop (layout.props, found by its stable id such as "courtyard-fountain") has its own
 * x, y, w, h in tiles. `me` is the tile this Hopper stands on.
 *
 * ROOM FACTS. `roomId` is the crew id (one room per crew). Everyone who reaches the layer is signed in and in the
 * crew; `isWatcher` is true while the room is full and this Hopper only looks on (no avatar, `me` is null, `walkTo`
 * does nothing, no SEARCH).
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
  /** Chrome mount only: the room has finished opening, so the practice hunt (HuntDemo.tsx) may start. Default true. */
  ready?: boolean;
};

export default function GameTimeLayer(props: GameTimeLayerProps) {
  if (!props.isMember) return null;
  return props.worldLayer ? (
    <GameTimeWorld layout={props.layout} me={props.me} isWatcher={props.isWatcher} walkTo={props.walkTo} />
  ) : (
    <GameTimeChrome crewId={props.crewId} layout={props.layout} isWatcher={props.isWatcher} ready={props.ready} />
  );
}
