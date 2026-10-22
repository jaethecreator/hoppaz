"use client";

import { memo, useEffect, useMemo } from "react";
import type { AmbientMember, CampaignLayout } from "@/lib/campaign/layout";
import { AmbientRunner } from "@/lib/campaign/ambient";
import { deviceTier } from "@/lib/deviceTier";
import AvatarSprite from "./AvatarSprite";
import css from "./Campaign.module.css";

/** A phone short of memory keeps the first few of the cast only (the layout lists the ones that matter most first). */
const CAST_LOW = 6;

/**
 * The scenery people of a room that lists them (CampaignLayout.ambient: Lagos HQ). Drawn with the same avatar system as a
 * Hopper, but only ever scenery: they are not in `social.peers`, so they are not counted, not named, not tappable (the world's
 * tap test reads the peers only), not in the room store and never in chat. Nothing is sent or stored: they exist on this
 * phone and move by their own clock (src/lib/campaign/ambient.ts), with no React render per step.
 */
const One = memo(function One({ member, tile, attach }: { member: AmbientMember; tile: number; attach: (id: string, el: HTMLElement | null) => void }) {
  return (
    <div
      ref={(el) => attach(member.id, el)}
      data-ambient={member.id}
      aria-hidden
      className={`${css.walker} ${css.peer}`}
      style={{ transform: `translate3d(${(member.home.x + 0.5) * tile}px,${(member.home.y + 0.6) * tile}px,0)`, zIndex: 10 + member.home.y }}
    >
      <span className={css.sprite}>
        <AvatarSprite look={member.look} />
      </span>
    </div>
  );
});

export default function AmbientWalkers({ layout }: { layout: CampaignLayout }) {
  const tile = layout.grid.tile;
  const cast = useMemo(() => (layout.ambient ?? []).slice(0, deviceTier() === "low" ? CAST_LOW : undefined), [layout]);
  const runner = useMemo(() => (cast.length ? new AmbientRunner(layout, cast, tile, css.walking) : null), [layout, cast, tile]);
  useEffect(() => {
    if (!runner) return;
    runner.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    runner.start();
    return () => runner.dispose();
  }, [runner]);
  if (!runner) return null;
  return (
    <>
      {cast.map((member) => (
        <One key={member.id} member={member} tile={tile} attach={runner.attach} />
      ))}
    </>
  );
}
