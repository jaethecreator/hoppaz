/**
 * The room's camera (docs/ROOM-GAME-DESIGN.md section 4). Plain TypeScript, no React: React does not re-render per
 * frame. One transform on the world element is written from a requestAnimationFrame loop that runs only while
 * something moves, and two custom properties (--cam-s, --cam-inv) go on the layer inside it so labels can stay the same
 * size on screen at every zoom.
 *
 *   FULL    the whole room, centred in the part of the stage the chat sheet leaves free
 *   FOLLOW  my avatar, eased (critically damped, 120 ms), at the follow scale or the scale I pinched to
 *   FREE    I dragged or pinched: the camera goes where the fingers go, clamped to the scene
 *
 * The camera is (cx, cy, s): the scene point at the anchor (the middle of the free stage) and the scale. The
 * translation is derived and clamped so the camera never shows more than half a tile beyond the scene, and a scene that
 * is smaller than the stage at the current scale is centred.
 */

export type CamMode = "full" | "follow" | "free";

const MAX_SCALE = 2.2;
const SMOOTH = 0.12;
const OVERSHOOT = 0.06;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Tween = { fx: number; fy: number; fs: number; t0: number; dur: number };

export class RoomCamera {
  mode: CamMode = "full";
  /** Current camera: scene point at the anchor and scale. */
  cx = 0;
  cy = 0;
  s = 0.4;
  /** The applied translation (screen px) after clamping, for hit tests. */
  tx = 0;
  ty = 0;
  private w = 390;
  private h = 700;
  private freeH = 700;
  private gx = 0;
  private gy = 0;
  private gs = 1;
  /** The follow scale I pinched to (kept for the visit), or null. */
  private userScale: number | null = null;
  private tween: Tween | null = null;
  private raf = 0;
  private last = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastS = -1;
  private placed = false;
  private lastPainted = "";
  reduced = false;
  /** Called when the mode changes (FULL, FOLLOW, FREE). */
  onMode: (mode: CamMode) => void = () => {};
  /** Called when the scale crosses a label threshold. */
  onScale: (s: number) => void = () => {};

  constructor(
    private world: HTMLElement,
    private layer: HTMLElement,
    private sceneW: number,
    private sceneH: number,
    private tile: number,
  ) {
    this.cx = sceneW / 2;
    this.cy = sceneH / 2;
    this.gx = this.cx;
    this.gy = this.cy;
  }

  get fullScale() {
    return 0.97 * Math.min(this.w / this.sceneW, this.freeH / this.sceneH);
  }
  /** About eleven tiles across on every portrait phone, never fewer than nine tiles tall. */
  get followScale() {
    const base = clamp(this.w / 352, 0.95, 1.3);
    const cap = this.freeH / (this.tile * 9);
    return clamp(this.userScale ?? Math.min(base, cap), this.fullScale, MAX_SCALE);
  }
  get minScale() {
    return this.fullScale;
  }

  private setMode(mode: CamMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onMode(mode);
  }

  /** Stage size and the part of it the chat sheet leaves free. Re-centres over 250 ms. */
  setViewport(w: number, h: number, freeH: number) {
    const first = !this.placed;
    this.placed = true;
    this.w = w;
    this.h = h;
    this.freeH = Math.max(120, freeH);
    if (first) {
      this.s = this.fullScale;
      this.cx = this.sceneW / 2;
      this.cy = this.sceneH / 2;
    }
    this.reframe(first || this.reduced ? 0 : 250);
  }

  /** Where the camera wants to be for the current mode. */
  private goalFor(mode: CamMode, px: number, py: number) {
    if (mode === "full") return { x: this.sceneW / 2, y: this.sceneH / 2, s: this.fullScale };
    const s = this.followScale;
    // The avatar sits a little below the middle, so there is more room above the head for cards and bubbles.
    return { x: px, y: py - (this.freeH * 0.06) / s, s };
  }

  private target = { x: 0, y: 0 };
  private reframe(ms: number) {
    if (this.mode === "free") {
      this.s = clamp(this.s, this.fullScale, MAX_SCALE);
      this.clampCenter();
      this.kick();
      return;
    }
    const g = this.goalFor(this.mode, this.target.x, this.target.y);
    this.gx = g.x;
    this.gy = g.y;
    this.gs = g.s;
    if (ms > 0) this.startTween(ms);
    else {
      this.tween = null;
      this.cx = g.x;
      this.cy = g.y;
      this.s = g.s;
    }
    this.kick();
  }
  private startTween(ms: number) {
    if (this.reduced || ms <= 0) {
      this.tween = null;
      this.cx = this.gx;
      this.cy = this.gy;
      this.s = this.gs;
      return;
    }
    this.tween = { fx: this.cx, fy: this.cy, fs: this.s, t0: performance.now(), dur: ms };
  }

  /** Where my avatar is, in scene px. The follow goal tracks it. */
  follow(px: number, py: number) {
    this.target.x = px;
    this.target.y = py;
    if (this.mode !== "follow") return;
    const g = this.goalFor("follow", px, py);
    this.gx = g.x;
    this.gy = g.y;
    this.gs = g.s;
    this.kick();
  }

  goFull(ms = 600) {
    this.setMode("full");
    this.tween = null;
    const g = this.goalFor("full", 0, 0);
    this.gx = g.x;
    this.gy = g.y;
    this.gs = g.s;
    this.startTween(ms);
    this.kick();
  }

  goFollow(ms = 600) {
    this.setMode("follow");
    const g = this.goalFor("follow", this.target.x, this.target.y);
    this.gx = g.x;
    this.gy = g.y;
    this.gs = g.s;
    this.startTween(ms);
    this.kick();
  }

  /** Fly to a point in the scene (the other person, a room) and follow from there. */
  flyTo(px: number, py: number, ms = 650) {
    this.target.x = px;
    this.target.y = py;
    this.goFollow(ms);
  }

  /** Look at a point (another Hopper, a room) at the follow scale, without following me. Leaves the camera free. */
  focus(px: number, py: number, ms = 650) {
    this.setMode("free");
    const g = this.goalFor("follow", px, py);
    this.gx = g.x;
    this.gy = g.y;
    this.gs = g.s;
    this.startTween(ms);
    this.kick();
  }

  /** Zoom to a scale about a screen point (double tap, wheel). Leaves the camera free. */
  zoomAbout(sx: number, sy: number, scale: number, ms = 0) {
    const s = clamp(scale, this.fullScale, MAX_SCALE);
    const sceneX = (sx - this.tx) / this.s;
    const sceneY = (sy - this.ty) / this.s;
    this.setMode("free");
    this.tween = null;
    const ax = this.w / 2;
    const ay = this.freeH / 2;
    const ntx = sx - s * sceneX;
    const nty = sy - s * sceneY;
    const cx = (ax - ntx) / s;
    const cy = (ay - nty) / s;
    if (ms > 0 && !this.reduced) {
      this.gx = cx;
      this.gy = cy;
      this.gs = s;
      this.startTween(ms);
    } else {
      this.cx = cx;
      this.cy = cy;
      this.s = s;
      this.clampCenter();
    }
    if (this.userScale !== null || s > this.fullScale) this.userScale = s;
    this.kick();
  }

  /** Drag by screen pixels. */
  panBy(dx: number, dy: number) {
    this.setMode("free");
    this.tween = null;
    this.cx -= dx / this.s;
    this.cy -= dy / this.s;
    this.clampCenter();
    this.kick();
  }

  /** Two fingers: scale about the midpoint, and the midpoint's own travel. */
  pinch(startScale: number, ratio: number, sceneX: number, sceneY: number, midX: number, midY: number) {
    this.setMode("free");
    this.tween = null;
    const lo = this.fullScale * (1 - OVERSHOOT);
    const hi = MAX_SCALE * (1 + OVERSHOOT);
    const s = clamp(startScale * ratio, lo, hi);
    const ntx = midX - s * sceneX;
    const nty = midY - s * sceneY;
    this.s = s;
    this.cx = (this.w / 2 - ntx) / s;
    this.cy = (this.freeH / 2 - nty) / s;
    this.clampCenter();
    this.kick();
  }

  /** Fingers up after a pinch: spring back into limits and remember the scale. */
  pinchEnd() {
    const s = clamp(this.s, this.fullScale, MAX_SCALE);
    if (s !== this.s) {
      this.gx = this.cx;
      this.gy = this.cy;
      this.gs = s;
      this.startTween(160);
    }
    this.userScale = s;
    this.kick();
  }

  private clampCenter() {
    const [tx, ty] = this.place(this.cx, this.cy, this.s);
    this.cx = (this.w / 2 - tx) / this.s;
    this.cy = (this.freeH / 2 - ty) / this.s;
  }

  private place(cx: number, cy: number, s: number): [number, number] {
    let tx = this.w / 2 - s * cx;
    let ty = this.freeH / 2 - s * cy;
    const sw = s * this.sceneW;
    const sh = s * this.sceneH;
    const m = this.tile * s * 0.5;
    tx = sw <= this.w ? (this.w - sw) / 2 : clamp(tx, this.w - sw - m, m);
    ty = sh <= this.freeH ? (this.freeH - sh) / 2 : clamp(ty, this.freeH - sh - m, m);
    return [tx, ty];
  }

  screenToScene(sx: number, sy: number) {
    return { x: (sx - this.tx) / this.s, y: (sy - this.ty) / this.s };
  }
  sceneToScreen(px: number, py: number) {
    return { x: this.tx + px * this.s, y: this.ty + py * this.s };
  }

  private kick() {
    if (this.raf) return;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.world.style.willChange = "transform";
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    let busy = false;
    if (this.tween) {
      const t = clamp((now - this.tween.t0) / this.tween.dur, 0, 1);
      const e = easeInOut(t);
      // A follow tween ends where the avatar is NOW, so it lands on a walking avatar without a jump.
      const tx = this.gx;
      const ty = this.gy;
      const ts = this.gs;
      this.cx = this.tween.fx + (tx - this.tween.fx) * e;
      this.cy = this.tween.fy + (ty - this.tween.fy) * e;
      this.s = Math.exp(Math.log(this.tween.fs) + (Math.log(ts) - Math.log(this.tween.fs)) * e);
      if (t >= 1) this.tween = null;
      else busy = true;
    } else if (this.mode !== "free") {
      const a = 1 - Math.exp(-dt / SMOOTH);
      const dx = this.gx - this.cx;
      const dy = this.gy - this.cy;
      const ds = Math.log(this.gs) - Math.log(this.s);
      this.cx += dx * a;
      this.cy += dy * a;
      this.s = Math.exp(Math.log(this.s) + ds * a);
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1 && Math.abs(ds) < 0.0005) {
        this.cx = this.gx;
        this.cy = this.gy;
        this.s = this.gs;
      } else busy = true;
    }
    this.paint();
    if (busy) this.raf = requestAnimationFrame(this.frame);
    else
      // Let go of the compositor hint so the art re-rasters crisply at the final scale.
      this.settleTimer = setTimeout(() => {
        this.world.style.willChange = "";
        this.settleTimer = null;
      }, 220);
  };

  private paint() {
    const [tx, ty] = this.place(this.cx, this.cy, this.s);
    this.tx = tx;
    this.ty = ty;
    const t = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${this.s.toFixed(4)})`;
    if (t !== this.lastPainted) {
      this.lastPainted = t;
      this.world.style.transform = t;
    }
    if (Math.abs(this.s - this.lastS) > 0.0004) {
      this.lastS = this.s;
      this.layer.style.setProperty("--cam-s", this.s.toFixed(4));
      this.layer.style.setProperty("--cam-inv", (1 / this.s).toFixed(4));
      this.onScale(this.s);
    }
  }

  /** Write the current camera at once (first paint, resize). */
  paintNow() {
    this.paint();
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.raf = 0;
  }
}
