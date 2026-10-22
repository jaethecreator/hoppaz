import type { Tile } from "./geometry";
import { floodFill } from "./geometry";
import { canWalkScene, type AmbientMember, type CampaignLayout } from "./layout";

/**
 * Scenery people for a room that lists them (CampaignLayout.ambient, today only Lagos HQ). Plain TypeScript, no React.
 *
 * They live on each phone and nowhere else: nothing is sent, stored or read, there is no presence row and no peer. They are not
 * counted in "N here", have no name tag, cannot be tapped and never appear in chat (CampaignWorld keeps them out of every one of
 * those lists). They stroll at about two tiles a second, which is slower than a Hopper, so nobody takes them for one.
 *
 * AmbientCrowd is the brain (`tick` moves them in time, no DOM, testable on its own); AmbientRunner paints it: one transform write
 * per walker that moved, on a requestAnimationFrame loop that sleeps while everyone is standing.
 */

/** Tiles a second. */
export const AMBIENT_SPEED = 2.2;
const DIRS: readonly Tile[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;
const dist = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inBlock = (b: { x: number; y: number; w: number; h: number }, t: Tile) => t.x >= b.x && t.x < b.x + b.w && t.y >= b.y && t.y < b.y + b.h;

type Mate = {
  m: AmbientMember;
  /** The tile it stands on, or last stepped onto. */
  at: Tile;
  /** Tiles still to step onto, and how far (0..1) it is through the first. */
  path: Tile[];
  p: number;
  /** Where it is drawn, in tiles. */
  x: number;
  y: number;
  /** Milliseconds until it decides what to do next. */
  wait: number;
  /** Every tile of its range it may stand on. */
  tiles: Tile[];
};

export class AmbientCrowd {
  readonly mates: Mate[];
  private reach: Int32Array;
  private w: number;

  constructor(private layout: CampaignLayout, cast: readonly AmbientMember[], private rand: () => number = Math.random) {
    this.w = layout.grid.width;
    const flood = floodFill(layout.spawn, layout.grid.width, layout.grid.height, (x, y) => canWalkScene(layout, { x, y }));
    this.reach = flood.dist;
    const door = layout.props.find((p) => p.id === "entry-map-table");
    this.mates = cast.map((m) => {
      const tiles: Tile[] = [];
      for (let y = m.range.y; y < m.range.y + m.range.h; y++) {
        for (let x = m.range.x; x < m.range.x + m.range.w; x++) {
          // Never the arrival tile or the one beside the door: the place a Hopper lands is theirs.
          if (!this.open({ x, y }) || dist({ x, y }, layout.spawn) <= 1) continue;
          if (door && x >= door.x - 1 && x <= door.x + door.w && y >= door.y - 1 && y <= door.y + door.h) continue;
          tiles.push({ x, y });
        }
      }
      const at = this.open(m.home) ? { ...m.home } : tiles[0] ?? { ...layout.spawn };
      return { m, at, path: [], p: 0, x: at.x, y: at.y, wait: this.rand() * 5000, tiles };
    });
  }

  private open(t: Tile) {
    return canWalkScene(this.layout, t) && this.reach[t.y * this.w + t.x] > 0;
  }

  /** The tile a mate stands on or is heading for. */
  private spot(o: Mate) {
    return o.path.length ? o.path[o.path.length - 1] : o.at;
  }

  private free(t: Tile, self: Mate) {
    return !this.mates.some((o) => o !== self && same(this.spot(o), t));
  }

  /** A shortest walk that goes round anyone standing still, or null when they block every way. */
  private around(from: Tile, to: Tile, self: Mate): Tile[] | null {
    const standing = new Set(this.mates.filter((o) => o !== self && !o.path.length).map((o) => `${o.at.x},${o.at.y}`));
    const key = (t: Tile) => `${t.x},${t.y}`;
    const parent = new Map<string, Tile | null>([[key(from), null]]);
    const queue: Tile[] = [from];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      if (same(t, to)) {
        const out: Tile[] = [];
        for (let c: Tile | null = t; c && !same(c, from); c = parent.get(key(c)) ?? null) out.unshift(c);
        return out;
      }
      for (const d of DIRS) {
        const n = { x: t.x + d.x, y: t.y + d.y };
        if (parent.has(key(n)) || !this.open(n) || standing.has(key(n))) continue;
        parent.set(key(n), t);
        queue.push(n);
      }
    }
    return null;
  }

  private send(mate: Mate, to: Tile) {
    if (same(mate.at, to)) return;
    const path = this.around(mate.at, to, mate);
    if (path && path.length) mate.path = path;
  }

  private beside(t: Tile, mate: Mate): Tile | null {
    const options = DIRS.map((d) => ({ x: t.x + d.x, y: t.y + d.y })).filter((n) => this.open(n) && this.free(n, mate) && mate.tiles.some((c) => same(c, n)));
    return options.length ? options[Math.floor(this.rand() * options.length)] : null;
  }

  private pause(lo: number, hi: number) {
    return lo + this.rand() * (hi - lo);
  }

  private decide(mate: Mate) {
    const { m } = mate;
    if (!mate.tiles.length) {
      mate.wait = 4000;
      return;
    }
    if (m.mode === "post") {
      // Stand at the post; now and then shuffle a step and come back.
      if (!same(mate.at, m.home) && this.open(m.home)) {
        // Someone is standing in the post: wait a moment rather than share the tile.
        if (this.free(m.home, mate)) this.send(mate, m.home);
        mate.wait = this.free(m.home, mate) ? this.pause(6000, 14000) : 2000;
        return;
      }
      const step = this.rand() < 0.45 ? this.beside(mate.at, mate) : null;
      if (step) this.send(mate, step);
      mate.wait = this.pause(3500, 9000);
      return;
    }
    if (m.mode === "chat") {
      // The one that sorts first leads: it picks a spot and the two walk there side by side. The other waits for it.
      const mateOf = this.mates.find((o) => o.m.id === m.partner);
      if (!mateOf || m.id > mateOf.m.id) {
        mate.wait = 1500;
        return;
      }
      const spots = mate.tiles.filter((t) => dist(t, mate.at) >= 3 && dist(t, mate.at) <= 10 && this.free(t, mate) && this.free(t, mateOf));
      const to = spots[Math.floor(this.rand() * spots.length)];
      const next = to ? this.beside(to, mateOf) : null;
      if (to && next) {
        this.send(mate, to);
        this.send(mateOf, next);
      }
      mate.wait = this.pause(14000, 26000);
      return;
    }
    // wander: walk somewhere in the range, sometimes to stand next to someone, then stand a while.
    if (this.rand() < 0.28) {
      const others = this.mates.filter((o) => o !== mate && inBlock(m.range, this.spot(o)));
      const other = others[Math.floor(this.rand() * others.length)];
      const next = other ? this.beside(this.spot(other), mate) : null;
      if (next) {
        this.send(mate, next);
        mate.wait = this.pause(5000, 11000);
        return;
      }
    }
    const spots = mate.tiles.filter((t) => dist(t, mate.at) >= 2 && dist(t, mate.at) <= 9 && this.free(t, mate));
    const to = spots[Math.floor(this.rand() * spots.length)];
    if (to) this.send(mate, to);
    mate.wait = this.pause(3000, 9000);
  }

  /** Advance every walker by `ms`. Returns true while anyone is mid-step (the runner keeps its frame loop going). */
  tick(ms: number): boolean {
    let moving = false;
    for (const mate of this.mates) {
      if (mate.path.length) {
        mate.p += (ms / 1000) * AMBIENT_SPEED;
        while (mate.path.length && mate.p >= 1) {
          mate.at = mate.path.shift()!;
          mate.p -= 1;
        }
        if (mate.path.length) {
          const next = mate.path[0];
          mate.x = mate.at.x + (next.x - mate.at.x) * mate.p;
          mate.y = mate.at.y + (next.y - mate.at.y) * mate.p;
          moving = true;
          continue;
        }
        mate.p = 0;
        mate.x = mate.at.x;
        mate.y = mate.at.y;
        continue;
      }
      mate.wait -= ms;
      if (mate.wait <= 0) {
        this.decide(mate);
        if (mate.path.length) moving = true;
      }
    }
    return moving;
  }
}

/** Paints an AmbientCrowd: writes each walker's transform and z-index (as walkMotion.ts does for a Hopper) and toggles its legs. */
export class AmbientRunner {
  readonly crowd: AmbientCrowd;
  /** Quantise to whole tiles (prefers-reduced-motion). */
  reduced = false;
  private els = new Map<string, HTMLElement>();
  private last = new Map<string, string>();
  private walking = new Set<string>();
  private raf = 0;
  private timer = 0;
  private prev = 0;
  private slept = false;
  private on = false;

  constructor(layout: CampaignLayout, cast: readonly AmbientMember[], private tile: number, private walkClass: string, rand?: () => number) {
    this.crowd = new AmbientCrowd(layout, cast, rand);
  }

  /** A stable ref callback for a walker's node. */
  attach = (id: string, el: HTMLElement | null) => {
    if (el) this.els.set(id, el);
    else {
      this.els.delete(id);
      this.last.delete(id);
      this.walking.delete(id);
    }
  };

  private paint() {
    for (const mate of this.crowd.mates) {
      const el = this.els.get(mate.m.id);
      if (!el) continue;
      const x = this.reduced ? mate.at.x : mate.x;
      const y = this.reduced ? mate.at.y : mate.y;
      const t = `translate3d(${((x + 0.5) * this.tile).toFixed(1)}px,${((y + 0.6) * this.tile).toFixed(1)}px,0)`;
      if (this.last.get(mate.m.id) !== t) {
        this.last.set(mate.m.id, t);
        el.style.transform = t;
        el.style.zIndex = String(10 + Math.round(y));
      }
      const legs = mate.path.length > 0 && !this.reduced;
      if (legs !== this.walking.has(mate.m.id)) {
        if (legs) this.walking.add(mate.m.id);
        else this.walking.delete(mate.m.id);
        el.firstElementChild?.classList.toggle(this.walkClass, legs);
      }
    }
  }

  private frame = (now: number) => {
    this.raf = 0;
    // A frame counts at most 100 ms (a stalled tab must not fast-forward a walk); after a sleep the whole sleep counts, since
    // nobody was walking and only the waits run down.
    const ms = Math.min(this.slept ? 600 : 100, Math.max(0, now - this.prev));
    this.prev = now;
    this.slept = false;
    const moving = this.crowd.tick(ms);
    this.paint();
    if (!this.on) return;
    if (moving) this.raf = requestAnimationFrame(this.frame);
    else this.timer = window.setTimeout(this.wake, 250);
  };

  private wake = () => {
    this.timer = 0;
    if (!this.on) return;
    this.slept = true;
    this.raf = requestAnimationFrame(this.frame);
  };

  start() {
    if (this.on) return;
    this.on = true;
    this.prev = performance.now();
    this.paint();
    this.wake();
  }

  dispose() {
    this.on = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) window.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }
}
