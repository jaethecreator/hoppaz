/** Ids the database wants are uuids. The screens may hold a slug (an event's short link) or "hq" (Lagos HQ's address). */
import { client, rpc, UUID } from "./core";

const clean = (s: string) => String(s).trim();

/** An event's uuid from a uuid or a slug. A slug the viewer cannot open is "Event not found". */
export async function eventIdOf(idOrSlug: string): Promise<string> {
  const k = clean(idOrSlug);
  if (UUID.test(k)) return k.toLowerCase();
  const j = await rpc<{ id?: string } | null>("ev_get_event", { p_id_or_slug: k });
  if (!j?.id) throw new Error("Event not found");
  return String(j.id);
}

let hqId: string | null = null;

/** Lagos HQ's room id (made on first ask; every account joins it). Null when there is no staff account to own it yet. */
export async function hqRoomId(): Promise<string | null> {
  if (hqId) return hqId;
  const id = await rpc<string | null>("ev_ensure_hq");
  hqId = id ? String(id) : null;
  return hqId;
}

/**
 * A room's uuid from a uuid, "hq", or its address (hoppaz.fun/r/<slug>, ev_room_by_slug in events_r1_room_profile.sql). Until that file is run
 * a room's slug is its id, so an address that is not a uuid is simply not a room. Null when it is not a room.
 */
export async function roomIdOf(idOrSlug: string): Promise<string | null> {
  const k = clean(idOrSlug);
  if (k === "hq") return hqRoomId();
  if (UUID.test(k)) return k.toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(k)) return null;
  const { data, error } = await client().rpc("ev_room_by_slug", { p_slug: k });
  return error || !data ? null : String(data);
}
