"use client";

import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * The door's readable EXIT TO MAP label and its tap (design section 12). The prop id is MAP_TABLE (entry-map-table).
 *
 * WORLD LAYER stub, owned by PLACES. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). Everything here opts in to pointer events itself; the wrapper is click-through.
 *
 * SHELL LAYOUT FACTS (set on the chrome wrapper this is mounted in, usable as CSS):
 *   --room-bottom   px from the stage bottom edge to put a bottom-anchored control: 12px, plus the chat sheet's height
 *                   while it is open (the shell keeps it in step with useRoomStore().sheetHeight)
 *   --room-hud-bottom   px from the stage top to just under the shell's HUD pill (sound, full view, owner settings),
 *                   which sits at the top right. A control that belongs in that column (the mic) goes right under it:
 *                   top: var(--room-hud-bottom), right: 8px, 44 x 44.
 *   The shell's CHAT button sits bottom left: left 12px, 44 high, 44 wide (88 with the word when no action shows),
 *   at bottom: var(--room-bottom). Keep the centre free for the action pill: left 64px to right 12px.
 * In the world container (WORLD LAYER stubs) the scaled .world element carries --cam-s (the camera scale) and --cam-inv
 * (1 / scale), updated every camera frame. A label that must stay the same size on screen at every zoom is
 * positioned in world px and uses transform: ... scale(var(--cam-inv)) with transform-origin at its anchor.
 */
export type ExitDoorProps = { crewId: string; layout: CampaignLayout };

export default function ExitDoor(props: ExitDoorProps) {
  void props;
  return null;
}
