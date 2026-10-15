"use client";

import { create } from "zustand";
import { isEventLead } from "@/lib/geo";
import { NEXT_COUNT, nextEvents } from "@/lib/filters";
import type { EventRow } from "@/lib/types";

/**
 * Events close to the Hopper, first. One rule, shared: with a location, events this close (km) go to the front of the
 * next-events list and the rest top it up. It is Ola's rule for the deck on the Events page (NEAR_KM in
 * src/app/discover/page.tsx, upstream 1c1ebe0), moved here so the map and the first run use the same one.
 */
export const NEAR_KM = 12;
const DAY_MS = 24 * 3.6e6;

/** The next `n` events from now, whatever night, the ones within NEAR_KM first when `located`. */
export function nearFirst(events: EventRow[], located: boolean, now: number, n = NEXT_COUNT): { list: EventRow[] } {
  if (!located) return nextEvents(events, n, now);
  const far = (e: EventRow) => !(e.distance_m <= NEAR_KM * 1000);
  const near = nextEvents(events.filter((e) => !far(e)), n, now).list;
  const taken = new Set(near.map((e) => e.id));
  const rest = nextEvents(events.filter((e) => !taken.has(e.id)), n - near.length, now).list;
  return { list: [...near, ...rest] };
}

/**
 * The top events this week near you, for the first run's second layer: this week only, a flyer to show, no leads (an
 * event lead has no date worth putting on a card), the busiest of those within NEAR_KM, up to `max`.
 */
export function topThisWeek(events: EventRow[], now: number, max = 4): EventRow[] {
  return events
    .filter((e) => {
      const at = Date.parse(e.starts_at);
      return at > now - 3 * 3.6e6 && at < now + 7 * DAY_MS && !isEventLead(e) && !!e.flyer_url && /^https?:\/\//i.test(e.flyer_url) && e.distance_m <= NEAR_KM * 1000;
    })
    .sort((a, b) => b.heat - a.heat || a.distance_m - b.distance_m)
    .slice(0, max);
}

/** What the map page has worked out for the first run (the first run lives in the layout, not under the map). */
export const useTopNear = create<{ list: EventRow[]; set: (list: EventRow[]) => void }>((set) => ({ list: [], set: (list) => set({ list }) }));
