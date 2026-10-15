import { STAGE_FLAG } from "./stageRights";

/**
 * What the two crew voice routes share (api/crew/rooms/voice and api/crew/rooms/voice/stage): the LiveKit settings, a
 * small per-person rate limit, the id check and the stage switches. Server only (it reads the LIVEKIT_* secrets).
 */

/** A walker's heartbeat is kept this long by the room (supabase/crew_rooms.sql, _crew_room_ttl). */
export const WALKER_TTL_MS = 45_000;

export const CREW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** NEXT_PUBLIC_ROOM_STAGE_VOICE=1: staff on the stage talk to the whole room. Off by default; off changes nothing. */
export const STAGE = STAGE_FLAG;
/** ROOM_VOICE_STAGE_ONLY=1 (with STAGE): only staff standing on the stage may publish; everyone else listens. */
export const STAGE_ONLY = STAGE_FLAG && process.env.ROOM_VOICE_STAGE_ONLY === "1";

/** True when this heartbeat is still inside the walker window. */
export const isWalking = (lastSeen: string | null | undefined): boolean => !!lastSeen && Date.now() - Date.parse(lastSeen) < WALKER_TTL_MS;

export const livekit = () => {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  return serverUrl && apiKey && apiSecret ? { serverUrl, apiKey, apiSecret } : null;
};

/** LiveKit's admin API is plain https; the browser connects over wss. */
export const httpUrl = (serverUrl: string) => serverUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");

/** One limiter per route: returns true when this person has asked `max` times in the last minute. */
export function limiter(max: number, windowMs = 60_000) {
  const asked = new Map<string, number[]>();
  return (userId: string): boolean => {
    const now = Date.now();
    const recent = (asked.get(userId) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      asked.set(userId, recent);
      return true;
    }
    recent.push(now);
    asked.set(userId, recent);
    if (asked.size > 5000) for (const [id, times] of asked) if (!times.some((at) => now - at < windowMs)) asked.delete(id);
    return false;
  };
}
