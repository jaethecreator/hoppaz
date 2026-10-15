"use client";

import { memo } from "react";
import { normalizeLook } from "@/lib/avatar";
import { avatarSvg } from "@/lib/avatarSvg";

/**
 * One Hopper in the room as ONE image node. A full avatar is about 77 SVG nodes; 60 of them is thousands of nodes that
 * the phone has to style, layout and paint. The look is drawn once to an SVG string (src/lib/avatarSvg.ts), turned into a
 * data URL and cached by look, so every Hopper with the same look shares one decoded image and costs one DOM node.
 */
const urls = new Map<string, string>();
const MAX = 160;

export function spriteUrl(look: unknown): string {
  const normal = normalizeLook(look);
  const key = JSON.stringify(normal);
  let url = urls.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(normal, { uid: "sp" }))}`;
    if (urls.size >= MAX) urls.delete(urls.keys().next().value as string);
    urls.set(key, url);
  }
  return url;
}

function AvatarSprite({ look, label, className }: { look: unknown; label?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a drawn avatar in a data URL, not a photo
    <img src={spriteUrl(look)} alt={label ?? ""} className={className} width={32} height={58} draggable={false} decoding="async" />
  );
}

export default memo(AvatarSprite);
