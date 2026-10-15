import type { CampaignLayout } from "@/lib/campaign/layout";

/**
 * Where a Hopper may search from. The server decides (docs/GAME-TIME.md section 2: the searcher's server-side tile must be
 * within one tile of the object's rectangle, diagonals included, which is the Chebyshev distance to the rectangle); this
 * is the same rule on the phone, so the SEARCH pill appears only where the server would say yes.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Tile = { x: number; y: number };
export type SpotRect = { id: string; rect: Rect };

/** Tiles from a tile to a rectangle: 0 inside it, 1 next to it (diagonals too), and so on. */
export function tilesFrom(tile: Tile, r: Rect): number {
  const dx = Math.max(r.x - tile.x, 0, tile.x - (r.x + r.w - 1));
  const dy = Math.max(r.y - tile.y, 0, tile.y - (r.y + r.h - 1));
  return Math.max(dx, dy);
}

/** The straight-line distance from the middle of my tile to the nearest point of a rectangle, in tiles. Breaks ties. */
function reach(tile: Tile, r: Rect): number {
  const cx = tile.x + 0.5;
  const cy = tile.y + 0.5;
  const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w));
  const dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** The objects of this room that may hide a box (by id from `objects`), with their rectangles. An id the layout lacks is skipped. */
export function spotRects(layout: CampaignLayout, ids: readonly string[]): SpotRect[] {
  const byId = new Map(layout.props.map((p) => [p.id, p]));
  const out: SpotRect[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push({ id, rect: { x: p.x, y: p.y, w: p.w, h: p.h } });
  }
  return out;
}

/** The object to search from this tile: the nearest one within `max` tiles, or null. */
export function nearestSpot(tile: Tile | null, spots: readonly SpotRect[], max = 1): SpotRect | null {
  if (!tile) return null;
  let best: SpotRect | null = null;
  let bestReach = Infinity;
  for (const s of spots) {
    if (tilesFrom(tile, s.rect) > max) continue;
    const r = reach(tile, s.rect);
    if (r < bestReach) {
      best = s;
      bestReach = r;
    }
  }
  return best;
}
