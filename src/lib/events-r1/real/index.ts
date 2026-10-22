import type { EventsR1Api } from "../api";

/**
 * The real layer. It will call Ola's security-definer functions (supabase/events_r1_*.sql, DRAFT).
 * Not wired yet: every method rejects, so a build that turns the flag on without the fake layer fails loudly.
 */
const notWired = (what: string) => (): never => {
  throw new Error(`events-r1 real layer not wired yet: ${what}`);
};

const proxy = <T extends object>(name: string): T =>
  new Proxy({} as T, { get: (_t, prop) => notWired(`${name}.${String(prop)}`) });

export const realApi: EventsR1Api = {
  mode: "real",
  auth: proxy("auth"),
  events: proxy("events"),
  registrations: proxy("registrations"),
  pops: proxy("pops"),
  rooms: proxy("rooms"),
  reports: proxy("reports"),
  door: proxy("door"),
  clock: { now: () => Date.now() },
  pay: proxy("pay"),
};
