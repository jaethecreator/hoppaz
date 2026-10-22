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
