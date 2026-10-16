import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Public reads the CDN can keep. Every route under /api/public answers the same bytes to everyone, so Vercel serves the
 * copy and the database sees about one query per route per minute, however many phones ask.
 *
 * Rules that keep that true:
 *  - The client is the anon/publishable one, never the secret key: row level security is what "public" means here (a
 *    game drop owned by a Hopper stays out). The request's cookies and Authorization header are never read or forwarded.
 *  - No query parameters. Anything unknown is a 400 that is not cached, so `?x=random` cannot fill the CDN or dodge it.
 *  - If the database is slow or down, the last good answer this server instance has is served for a short time instead.
 */

export function publicClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Loaders get one signal that aborts after this long; every query of the loader must carry it (`.abortSignal(signal)`). */
const LOAD_TIMEOUT_MS = 8000

/** The error text a loader throws when a query fails. */
export function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

type Good = { at: string; data: unknown }
const lastGood = new Map<string, Good>()
/** Callers that arrive while a load is out share it, so a cold CDN never stampedes the database from one instance. */
const inFlight = new Map<string, Promise<Good>>()

const cc = (sMaxAge: number, swr: number) => `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`

function reply(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers },
  })
}

const NO_STORE = { "cache-control": "no-store", "cdn-cache-control": "no-store" }

export async function cached(
  name: string,
  req: Request,
  loader: (sb: SupabaseClient, signal: AbortSignal) => Promise<unknown>,
  opts: { sMaxAge: number; swr: number },
): Promise<Response> {
  // A cache key is the path. A query string would make a new key per value, so none is allowed.
  if (new URL(req.url).search !== "") return reply(400, { error: "no parameters" }, NO_STORE)

  let good: Good | undefined
  let stale = false
  try {
    const sb = publicClient()
    if (!sb) throw new Error("no database")
    let p = inFlight.get(name)
    if (!p) {
      p = (async () => {
        const data = await loader(sb, AbortSignal.timeout(LOAD_TIMEOUT_MS))
        return { at: new Date().toISOString(), data }
      })().finally(() => inFlight.delete(name))
      inFlight.set(name, p)
    }
    good = await p
    lastGood.set(name, good)
  } catch (e) {
    console.warn(`[hoppaz] /api/public/${name} failed:`, e instanceof Error ? e.message : e)
    good = lastGood.get(name)
    stale = true
  }

  if (!good) return reply(503, { error: "unavailable" }, NO_STORE)
  const value = stale ? cc(10, 60) : cc(opts.sMaxAge, opts.swr)
  return reply(200, good, {
    "cache-control": value,
    // Vercel's CDN reads this one even if Next rewrites Cache-Control.
    "cdn-cache-control": value,
    ...(stale ? { "x-hz-stale": "1" } : {}),
  })
}
