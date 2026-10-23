import type { Block, Tile } from "../geometry";
import type { CampaignLayout, CampaignProp, CampaignZone, CampaignZoneLink, FloorMaterial, PropKind } from "../layout";

/**
 * Authoring helpers for event and hotspot rooms (src/lib/campaign/rooms/*). Data only: no JSX, no imports but types, so
 * scripts/rooms/load-campaign.mjs can read these files in a bare vm.
 *
 * Every one of these rooms shares the clubhouse's frame so the camera, walking, the exit door and the Game Time anchors
 * behave the same: 30 by 20 tiles of 32 px, the spawn at the bottom centre, and the way out (`entry-map-table`) two tiles
 * left of it with a walkable tile under it. The outer ring of tiles is never walkable (canWalkScene), so walls are authored
 * inside it.
 */
export const TILE = 32;
export const ROOM_GRID = { width: 30, height: 20, tile: TILE } as const;
export const ROOM_SPAWN: Tile = { x: 15, y: 17 };
/** The exit prop's id, fixed everywhere (MAP_TABLE in layout.ts). */
export const DOOR_ID = "entry-map-table";

export const wall = (x: number, y: number, w: number, h: number): Block => ({ x, y, w, h });

export function prop(id: string, kind: PropKind, x: number, y: number, w: number, h: number, opts: { solid?: boolean; variant?: number } = {}): CampaignProp {
  const out: CampaignProp = { id, kind, x, y, w, h, solid: opts.solid ?? true };
  if (opts.variant !== undefined) out.variant = opts.variant;
  return out;
}

/** Floor decoration the avatars walk over (a rug, a dance floor): not solid. */
export const floorProp = (id: string, kind: PropKind, x: number, y: number, w: number, h: number, variant?: number) => prop(id, kind, x, y, w, h, { solid: false, variant });

/** The exit, two tiles left of the spawn. `kind` picks how the room draws it (door, gate, mapboard, ticket desk...). */
export const exitProp = (kind: PropKind) => prop(DOOR_ID, kind, 13, 16, 2, 1);

export function zone(id: string, name: string, subtitle: string, material: FloorMaterial, rect: Block, stop: Tile, plaque: Tile, link?: CampaignZoneLink): Omit<CampaignZone, "number"> {
  return link ? { id, name, subtitle, material, ...rect, stop, plaque, link } : { id, name, subtitle, material, ...rect, stop, plaque };
}

export function room(id: string, parts: { zones: Omit<CampaignZone, "number">[]; walls: Block[]; props: CampaignProp[]; spawn?: Tile }): CampaignLayout {
  return {
    id,
    grid: { ...ROOM_GRID },
    spawn: parts.spawn ?? ROOM_SPAWN,
    privateAreas: [],
    zones: parts.zones.map((z, i) => ({ ...z, number: String(i + 1).padStart(2, "0") })),
    walls: parts.walls,
    props: parts.props,
  };
}
