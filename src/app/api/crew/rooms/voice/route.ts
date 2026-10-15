import { AccessToken, TrackSource } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Area voice for a crew room, on Ola's LiveKit pattern (api/queer/rooms/token). One LiveKit room per crew, named by
 * the server from the crew id, never taken from the client. The browser asks here for a 15 minute token and then
 * connects to LiveKit itself.
 *
 *   GET   { enabled }. True when LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are all set. The room reads this
 *         one answer for both the chip and the welcome line, so nobody is promised voice that would answer 503.
 *   POST  { crewId } with a bearer session. 401 without a session or a permanent account, 404 for a bad id, 403 for
 *         someone outside the crew, 503 while voice is not set up, otherwise { serverUrl, token, room, canPublish,
 *         owners }.
 *
 * Who may talk. canPublish only for a walker: someone with a live place in the room right now (a crew_room_presence row
 * the 45 s heartbeat is keeping). Someone watching a full room has none, so they listen and cannot be heard. Members
 * publish a microphone track only: no camera, no screen, no data. Only the crew's owner may update their own
 * attributes, which is how they go live to the whole room from the stage (the "live" attribute, see RoomVoice.tsx).
 *
 * What the token does not do: LiveKit does not know about the room's areas. Who a listener subscribes to is decided in
 * the browser from the room's positions, so area voice is as private as an honest client, not as private as area text
 * (which the database enforces). Server-enforced subscriptions are the next step (docs/CREW-ROOMS.md).
 */

/** A walker's heartbeat is kept this long by the room (supabase/crew_rooms.sql, _crew_room_ttl). */
const WALKER_TTL_MS = 45_000;
/** A token is cheap, but nobody needs more than a handful a minute. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const asked = new Map<string, number[]>();

function slowDown(userId: string) {
  const now = Date.now();
  const recent = (asked.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    asked.set(userId, recent);
    return true;
  }
  recent.push(now);
  asked.set(userId, recent);
  if (asked.size > 5000) for (const [id, times] of asked) if (!times.some((at) => now - at < WINDOW_MS)) asked.delete(id);
  return false;
}

const livekit = () => {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  return serverUrl && apiKey && apiSecret ? { serverUrl, apiKey, apiSecret } : null;
};

export async function GET() {
  return NextResponse.json({ enabled: !!livekit() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to join the voice room." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account before joining the voice room." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { crewId?: unknown } | null;
  const crewId = typeof body?.crewId === "string" ? body.crewId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(crewId)) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }

  const { admin } = clients;
  const [{ data: member }, { data: owners }, { data: walker }, { data: profile }] = await Promise.all([
    admin.from("crew_members").select("role").eq("crew_id", crewId).eq("user_id", user.id).maybeSingle(),
    admin.from("crew_members").select("user_id").eq("crew_id", crewId).eq("role", "owner"),
    admin.from("crew_room_presence").select("last_seen").eq("crew_id", crewId).eq("user_id", user.id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!member) return NextResponse.json({ error: "Voice is for people in this crew." }, { status: 403 });

  const config = livekit();
  if (!config) return NextResponse.json({ error: "Voice is coming soon." }, { status: 503 });
  if (slowDown(user.id)) return NextResponse.json({ error: "Give it a moment, then try again." }, { status: 429 });

  const walking = !!walker && Date.now() - Date.parse(walker.last_seen) < WALKER_TTL_MS;
  const isOwner = member.role === "owner";
  const room = `crew-${crewId}`;
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id,
    name: (profile?.display_name || "Hopper").slice(0, 32),
    ttl: "15m",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canSubscribe: true,
    canPublish: walking,
    canPublishSources: walking ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canUpdateOwnMetadata: isOwner,
  });
  return NextResponse.json(
    { serverUrl: config.serverUrl, token: await token.toJwt(), room, canPublish: walking, owners: (owners ?? []).map((o) => o.user_id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
