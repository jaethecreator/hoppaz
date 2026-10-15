"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useBubbles, type Bubble } from "@/lib/crew-room/chatBubbles";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection } from "@/lib/crew-room/types";
import css from "./Bubbles.module.css";

/**
 * New messages as short bubbles over the speaker's avatar (design section 9.8). Owned by CHAT.
 *
 * WORLD LAYER, mounted by CampaignWorld inside the scaled world container, so a tile (x, y) sits at left x * tile,
 * top y * tile (tile = roomStore.tile). People are roomStore.peers, me is roomStore.me. A bubble must stay the same size
 * on screen at every zoom, so each one is drawn at scale(var(--cam-inv)) (the shell's camera sets --cam-s and
 * --cam-inv on the world every frame; without them the scale is measured off this layer's own 100 px box). No bubble
 * shows when the camera is zoomed out to the full view (scale under 0.6), where an avatar is too small to talk over.
 */
export type BubblesProps = { crewId: string; layout: CampaignLayout; room: CrewRoomConnection; userId: string };

/** World px from an avatar's feet tile centre up to just above its head (the sprite is 60 px tall, anchored 80 percent down). */
const HEAD = 52;
/** Below this camera scale an avatar is too small to talk over. */
const MIN_SCALE = 0.6;
/** Rough size of a bubble on screen (px) for stacking two that would overlap. */
const widthOf = (text: string) => Math.min(156, 20 + text.length * 6.2);
const heightOf = (text: string) => (text.length * 6.2 > 130 ? 41 : 26);

export default function Bubbles({ room, userId }: BubblesProps) {
  const bubbles = useBubbles(room, userId);
  const live = bubbles.length > 0;
  const marker = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const tile = useRoomStore((s) => s.tile);
  const where = useRoomStore(
    useShallow((s) => bubbles.map((b) => (b.speaker === userId ? s.me : (s.peers.find((p) => p.id === b.speaker) ?? null))))
  );

  // The camera zooms by a transform on a parent, so ask the browser how big 100 layout px came out.
  useEffect(() => {
    if (!live) return;
    let frame = 0;
    const read = () => {
      const el = marker.current;
      if (el) {
        // The shell writes the camera scale on the world as --cam-s; without it, measure this layer's own box.
        const fromVar = parseFloat(getComputedStyle(el).getPropertyValue("--cam-s"));
        const s = fromVar > 0 ? fromVar : el.getBoundingClientRect().width / 100;
        if (s > 0) setScale((old) => (Math.abs(old - s) < 0.003 ? old : s));
      }
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  const visible = scale >= MIN_SCALE;
  // Two bubbles that would sit on top of each other: the later one moves up by its height plus 4 px, at most twice.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const items = bubbles.map((b, i) => {
    const at = where[i];
    if (!at) return null;
    const w = widthOf(b.text);
    const h = heightOf(b.text);
    const x = (at.x + 0.5) * tile * scale;
    let lift = 0;
    for (let tries = 0; tries < 2; tries++) {
      const y = (at.y + 0.5) * tile * scale - HEAD * scale - lift;
      const clash = placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2 + 2);
      if (!clash) break;
      lift += h + 4;
    }
    placed.push({ x, y: (at.y + 0.5) * tile * scale - HEAD * scale - lift, w, h });
    return { b, px: (at.x + 0.5) * tile, py: (at.y + 0.5) * tile - HEAD - lift / Math.max(scale, 0.01) };
  });

  return (
    <div className={css.layer} aria-hidden>
      <div ref={marker} className={css.marker} />
      {visible &&
        items.map(
          (it) =>
            it && <BubbleView key={it.b.id} bubble={it.b} x={it.px} y={it.py} scale={scale} />
        )}
    </div>
  );
}

function BubbleView({ bubble, x, y, scale }: { bubble: Bubble; x: number; y: number; scale: number }) {
  return (
    <div
      className={css.bubble}
      data-bubble={bubble.speaker}
      style={{ transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) scale(var(--cam-inv, ${1 / scale}))` }}
    >
      <span className={css.face}>
        {bubble.area && <Lock size={10} aria-hidden className={css.lock} />}
        <span>{bubble.text}</span>
      </span>
    </div>
  );
}
