import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** What the run route needs from the web side. Server only. */

type Env = Record<string, string | undefined>;

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The run route accepts one thing: Authorization: Bearer <NOTIFY_RUN_SECRET>, sent by the database timer (pg_net, notify_tick in
 * supabase/events_r1_notify.sql). With the secret unset nobody gets in.
 */
export function runAllowed(req: Request, env: Env = process.env): boolean {
  const secret = env.NOTIFY_RUN_SECRET;
  const received = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || !received) return false;
  return timingSafeEqual(digest(secret), digest(received));
}

export function serviceClient(env: Env = process.env): SupabaseClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  return url && service ? createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

export const noStore = { "Cache-Control": "no-store" };
