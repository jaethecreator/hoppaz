import { cached, must } from "../_lib"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Every live event within 110 km of Lagos centre, from 4 hours ago to 45 days ahead. 110 km is the 65 km a fix may be from
 * the centre plus the 45 km wide net the app always pulls, so it holds whatever events_near would have returned for any
 * fix the client sends here. distance_m is from the centre; the phone recomputes it.
 */
export function GET(req: Request) {
  return cached(
    "events",
    req,
    async (sb, signal) =>
      must(
        await sb
          .rpc("events_near", {
            p_lat: 6.5,
            p_lng: 3.42,
            p_radius_m: 110_000,
            p_from: new Date(Date.now() - 4 * 3.6e6).toISOString(),
            p_to: new Date(Date.now() + 45 * 24 * 3.6e6).toISOString(),
          })
          .abortSignal(signal),
      ),
    { sMaxAge: 60, swr: 600 },
  )
}
