import { cached, must } from "../_lib"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** hotspot_list(): the same for everyone (zone shapes plus the counts). About 50 KB, which the CDN gzips. */
export function GET(req: Request) {
  return cached("hotspots", req, async (sb, signal) => must(await sb.rpc("hotspot_list").abortSignal(signal)), { sMaxAge: 30, swr: 300 })
}
