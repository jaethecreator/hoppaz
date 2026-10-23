import type { EventsR1Api } from "../api";
import { auth } from "./auth";
import { door } from "./door";
import { events } from "./events";
import { pay } from "./pay";
import { pops } from "./pops";
import { registrations } from "./registrations";
import { reports } from "./reports";
import { rooms } from "./rooms";

/**
 * The real layer: every method calls Ola's security-definer functions (supabase/events_r1_*.sql) with the signed-in session,
 * and answers with the same shapes and the same error messages as the fake layer (fake/), which is the spec.
 * Picked by loadApi() when NEXT_PUBLIC_EVENTS_R1_FAKE is not 1. See real/README.md.
 */
export const realApi: EventsR1Api = {
  mode: "real",
  auth,
  events,
  registrations,
  pops,
  rooms,
  reports,
  door,
  clock: { now: () => Date.now() },
  pay,
};

