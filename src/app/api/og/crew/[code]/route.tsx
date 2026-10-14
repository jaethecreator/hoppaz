import { brandImage, loadFonts, loadShareCrew } from "../../_lib";
import { CrewShareCard, SiteShareCard, renderPng } from "../../_cards";

/**
 * GET /api/og/crew/<invite code>: a crew invite's share card, 1200 x 630 PNG, for link previews. The invite page
 * points its og:image here (src/app/crew/join/[code]/layout.tsx). Public: it shows what the invite page shows.
 */

// Members and "in the room now" change, so the card is short lived on the CDN.
const CACHE = "public, max-age=300, s-maxage=600, stale-while-revalidate=3600";
const BRIEF = "public, max-age=60, s-maxage=300";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const [fonts, crew, wordmark] = await Promise.all([loadFonts(), loadShareCrew(code), brandImage("wordmark")]);
  try {
    if (!crew) return await renderPng(<SiteShareCard wordmark={wordmark} />, fonts, BRIEF);
    return await renderPng(<CrewShareCard crew={crew} wordmark={wordmark} />, fonts, CACHE);
  } catch (e) {
    console.warn("[hoppaz] crew share card failed:", e instanceof Error ? e.message : e);
    return new Response("Could not draw the card.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
