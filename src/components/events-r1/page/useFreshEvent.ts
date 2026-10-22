"use client";

import { useR1Event } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";

/**
 * The event as the data layer has it now. The list a card was opened from was read earlier, so its going count,
 * spots left and (above all) the online link are stale after a Register. Until the fresh read arrives the given one stands.
 */
export function useFreshEvent(given: R1Event): R1Event {
  const { data } = useR1Event(given.id);
  return data ?? given;
}
