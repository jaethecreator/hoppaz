/**
 * Two switches for the app's openings. Both are inlined at build time, so redeploy after changing one. Each is on unless its
 * variable is set to "off" (or "0", "false").
 *
 *   NEXT_PUBLIC_BUS_INTRO     the city title sequence (the bus crossing Lagos at night, ending on the wordmark) for someone
 *                             opening Hoppaz for the first time on this device. Once per device. Then the first run's cards.
 *   NEXT_PUBLIC_OPENING       the short Hoppaz opening (wordmark bounce, an okada across the skyline) on a cold start and
 *                             when the app comes back after a long while in the background. Never on the very first visit,
 *                             which has the title sequence instead.
 */
const off = (v: string | undefined) => v === "off" || v === "0" || v === "false";

export const BUS_INTRO_ENABLED = !off(process.env.NEXT_PUBLIC_BUS_INTRO);
export const OPENING_ENABLED = !off(process.env.NEXT_PUBLIC_OPENING);
