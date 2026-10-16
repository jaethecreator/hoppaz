/**
 * The beats of a search, in one place so the real hunt (controller.ts, GameTimeChrome.tsx) and the practice hunt
 * (HuntDemo.tsx) cannot drift apart.
 */

/** A search plays this long before its answer shows. */
export const SEARCH_ANIMATION_MS = 2000;
/** The hint chip on the object stays this long. */
export const CHIP_MS = 2500;
/** Standing still this long next to an object before SEARCH appears: the room sends my steps every 200 ms and the server checks its own copy. */
export const SETTLE_MS = 450;
/** The SEARCH pill stays while I am within this many tiles, so it does not flicker at the edge. */
export const LEAVE_TILES = 2;
