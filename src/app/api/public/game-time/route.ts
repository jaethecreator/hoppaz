import { cached, must } from "../_lib"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * game_time_list() as an anonymous caller sees it: open crews only, with is_member false, won false and blocked null, so
 * nothing in it belongs to one Hopper. server_now is dropped on purpose: a cached copy must never set a phone's clock.
 */
export function GET(req: Request) {
  return cached(
    "game-time",
    req,
    async (sb, signal) => {
      const d = must(await sb.rpc("game_time_list").abortSignal(signal)) as { games?: unknown } | null
      return { games: Array.isArray(d?.games) ? d.games : [] }
    },
    { sMaxAge: 15, swr: 45 },
  )
}
