import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to start a room." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account before starting a room." }, { status: 401 });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "Live audio is being set up. Try again later." }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as { title?: unknown; topic?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 100) : "";
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 240) : "";
  if (title.length < 2) return NextResponse.json({ error: "Add a room title." }, { status: 400 });

  const { admin } = clients;
  const { data: member } = await admin.from("queer_memberships").select("user_id").eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!member) return NextResponse.json({ error: "This is for invited community members." }, { status: 403 });
  const { data: room, error } = await admin.from("queer_rooms")
    .insert({ title, topic, host_id: user.id }).select("id,title,topic,host_id,started_at").single();
  if (error || !room) return NextResponse.json({ error: "You already have a live room, or it could not be started." }, { status: 409 });
  return NextResponse.json({ room });
}
