/**
 * Confetti pack: paper tumbling down the first screen, drawn on the two canvases inside `.pack-confetti` (far pieces sharp,
 * near pieces at 30% resolution so they read out of focus). Colours come from the pack's --cf-* variables (the tint), read once
 * per mount, so PackLayer remounts it when the tint or mood changes. Stops while the tab is hidden or the layer is off screen;
 * with reduced motion it draws one still frame. Ported from the approved review/packs/confetti.html. Returns a cleanup.
 */
type Bit = {
  depth: number; s: number; kind: number; col: string; x: number; y: number; vy: number; sw: number; sf: number; ph: number;
  rx: number; ry: number; rz: number; wx: number; wy: number; len: number;
};

export function mountConfetti(el: HTMLElement): () => void {
  const cans = el.querySelectorAll("canvas");
  const far = cans[0], near = cans[1];
  if (!far || !near) return () => {};
  const fctx = far.getContext("2d"), nctx = near.getContext("2d");
  if (!fctx || !nctx) return () => {};
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pick = (v: string) => {
    const s = document.createElement("i");
    s.style.color = `var(${v})`;
    el.append(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  };
  const pal = ["--cf-1", "--cf-2", "--cf-3", "--cf-4", "--cf-1"].map(pick), back = pick("--cf-back");
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let W = 0, V = 0, raf = 0, last = 0, onScreen = true, bits: Bit[] = [];
  const make = (depth: number, initial: boolean): Bit => {
    const s = depth === 2 ? 2 + rnd() * 0.6 : depth === 1 ? 0.9 + rnd() * 0.3 : 0.5 + rnd() * 0.15, r = rnd(), e = rnd() < 0.5 ? -1 : 1;
    return {
      depth, s, kind: r < 0.38 ? 0 : r < 0.6 ? 1 : r < 0.78 || depth === 2 ? 2 - Number(depth === 2 && r > 0.78) : 3, col: pal[(rnd() * pal.length) | 0],
      x: W * (0.5 + e * 0.5 * Math.pow(rnd(), W > 700 ? 0.55 : 0.9)), y: initial ? V * 0.72 * Math.pow(rnd(), W > 700 ? 2.2 : 3.2) - 10 : -30 - rnd() * V * 0.25,
      vy: (12 + rnd() * 16) * (0.55 + s * 0.45), sw: 8 + rnd() * 22, sf: 0.6 + rnd() * 1.1, ph: rnd() * 6.3,
      rx: rnd() * 6.3, ry: rnd() * 6.3, rz: rnd() * 6.3, wx: (1.2 + rnd() * 3) * e, wy: 1 + rnd() * 2.6, len: 20 + rnd() * 12,
    };
  };
  const draw = (ctx: CanvasRenderingContext2D, b: Bit, t: number) => {
    const x = b.x + Math.sin(t * b.sf + b.ph) * b.sw, k = (v: number) => Math.sign(v) * Math.max(0.22, Math.abs(v)), cy = k(Math.cos(b.ry)), cx = k(Math.cos(b.rx));
    let a = Math.min(1, Math.max(0, 1 - (b.y / V - 0.14) / 0.5));
    // Pieces behind the centre column (the content) fade back on wide screens.
    if (W > 700 && Math.abs(x - W / 2) < 300) a *= 0.45;
    if (a <= 0) return;
    ctx.save();
    ctx.translate(x, b.y);
    ctx.rotate(b.rz + Math.sin(t * b.sf + b.ph) * 0.5);
    ctx.scale(b.s * cy, b.s * cx);
    ctx.globalAlpha = a * (b.depth ? 0.95 : 0.7) * (0.8 + 0.2 * Math.abs(cy * cx));
    ctx.fillStyle = ctx.strokeStyle = b.col;
    ctx.beginPath();
    if (b.kind === 0) ctx.rect(-3, -b.len / 2, 6, b.len);
    else if (b.kind === 1) ctx.rect(-6.5, -6.5, 13, 13);
    else if (b.kind === 2) ctx.arc(0, 0, 6.5, 0, 6.3);
    else {
      ctx.lineWidth = 4.2;
      ctx.lineCap = "round";
      ctx.moveTo(-17, 0);
      for (let i = -17; i <= 17; i += 2) ctx.lineTo(i, Math.sin(i * 0.3 + b.ph) * 5);
    }
    const paint = () => (b.kind < 3 ? ctx.fill() : ctx.stroke());
    paint();
    // The back of the paper when it flips: the same shape, washed towards the page colour.
    if (cy * cx < 0) {
      ctx.globalAlpha *= 0.4;
      ctx.fillStyle = ctx.strokeStyle = back;
      paint();
    }
    ctx.restore();
  };
  const frame = (now: number) => {
    const t = now / 1000, dt = Math.min(0.05, last ? t - last : 0);
    last = t;
    fctx.clearRect(0, 0, W, V);
    nctx.clearRect(0, 0, W, V);
    for (const b of bits) {
      b.y += b.vy * dt;
      b.rx += b.wx * dt;
      b.ry += b.wy * dt;
      b.rz += b.wx * 0.15 * dt;
      if (b.y > V * 0.75) Object.assign(b, make(b.depth, false));
      draw(b.depth === 2 ? nctx : fctx, b, t);
    }
    raf = still ? 0 : requestAnimationFrame(frame);
  };
  const run = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (document.hidden || !onScreen || !W || !V) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const size = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1), r = far.getBoundingClientRect();
    W = r.width;
    V = r.height;
    for (const [c, ctx, d] of [[far, fctx, dpr], [near, nctx, 0.3]] as const) {
      c.width = Math.max(1, Math.round(W * d));
      c.height = Math.max(1, Math.round(V * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    seed = 7;
    const n = Math.round(Math.min(110, 30 + (W * V) / 13000));
    bits = Array.from({ length: n }, (_, i) => make(i < n * 0.1 ? 2 : i < n * 0.55 ? 1 : 0, true));
    run();
  };
  const ro = new ResizeObserver(size);
  ro.observe(el);
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    run();
  });
  io.observe(far);
  document.addEventListener("visibilitychange", run);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", run);
  };
}
