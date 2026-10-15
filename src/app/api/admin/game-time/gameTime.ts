import type { SupabaseClient } from "@supabase/supabase-js";
import { roomTemplate, templateFor, type RoomWidth } from "@/lib/campaign/templates";

/**
 * The staff side of Game Time (supabase/game_time.sql, docs/GAME-TIME.md) for the admin desk's route
 * (src/app/api/admin/game-time/route.ts): what the desk reads, the checks on what it sends, and the
 * actions it can take. They end in the `admin_game_time_*` calls of the database, which only the service
 * role can run, so the staff token on the route is the gate. Plain data in and out (no Next types), so a
 * script can run them against a local database.
 *
 * The checks here are the friendly first line. The database checks everything again, against the room
 * layout it holds (crew_room_layouts), so a caller that skips this file still cannot hide a box in a
 * rug, a wall or the door, or in a room the crew no longer has.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type GameTimeObject = { id: string; label: string; kind: string; x: number; y: number; w: number; h: number };
export type RoomInfo = { template: string; width: RoomWidth; objects: GameTimeObject[] };
export type Bad = { error: { reason: string; message: string } };
export type Done = { status: number; json: Record<string, unknown> };

/** Every reason the database or this file can give, with the HTTP status and the line staff read. */
const REASONS: Record<string, { status: number; message: string }> = {
  bad_args: { status: 400, message: "That request is not shaped right." },
  unknown_field: { status: 400, message: "That request holds a field Game Time does not know." },
  bad_crew: { status: 400, message: "Pick a crew that exists." },
  bad_title: { status: 400, message: "The title needs 2 to 60 characters." },
  bad_times: { status: 400, message: "Check the times: say when it opens (or START NOW), and close it after that, within 7 days." },
  in_past: { status: 400, message: "That game would already be over." },
  too_long: { status: 400, message: "A Game Time runs 7 days at most." },
  bad_codes: { status: 400, message: "Add 1 to 10 ticket codes, one per line, 80 characters at most each." },
  dup_codes: { status: 400, message: "Two of the codes are the same." },
  bad_objects: { status: 400, message: "Pick the room objects that may hide a box." },
  unknown_objects: { status: 400, message: "One of those objects is not in this room, or cannot hide a box." },
  not_enough_spots: { status: 400, message: "Every code needs its own object: pick at least as many objects as codes." },
  bad_relocate: { status: 400, message: "Minutes before a box moves on: 0 to 720 (0 means never)." },
  bad_tiles: { status: 400, message: "Hot and warm are distances in tiles: hot above 0, warm at least as big, up to 100 and 200." },
  bad_campaign: { status: 400, message: "The campaign key is 80 characters or fewer, on one line." },
  room_changed: { status: 409, message: "The crew changed its room. Reload and pick the objects again." },
  overlaps: { status: 409, message: "This crew already has a Game Time in that window." },
  not_found: { status: 404, message: "That Game Time does not exist." },
  ended: { status: 409, message: "That Game Time is over and cannot change." },
  time_up: { status: 409, message: "That Game Time ran out of time. Move its closing time to bring it back." },
  already_open: { status: 409, message: "It has already opened, so it can no longer move its opening." },
  codes_locked: { status: 409, message: "Someone already won, so the codes are locked." },
  campaign_locked: { status: 409, message: "Someone already won, so the campaign key is locked." },
};

export function gameTimeError(reason: string): Done {
  const r = REASONS[reason];
  return { status: r?.status ?? 400, json: { ok: false, error: reason, message: r?.message ?? reason } };
}
const bad = (reason: string, message?: string): Bad => ({ error: { reason, message: message ?? REASONS[reason]?.message ?? reason } });
const isBad = (v: unknown): v is Bad => !!v && typeof v === "object" && "error" in v;

/** "Mixing desk" from "mixing-desk". */
const label = (id: string) => id.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The room objects that may hide a box: the solid props of the template at that width, never the door
 * (the map table leaves for the map). An unknown template is the clubhouse. The ids are the room's own
 * and never change.
 */
export function roomInfo(template: string | null | undefined, width: number | null | undefined): RoomInfo {
  const w: RoomWidth = width === 36 ? 36 : 30;
  const layout = roomTemplate(template, w);
  return {
    template: templateFor(template).key,
    width: w,
    objects: layout.props
      .filter((p) => p.solid && p.kind !== "maptable")
      .map((p) => ({ id: p.id, label: label(p.id), kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h })),
  };
}

/** The room a crew has now. A crew that never opened its room has the default one. */
export async function crewRoom(sb: SupabaseClient, crew: string): Promise<RoomInfo | null> {
  const { data: c, error: ce } = await sb.from("crews").select("id").eq("id", crew).maybeSingle();
  if (ce || !c) return null;
  const { data } = await sb.from("crew_rooms").select("template,width").eq("crew_id", crew).maybeSingle();
  return roomInfo((data as { template?: string } | null)?.template, (data as { width?: number } | null)?.width);
}

/**
 * A time as an ISO string. "2026-10-16T20:00" (what a datetime-local field gives, no zone) is Lagos time;
 * anything with a zone (Z or +01:00) is taken as written. Anything else is refused.
 */
export function whenOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(s);
  if (!naive && !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return null;
  const d = new Date(naive ? `${naive[1]}T${naive[2]}${naive[3] ?? ":00"}+01:00` : s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** 1 to 10 ticket codes from a list, or from `codes_text` (one per line). Trimmed, blanks dropped, no duplicates. */
export function codesOf(body: Record<string, unknown>): string[] | Bad {
  const raw = Array.isArray(body.codes) ? body.codes : typeof body.codes_text === "string" ? body.codes_text.split(/\r?\n/) : typeof body.codes === "string" ? body.codes.split(/\r?\n/) : null;
  if (!raw) return bad("bad_codes");
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") return bad("bad_codes");
    const v = c.trim();
    if (!v) continue;
    if (v.length > 80 || /[\u0000-\u001f\u007f]/.test(v)) return bad("bad_codes");
    if (out.some((o) => o.toLowerCase() === v.toLowerCase())) return bad("dup_codes", `"${v}" is in the list twice.`);
    out.push(v);
  }
  return out.length >= 1 && out.length <= 10 ? out : bad("bad_codes");
}

/** The chosen objects (ids, or {id}) checked against the room, each with the rectangle the room gives it. */
export function objectsOf(raw: unknown, room: RoomInfo): GameTimeObject[] | Bad {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 80) return bad("bad_objects");
  const out: GameTimeObject[] = [];
  for (const o of raw) {
    const id = typeof o === "string" ? o : o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string" ? (o as { id: string }).id : null;
    if (!id) return bad("bad_objects");
    if (out.some((x) => x.id === id)) return bad("bad_objects", `"${id}" is in the list twice.`);
    const hit = room.objects.find((x) => x.id === id);
    if (!hit) return bad("unknown_objects", `"${id}" cannot hide a box in this room.`);
    out.push(hit);
  }
  return out;
}

const whole = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const tiles = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 10) / 10 : null;
};

const CREATE_FIELDS = ["action", "crew_id", "title", "opens_at", "closes_at", "duration_minutes", "start_now", "codes", "codes_text", "objects", "relocate_minutes", "campaign_key", "hot_tiles", "warm_tiles"];
const UPDATE_FIELDS = ["action", "id", "title", "opens_at", "closes_at", "codes", "codes_text", "objects", "relocate_minutes", "campaign_key", "hot_tiles", "warm_tiles"];

/** The knobs both create and update take. Fills `args`; returns a refusal or null. */
function knobs(b: Record<string, unknown>, args: Record<string, unknown>): Bad | null {
  if ("title" in b) {
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (t.length < 2 || t.length > 60) return bad("bad_title");
    args.title = t;
  }
  if ("relocate_minutes" in b) {
    const n = whole(b.relocate_minutes, 0, 720);
    if (n === null) return bad("bad_relocate");
    args.relocate_minutes = n;
  }
  if ("hot_tiles" in b) {
    const n = tiles(b.hot_tiles, 100);
    if (n === null) return bad("bad_tiles");
    args.hot_tiles = n;
  }
  if ("warm_tiles" in b) {
    const n = tiles(b.warm_tiles, 200);
    if (n === null) return bad("bad_tiles");
    args.warm_tiles = n;
  }
  if ("campaign_key" in b) {
    const k = typeof b.campaign_key === "string" ? b.campaign_key.trim() : "";
    if (k.length > 80 || /[\u0000-\u001f\u007f]/.test(k)) return bad("bad_campaign");
    args.campaign_key = k; // empty means the crew's own limit
  }
  return null;
}

/**
 * What staff send to make a game, turned into the database's arguments.
 *   { action: "create", crew_id, title, codes: [..] | codes_text: "one\nper line",
 *     objects: [ids], start_now: true | opens_at, closes_at | duration_minutes,
 *     relocate_minutes?, campaign_key?, hot_tiles?, warm_tiles? }
 * A game never opens by accident: START NOW (start_now true) or an explicit opens_at.
 */
export function parseCreate(b: Record<string, unknown>, room: RoomInfo): { args: Record<string, unknown> } | Bad {
  for (const k of Object.keys(b)) if (!CREATE_FIELDS.includes(k)) return bad("unknown_field", `"${k}" is not a Game Time field.`);
  if (!isUuid(b.crew_id)) return bad("bad_crew");
  const args: Record<string, unknown> = { crew_id: b.crew_id };
  if (!("title" in b)) return bad("bad_title");
  const k = knobs(b, args);
  if (k) return k;
  if ("start_now" in b && typeof b.start_now !== "boolean") return bad("bad_args", "start_now is true or false.");
  if (b.start_now === true) {
    if (b.opens_at != null && b.opens_at !== "") return bad("bad_times", "START NOW and an opening time cannot both be given.");
    args.start_now = true;
  } else {
    const o = whenOf(b.opens_at);
    if (!o) return bad("bad_times", "Say when it opens, or START NOW.");
    args.opens_at = o;
  }
  const hasClose = b.closes_at != null && b.closes_at !== "";
  const hasDuration = b.duration_minutes != null && b.duration_minutes !== "";
  if (hasClose === hasDuration) return bad("bad_times", "Give a closing time or a length in minutes, not both and not neither.");
  if (hasClose) {
    const c = whenOf(b.closes_at);
    if (!c) return bad("bad_times");
    args.closes_at = c;
  } else {
    const n = whole(b.duration_minutes, 1, 10080);
    if (n === null) return bad("bad_times", "A Game Time lasts 1 minute to 7 days.");
    args.duration_minutes = n;
  }
  const codes = codesOf(b);
  if (isBad(codes)) return codes;
  args.codes = codes;
  const objects = objectsOf(b.objects, room);
  if (isBad(objects)) return objects;
  if (objects.length < codes.length) return bad("not_enough_spots");
  args.objects = objects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
  args.room_template = room.template;
  args.room_width = room.width;
  return { args };
}

/**
 * What staff send to change a game, turned into the database's patch: title, opens_at (before it opens),
 * closes_at, relocate_minutes, hot_tiles, warm_tiles, campaign_key (until someone has won), objects and
 * codes (codes until someone has won). `room` is the crew's room now; it is only used for `objects`.
 */
export function parseUpdate(b: Record<string, unknown>, room: RoomInfo | null): { id: string; patch: Record<string, unknown> } | Bad {
  for (const k of Object.keys(b)) if (!UPDATE_FIELDS.includes(k)) return bad("unknown_field", `"${k}" cannot be changed.`);
  if (!isUuid(b.id)) return bad("not_found");
  const patch: Record<string, unknown> = {};
  const k = knobs(b, patch);
  if (k) return k;
  if ("opens_at" in b) {
    const o = whenOf(b.opens_at);
    if (!o) return bad("bad_times");
    patch.opens_at = o;
  }
  if ("closes_at" in b) {
    const c = whenOf(b.closes_at);
    if (!c) return bad("bad_times");
    patch.closes_at = c;
  }
  if ("codes" in b || "codes_text" in b) {
    const codes = codesOf(b);
    if (isBad(codes)) return codes;
    patch.codes = codes;
  }
  if ("objects" in b) {
    if (!room) return bad("bad_crew");
    const objects = objectsOf(b.objects, room);
    if (isBad(objects)) return objects;
    patch.objects = objects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    patch.room_template = room.template;
    patch.room_width = room.width;
  }
  return Object.keys(patch).length ? { id: b.id, patch } : bad("bad_args", "Nothing to change.");
}

type Answer = { ok: boolean; reason?: string; [k: string]: unknown };

async function call(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Done> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const missing = error.code === "PGRST202" || /does not exist|schema cache/i.test(error.message);
    return { status: missing ? 503 : 500, json: { ok: false, error: missing ? "not_loaded" : "database", message: missing ? "Game Time is not loaded in this database (run supabase/game_time.sql)." : `Database error: ${error.message}` } };
  }
  const a = data as Answer | null;
  if (!a || a.ok !== true) return gameTimeError(String(a?.reason ?? "bad_args"));
  return { status: 200, json: a };
}

/** Everything the desk needs on load: the games (without codes), the crews with their rooms, and each room's objects. */
export async function gameTimeData(sb: SupabaseClient): Promise<Done> {
  const list = await call(sb, "admin_game_time_list", {});
  if (list.status !== 200) return list;
  const [crews, rooms] = await Promise.all([
    sb.from("crews").select("id,name,verified,visibility").order("name").limit(500),
    sb.from("crew_rooms").select("crew_id,template,width").limit(2000),
  ]);
  const failed = [crews, rooms].find((r) => r.error);
  if (failed?.error) return { status: 500, json: { ok: false, error: "database", message: `Database error: ${failed.error.message}` } };
  const roomOf = new Map((rooms.data ?? []).map((r) => [r.crew_id as string, r as { template: string; width: number }]));
  const keys = new Map<string, RoomInfo>();
  const crewRows = (crews.data ?? []).map((c) => {
    const r = roomOf.get(c.id as string);
    const info = roomInfo(r?.template, r?.width);
    keys.set(`${info.template}:${info.width}`, info);
    return { id: c.id, name: c.name, verified: c.verified, visibility: c.visibility, template: info.template, width: info.width };
  });
  return {
    status: 200,
    json: { ok: true, games: list.json.games, crews: crewRows, objects: Object.fromEntries([...keys].map(([k, v]) => [k, v.objects])) },
  };
}

export const gameTimeGame = (sb: SupabaseClient, id: string): Promise<Done> => (isUuid(id) ? call(sb, "admin_game_time_status", { p_id: id }) : Promise.resolve(gameTimeError("not_found")));

export async function gameTimeWinners(sb: SupabaseClient, id: string | null): Promise<Done> {
  if (id !== null && !isUuid(id)) return gameTimeError("not_found");
  return call(sb, "admin_game_time_winners", { p_id: id });
}

/** The actions of the desk: create, update, start_now, close. */
export async function gameTimeAction(sb: SupabaseClient, b: Record<string, unknown>): Promise<Done> {
  const action = String(b.action ?? "");
  if (action === "create") {
    if (!isUuid(b.crew_id)) return gameTimeError("bad_crew");
    const room = await crewRoom(sb, b.crew_id);
    if (!room) return gameTimeError("bad_crew");
    const p = parseCreate(b, room);
    if (isBad(p)) return { status: REASONS[p.error.reason]?.status ?? 400, json: { ok: false, error: p.error.reason, message: p.error.message } };
    return call(sb, "admin_game_time_create", { p_args: p.args });
  }
  if (action === "update") {
    if (!isUuid(b.id)) return gameTimeError("not_found");
    let room: RoomInfo | null = null;
    if ("objects" in b) {
      const g = await call(sb, "admin_game_time_status", { p_id: b.id });
      if (g.status !== 200) return g;
      room = await crewRoom(sb, String((g.json.game as { crew_id: string }).crew_id));
    }
    const p = parseUpdate(b, room);
    if (isBad(p)) return { status: REASONS[p.error.reason]?.status ?? 400, json: { ok: false, error: p.error.reason, message: p.error.message } };
    return call(sb, "admin_game_time_update", { p_id: p.id, p_patch: p.patch });
  }
  if (action === "start_now" || action === "close") {
    if (!isUuid(b.id)) return gameTimeError("not_found");
    return call(sb, action === "start_now" ? "admin_game_time_start_now" : "admin_game_time_close", { p_id: b.id });
  }
  return { status: 400, json: { ok: false, error: "bad_args", message: "Unknown action. Use create, update, start_now or close." } };
}

/** A spreadsheet cell: quoted, and a leading = + - @ made harmless so a handle cannot run as a formula. */
const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** The winners as CSV: game, crew, handle, name, email, code, object, won_at (oldest first). */
export function winnersCsv(rows: Record<string, unknown>[]): string {
  const head = ["game", "crew", "handle", "name", "email", "code", "object", "won_at"];
  const lines = rows.map((r) => [r.title, r.crew_name, r.handle, r.name, r.email, r.code, r.object, r.won_at].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
