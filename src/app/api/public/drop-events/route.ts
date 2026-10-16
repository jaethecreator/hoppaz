import { cached, must } from "../_lib"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Every event id that has a collectible drop or a live public game drop, for the map's discovery markers. Replaces asking
 * with `.in(event_id, all the ids on the map)`, whose URL grows with every event. Row level security decides what the anon
 * key may see, so a game drop that belongs to a Hopper (a welcome box) never lists its event here.
 */
export function GET(req: Request) {
  return cached(
    "drop-events",
    req,
    async (sb, signal) => {
      const [legacy, live] = await Promise.all([
        sb.from("collectible_drops").select("event_id").abortSignal(signal),
        sb
          .from("game_drops")
          .select("event_id")
          .eq("active", true)
          .gt("closes_at", new Date().toISOString())
          .not("event_id", "is", null)
          .abortSignal(signal),
      ])
      const rows = [...(must(legacy) ?? []), ...(must(live) ?? [])] as { event_id: string | null }[]
      return [...new Set(rows.map((r) => r.event_id).filter((id): id is string => !!id))]
    },
    { sMaxAge: 60, swr: 300 },
  )
}
