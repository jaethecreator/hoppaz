import type { Block, Tile } from "./geometry";

/** The clubhouse's own zone ids. Event and hotspot rooms (src/lib/campaign/rooms) bring their own, so a zone id is any string. */
export type ZoneId = "studio" | "stage" | "awards" | "courtyard" | "records" | "campaign" | (string & {});
export type FloorMaterial = "acoustic" | "stage" | "marble" | "grass" | "wood" | "terrazzo" | (string & {});
/**
 * `link` is optional data: a room template may give a zone one link (a label for the room's action pill, and an https URL),
 * and the pill offers it while someone stands in the zone (useZoneCards.ts). The engine knows no brand, only this field.
 */
export type CampaignZoneLink = { label: string; url: string };
export type CampaignZone = Block & { id: ZoneId; number: string; name: string; subtitle: string; material: FloorMaterial; stop: Tile; plaque: Tile; link?: CampaignZoneLink };
/**
 * What a prop is drawn as. The first sixteen are the clubhouse kit (ClubhouseArt). Event and hotspot rooms draw their own
 * props in their art file (src/components/campaign/art), so a kind is any string there: the layout only needs the box.
 */
export type PropKind = "console" | "speaker" | "headphones" | "plant" | "tree" | "sofa" | "table" | "records" | "plinth" | "poster" | "counter" | "bench" | "fountain" | "lamp" | "rug" | "maptable" | (string & {});
export type CampaignProp = Block & { id: string; kind: PropKind; variant?: number; solid?: boolean };
export type PrivateArea = Block & { id: string; name: string; stop: Tile };
/**
 * Scenery people (ambient.ts). A template may list a few characters that live on each phone only: drawn with the avatar system,
 * but never a Hopper. They are not peers, not counted, not tagged, not tappable and never in chat. `look` is a partial avatar look
 * (normalizeLook fills the rest). `range` is the block they stay in; `home` is where they start and come back to.
 */
export type AmbientMember = {
  id: string;
  role: string;
  look: Record<string, unknown>;
  home: Tile;
  range: Block;
  /** post: stands at home and shuffles; wander: strolls the range and pauses; chat: walks with `partner`, side by side. */
  mode: "post" | "wander" | "chat";
  partner?: string;
};
export type CampaignLayout = { id: string; grid: { width: number; height: number; tile: number }; spawn: Tile; zones: CampaignZone[]; privateAreas: PrivateArea[]; walls: Block[]; props: CampaignProp[]; ambient?: AmbientMember[] };

/** Scene dimensions, collision, assets and interaction anchors share one source of truth. */
export const CLUBHOUSE: CampaignLayout = {
  id: "360-playlist-clubhouse",
  grid: { width: 30, height: 20, tile: 32 },
  spawn: { x: 15, y: 17 },
  privateAreas: [
    { id: 'booth-1', name: 'Listening Booth 1', x: 2, y: 4, w: 3, h: 3, stop: { x: 3, y: 5 } },
    { id: 'booth-2', name: 'Listening Booth 2', x: 5, y: 4, w: 3, h: 3, stop: { x: 6, y: 4 } },
    { id: 'courtyard-corner', name: 'Courtyard Corner', x: 10, y: 9, w: 4, h: 4, stop: { x: 13, y: 11 } },
    { id: 'lounge-table', name: 'Lounge Table', x: 3, y: 13, w: 4, h: 5, stop: { x: 4, y: 16 } },
  ],
  zones: [
    { id: "studio", number: "01", name: "Listening Studio", subtitle: "Hear what comes next", x: 1, y: 1, w: 8, h: 7, material: "acoustic", stop: { x: 4, y: 5 }, plaque: { x: 4, y: 7 } },
    { id: "stage", number: "02", name: "The 360 Stage", subtitle: "A home for the next sound", x: 10, y: 1, w: 10, h: 6, material: "stage", stop: { x: 15, y: 6 }, plaque: { x: 15, y: 5 } },
    { id: "awards", number: "03", name: "Awards Gallery", subtitle: "The stories behind the milestones", x: 21, y: 1, w: 8, h: 7, material: "marble", stop: { x: 24, y: 5 }, plaque: { x: 24, y: 7 } },
    { id: "courtyard", number: "04", name: "The Courtyard", subtitle: "Take a breath. Stay a while.", x: 10, y: 8, w: 10, h: 6, material: "grass", stop: { x: 15, y: 12 }, plaque: { x: 15, y: 13 } },
    { id: "records", number: "05", name: "Record Lounge", subtitle: "Find your next favourite", x: 1, y: 10, w: 8, h: 9, material: "wood", stop: { x: 4, y: 13 }, plaque: { x: 4, y: 10 } },
    { id: "campaign", number: "06", name: "Artist Corner", subtitle: "A closer look at the music", x: 21, y: 10, w: 8, h: 9, material: "terrazzo", stop: { x: 24, y: 14 }, plaque: { x: 24, y: 10 } },
  ],
  walls: [
    { x: 1, y: 1, w: 8, h: 1 }, { x: 1, y: 1, w: 1, h: 7 }, { x: 8, y: 1, w: 1, h: 7 }, { x: 1, y: 7, w: 3, h: 1 }, { x: 6, y: 7, w: 3, h: 1 },
    { x: 10, y: 1, w: 10, h: 1 }, { x: 10, y: 1, w: 1, h: 5 }, { x: 19, y: 1, w: 1, h: 5 },
    { x: 21, y: 1, w: 8, h: 1 }, { x: 21, y: 1, w: 1, h: 7 }, { x: 28, y: 1, w: 1, h: 7 }, { x: 21, y: 7, w: 3, h: 1 }, { x: 26, y: 7, w: 3, h: 1 },
    { x: 1, y: 10, w: 3, h: 1 }, { x: 6, y: 10, w: 3, h: 1 }, { x: 1, y: 10, w: 1, h: 9 }, { x: 8, y: 10, w: 1, h: 9 }, { x: 1, y: 18, w: 8, h: 1 },
    { x: 21, y: 10, w: 3, h: 1 }, { x: 26, y: 10, w: 3, h: 1 }, { x: 21, y: 10, w: 1, h: 9 }, { x: 28, y: 10, w: 1, h: 9 }, { x: 21, y: 18, w: 8, h: 1 },
  ],
  props: [
    { id: "mixing-desk", kind: "console", x: 2, y: 2, w: 5, h: 1, solid: true },
    { id: "studio-speaker-l", kind: "speaker", x: 2, y: 3, w: 1, h: 1, solid: true }, { id: "studio-speaker-r", kind: "speaker", x: 6, y: 3, w: 1, h: 1, solid: true },
    { id: "listening-chair-l", kind: "headphones", x: 2, y: 5, w: 1, h: 1, solid: true }, { id: "listening-chair-r", kind: "headphones", x: 6, y: 5, w: 1, h: 1, solid: true },
    { id: "studio-plant", kind: "plant", x: 7, y: 6, w: 1, h: 1, solid: true },
    { id: "stage-console", kind: "console", x: 13, y: 3, w: 4, h: 1, solid: true, variant: 1 },
    { id: "stage-speaker-l", kind: "speaker", x: 11, y: 3, w: 1, h: 2, solid: true }, { id: "stage-speaker-r", kind: "speaker", x: 18, y: 3, w: 1, h: 2, solid: true },
    { id: "gallery-display-1", kind: "plinth", x: 22, y: 3, w: 2, h: 1, solid: true, variant: 0 }, { id: "gallery-display-2", kind: "plinth", x: 25, y: 3, w: 2, h: 1, solid: true, variant: 1 },
    { id: "gallery-display-3", kind: "plinth", x: 26, y: 5, w: 1, h: 1, solid: true, variant: 2 }, { id: "gallery-plant", kind: "plant", x: 22, y: 6, w: 1, h: 1, solid: true },
    { id: "courtyard-tree-l", kind: "tree", x: 10, y: 8, w: 1, h: 1, solid: true }, { id: "courtyard-tree-r", kind: "tree", x: 19, y: 8, w: 1, h: 1, solid: true },
    { id: "courtyard-fountain", kind: "fountain", x: 14, y: 9, w: 2, h: 2, solid: true },
    { id: "courtyard-bench-l", kind: "bench", x: 11, y: 10, w: 2, h: 1, solid: true }, { id: "courtyard-bench-r", kind: "bench", x: 17, y: 10, w: 2, h: 1, solid: true },
    { id: "courtyard-plant-l", kind: "plant", x: 11, y: 12, w: 1, h: 1, solid: true }, { id: "courtyard-plant-r", kind: "plant", x: 18, y: 12, w: 1, h: 1, solid: true },
    { id: "record-wall", kind: "records", x: 2, y: 11, w: 2, h: 1, solid: true },
    { id: "record-wall-r", kind: "records", x: 6, y: 11, w: 1, h: 1, solid: true },
    { id: "record-rug", kind: "rug", x: 3, y: 14, w: 4, h: 3 },
    { id: "record-sofa-l", kind: "sofa", x: 2, y: 14, w: 2, h: 1, solid: true, variant: 1 }, { id: "record-sofa-r", kind: "sofa", x: 6, y: 15, w: 1, h: 2, solid: true },
    { id: "record-table", kind: "table", x: 4, y: 15, w: 1, h: 1, solid: true }, { id: "record-sofa-bottom", kind: "sofa", x: 3, y: 17, w: 2, h: 1, solid: true, variant: 1 },
    { id: "record-lamp", kind: "lamp", x: 2, y: 16, w: 1, h: 1, solid: true }, { id: "record-plant", kind: "plant", x: 7, y: 17, w: 1, h: 1, solid: true },
    { id: "artist-poster-1", kind: "poster", x: 22, y: 11, w: 2, h: 2, solid: true, variant: 0 }, { id: "artist-poster-2", kind: "poster", x: 25, y: 11, w: 2, h: 2, solid: true, variant: 1 },
    { id: "artist-poster-3", kind: "poster", x: 26, y: 14, w: 1, h: 2, solid: true, variant: 2 },
    { id: "artist-counter", kind: "counter", x: 22, y: 17, w: 3, h: 1, solid: true }, { id: "artist-plant", kind: "plant", x: 26, y: 17, w: 1, h: 1, solid: true },
    { id: "entry-plant-l", kind: "plant", x: 11, y: 16, w: 1, h: 1, solid: true }, { id: "entry-plant-r", kind: "plant", x: 18, y: 16, w: 1, h: 1, solid: true },
    // The Lagos map on a table by the door: tapping it leaves for the main map (MAP_TABLE).
    { id: "entry-map-table", kind: "maptable", x: 13, y: 16, w: 2, h: 1, solid: true },
  ],
};

/**
 * Props the room does something with. Their ids are fixed: other features find them by id (the map table here, and
 * the Game Time hunt's hiding places), so an id is never renamed or reused.
 */
export const MAP_TABLE = "entry-map-table";

export const sceneSize = (layout: CampaignLayout) => ({ width: layout.grid.width * layout.grid.tile, height: layout.grid.height * layout.grid.tile });
/** Extra width opens the circulation lanes while preserving each authored room and its doors. */
export function clubhouseWidth(width: 30 | 36): CampaignLayout {
  if (width === 30) return CLUBHOUSE;
  const shift = (x: number) => x >= 21 ? 6 : x >= 10 ? 3 : 0;
  return { ...CLUBHOUSE, grid: { ...CLUBHOUSE.grid, width }, spawn: { ...CLUBHOUSE.spawn, x: CLUBHOUSE.spawn.x + 3 },
    privateAreas: CLUBHOUSE.privateAreas.map((area) => ({ ...area, x: area.x + shift(area.x), stop: { ...area.stop, x: area.stop.x + shift(area.x) } })),
    zones: CLUBHOUSE.zones.map((zone) => ({ ...zone, x: zone.x + shift(zone.x), stop: { ...zone.stop, x: zone.stop.x + shift(zone.x) }, plaque: { ...zone.plaque, x: zone.plaque.x + shift(zone.x) } })),
    walls: CLUBHOUSE.walls.map((wall) => ({ ...wall, x: wall.x + shift(wall.x) })),
    props: CLUBHOUSE.props.map((prop) => ({ ...prop, x: prop.x + shift(prop.x) })),
  };
}
export const sceneBlocks = (layout: CampaignLayout): Block[] => [...layout.walls, ...layout.props.filter((prop) => prop.solid)];
export function privateAreaAt(layout: CampaignLayout, tile: Tile): PrivateArea | null {
  return canWalkScene(layout, tile) ? layout.privateAreas.find((area) => tile.x >= area.x && tile.x < area.x + area.w && tile.y >= area.y && tile.y < area.y + area.h) ?? null : null;
}
/** Zone ids that are a room's stage: the clubhouse and the outdoor, tech and theatre rooms say "stage", the indoor room "booth", the pool "deck". */
export const STAGE_ZONE_IDS = ["stage", "booth", "deck"] as const;
/** The layout's stage zone, or null. The crew voice reads this, and supabase/crew_stage_voice.sql reads the same ids. */
export function stageZoneOf(layout: Pick<CampaignLayout, "zones">): CampaignZone | null {
  for (const id of STAGE_ZONE_IDS) {
    const zone = layout.zones.find((z) => z.id === id);
    if (zone) return zone;
  }
  return null;
}
export const stageZoneId = (layout: Pick<CampaignLayout, "zones">): string | null => stageZoneOf(layout)?.id ?? null;
/** True when a tile is inside the stage zone (half open, like the zone card: x from zone.x up to but not including zone.x + zone.w). */
export function onStageTile(layout: Pick<CampaignLayout, "zones">, tile: Tile): boolean {
  const z = layout.zones.filter((zone) => (STAGE_ZONE_IDS as readonly string[]).includes(zone.id));
  return z.some((zone) => tile.x >= zone.x && tile.x < zone.x + zone.w && tile.y >= zone.y && tile.y < zone.y + zone.h);
}
/** Keep arrivals inside the selected boundary while leaving room for people already there. */
export function areaArrival(layout: CampaignLayout, area: PrivateArea, occupied: Tile[], from: Tile): Tile {
  if (privateAreaAt(layout,from)?.id===area.id) return from;
  const options: Tile[]=[];
  for(let y=area.y;y<area.y+area.h;y++) for(let x=area.x;x<area.x+area.w;x++) {
    if(canWalkScene(layout,{x,y}) && !occupied.some((p) => p.x===x && p.y===y)) options.push({x,y});
  }
  const distance=(a:Tile,b:Tile)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  return options.sort((a,b)=>distance(a,area.stop)-distance(b,area.stop) || distance(a,from)-distance(b,from))[0] ?? area.stop;
}
export function canWalkScene(layout: CampaignLayout, tile: Tile) {
  return Number.isInteger(tile.x) && Number.isInteger(tile.y) && tile.x > 0 && tile.y > 0 && tile.x < layout.grid.width - 1 && tile.y < layout.grid.height - 1 && !sceneBlocks(layout).some((block) => tile.x >= block.x && tile.x < block.x + block.w && tile.y >= block.y && tile.y < block.y + block.h);
}
export function scenePath(layout: CampaignLayout, from: Tile, to: Tile): Tile[] | null {
  if (!canWalkScene(layout, from) || !canWalkScene(layout, to)) return null;
  const key = (p: Tile) => `${p.x},${p.y}`;
  const queue: Tile[] = [from];
  const parents = new Map<string, Tile | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i];
    if (tile.x === to.x && tile.y === to.y) {
      const path: Tile[] = [];
      let cursor: Tile | null = tile;
      while (cursor && key(cursor) !== key(from)) { path.unshift(cursor); cursor = parents.get(key(cursor)) ?? null; }
      return path;
    }
    for (const next of [{ x: tile.x + 1, y: tile.y }, { x: tile.x - 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }, { x: tile.x, y: tile.y - 1 }]) {
      if (!canWalkScene(layout, next) || parents.has(key(next))) continue;
      parents.set(key(next), tile); queue.push(next);
    }
  }
  return null;
}

export type AwardEntry = { title: string; year: string; detail: string; sourceUrl?: string };
/** eventKeywords: comma separated words that find the crew's events by title or venue (the crew name when empty). Optional: rooms saved before it have none. */
export type CampaignContent = { brand: string; strapline: string; musicTitle: string; musicUrl: string; audioUrl: string; artistTitle: string; artistNote: string; eventKeywords?: string; awards: AwardEntry[] };
export const EMPTY_CAMPAIGN: CampaignContent = { brand: "360Playlist", strapline: "A space for music, discovery & good company.", musicTitle: "", musicUrl: "", audioUrl: "", artistTitle: "", artistNote: "", eventKeywords: "", awards: [] };
/** Public outbound content only accepts web links; direct audio is configured in the campaign manifest. */
export function validCampaignUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
