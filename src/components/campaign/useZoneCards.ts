"use client";

import { useEffect, useRef } from "react";
import type { CampaignContent, CampaignLayout } from "@/lib/campaign/layout";
import { validCampaignUrl } from "@/lib/campaign/layout";
import { useGoOut } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { ZoneSheetKind } from "./ZoneSheet";

/** Dwell before the pill shows (the card itself, PopUps in the world, uses the same half second), and how long it stays. */
const DWELL = 500;
/** How long the zone's pill stays. */
const PILL = 8000;
/** The same zone does not offer its pill again for this long, like its card (60 s). */
const AGAIN = 60_000;

/**
 * The card a zone shows when you walk in is drawn by PopUps (a zone card in the world: name, one line, 3 s). This hook adds
 * the ONE thing that zone offers as the action pill, when the owner has set it: OPEN THE MUSIC, SEE NEXT NIGHT, SEE THE
 * AWARDS, OPEN THE PLAYLIST, SEE THE ARTIST. It registers at priority 20 (Game Time 100, fountain 50, event sheet 40, exit
 * 10 are the others) and lets go after eight seconds or when you walk out. Nothing here pulls you out of the game: the
 * awards and the artist open as a sheet over the world, the links open in a new tab, and only a press does it.
 */
export function useZoneCards({
  layout,
  content,
  nextEvent,
  ready,
  openSheet,
}: {
  layout: CampaignLayout;
  content: CampaignContent;
  nextEvent: { id: string } | null;
  /** The open sequence is over and the camera is on me. */
  ready: boolean;
  openSheet: (kind: ZoneSheetKind) => void;
}) {
  const goOut = useGoOut();
  const zone = useRoomStore((s) => s.zone);
  const shown = useRef(new Map<string, number>());
  const latest = useRef({ content, nextEvent, openSheet, goOut, layout });
  latest.current = { content, nextEvent, openSheet, goOut, layout };

  useEffect(() => {
    if (!zone || !ready) return;
    let pillTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const now = Date.now();
      const store = useRoomStore.getState();
      if (store.sheet === "full") return;
      if (now - (shown.current.get(zone) ?? 0) < AGAIN) return;
      const { content: c, nextEvent: next, openSheet: open, goOut: out, layout: l } = latest.current;
      if (l.privateAreas.some((a) => a.id === zone)) return;
      const z = l.zones.find((item) => item.id === zone);
      if (!z) return;
      const music = validCampaignUrl(c.musicUrl);
      const go = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
      let action: { label: string; onPress: () => void } | null = null;
      if (z.id === "studio" && music) action = { label: "OPEN THE MUSIC", onPress: () => go(music) };
      else if (z.id === "stage" && next) action = { label: "SEE NEXT NIGHT", onPress: () => out(`/event/${next.id}`) };
      else if (z.id === "awards" && c.awards.length) action = { label: "SEE THE AWARDS", onPress: () => open("awards") };
      else if (z.id === "records" && music) action = { label: "OPEN THE PLAYLIST", onPress: () => go(music) };
      else if (z.id === "campaign") {
        if (c.artistTitle) action = { label: "SEE THE ARTIST", onPress: () => open("artist") };
        else if (music) action = { label: "SEE THE RELEASE", onPress: () => go(music) };
      }
      if (!action) return;
      shown.current.set(zone, now);
      store.setAction({ id: "zone", label: action.label, priority: 20, onPress: action.onPress });
      pillTimer = setTimeout(() => useRoomStore.getState().clearAction("zone"), PILL);
    }, DWELL);
    return () => {
      clearTimeout(timer);
      if (pillTimer) clearTimeout(pillTimer);
      useRoomStore.getState().clearAction("zone");
    };
  }, [zone, ready]);
}

/**
 * True when this Hopper has never been in this crew's room on this device. Read only: the welcome card (ChatWelcome) is the
 * one that marks the visit as seen, a moment after the room opens, so this is asked once, as the room mounts.
 */
export function firstVisit(crewId: string): boolean {
  const key = `hz:room-seen:${crewId}`;
  try {
    return !localStorage.getItem(key);
  } catch {
    return false;
  }
}
