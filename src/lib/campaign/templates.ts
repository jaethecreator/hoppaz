import { CLUBHOUSE, clubhouseWidth, type CampaignLayout } from "./layout";

/**
 * Room templates: the places a crew can hold its meeting. A crew room points at one by key
 * (`crew_rooms.template`, supabase/crew_rooms.sql); the walkable grid of each (template, width) pair is exported to
 * the database by scripts/crew-room/export-layouts.mjs, so a template added here needs that run and a SQL load before
 * a crew can pick it.
 *
 * Shipped today: the clubhouse. The lounge and the event templates come later, each with its own backdrop
 * component (ClubhouseArt draws the clubhouse and nothing else) and its own stable prop ids.
 *
 * Rules for every template: stable unique prop ids (scripts/rooms/check-campaign.mjs), valid walls and a spawn, an
 * `entry-map-table` door prop at the entrance (the way out to the map) and a `courtyard-fountain` prop at the
 * centre (the featured event's sticker sits on it).
 */
export type RoomWidth = 30 | 36;

export type RoomTemplate = {
  /** Stored in crew_rooms.template and the layouts table. Never renamed. */
  key: "clubhouse";
  name: string;
  /** One line for the picker card in MANAGE CREW. */
  description: string;
  /** A picture under /public for the picker card. */
  thumbnail: string;
  /** The layout at a width (30 compact, 36 roomy). */
  layout: (width: RoomWidth) => CampaignLayout;
};

export const ROOM_WIDTHS: RoomWidth[] = [30, 36];
export const DEFAULT_TEMPLATE = "clubhouse";

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    key: "clubhouse",
    name: "The Clubhouse",
    description: "Six corners round a courtyard: a stage up top, a studio, a lounge, a gallery and booths to chat in.",
    thumbnail: "/templates/clubhouse.jpg",
    layout: (width) => (width === 30 ? CLUBHOUSE : clubhouseWidth(width)),
  },
];

export const TEMPLATE_KEYS: string[] = ROOM_TEMPLATES.map((t) => t.key);

/** The template for a stored key. An unknown or missing key is the clubhouse, so a stale row still opens a room. */
export function templateFor(key: string | null | undefined): RoomTemplate {
  return ROOM_TEMPLATES.find((t) => t.key === key) ?? ROOM_TEMPLATES[0];
}

/** The layout a room walks in: the template's, at the room's width (30 when none is given). */
export function roomTemplate(key: string | null | undefined, width: RoomWidth = 30): CampaignLayout {
  return templateFor(key).layout(width === 36 ? 36 : 30);
}
