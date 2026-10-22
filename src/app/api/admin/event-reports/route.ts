import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The staff desk for reports on Release 1 events (supabase/events_r1_reports.sql). Guarded like the rest of the desk:
 * Authorization: Bearer $HOPPAZ_ADMIN_TOKEN. The two database functions are service-role only, so they are called here.
 *
 *   GET  /api/admin/event-reports                                  -> { ok: true, reports: Report[] }   (ev_admin_reports)
 *   POST /api/admin/event-reports { action: "review", id, restore? } -> { ok: true, event_status }       (ev_admin_review_report)
 *        restore true also marks every open report on that event reviewed and puts a hidden event back.
 *
 * Answers: { ok: false, error, message } with 401 (no token), 400 (bad input), 404 (no such report), 503 (not set up).
 */
const authorized = (req: Request) => {
  const secret = process.env.HOPPAZ_ADMIN_TOKEN ?? "";
  const received = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !received) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

const noStore = { "Cache-Control": "no-store" };
const refuse = (error: string, message: string, status: number) => NextResponse.json({ ok: false, error, message }, { status, headers: noStore });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  const { data, error } = await sb.rpc("ev_admin_reports");
  if (error) return refuse("failed", "Could not load the reports", 500);
  return NextResponse.json({ ok: true, reports: data ?? [] }, { headers: noStore });
}

export async function POST(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; restore?: unknown } | null;
  if (body?.action !== "review" || typeof body.id !== "string" || !UUID.test(body.id)) return refuse("bad_args", "Send { action: \"review\", id }", 400);
  const { data, error } = await sb.rpc("ev_admin_review_report", { p_id: body.id, p_restore: body.restore === true });
  if (error) return refuse("failed", "Could not mark the report reviewed", 500);
  const out = data as { ok?: boolean; reason?: string; event_status?: string } | null;
  if (!out?.ok) return refuse(out?.reason ?? "failed", out?.reason === "not_found" ? "Report not found" : "Could not mark the report reviewed", out?.reason === "not_found" ? 404 : 500);
  return NextResponse.json({ ok: true, event_status: out.event_status }, { headers: noStore });
}
