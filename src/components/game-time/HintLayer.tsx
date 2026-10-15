"use client";

import { useLayoutEffect, useRef } from "react";
import { Flame, Info, Snowflake, Thermometer, TriangleAlert } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useGameTime, type GtChip } from "@/lib/game-time/store";
import css from "./GameTime.module.css";

/**
 * The answer to a search, drawn ON the object but in the screen layer (design 13.4): "NOTHING HERE · WARM", or what went wrong.
 * It lives over the room, not inside the scaled world, so a zone label can never sit on top of it, and it can read the real
 * boxes of the banner: it goes above the object, or under it when its top would meet the banner, the feed lines or the tip.
 * It follows the object while the camera moves (a few frames of reading two rectangles) and keeps inside the screen.
 */

const TONE_CLASS: Record<GtChip["tone"], string> = { cold: css.tCold, warm: css.tWarm, hot: css.tHot, warn: css.tWarn, info: css.tInfo };

function ChipIcon({ tone }: { tone: GtChip["tone"] }) {
  const p = { size: 14, strokeWidth: 2.4, "aria-hidden": true } as const;
  if (tone === "cold") return <Snowflake {...p} />;
  if (tone === "warm") return <Thermometer {...p} />;
  if (tone === "hot") return <Flame {...p} />;
  if (tone === "warn") return <TriangleAlert {...p} />;
  return <Info {...p} />;
}

const GAP = 6;
const EDGE = 8;

function Hint({ chip, layout }: { chip: GtChip; layout: CampaignLayout }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.closest<HTMLElement>('[data-game-time-layer="chrome"]');
    const world = document.querySelector<HTMLElement>('[data-game-time-layer="world"]');
    const prop = layout.props.find((p) => p.id === chip.object);
    if (!el || !host || !world || !prop) {
      if (el) el.style.visibility = "hidden";
      return;
    }
    let raf = 0;
    const place = () => {
      const w = world.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      if (w.width > 0 && w.height > 0) {
        const tw = w.width / layout.grid.width;
        const th = w.height / layout.grid.height;
        const cx = w.left - h.left + (prop.x + prop.w / 2) * tw;
        const top = w.top - h.top + prop.y * th;
        const bottom = w.top - h.top + (prop.y + prop.h) * th;
        const cw = el.offsetWidth;
        const ch = el.offsetHeight;
        const left = Math.min(Math.max(cx - cw / 2, EDGE), Math.max(EDGE, h.width - EDGE - cw));
        // Whatever the HUD draws over the top of the room, where it sits sideways over the chip.
        let floor = EDGE;
        host.querySelectorAll<HTMLElement>("[data-gt-banner], [data-gt-feed], [data-gt-tip]").forEach((n) => {
          const b = n.getBoundingClientRect();
          if (b.height > 2 && b.right - h.left > left && b.left - h.left < left + cw) floor = Math.max(floor, b.bottom - h.top + 4);
        });
        const above = top - GAP - ch;
        const y = above >= floor ? above : bottom + GAP;
        el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(y)}px, 0)`;
        el.style.visibility = "visible";
        el.dataset.side = above >= floor ? "above" : "below";
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [chip.k, chip.object, layout]);

  return (
    <div ref={ref} className={css.hintAt} style={{ visibility: "hidden" }}>
      <div className={`${css.chip} ${TONE_CLASS[chip.tone]}`} role="status" data-gt-chip={chip.tone}>
        <ChipIcon tone={chip.tone} />
        {chip.text}
      </div>
    </div>
  );
}

export default function HintLayer({ layout }: { layout: CampaignLayout }) {
  const chip = useGameTime((s) => s.chip);
  return chip ? <Hint key={chip.k} chip={chip} layout={layout} /> : null;
}
