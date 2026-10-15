import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { gameTimeAction, gameTimeData, gameTimeGame, gameTimeWinners, winnersCsv, type Done } from "./gameTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The staff desk for Game Time (supabase/game_time.sql, docs/GAME-TIME.md). Guarded by the same shared
 * secret as the rest of the admin desk: Authorization: Bearer $HOPPAZ_ADMIN_TOKEN. Codes and hiding spots
 * only ever travel on this route, never to a Hopper.
 *
 *   GET  /api/admin/game-time                       the games (no codes), the crews with their room, each room's objects
 *   GET  /api/admin/game-time?id=<game>             one game in full: live status, every box with its code and where it hides
 *   GET  /api/admin/game-time?winners=<game|all>    the winners: handle, name, email, code, object, time
 *   GET  /api/admin/game-time?winners=<game|all>&format=csv    the same as a spreadsheet download
 *   POST /api/admin/game-time { action: "create" | "update" | "start_now" | "close", ... }
 *
 * Answers: { ok: true, ... } or { ok: false, error: "<reason>", message: "<what to tell staff>" } with the status
 * that fits (400 a field is wrong, 404 no such game, 409 the game is in a state that forbids it, 401 no token).
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
const send = (d: Done) => NextResponse.json(d.json, { status: d.status, headers: noStore });
const refuse = (error: string, message: string, status: number) => NextResponse.json({ ok: false, error, message }, { status, headers: noStore });

export async function GET(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  const q = new URL(req.url).searchParams;

  const winners = q.get("winners");
  if (winners !== null) {
    const r = await gameTimeWinners(sb, winners === "all" || winners === "" ? null : winners);
    if (r.status !== 200 || q.get("format") !== "csv") return send(r);
    const csv = winnersCsv((r.json.winners as Record<string, unknown>[]) ?? []);
    return new NextResponse(csv, {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="game-time-winners${winners && winners !== "all" ? `-${winners.slice(0, 8)}` : ""}.csv"`,
      },
    });
  }
  const id = q.get("id");
  if (id !== null) return send(await gameTimeGame(sb, id));
  return send(await gameTimeData(sb));
}

export async function POST(req: Request) {
  if (!authorized(req)) return refuse("unauthorized", "Unauthorized", 401);
  const sb = adminClient();
  if (!sb) return refuse("not_configured", "Admin service is not configured", 503);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("bad_args", "Invalid JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("bad_args", "Send a JSON object", 400);
  return send(await gameTimeAction(sb, body as Record<string, unknown>));
}
