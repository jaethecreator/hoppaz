import type { EventsR1Api } from "./api";
import { EVENTS_R1_FAKE } from "./flags";

export * from "./flags";
export type * from "./types";
export type * from "./api";

let cached: EventsR1Api | null = null;

/**
 * The data layer for the current build. Fake when NEXT_PUBLIC_EVENTS_R1_FAKE=1, else real.
 * Dynamic import keeps the seed data and the fake store out of a build that does not use them.
 */
export async function loadApi(): Promise<EventsR1Api> {
  if (cached) return cached;
  cached = EVENTS_R1_FAKE ? (await import("./fake")).fakeApi : (await import("./real")).realApi;
  return cached;
}
