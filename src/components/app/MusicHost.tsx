"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { music, type MusicSlot } from "@/lib/sound/music";
import { useRoomTrack } from "@/lib/sound/roomTrack";
import { usePlayMode } from "@/lib/usePlayMode";
import { useTheme } from "@/lib/useTheme";

/** The three menu tabs. Sub-pages (a group chat, the avatar maker, a quest list) stay silent, like Chat and the events map. */
const MENUS = new Set(["/discover", "/me", "/crew"]);
/** A crew room (/crew/<id>/room). */
const ROOM = /^\/crew\/[^/]+\/room$/;

/**
 * Which music slot a screen wants (docs/MUSIC.md). Play is an overlay on the map at "/", so it counts only there:
 * its day or night loop follows the theme the map is drawn in. A crew room, once you are inside, has the Play theme
 * as its room theme (its owner's own loop plays instead when there is one, see MusicHost). The map outside Play and
 * everything else is silent.
 */
function slotFor(path: string, playing: boolean, night: boolean, inRoom: boolean): MusicSlot | null {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return playing ? (night ? "play_night" : "play_day") : null;
  if (ROOM.test(p)) return inRoom ? (night ? "play_night" : "play_day") : null;
  return MENUS.has(p) ? "menu" : null;
}

/**
 * Tells the music player what the screen wants (src/lib/sound/music.ts). It makes no sound and no network
 * request itself: the player starts only after the first real tap, and fetches only the loop the screen needs.
 * The Music row in Me, Settings is the switch.
 */
export default function MusicHost() {
  const path = usePathname() ?? "/";
  const playing = usePlayMode((s) => s.active);
  const theme = useTheme();
  // A crew room's screen says when the Hopper is inside and which loop its owner set (useRoomTrack).
  const room = useRoomTrack();
  const slot = slotFor(path, playing, theme === "night", room.inside);
  const inRoomPath = ROOM.test(path.replace(/\/+$/, ""));
  const own = inRoomPath ? room.url : null;
  useEffect(() => {
    // A crew room plays the loop quieter than the map's Play does (music.ts, ROOM_LEVEL).
    music.want(slot, own, inRoomPath);
  }, [slot, own, inRoomPath]);
  // Only on unmount. A cleanup on the effect above would stop and restart the music at every route change.
  useEffect(() => () => music.want(null), []);
  return null;
}
