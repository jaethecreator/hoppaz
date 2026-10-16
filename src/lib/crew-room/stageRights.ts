/**
 * Who may publish a microphone in a crew room, and who is on the stage. PURE: no imports, so the server routes, the
 * room and scripts/crew-room/check-stage-mix.mjs all use the same rules, and nothing here needs LiveKit or a database.
 *
 * Staff on the stage talk to the whole room (docs/ROOM-GAME-DESIGN.md 14.4). The database decides who is on the stage
 * (supabase/crew_stage_voice.sql, _crew_room_stage_list: a live heartbeat and a server-checked tile inside the stage
 * zone). The routes turn that into LiveKit rights with these functions. The browser never decides any of it.
 */

/** NEXT_PUBLIC_ROOM_STAGE_VOICE=1. Off by default: the room's voice is then exactly what it was. */
export const STAGE_FLAG = process.env.NEXT_PUBLIC_ROOM_STAGE_VOICE === "1";

/** At most this many staff speak to the whole room at once. The same number as the SQL list's limit. */
export const MAX_STAGE = 3;

export type CrewRole = "owner" | "admin" | "member";
export const isStaffRole = (role: string | null | undefined): boolean => role === "owner" || role === "admin";

/**
 * May this token publish a microphone track?
 *   flag off          a walker may (today's behaviour)
 *   flag on, mixed    a walker may (people near you hear you), as before
 *   flag on, stage    only staff standing on the stage right now (everyone else listens)
 * `onStage` is the database's answer, never the browser's.
 */
export function tokenCanPublish(a: { stageFlag: boolean; stageOnly: boolean; walking: boolean; isStaff: boolean; onStage: boolean }): boolean {
  if (!a.stageFlag || !a.stageOnly) return a.walking;
  return a.walking && a.isStaff && a.onStage;
}

/**
 * What the stage route does when someone asks to start (on) or stop (off) speaking to the whole room.
 *   stage         they are now (or stay) a stage speaker: the "stage" attribute is set
 *   canPublish    the LiveKit permission to set. In stage-only rooms it is exactly `stage`; in mixed rooms a walker keeps
 *                 their microphone for the people near them
 *   full          they asked and were refused only because three others are already speaking
 */
export function stageDecision(a: { on: boolean; isStaff: boolean; list: readonly string[]; me: string; walking: boolean; stageOnly: boolean }): { stage: boolean; canPublish: boolean; full: boolean } {
  const onStage = a.list.includes(a.me);
  const stage = a.on && a.isStaff && onStage;
  const full = a.on && a.isStaff && !onStage && a.list.length >= MAX_STAGE;
  return { stage, canPublish: a.stageOnly ? stage : a.walking || stage, full };
}

/**
 * The sweep: LiveKit participants whose "stage" attribute is still up although the database no longer has them on the
 * stage. The route clears the attribute (and, in stage-only rooms, the publish right).
 */
export function staleStage(participants: readonly { identity: string; attributes?: Record<string, string> | null }[], list: readonly string[]): string[] {
  return participants.filter((p) => p.attributes?.stage === "1" && !list.includes(p.identity)).map((p) => p.identity);
}

/**
 * Parse the answer of crew_room_stage. Anything unexpected is "nobody on stage, not staff", so a missing or odd answer
 * never shows a pill or a button.
 */
export function parseStage(data: unknown): { stage: string[]; isStaff: boolean; isOwner: boolean; admins: string[] } {
  const none = { stage: [] as string[], isStaff: false, isOwner: false, admins: [] as string[] };
  if (!data || typeof data !== "object") return none;
  const d = data as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  return { stage: ids(d.stage).slice(0, MAX_STAGE), isStaff: d.is_staff === true, isOwner: d.is_owner === true, admins: ids(d.admins) };
}
