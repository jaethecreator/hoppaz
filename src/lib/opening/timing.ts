/** How long the short opening is up, in ms. The CSS in src/components/opening/opening.css times itself to the same numbers. */
export const OPENING_MS = 1650;
/** The last part of OPENING_MS is a fade (a tap starts the same fade at once). */
export const OPENING_FADE_MS = 200;
/** With reduced motion there is one still frame: up this long, then the fade. */
export const OPENING_STILL_MS = 900;
/** Coming back to the app after at least this long in the background plays the opening again. */
export const BACKGROUND_GAP_MS = 10 * 60_000;
/** Screens that never get it: reports, staff, dev pages, the reset page, sign-in and the API. */
export const OPENING_SKIP_PATH = /^\/(report|admin|dev|reset|account|auth|api)(\/|$)/;
