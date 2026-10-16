import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";
import { isStaffRole, stageDecision, staleStage } from "@/lib/crew-room/stageRights";
import { CREW_ID, STAGE, STAGE_ONLY, isWalking, limiter, livekit } from "@/lib/crew-room/voiceServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff on the stage talk to the whole room (docs/ROOM-GAME-DESIGN.md 14.4). DARK: with NEXT_PUBLIC_ROOM_STAGE_VOICE
 * off this answers 404 and does nothing.
 *
 *   POST { crewId, on } with a bearer session: "I am on the stage, let the room hear me" (on) or "stop" (off).
 *   404 flag off or a bad id, 401 no session or no permanent account, 403 not the owner or an admin of that crew, 503
 *   voice not set up, 429 too many, 409 the caller is not connected to the voice room yet, otherwise
 *   { ok, stage, full, canPublish }.
 *
 * The server decides. It asks the database who is on the stage (_crew_room_stage_list: a live heartbeat and a
 * server-checked tile inside the stage zone), never the browser. `ok` is true only when the caller is staff AND in that
 * list. Then it writes the answer into LiveKit with the service key: the caller's "stage" attribute and their publish
 * right (a participant cannot change either themselves, see voice/route.ts). Finally it sweeps: anyone whose "stage"
 * attribute is still up although the database no longer has them on the stage is cleared (and, in a stage-only room,
 * loses the right to publish). The listeners also check the database list before they subscribe, so the sweep is the
 * second layer, not the first.
 */

const slowDown = limiter(20);

const httpUrl = (url: string) => url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
const notFound = (e: unknown) => /not.?found|404/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

export async function POST(request: Request) {
  if (!STAGE) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to use the stage." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account to use the stage." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { crewId?: unknown; on?: unknown } | null;
  const crewId = typeof body?.crewId === "string" ? body.crewId : "";
  if (!CREW_ID.test(crewId)) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  const on = body?.on === true;

  const { admin } = clients;
  const [{ data: member }, { data: walker }] = await Promise.all([
    admin.from("crew_members").select("role").eq("crew_id", crewId).eq("user_id", user.id).maybeSingle(),
    admin.from("crew_room_presence").select("last_seen").eq("crew_id", crewId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!member || !isStaffRole(member.role)) return NextResponse.json({ error: "The stage is for this crew's staff." }, { status: 403 });
  const config = livekit();
  if (!config) return NextResponse.json({ error: "Voice is coming soon." }, { status: 503 });
  if (slowDown(user.id)) return NextResponse.json({ error: "Give it a moment, then try again." }, { status: 429 });

  const { data: rows } = await admin.rpc("_crew_room_stage_list", { p_crew: crewId, p_viewer: null });
  const list = Array.isArray(rows) ? rows.filter((id): id is string => typeof id === "string") : [];
  const decision = stageDecision({ on, isStaff: true, list, me: user.id, walking: isWalking(walker?.last_seen), stageOnly: STAGE_ONLY });

  const room = `crew-${crewId}`;
  const lk = new RoomServiceClient(httpUrl(config.serverUrl), config.apiKey, config.apiSecret);
  const permission = (canPublish: boolean) => ({
    canSubscribe: true,
    canPublish,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canUpdateMetadata: false,
  });
  try {
    await lk.updateParticipant(room, user.id, { attributes: { stage: decision.stage ? "1" : "" }, permission: permission(decision.canPublish) });
  } catch (e) {
    if (notFound(e)) return NextResponse.json({ error: "Join the voice room first." }, { status: 409 });
    console.warn("[hoppaz] stage voice: could not update participant:", e);
    return NextResponse.json({ error: "Voice isn't working right now." }, { status: 502 });
  }

  // The sweep. Best effort: a failure here never fails the caller's own request.
  try {
    for (const identity of staleStage(await lk.listParticipants(room), list)) {
      if (identity === user.id) continue;
      await lk.updateParticipant(room, identity, { attributes: { stage: "" }, ...(STAGE_ONLY ? { permission: permission(false) } : {}) }).catch(() => undefined);
    }
  } catch (e) {
    console.warn("[hoppaz] stage voice: sweep failed:", e);
  }

  return NextResponse.json(
    { ok: decision.stage, stage: list, full: decision.full, canPublish: decision.canPublish },
    { headers: { "Cache-Control": "no-store" } },
  );
}
