/**
 * How the walkers move. Plain TypeScript, no React, one requestAnimationFrame loop that runs only while someone is
 * stepping.
 *
 * Time, not frames. Every walker advances by the milliseconds that passed (one tile per STEP_MS), so a 60 Hz phone, a
 * 120 Hz phone and a slow Android that draws 15 frames a second all cover the same tiles in the same time. A frame that
 * comes late moves the walker further, never slower (a pause longer than MAX_FRAME_MS, a tab in the background, does not
 * fast-forward the walk). There are no CSS transitions on the walkers: this loop writes each walker's transform itself, so
 * nothing steps in jumps every few frames and nothing eases twice.
 *
 * Me. A walk is a list of tiles. The next tile is only begun once the server's queue has taken it (hooks.step). If the
 * server will not take it for BLOCKED_MS (no connection, or it is far behind), the walk is given up where it stands: the
 * last tile taken is where I stay, and the server catches up to exactly that tile. I never walk later on my own.
 *
 * Others. A walker I see is shown where the server last said, and glides there along the room's tiles from where it was
 * drawn (a snapshot arrives every second or so and can be several tiles on), at my own pace, a little faster when a long
 * path is waiting. It never cuts a straight line through a wall, and it never moves unless a report says it moved.
 */
import type { Tile } from "@/lib/campaign/geometry";

/**
 * One tile of my walk: about 11 tiles a second. The server credits a walker 12 a second (crew_room_step, move_credit), so this
 * stays under it with room for a slow link whose batches arrive late and then together.
 */
export const STEP_MS = 90;
/** The server will not take a step for this long (ms): the walk is given up where it stands. */
const BLOCKED_MS = 1200;
/** The longest time one frame may count for (ms). */
const MAX_FRAME_MS = 100;
/** A reported move longer than this (tiles) is a respawn or a long absence: the walker is placed, not walked. */
const MAX_GLIDE = 24;
/** More than this many tiles waiting and the walker is placed at the end. */
const MAX_BACKLOG = 40;
/** A backlog of reported tiles is caught up within this long (ms), up to MAX_SPEEDUP times my pace. */
const CATCH_UP_MS = 1400;
const MAX_SPEEDUP = 3;

type Seg = { from: Tile; to: Tile; p: number };
type Mover = {
  el: HTMLElement | null;
  /** Where it is drawn, in tiles (between two tiles while it steps). */
  x: number;
  y: number;
  /** The tile it last arrived on. */
  at: Tile;
  seg: Seg | null;
  /** Tiles still to step onto. */
  queue: Tile[];
  /** Where the last of them is: the spot a new report is walked on from. */
  end: Tile;
  t: string;
  z: number;
};

export type MotionHooks = {
  /** Ask the server's queue to take this step. False: it has not, so nothing moves yet. */
  step: (tile: Tile) => boolean;
  /** A step toward this tile began (it is now the tile the next path starts from). */
  began: (tile: Tile) => void;
  /** I am standing on this tile. */
  arrived: (tile: Tile) => void;
  /** Whether I am mid-walk (the legs). */
  walking: (on: boolean) => void;
  /** Where I am drawn, in scene px (the camera follows it every frame). */
  follow: (px: number, py: number) => void;
  /** The walk is over, finished or given up. */
  stopped: () => void;
};

const make = (t: Tile): Mover => ({ el: null, x: t.x, y: t.y, at: t, seg: null, queue: [], end: t, t: "", z: -1 });
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Motion {
  /** Quantise to whole tiles (prefers-reduced-motion). */
  reduced = false;
  private me: Mover;
  private peers = new Map<string, Mover>();
  private els = new Map<string, HTMLElement>();
  private raf = 0;
  private last = 0;
  private going = false;
  private legs = false;
  private blocked = 0;

  constructor(
    private tile: number,
    start: Tile,
    private hooks: MotionHooks,
  ) {
    this.me = make(start);
  }

  /** The element a walker is drawn in ("me" or a peer's id), or null when it goes away. A stable function, safe as a ref. */
  attach = (id: string, el: HTMLElement | null) => {
    const m = id === "me" ? this.me : this.peers.get(id);
    if (!el) {
      this.els.delete(id);
      if (m) m.el = null;
      return;
    }
    this.els.set(id, el);
    if (m) {
      m.el = el;
      m.t = "";
      m.z = -1;
      this.paint(m);
    }
  };

  /** Where a walker is drawn right now, in tiles (for hit tests), or null when it is not known. */
  point(id: string): Tile | null {
    const m = id === "me" ? this.me : this.peers.get(id);
    return m ? { x: m.x, y: m.y } : null;
  }

  get idle() {
    return !this.going && !this.me.seg && !this.me.queue.length;
  }

  private paint(m: Mover) {
    const el = m.el;
    if (!el) return;
    const t = `translate3d(${((m.x + 0.5) * this.tile).toFixed(1)}px,${((m.y + 0.6) * this.tile).toFixed(1)}px,0)`;
    if (t !== m.t) {
      m.t = t;
      el.style.transform = t;
    }
    const z = 10 + Math.round(m.y);
    if (z !== m.z) {
      m.z = z;
      el.style.zIndex = String(z);
    }
  }

  private place(m: Mover) {
    const s = m.seg;
    if (!s) {
      m.x = m.at.x;
      m.y = m.at.y;
      return;
    }
    const p = this.reduced ? (s.p < 0.5 ? 0 : 1) : s.p;
    m.x = s.from.x + (s.to.x - s.from.x) * p;
    m.y = s.from.y + (s.to.y - s.from.y) * p;
  }

  /**
   * Move a walker `ms` along its tiles. "moving": it is mid-step or has more to take. "idle": nothing left. "blocked": the
   * next step was refused (only me), nothing began.
   */
  private run(m: Mover, ms: number, ask: ((t: Tile) => boolean) | null, began: ((t: Tile) => void) | null, arrived: ((t: Tile) => void) | null): "moving" | "idle" | "blocked" {
    let left = ms;
    for (let n = 0; n < 256; n++) {
      if (!m.seg) {
        const next = m.queue[0];
        if (!next) {
          this.place(m);
          return "idle";
        }
        if (ask && !ask(next)) {
          this.place(m);
          return "blocked";
        }
        m.queue.shift();
        m.seg = { from: m.at, to: next, p: 0 };
        began?.(next);
      }
      const seg = m.seg;
      const need = (1 - seg.p) * STEP_MS;
      if (left < need) {
        seg.p += left / STEP_MS;
        this.place(m);
        return "moving";
      }
      left -= need;
      m.at = seg.to;
      m.seg = null;
      arrived?.(seg.to);
    }
    this.place(m);
    return "moving";
  }

  private setLegs(on: boolean) {
    if (this.legs === on) return;
    this.legs = on;
    this.hooks.walking(on);
  }

  private finish() {
    this.going = false;
    this.blocked = 0;
    this.setLegs(false);
    this.hooks.stopped();
  }

  /** One step of my walk's clock. True while the loop must keep running. */
  private stepMe(dt: number): boolean {
    const m = this.me;
    if (!this.going && !m.seg) return false;
    const r = this.run(m, dt, this.hooks.step, this.hooks.began, this.hooks.arrived);
    this.paint(m);
    this.hooks.follow((m.x + 0.5) * this.tile, (m.y + 0.5) * this.tile);
    if (r === "moving") {
      this.blocked = 0;
      this.setLegs(true);
      return true;
    }
    if (r === "blocked") {
      // The server has not taken the next step. Stand still and give it a moment; then settle here.
      this.setLegs(false);
      this.blocked += dt;
      if (this.blocked < BLOCKED_MS) return true;
      m.queue = [];
    }
    this.finish();
    return false;
  }

  private stepPeer(m: Mover, dt: number): boolean {
    const backlog = m.queue.length + (m.seg ? 1 - m.seg.p : 0);
    const rate = clamp((backlog * STEP_MS) / CATCH_UP_MS, 1, MAX_SPEEDUP);
    const r = this.run(m, dt * rate, null, null, null);
    this.paint(m);
    return r === "moving";
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = clamp(now - this.last, 0, MAX_FRAME_MS);
    this.last = now;
    let busy = this.stepMe(dt);
    for (const m of this.peers.values()) if (m.seg || m.queue.length) busy = this.stepPeer(m, dt) || busy;
    if (busy) this.raf = requestAnimationFrame(this.frame);
  };

  private kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Walk me along `path` (the tiles after the one I am on or heading to). It replaces any walk in hand; a step already
   * begun is finished first. The first step goes to the server now, in the tap that asked for it, not on the next frame.
   */
  go(path: Tile[]) {
    const m = this.me;
    m.queue = path.slice();
    this.blocked = 0;
    this.going = path.length > 0 || !!m.seg;
    if (!this.going) {
      this.finish();
      return;
    }
    if (this.stepMe(0)) this.kick();
  }

  /** Put me on a tile and stop (the server says I am there). */
  snapMe(t: Tile) {
    const m = this.me;
    m.queue = [];
    m.seg = null;
    m.at = t;
    m.end = t;
    m.x = t.x;
    m.y = t.y;
    this.going = false;
    this.blocked = 0;
    this.setLegs(false);
    this.paint(m);
    this.hooks.follow((t.x + 0.5) * this.tile, (t.y + 0.5) * this.tile);
  }

  /**
   * Everyone else, as the server last reported. A walker whose report moved is walked from where its last report was to
   * the new one by `route` (the room's own paths); no route, or a far one, places it there.
   */
  syncPeers(list: readonly { id: string; x: number; y: number }[], route: (from: Tile, to: Tile) => Tile[] | null) {
    const seen = new Set<string>();
    let busy = false;
    for (const r of list) {
      seen.add(r.id);
      const to = { x: r.x, y: r.y };
      let m = this.peers.get(r.id);
      if (!m) {
        m = make(to);
        m.el = this.els.get(r.id) ?? null;
        this.peers.set(r.id, m);
        this.paint(m);
        continue;
      }
      if (same(m.end, to)) continue;
      const path = route(m.end, to);
      if (path && path.length && path.length + m.queue.length <= MAX_BACKLOG && path.length <= MAX_GLIDE) {
        m.queue.push(...path);
        m.end = to;
        busy = true;
      } else {
        m.queue = [];
        m.seg = null;
        m.at = to;
        m.end = to;
        this.place(m);
        this.paint(m);
      }
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);
    if (busy) this.kick();
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
