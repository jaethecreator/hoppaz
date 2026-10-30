"use client";

import { useEffect, useRef } from "react";

/**
 * The walkable room as a wallpaper: a small pixel scene with people drifting about, drawn on a canvas a few dozen pixels tall and
 * scaled up. It is a picture of the room, not the room: nothing here connects to it. It stands still under prefers-reduced-motion
 * (the first frame is drawn and kept) and while the page is hidden.
 */
const PALETTE = {
  night: { f1: "#2A1712", f2: "#331C16", wall: "#4A2219", rug: "#7A1F22", light: "#FFB347", plant: "#2FD35C", bar: "#5A3020" },
  day: { f1: "#E6E0F2", f2: "#DCD5EC", wall: "#B9AEDA", rug: "#5B6FC2", light: "#FFD24A", plant: "#2FA35C", bar: "#9A8CC8" },
};
const COLORS = ["#FF4D00", "#2FD35C", "#22B8F0", "#FFC400", "#9D81FF", "#FF6FB5", "#F5EBDD"];

type Person = { x: number; y: number; tx: number; ty: number; c: string };

export default function Scene({ night, people }: { night: boolean; people: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const H = 48;
    const W = Math.max(96, Math.round((H * (canvas.clientWidth || 400)) / (canvas.clientHeight || 200)));
    canvas.width = W;
    canvas.height = H;
    const p = night ? PALETTE.night : PALETTE.day;
    const n = Math.max(3, Math.min(14, people || 8));
    // A fixed spread, so the picture is the same on every visit (no random jumps between renders).
    const folks: Person[] = Array.from({ length: n }, (_, i) => {
      const x = 8 + ((i * 37) % (W - 20));
      const y = 18 + ((i * 11) % 26);
      return { x, y, tx: x, ty: y, c: COLORS[i % COLORS.length] };
    });
    const draw = () => {
      for (let i = 0; i < W / 4; i++) for (let j = 0; j < H / 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? p.f1 : p.f2;
        ctx.fillRect(i * 4, j * 4, 4, 4);
      }
      ctx.fillStyle = p.wall;
      ctx.fillRect(0, 0, W, 10);
      for (let i = 0; i < W / 8; i++) {
        ctx.fillStyle = p.light;
        ctx.fillRect(4 + i * 8, 3, 2, 2);
      }
      ctx.fillStyle = p.rug;
      ctx.fillRect(Math.round(W / 2 - 16), 22, 32, 14);
      ctx.fillStyle = p.bar;
      ctx.fillRect(W - 30, 12, 22, 6);
      ctx.fillStyle = p.plant;
      ctx.fillRect(3, 38, 5, 5);
      ctx.fillRect(W - 8, 38, 5, 5);
      for (const a of folks) {
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.fillRect(Math.round(a.x) - 1, Math.round(a.y) + 3, 4, 1);
        ctx.fillStyle = a.c;
        ctx.fillRect(Math.round(a.x), Math.round(a.y), 3, 3);
        ctx.fillStyle = "#F2D2B6";
        ctx.fillRect(Math.round(a.x), Math.round(a.y) - 2, 3, 2);
      }
    };
    draw();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let tick = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (reduce.matches || document.hidden) return;
      // Redraw at about 20 frames a second: the scene is tiny and slow, it does not need more.
      if (++tick % 3) return;
      for (const a of folks) {
        if (Math.hypot(a.tx - a.x, a.ty - a.y) < 0.5) {
          if (((tick * 7 + Math.round(a.x * 13)) % 61) === 0) {
            a.tx = 6 + ((tick * 17 + Math.round(a.y * 5)) % (W - 16));
            a.ty = 14 + ((tick * 11 + Math.round(a.x * 3)) % 30);
          }
        } else {
          a.x += (a.tx - a.x) * 0.09;
          a.y += (a.ty - a.y) * 0.09;
        }
      }
      draw();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [night, people]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 block h-full w-full [image-rendering:pixelated]" />;
}
