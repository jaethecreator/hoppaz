/**
 * Release 1 ("Free events and a community") switches.
 *
 * NEXT_PUBLIC_EVENTS_R1=1        every new screen. Off: the app is exactly as it was.
 * NEXT_PUBLIC_EVENTS_R1_FAKE=1   the in-memory data layer with seeded Lagos events (no database).
 * NEXT_PUBLIC_ROOMS_SEAL=1       home base and every hotspot sealed; Lagos HQ is the one central room (WP7).
 * NEXT_PUBLIC_QUESTS=1            quests show on events (event page, map card, host lists). Nobody can use them yet. Default off.
 * NEXT_PUBLIC_PAID_TICKETS=1      a paid ticket type may be saved (front end only). Paid tickets need the Release 2 payment layer:
 *                                 nobody can buy one, whatever this says. Default off.
 *
 * NEXT_PUBLIC_EVENT_CLAIMS=1     claim an event: the "Is this your event? Claim it" strip, one-time /claim/<token> links, the claim ask, and the
 *                                 staff Claimable list. Default off. The database has the same switch (ev_settings 'event_claims', set by
 *                                 ev_set_setting) and refuses every claim function while it is off.
 *
 * Open organiser rooms (CHANGE-006): the database decides (ev_settings 'open_organiser_rooms', ev_set_open_organiser_rooms). The fake has a
 * demo switch for it, ON by default (openOrganiserRoomsOn below).
 *
 * Each is read as a literal `process.env.NEXT_PUBLIC_*` so the bundler can inline it.
 */
export const EVENTS_R1 = process.env.NEXT_PUBLIC_EVENTS_R1 === "1";
export const EVENTS_R1_FAKE = process.env.NEXT_PUBLIC_EVENTS_R1_FAKE === "1";
export const ROOMS_SEAL = process.env.NEXT_PUBLIC_ROOMS_SEAL === "1";
export const QUESTS_ON = process.env.NEXT_PUBLIC_QUESTS === "1";
export const PAID_TICKETS = process.env.NEXT_PUBLIC_PAID_TICKETS === "1";
export const EVENT_CLAIMS = process.env.NEXT_PUBLIC_EVENT_CLAIMS === "1";

/** localStorage key of the demo switch for paid tickets (fake data only). */
export const PAID_KEY = "hz.r1.paid";

/**
 * Is the paid ticket flow on right now? The build switch, or (fake data only) the demo switch "Paid tickets" on the dev
 * panel, kept in localStorage. On the server it is false. Under Node (the check script) HZ_PAID=1 turns it on.
 * Read it at the moment you need it, not at module load: the demo switch can change while the app is open.
 */
export function paidTicketsOn(): boolean {
  if (PAID_TICKETS) return true;
  if (typeof window === "undefined") return typeof process !== "undefined" && process.env.HZ_PAID === "1";
  if (!EVENTS_R1_FAKE) return false;
  try {
    return window.localStorage.getItem(PAID_KEY) === "1";
  } catch {
    return false;
  }
}

/** localStorage key of the demo switch for claiming (fake data only). */
export const CLAIMS_KEY = "hz.r1.claims";

/**
 * Is "claim an event" on right now? The build flag, or (fake data only) the demo switch "Event claims" on the dev panel. On the server it is
 * false. Under Node (the check script) HZ_CLAIMS=1 turns it on. Read it at the moment you need it, like paidTicketsOn().
 */
export function eventClaimsOn(): boolean {
  if (EVENT_CLAIMS) return true;
  if (typeof window === "undefined") return typeof process !== "undefined" && process.env.HZ_CLAIMS === "1";
  if (!EVENTS_R1_FAKE) return false;
  try {
    return window.localStorage.getItem(CLAIMS_KEY) === "1";
  } catch {
    return false;
  }
}

/** localStorage key of the demo switch for open organiser rooms (fake data only). "0" is off; anything else (or nothing) is on. */
export const OPEN_ROOMS_KEY = "hz.r1.openrooms";

/**
 * Are unclaimed organiser rooms open to view (CHANGE-006)? Fake data only: the demo switch "Open organiser rooms", on unless set to "0".
 * Under Node (the check script) HZ_OPEN_ROOMS=0 turns it off. The real layer asks the database (ev_room_listing answers null while it is off).
 */
export function openOrganiserRoomsOn(): boolean {
  if (typeof window === "undefined") return typeof process === "undefined" || process.env.HZ_OPEN_ROOMS !== "0";
  try {
    return window.localStorage.getItem(OPEN_ROOMS_KEY) !== "0";
  } catch {
    return true;
  }
}
