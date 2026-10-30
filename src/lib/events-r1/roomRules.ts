/**
 * Small pure rules for a room's profile, shared by the fake layer, the real layer and the Create a room screen, so the three agree:
 * the hoppaz.fun/r/<slug> address (shape, reserved words, how it is made from a name) and the links (what is kept, how a handle
 * becomes a link). The database checks the same shapes (supabase/events_r1_room_profile.sql, _ev_slug_ok).
 */
import type { JoinMode, RoomLinks } from "./types";
import { SLUG_MAX, SLUG_MIN } from "./types";

/** Words that would collide with a page, so they are never a room's address. */
export const RESERVED_SLUGS = ["hq", "new", "create", "admin", "api", "host", "event", "events", "rooms", "room", "r", "map", "me", "dev", "login"];

export const JOIN_MODES: Array<{ value: JoinMode; label: string; line: string }> = [
  { value: "open", label: "Open", line: "Anyone can join and see your events" },
  { value: "ask", label: "Ask to join", line: "You approve each member" },
  { value: "invite", label: "Invite only", line: "Hidden from search. Only people with a link" },
];

/** Lowercase letters and digits with single dashes between, SLUG_MIN to SLUG_MAX long. */
export function slugShapeOk(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

export const slugOk = (slug: string): boolean => slugShapeOk(slug) && !RESERVED_SLUGS.includes(slug);

/** "South Social" -> "south-social". Always has a good shape (a name with no letters becomes "room"). */
export function slugFromName(name: string): string {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  if (!base) base = "room";
  if (base.length < SLUG_MIN) base = `${base}-room`;
  if (RESERVED_SLUGS.includes(base)) base = `${base}-room`;
  return base;
}

/** What a person typed in the address box, kept to the allowed shape as they type (spaces become dashes). */
export function cleanSlugInput(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, SLUG_MAX);
}

export const SLUG_HELP = `Use ${SLUG_MIN} to ${SLUG_MAX} letters, numbers and dashes`;

const LINK_KEYS: Array<keyof RoomLinks> = ["instagram", "x", "website", "whatsapp"];
const HOSTS: Partial<Record<keyof RoomLinks, string>> = { instagram: "https://instagram.com/", x: "https://x.com/" };

/** One link as a full https address, or "" when it cannot be one. A bare handle (@name) becomes an Instagram or X link. */
export function linkOf(key: keyof RoomLinks, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const host = HOSTS[key];
  if (host && /^@?[A-Za-z0-9_.]{1,40}$/.test(v)) return host + v.replace(/^@/, "");
  const url = /^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) ? `https://${v}` : "";
  if (!url || url.length > 300) return "";
  try {
    return new URL(url).protocol.startsWith("http") ? url : "";
  } catch {
    return "";
  }
}

/** The links kept: only the four known ones, only the ones that are real addresses. */
export function normalizeLinks(l: RoomLinks | undefined | null): RoomLinks {
  const out: RoomLinks = {};
  for (const k of LINK_KEYS) {
    const v = linkOf(k, String(l?.[k] ?? ""));
    if (v) out[k] = v;
  }
  return out;
}
