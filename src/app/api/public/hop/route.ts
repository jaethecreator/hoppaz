import { cached, must } from "../_lib"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The next announced or selling Hop with its stops, raw (the phone maps it). Null when there is none. */
export function GET(req: Request) {
  return cached(
    "hop",
    req,
    async (sb, signal) =>
      must(
        await sb
          .from("hops")
          .select("*, hop_stops(*)")
          .in("status", ["announced", "selling"])
          .order("hop_date", { ascending: true })
          .limit(1)
          .abortSignal(signal)
          .maybeSingle(),
      ),
    { sMaxAge: 300, swr: 3600 },
  )
}
