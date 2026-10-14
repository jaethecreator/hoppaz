import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to join a room." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account before joining a room." }, { status: 401 });
  const body = await request.json().catch(() => null) as { roomId?: unknown } | null;
  const roomId = typeof body?.roomId === "string" ? body.roomId : "";
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return NextResponse.json({ error: "Room not found." }, { status: 404 });

  const { admin } = clients;
  const [{ data: member }, { data: room }, { data: profile }] = await Promise.all([
    admin.from("queer_memberships").select("user_id").eq("user_id", user.id).eq("status", "active").maybeSingle(),
    admin.from("queer_rooms").select("room_name").eq("id", roomId).eq("status", "live").maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!member) return NextResponse.json({ error: "This room is for invited community members." }, { status: 403 });
  if (!room) return NextResponse.json({ error: "Room not found or it has ended." }, { status: 404 });

  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) return NextResponse.json({ error: "Live audio is being set up. Try again later." }, { status: 503 });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: (profile?.display_name || "Hopper").slice(0, 32),
    ttl: "15m",
  });
  token.addGrant({ roomJoin: true, room: room.room_name, canPublish: true, canSubscribe: true, canPublishData: true });
  return NextResponse.json({ serverUrl, token: await token.toJwt() });
}
