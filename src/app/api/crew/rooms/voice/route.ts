import { AccessToken, TrackSource } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";
import { isStaffRole, tokenCanPublish } from "@/lib/crew-room/stageRights";
import { CREW_ID, STAGE, STAGE_ONLY, isWalking, limiter, livekit } from "@/lib/crew-room/voiceServer";

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
 *         owners } (and mode "mixed" or "stage" when stage voice is on).
 *
 * Who may talk. canPublish only for a walker: someone with a live place in the room right now (a crew_room_presence row
 * the 45 s heartbeat is keeping). Someone watching a full room has none, so they listen and cannot be heard. Members
 * publish a microphone track only: no camera, no screen, no data. Only the crew's owner may update their own
 * attributes, which is how they go live to the whole room from the stage (the "live" attribute, see RoomVoice.tsx).
 *
 * Stage voice (NEXT_PUBLIC_ROOM_STAGE_VOICE=1, docs/ROOM-GAME-DESIGN.md 14.4) replaces that: nobody may update their own
 * attributes, the owner and the admins are staff, and voice/stage/route.ts puts a staff member on the stage for the
 * whole room only while the database says their walker stands on the stage. With ROOM_VOICE_STAGE_ONLY=1 the token
 * lets only staff on the stage publish at all.
 *
 * What the token does not do: LiveKit does not know about the room's areas. Who a listener subscribes to is decided in
 * the browser from the room's positions, so area voice is as private as an honest client, not as private as area text
 * (which the database enforces). Server-enforced subscriptions are the next step (docs/CREW-ROOMS.md).
 */

/** A token is cheap, but nobody needs more than a handful a minute. */
const slowDown = limiter(12);

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
  if (!CREW_ID.test(crewId)) {
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

  const walking = isWalking(walker?.last_seen);
  const isOwner = member.role === "owner";
  // Stage voice (flag, see voiceServer.ts): staff are the owner and the admins; "on the stage" is the server's own
  // reading of their walker's tile (supabase/crew_stage_voice.sql), never the browser's word.
  const isStaff = isStaffRole(member.role);
  let onStage = false;
  if (STAGE && isStaff) {
    const { data: list } = await admin.rpc("_crew_room_stage_list", { p_crew: crewId, p_viewer: null });
    onStage = Array.isArray(list) && list.includes(user.id);
  }
  const canPublish = tokenCanPublish({ stageFlag: STAGE, stageOnly: STAGE_ONLY, walking, isStaff, onStage });
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
    canPublish,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    // With stage voice on, the "stage" attribute is set by the server only (voice/stage/route.ts); nobody sets their own.
    canUpdateOwnMetadata: STAGE ? false : isOwner,
  });
  return NextResponse.json(
    {
      serverUrl: config.serverUrl,
      token: await token.toJwt(),
      room,
      canPublish,
      owners: (owners ?? []).map((o) => o.user_id),
      ...(STAGE ? { mode: STAGE_ONLY ? "stage" : "mixed", isStaff } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
