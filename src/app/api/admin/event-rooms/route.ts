import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The staff desk for the 3D room switch on Release 1 rooms (supabase/events_r1_rooms.sql). Guarded like the rest of the desk:
 * Authorization: Bearer $HOPPAZ_ADMIN_TOKEN. The two database functions are service-role only, so they are called here.
 *
 *   GET  /api/admin/event-rooms                    -> { ok: true, rooms: Room[] }   (ev_admin_list_rooms: every room, Lagos HQ first)
 *   POST /api/admin/event-rooms { room, on }       -> { ok: true }                  (ev_admin_set_room_3d)
 *
 * Answers: { ok: false, error, message } with 401 (no token), 400 (bad input), 404 (no such room), 503 (not set up).
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
  const { data, error } = await sb.rpc("ev_admin_list_rooms");
  if (error) return refuse("failed", "Could not load the rooms", 500);
  return NextResponse.json({ ok: true, rooms: data ?? [] }, { headers: noStore });
}

export async function POST(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  const body = (await req.json().catch(() => null)) as { room?: unknown; on?: unknown } | null;
  if (typeof body?.room !== "string" || !UUID.test(body.room) || typeof body.on !== "boolean") return refuse("bad_args", "Send { room, on }", 400);
  const { data, error } = await sb.rpc("ev_admin_set_room_3d", { p_room: body.room, p_on: body.on });
  if (error) return refuse("failed", "Could not switch the 3D room", 500);
  if (data === "not_found") return refuse("not_found", "Room not found", 404);
  if (data !== "ok") return refuse("failed", "Could not switch the 3D room", 500);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
