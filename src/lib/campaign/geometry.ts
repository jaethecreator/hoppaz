export type Tile = { x: number; y: number };
export type Block = Tile & { w: number; h: number };

/**
 * Paths on the room's tile grid. Four neighbours only, because the server takes one adjacent tile per step
 * (crew_room_step). The order (right, left, down, up) is the one scenePath in layout.ts uses, so a path has the same
 * shape from either.
 */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Every tile reachable from `from` and how many steps away it is (-1: not reachable), with the way back for each. */
export type Flood = { w: number; h: number; from: Tile; dist: Int32Array; prev: Int32Array };

/**
 * Flood the grid from `from`. The start tile itself need not be walkable (a layout that disagrees with the server about
 * one tile must not freeze an avatar); every tile stepped onto must be.
 */
export function floodFill(from: Tile, w: number, h: number, walkable: (x: number, y: number) => boolean): Flood {
  const dist = new Int32Array(w * h).fill(-1);
  const prev = new Int32Array(w * h).fill(-1);
  if (from.x >= 0 && from.y >= 0 && from.x < w && from.y < h) {
    const start = from.y * w + from.x;
    dist[start] = 0;
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      const x = at % w;
      const y = (at - x) / w;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (dist[next] >= 0 || !walkable(nx, ny)) continue;
        dist[next] = dist[at] + 1;
        prev[next] = at;
        queue.push(next);
      }
    }
  }
  return { w, h, from, dist, prev };
}

export const reaches = (f: Flood, t: Tile) => t.x >= 0 && t.y >= 0 && t.x < f.w && t.y < f.h && f.dist[t.y * f.w + t.x] >= 0;

/** The tiles to step on to get from the flood's start to `to` (the start itself left out), or null when it cannot be reached. */
export function floodPath(f: Flood, to: Tile): Tile[] | null {
  if (!reaches(f, to)) return null;
  const path: Tile[] = [];
  let at = to.y * f.w + to.x;
  while (f.prev[at] >= 0) {
    path.push({ x: at % f.w, y: Math.floor(at / f.w) });
    at = f.prev[at];
  }
  return path.reverse();
}

const inside = (b: Block, t: Tile) => t.x >= b.x && t.x < b.x + b.w && t.y >= b.y && t.y < b.y + b.h;

/**
 * Where a tap on `tapped` sends me. The tile itself when I can walk to it. Otherwise it is a thing (a prop, a shrub, a chair,
 * a wall edge): the tile beside it that I reach in the fewest steps, looking one tile out first, then, for a real object,
 * two tiles out, then all round the whole object it belongs to. Ties go to the tile nearest the finger (`point`, scene px).
 * Null when nothing beside the tap can be walked to (the dark border of the scene, a sealed corner).
 */
export function nearestReachable(f: Flood, tapped: Tile, point: { x: number; y: number }, tile: number, blocks: readonly Block[]): Tile | null {
  if (reaches(f, tapped)) return tapped;
  const steps = (t: Tile) => f.dist[t.y * f.w + t.x];
  const gap = (t: Tile) => Math.hypot((t.x + 0.5) * tile - point.x, (t.y + 0.5) * tile - point.y);
  const best = (list: Tile[]) => list.sort((a, b) => steps(a) - steps(b) || gap(a) - gap(b))[0];
  const around = (r: number) => {
    const out: Tile[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (reaches(f, { x: tapped.x + dx, y: tapped.y + dy })) out.push({ x: tapped.x + dx, y: tapped.y + dy });
    return out;
  };
  const beside = around(1);
  if (beside.length) return best(beside);
  const block = blocks.find((b) => inside(b, tapped));
  if (!block) return null;
  const wider = around(2);
  if (wider.length) return best(wider);
  const ring: Tile[] = [];
  for (let y = block.y - 1; y <= block.y + block.h; y++) for (let x = block.x - 1; x <= block.x + block.w; x++) if (!inside(block, { x, y }) && reaches(f, { x, y })) ring.push({ x, y });
  return ring.length ? best(ring) : null;
}
