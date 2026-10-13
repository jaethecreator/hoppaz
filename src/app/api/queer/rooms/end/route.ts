import { RoomServiceClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { roomId?: unknown } | null;
  const roomId = typeof body?.roomId === "string" ? body.roomId : "";
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return NextResponse.json({ error: "Room not found." }, { status: 404 });

  const { admin } = clients;
  const [{ data: room }, { data: membership }] = await Promise.all([
    admin.from("queer_rooms").select("room_name,host_id").eq("id", roomId).eq("status", "live").maybeSingle(),
    admin.from("queer_memberships").select("role").eq("user_id", user.id).eq("status", "active").maybeSingle(),
  ]);
  if (!membership) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!room) return NextResponse.json({ ok: true });
  if (room.host_id !== user.id && membership.role !== "moderator" && membership.role !== "admin") {
    return NextResponse.json({ error: "Only the host can end this room." }, { status: 403 });
  }

  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) return NextResponse.json({ error: "Live audio is not configured yet." }, { status: 503 });
  try {
    const livekit = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    if ((await livekit.listRooms([room.room_name])).length) await livekit.deleteRoom(room.room_name);
  } catch (e) {
    console.warn("[hoppaz] could not close queer audio room:", e);
    return NextResponse.json({ error: "Could not close the live room." }, { status: 502 });
  }
  const { error } = await admin.from("queer_rooms").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", roomId);
  if (error) return NextResponse.json({ error: "The audio ended, but the room list could not update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
