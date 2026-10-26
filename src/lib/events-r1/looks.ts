/**
 * Looks: how a host's event page or room page is dressed (build brief 3a and 3b). One small record per event or room:
 * the pack (background behaviour), Day or Night, and the tint (hue and chroma). `auto` true means the tint was read from the
 * cover (or the room's logo) and follows it when the picture changes; false means the host picked a swatch.
 *
 * Kept apart from the event and room rows so nothing in Release 1 changes shape: fake keeps them in localStorage
 * ("hz.r1.looks.v1"), real calls ev_get_look / ev_set_look (supabase/events_r1_looks.sql, a draft for Ola). A missing look is
 * normal (every event made before this): screens fall back to reading the cover.
 */
import type { Mood, Tint } from "../tint";
import { FALLBACK_TINT } from "../tint";

export type PackId = "minimal" | "glow" | "confetti" | "detty" | "owambe";
export const PACKS: Array<{ id: PackId; name: string }> = [
  { id: "minimal", name: "Minimal" },
  { id: "glow", name: "Glow" },
  { id: "confetti", name: "Confetti" },
  { id: "detty", name: "Detty December" },
  { id: "owambe", name: "Owambe" },
];

export type LookOwner = "event" | "room";

export type Look = {
  pack: PackId;
  mood: Mood;
  tint: Tint;
  /** true: the tint comes from the cover or logo. */
  auto: boolean;
  /** Walkable 2D room (free during launch, see entitlements). Missing means on with the first template. */
  two_d?: { on: boolean; template: string };
};

export const DEFAULT_LOOK: Look = { pack: "minimal", mood: "night", tint: FALLBACK_TINT, auto: true, two_d: { on: true, template: "clubhouse" } };

export interface LooksApi {
  get(owner: LookOwner, id: string): Promise<Look | null>;
  /** Host of the event, or owner or admin of the room. */
  set(owner: LookOwner, id: string, look: Look): Promise<void>;
}

const isPack = (v: unknown): v is PackId => PACKS.some((p) => p.id === v);

/** A stored look, checked field by field (old or hand-edited records never break a page). */
export function parseLook(v: unknown): Look | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const hue = Number(o.hue ?? (o.tint as Record<string, unknown> | undefined)?.hue);
  const chroma = Number(o.chroma ?? (o.tint as Record<string, unknown> | undefined)?.chroma);
  const td = o.two_d as Record<string, unknown> | undefined;
  return {
    pack: isPack(o.pack) ? o.pack : "minimal",
    mood: o.mood === "day" ? "day" : "night",
    tint: Number.isFinite(hue) && Number.isFinite(chroma) ? { hue, chroma: Math.max(0, Math.min(0.37, chroma)) } : FALLBACK_TINT,
    auto: o.auto !== false,
    two_d: td && typeof td === "object" ? { on: td.on !== false, template: typeof td.template === "string" ? td.template : "clubhouse" } : undefined,
  };
}

/** The flat shape saved to the database (jsonb). */
export const lookJson = (l: Look) => ({ pack: l.pack, mood: l.mood, hue: l.tint.hue, chroma: l.tint.chroma, auto: l.auto, two_d: l.two_d ?? null });

const KEY = "hz.r1.looks.v1";
const readAll = (): Record<string, unknown> => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const fakeLooks: LooksApi = {
  async get(owner, id) {
    return parseLook(readAll()[`${owner}:${id}`]);
  },
  async set(owner, id, look) {
    if (typeof window === "undefined") return;
    const all = readAll();
    all[`${owner}:${id}`] = lookJson(look);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* full storage: the page falls back to the cover */
    }
  },
};
