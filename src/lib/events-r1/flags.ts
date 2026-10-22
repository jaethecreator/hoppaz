/**
 * Release 1 ("Free events and a community") switches.
 *
 * NEXT_PUBLIC_EVENTS_R1=1        every new screen. Off: the app is exactly as it was.
 * NEXT_PUBLIC_EVENTS_R1_FAKE=1   the in-memory data layer with seeded Lagos events (no database).
 * NEXT_PUBLIC_ROOMS_SEAL=1       home base and every hotspot sealed; Hoppaz HQ is the one central room (WP7).
 * NEXT_PUBLIC_PAID_TICKETS=1      a paid ticket type may be saved (front end only). Paid tickets need the Release 2 payment layer:
 *                                 nobody can buy one, whatever this says. Default off.
 *
 * Each is read as a literal `process.env.NEXT_PUBLIC_*` so the bundler can inline it.
 */
export const EVENTS_R1 = process.env.NEXT_PUBLIC_EVENTS_R1 === "1";
export const EVENTS_R1_FAKE = process.env.NEXT_PUBLIC_EVENTS_R1_FAKE === "1";
export const ROOMS_SEAL = process.env.NEXT_PUBLIC_ROOMS_SEAL === "1";
export const PAID_TICKETS = process.env.NEXT_PUBLIC_PAID_TICKETS === "1";

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
