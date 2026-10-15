"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { Block, Tile } from "@/lib/campaign/geometry";
import { dayLabel } from "@/lib/filters";
import { eventTitle } from "@/lib/geo";
import { getSupabase } from "@/lib/supabase/client";
import type { CrewCard } from "./hub";
import { useRoomStore } from "./roomStore";

/**
 * The featured event on the courtyard fountain (design section 11): the flyer, the owner's ribbon and the way to the
 * map. The owner picks the event and types the ribbon (crew_room_set_featured in supabase/crew_rooms.sql). Nothing here
 * works out a ribbon: it is the owner's words, never the price and never the time.
 *
 * The data is the crew's card (crew_card), read once when the room opens and kept five minutes. The 15 second poll the
 * hub runs is not wanted in the room: sixty phones on Lagos data should not each ask every 15 seconds for a sticker.
 */

export type Featured = {
  id: string;
  /** The title without the "LEAD · " tag: "DAVE: The Boy Who Played the Harp". */
  title: string;
  /** The words before the first colon, in caps, or "" when the title has no short headline. */
  headline: string;
  /** The label of the pill at the fountain: "SEE THE DAVE NIGHT", else "SEE THE EVENT". */
  pill: string;
  flyerUrl: string | null;
  venue: string;
  area: string | null;
  startsAt: string;
  /** "FRI 16 OCT · 8PM" (dayLabel). */
  day: string;
  /** The owner's ribbon text, "" for none. */
  ribbon: string;
};

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; card: CrewCard | null }>();
const inflight = new Map<string, Promise<CrewCard | null>>();

/** The crew's card, from the cache while it is fresh. Null when the crew is not readable or the read failed. */
export function loadCrewCard(crewId: string, force = false): Promise<CrewCard | null> {
  const hit = cache.get(crewId);
  if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.card);
  const running = inflight.get(crewId);
  if (running) return running;
  const sb = getSupabase();
  if (!sb) return Promise.resolve(hit?.card ?? null);
  const p = Promise.resolve(sb.rpc("crew_card", { p_crew: crewId, p_code: null }))
    .then(({ data, error }) => {
      if (error) return hit?.card ?? null;
      const card = (data as CrewCard | null) ?? null;
      cache.set(crewId, { at: Date.now(), card });
      return card;
    })
    .catch(() => hit?.card ?? null)
    .finally(() => inflight.delete(crewId));
  inflight.set(crewId, p);
  return p;
}

/** The label of the pill: SEE THE <HEADLINE> NIGHT where the headline is short, else SEE THE EVENT. */
export function pillLabel(title: string): string {
  const head = title.includes(":") ? title.slice(0, title.indexOf(":")).trim().toUpperCase() : "";
  return head && head.length <= 14 ? `SEE THE ${head} NIGHT` : "SEE THE EVENT";
}

/** The card's featured event as the room shows it. Null when there is none, or it has ended (no sticker then). */
export function featuredFrom(card: CrewCard | null, now = Date.now()): Featured | null {
  const e = card?.featured_event;
  if (!card || !e || card.featured_event_id !== e.id) return null;
  const day = dayLabel(e.starts_at, now);
  if (day === "ENDED") return null;
  const title = eventTitle(e);
  return {
    id: e.id,
    title,
    headline: title.includes(":") ? title.slice(0, title.indexOf(":")).trim().toUpperCase() : "",
    pill: pillLabel(title),
    flyerUrl: e.flyer_url,
    venue: e.venue_name,
    area: e.area,
    startsAt: e.starts_at,
    day,
    ribbon: (card.featured_ribbon ?? "").replace(/\s+/g, " ").trim().slice(0, 14),
  };
}

/**
 * The room's featured event, whether I own the crew, and the logo, from one cached read of the crew card. `ready` is
 * false until the first answer. A failed read leaves the room without a sticker: the sticker is a bonus.
 */
export function useFeatured(crewId: string) {
  const [state, setState] = useState<{ card: CrewCard | null; ready: boolean }>(() => {
    const hit = cache.get(crewId);
    return hit ? { card: hit.card, ready: true } : { card: null, ready: false };
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const read = (force: boolean) =>
      void loadCrewCard(crewId, force).then((card) => {
        if (live) setState({ card, ready: true });
      });
    read(false);
    // Back on the room after a while away: read again if the cache has gone stale (a cache hit costs nothing).
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      read(false);
    };
    document.addEventListener("visibilitychange", visible);
    const tick = setInterval(() => setNow(Date.now()), TTL);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", visible);
      clearInterval(tick);
    };
  }, [crewId]);

  return {
    featured: featuredFrom(state.card, now),
    isOwner: !!state.card?.is_owner,
    logoUrl: state.card?.logo_url ?? null,
    ready: state.ready,
  };
}

/**
 * Whether the event sheet is open. The sticker and the pill (inside the world) open it; EventSheet (screen chrome) draws
 * it. Closing it is the sheet's job.
 */
export const useEventSheet = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Sizes and keylines of the sticker, in scene px. One place, so the art and the tap area agree. */
export const STICKER = {
  /** 3.5 tiles wide (design 11.1). */
  tiles: 3.5,
  keyline: 3,
  tilt: -3,
  ribbonTilt: 2,
  ribbonHeight: 20,
  ribbonOverhang: 10,
} as const;

/** The ribbon's font size so up to 14 capitals of Poppins Black fit one strip of `width` px: 11 px down to 9 px. */
export function ribbonFont(text: string, width: number): number {
  const advance = 0.82; // Poppins 900 caps: about 0.7 em a letter plus .06 em of tracking, with margin
  const fit = Math.floor((width - 10) / (Math.max(1, text.length) * advance));
  return Math.max(9, Math.min(11, fit));
}

/**
 * How far I stand from a prop, in whole tiles: the gap on each axis added up. Standing right against its edge is 1,
 * diagonal to its corner is 2, and standing on it counts as 0.
 */
export function tilesFrom(me: Tile, block: Block): number {
  const dx = Math.max(block.x - me.x, 0, me.x - (block.x + block.w - 1));
  const dy = Math.max(block.y - me.y, 0, me.y - (block.y + block.h - 1));
  return dx + dy;
}

/** I stood still this long (ms) near something usable before its pill appears. Walking past shows nothing. */
const SETTLE = 250;

/**
 * Register one action pill with the room store while I stand near a prop (design section 7.2). It shows after I have
 * stood still SETTLE ms within `enter` tiles, and goes the moment I am more than `leave` tiles away (the gap between the
 * two numbers is the hysteresis, so the pill does not flicker at the edge). With no tile (watching a full room), no
 * label or no prop it never shows. The press runs the latest `onPress`.
 */
export function usePlaceAction(opts: { id: string; label: string | null; priority: number; block: Block | null; enter: number; leave: number; onPress: () => void }) {
  const { id, label, priority, block, enter, leave } = opts;
  const me = useRoomStore((s) => s.me);
  const press = useRef(opts.onPress);
  press.current = opts.onPress;
  const shown = useRef<string | null>(null);
  const mx = me?.x;
  const my = me?.y;

  useEffect(() => {
    const store = useRoomStore.getState();
    if (mx === undefined || my === undefined || !block || !label) {
      shown.current = null;
      store.clearAction(id);
      return;
    }
    const d = tilesFrom({ x: mx, y: my }, block);
    const register = () => {
      shown.current = label;
      useRoomStore.getState().setAction({ id, label, priority, onPress: () => press.current() });
    };
    if (shown.current !== null) {
      if (d > leave) {
        shown.current = null;
        store.clearAction(id);
      } else if (shown.current !== label) register();
      return;
    }
    if (d > enter) return;
    const t = setTimeout(register, SETTLE);
    return () => clearTimeout(t);
  }, [id, label, priority, block, enter, leave, mx, my]);

  // Leaving the room (or the prop going away) never leaves a pill behind.
  useEffect(
    () => () => {
      shown.current = null;
      useRoomStore.getState().clearAction(id);
    },
    [id],
  );
}
