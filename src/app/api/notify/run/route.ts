import { NextResponse } from "next/server";
import { supabaseNotifyDb } from "@/lib/notify/db";
import { noStore, runAllowed, serviceClient } from "@/lib/notify/http";
import { buildProviders } from "@/lib/notify/providers";
import { runNotify } from "@/lib/notify/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends what is due. Called every minute by the database, but only when something is due (pg_net, from notify_tick in
 * supabase/events_r1_notify.sql). Not for Hoppers: the caller must send Authorization: Bearer <NOTIFY_RUN_SECRET>.
 *
 * Claims up to 500 rows, routes each one through the providers (src/lib/notify/router.ts) and writes every attempt to notify_sends.
 * The database has already decided who gets what and when (flags, skip rules, daily caps, priority); this route only delivers.
 * WhatsApp rows are marked skipped with a reason until the WhatsApp sender is built.
 */
export async function POST(req: Request) {
  if (!runAllowed(req)) return NextResponse.json({ error: "Not allowed" }, { status: 401, headers: noStore });
  const sb = serviceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 503, headers: noStore });
  // Nothing is claimed unless there is a provider to hand it to, so rows are never marked as tried for nothing.
  const providers = buildProviders();
  if (!providers.length) return NextResponse.json({ error: "No email provider is configured" }, { status: 503, headers: noStore });

  try {
    const summary = await runNotify({ db: supabaseNotifyDb(sb), providers });
    return NextResponse.json({ ok: true, ...summary }, { headers: noStore });
  } catch (e) {
    console.warn("[hoppaz] notify: run failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not run" }, { status: 500, headers: noStore });
  }
}
