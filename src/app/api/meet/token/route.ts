import { AccessToken, TrackSource } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";
import { CREW_ID, limiter, livekit } from "@/lib/crew-room/voiceServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speed Meet voice (supabase/speed_meet.sql). The browser sends its session id; the room name comes from the database,
 * never from the browser, and only the two people of a running session get a token. A microphone only: no camera,
 * no screen, no data. The token ends with the chat (the session's ends_at plus a short grace).
 */
const slowDown = limiter(10);

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to join." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account to use Speed Meet." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!CREW_ID.test(sessionId)) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  const config = livekit();
  if (!config) return NextResponse.json({ error: "Voice is coming soon." }, { status: 503 });
  if (slowDown(user.id)) return NextResponse.json({ error: "Give it a moment, then try again." }, { status: 429 });

  const { admin } = clients;
  const { data: session } = await admin
    .from("meet_sessions")
    .select("room_name, a, b, ends_at, ended")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || (session.a !== user.id && session.b !== user.id)) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }
  const left = Date.parse(session.ends_at) - Date.now();
  if (session.ended || left <= 0) return NextResponse.json({ error: "This chat has ended." }, { status: 410 });

  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id,
    name: (profile?.display_name || "Hopper").slice(0, 32),
    ttl: Math.ceil(left / 1000) + 30,
  });
  token.addGrant({
    roomJoin: true,
    room: session.room_name,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return NextResponse.json({ serverUrl: config.serverUrl, token: await token.toJwt() }, { headers: { "Cache-Control": "no-store" } });
}
