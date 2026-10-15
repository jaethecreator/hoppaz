"use client";

import { useEffect, useRef, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import type { CampaignLayout, CampaignZone } from "@/lib/campaign/layout";
import type { RoomCamera } from "./roomCamera";
import css from "./Campaign.module.css";

/**
 * Where the other rooms are, once the camera is close. Zoomed in on me, most of the six rooms are out of sight and their
 * name tags with them, so a small chip with the room's name sits at the edge of the screen on the side it is on, with an
 * arrow pointing there. A tap walks me to it. At most four, the nearest first; none while the whole room shows or the
 * chat sheet is full; they keep clear of the sound/find-me pill, the chat button and the action pill.
 *
 * Screen space, not world space: the chips are placed straight on the DOM from the camera's paint (no React render per
 * frame), the way the zone tags keep their size.
 */
const MAX = 4;
const CHIP_H = 26;
const EDGE = 8;
/** Rectangles of the room chrome the chips must not sit on, as [x from the left or right, y from the top or bottom, w, h]. */
type Keep = { from: "tr" | "bl" | "bc"; x: number; y: number; w: number; h: number };
const KEEP: Keep[] = [
  { from: "tr", x: 0, y: 0, w: 60, h: 160 }, // the sound, find me and settings pill
  { from: "bl", x: 0, y: 0, w: 130, h: 64 }, // the room chat button
  { from: "bc", x: -110, y: 0, w: 220, h: 128 }, // the action pill and the Game Time banner foot
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Short names for the chips, so they stay small on a 360 px phone. The full name is the button's label. */
const SHORT: Record<string, string> = { studio: "Studio", stage: "Stage", awards: "Awards", courtyard: "Courtyard", records: "Records", campaign: "Artist corner" };
const label = (zone: CampaignZone) => SHORT[zone.id] ?? zone.name.replace(/^The\s+/i, "");

export default function EdgeArrows({
  layout,
  camRef,
  enabled,
  onGo,
}: {
  layout: CampaignLayout;
  camRef: RefObject<RoomCamera | null>;
  enabled: boolean;
  onGo: (zone: CampaignZone) => void;
}) {
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const tile = layout.grid.tile;
  const zones = layout.zones;

  useEffect(() => {
    const cam = camRef.current;
    const els = nodes.current;
    const hideAll = () => els.forEach((el) => el && (el.hidden = true));
    if (!cam || !enabled) {
      hideAll();
      return;
    }
    const update = () => {
      const w = cam.viewW;
      const h = cam.viewH;
      const keep = KEEP.map((k) => {
        if (k.from === "tr") return { x0: w - k.w, y0: k.y, x1: w, y1: k.h };
        if (k.from === "bl") return { x0: k.x, y0: h - k.h, x1: k.w, y1: h };
        return { x0: w / 2 + k.x, y0: h - k.h, x1: w / 2 + k.x + k.w, y1: h };
      });
      const seen = zones
        .map((z, i) => {
          const at = cam.sceneToScreen((z.stop.x + 0.5) * tile, (z.stop.y + 0.5) * tile);
          const on = at.x > 28 && at.x < w - 28 && at.y > 28 && at.y < h - 28;
          return { z, i, at, on, d: Math.hypot(at.x - w / 2, at.y - h / 2) };
        })
        .filter((s) => !s.on)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX);
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const shown = new Set<number>();
      for (const s of seen) {
        const el = els[s.i];
        if (!el) continue;
        if (!widths.current[s.i]) {
          el.hidden = false;
          widths.current[s.i] = el.offsetWidth || 90;
        }
        const cw = widths.current[s.i];
        const toLeft = s.at.x <= 28;
        const toRight = s.at.x >= w - 28;
        const horizontal = toLeft || toRight;
        // Hug the edge the room is past; slide along it to the room's own height (or width).
        let cx = horizontal ? (toLeft ? EDGE + cw / 2 : w - EDGE - cw / 2) : clamp(s.at.x, EDGE + cw / 2, w - EDGE - cw / 2);
        let cy = horizontal ? clamp(s.at.y, EDGE + CHIP_H / 2, h - EDGE - CHIP_H / 2) : s.at.y <= 28 ? EDGE + CHIP_H / 2 : h - EDGE - CHIP_H / 2;
        const free = (x: number, y: number) => {
          const r = { x0: x - cw / 2 - 4, y0: y - CHIP_H / 2 - 4, x1: x + cw / 2 + 4, y1: y + CHIP_H / 2 + 4 };
          const hit = (o: { x0: number; y0: number; x1: number; y1: number }) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0;
          return !keep.some(hit) && !placed.some(hit);
        };
        // Nudge along the edge until the spot is clear: down first, then up (left or right chips), or sideways (top or bottom).
        let ok = free(cx, cy);
        for (let step = 1; !ok && step <= 12; step++) {
          for (const sign of [1, -1]) {
            const nx = horizontal ? cx : clamp(cx + sign * step * 36, EDGE + cw / 2, w - EDGE - cw / 2);
            const ny = horizontal ? clamp(cy + sign * step * 34, EDGE + CHIP_H / 2, h - EDGE - CHIP_H / 2) : cy;
            if (free(nx, ny)) {
              cx = nx;
              cy = ny;
              ok = true;
              break;
            }
          }
        }
        if (!ok) continue;
        placed.push({ x0: cx - cw / 2, y0: cy - CHIP_H / 2, x1: cx + cw / 2, y1: cy + CHIP_H / 2 });
        // The arrow points from the chip to the room.
        const angle = (Math.atan2(s.at.y - cy, s.at.x - cx) * 180) / Math.PI + 90;
        el.style.transform = `translate3d(${(cx - cw / 2).toFixed(1)}px,${(cy - CHIP_H / 2).toFixed(1)}px,0)`;
        el.style.setProperty("--aim", `${angle.toFixed(0)}deg`);
        el.hidden = false;
        shown.add(s.i);
      }
      els.forEach((el, i) => {
        if (el && !shown.has(i)) el.hidden = true;
      });
    };
    cam.onPaint = update;
    update();
    return () => {
      if (cam.onPaint === update) cam.onPaint = () => {};
      hideAll();
    };
  }, [camRef, enabled, tile, zones]);

  return (
    <div className={css.edgeArrows}>
      {zones.map((zone, i) => (
        <button
          key={zone.id}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          type="button"
          hidden
          data-hit
          data-edge-room={zone.id}
          className={css.edgeArrow}
          aria-label={`${zone.name}. Walk there.`}
          onClick={() => onGo(zone)}
        >
          <ArrowUp size={12} strokeWidth={2.6} aria-hidden style={{ transform: "rotate(var(--aim, 0deg))" }} />
          <span>{label(zone)}</span>
        </button>
      ))}
    </div>
  );
}
