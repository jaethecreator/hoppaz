import type { EventRow } from "./types";

/**
 * How many are going, for the lists and the deck: the registered going (Release 1) or the swipes with your own tap on top,
 * whichever is larger. Never the sum: the same person can do both, so adding them would count them twice.
 */
export function goingCount(e: EventRow, tap = 0): number {
  return Math.max(0, e.going ?? 0, (e.swipes_in ?? 0) + tap);
}
