"use client";

import { memo, useMemo } from "react";
import { HAIR_COLORS, SKINS, itemById } from "@/lib/avatar";
import { lookOfKey, useSprite } from "./spriteCache";
import css from "./Campaign.module.css";

/**
 * One Hopper in the room as ONE node. A full avatar is about 77 SVG nodes and 60 of them at once froze a phone, so the room
 * draws a Hopper in two steps (spriteCache.ts): a flat blob in their own colours straight away, then the real avatar as a
 * small bitmap once the queue has drawn it, nearest to me first. At the full view a Hopper is 12 px wide, where the blob
 * and the avatar look alike; by the time the camera is close the near ones are drawn.
 */
function AvatarSprite({ look, label, className }: { look: unknown; label?: string; className?: string }) {
  const { key, url } = useSprite(look);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a drawn avatar (a bitmap made in the page), not a photo
      <img src={url} alt={label ?? ""} className={className} width={32} height={58} draggable={false} decoding="async" />
    );
  }
  return <AvatarBlob sprite={key} label={label} />;
}

/** The placeholder: head, hair, top and trousers in the Hopper's own colours, from CSS custom properties. */
function AvatarBlob({ sprite, label }: { sprite: string; label?: string }) {
  const style = useMemo(() => {
    const look = lookOfKey(sprite);
    return {
      "--skin": SKINS[look.skin],
      "--hair": HAIR_COLORS[look.hairColor].hex,
      "--top": itemById(look.top)?.color ?? "#555",
      "--bottom": itemById(look.bottom)?.color ?? "#333",
    } as React.CSSProperties;
  }, [sprite]);
  return <span className={css.blob} style={style} role="img" aria-label={label ?? ""} />;
}

export default memo(AvatarSprite);
