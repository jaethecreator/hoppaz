import { CLUBHOUSE, clubhouseWidth, type CampaignLayout } from "./layout";
import { lagosHqLayout } from "./rooms/lagosHq";
import { EVENT_INDOOR } from "./rooms/eventIndoor";
import { EVENT_THEATRE } from "./rooms/eventTheatre";
import { EVENT_POOL } from "./rooms/eventPool";
import { EVENT_OUTDOOR } from "./rooms/eventOutdoor";
import { EVENT_TECH } from "./rooms/eventTech";
import { HOTSPOT_YABA } from "./rooms/hotspotYaba";
import { HOTSPOT_LEKKI } from "./rooms/hotspotLekki";
import { HOTSPOT_VICTORIA_ISLAND } from "./rooms/hotspotVictoriaIsland";
import { HOTSPOT_IKEJA } from "./rooms/hotspotIkeja";
import { HOTSPOT_IKOYI } from "./rooms/hotspotIkoyi";
import { HOTSPOT_AJAH } from "./rooms/hotspotAjah";
import { HOTSPOT_ALIMOSHO } from "./rooms/hotspotAlimosho";
import { HOTSPOT_OJO_BADAGRY } from "./rooms/hotspotOjoBadagry";
import { HOTSPOT_IKORODU } from "./rooms/hotspotIkorodu";

/**
 * Room templates: the places a crew can hold its meeting. A crew room points at one by key
 * (`crew_rooms.template`, supabase/crew_rooms.sql); the walkable grid of each (template, width) pair is exported to
 * the database by scripts/crew-room/export-layouts.mjs, so a template added here needs that run and a SQL load before
 * a crew can pick it.
 *
 * Crew templates (ROOM_TEMPLATES, what the MANAGE picker shows): the clubhouse and Lagos HQ. Each one has its own backdrop
 * component (ClubhouseArt draws the clubhouse and nothing else; see roomArt.tsx) and its own stable prop ids.
 *
 * Place rooms (PLACE_ROOMS, below) are not crew templates and never reach the picker: the event rooms (a template per kind
 * of night, opened when an event is posted) and the hotspot rooms (one per hotspot, unique to its real place). They are
 * addressed by key (`event-theatre`, `hotspot-yaba`), have one fixed size and are looked up with placeRoom().
 *
 * Rules for every template: stable unique prop ids (scripts/rooms/check-campaign.mjs), valid walls and a spawn, an
 * `entry-map-table` door prop at the entrance (the way out to the map) and a `courtyard-fountain` prop at the
 * centre (the featured event's sticker sits on it).
 */
export type RoomWidth = 30 | 36;

export type RoomTemplate = {
  /** Stored in crew_rooms.template and the layouts table. Never renamed. */
  key: string;
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
  {
    key: "lagos-hq",
    name: "Lagos HQ",
    description: "A bright Lagos street by the lagoon: a stage under the billboard, a market, a bus stop, a suya spot and a road of danfos and okadas.",
    thumbnail: "/templates/lagos-hq.jpg",
    layout: (width) => lagosHqLayout(width),
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

// ---- Place rooms: events and hotspots ---------------------------------------------------------------------------------

export type PlaceRoomKind = "event" | "hotspot";

export type PlaceRoom = {
  /** The layout's id and the key of its art (roomArt.tsx). Never renamed. */
  key: string;
  kind: PlaceRoomKind;
  name: string;
  /** One line for a card. */
  description: string;
  layout: CampaignLayout;
  /** Hotspots: the slug in supabase/hotspot_zones.sql. */
  slug?: string;
};

/** The event templates, opened when an event is posted. The flyer and the line-up hang on the walls (`event-flyer`, `event-lineup`). */
export const EVENT_ROOMS: PlaceRoom[] = [
  { key: "event-indoor", kind: "event", name: "Indoor party", description: "A club night: DJ stage, dance floor, bar, VIP booths and a lounge by the door.", layout: EVENT_INDOOR },
  { key: "event-theatre", kind: "event", name: "Theatre night", description: "A proper theatre: a stage with curtains, rows of seats, a balcony and a foyer with the flyer.", layout: EVENT_THEATRE },
  { key: "event-pool", kind: "event", name: "Pool party", description: "A pool party: the pool in the middle, loungers, a DJ deck and a cabana bar.", layout: EVENT_POOL },
  { key: "event-outdoor", kind: "event", name: "Outdoor party", description: "An open-air party: a stage truck, tents, suya and jollof stalls and string lights over the lawn.", layout: EVENT_OUTDOOR },
  { key: "event-tech", kind: "event", name: "Tech event", description: "A tech meetup: a stage with a screen, rows of chairs, demo tables and a coffee corner.", layout: EVENT_TECH },
];

/** The hotspot rooms that have art. A hotspot without one is not here, and the app falls back to the crossroads screen. */
export const HOTSPOT_ROOMS: PlaceRoom[] = [
  { key: "hotspot-yaba", kind: "hotspot", slug: "yaba", name: "Jibowu", description: "The Yaba hotspot room.", layout: HOTSPOT_YABA },
  { key: "hotspot-lekki", kind: "hotspot", slug: "lekki", name: "Lekki Phase 1", description: "The Lekki hotspot room.", layout: HOTSPOT_LEKKI },
  { key: "hotspot-victoria-island", kind: "hotspot", slug: "victoria-island", name: "Adeola Odeku", description: "The Victoria Island hotspot room.", layout: HOTSPOT_VICTORIA_ISLAND },
  { key: "hotspot-ikeja", kind: "hotspot", slug: "ikeja", name: "Allen Roundabout", description: "The Ikeja hotspot room.", layout: HOTSPOT_IKEJA },
  { key: "hotspot-ikoyi", kind: "hotspot", slug: "ikoyi", name: "Bourdillon", description: "The Bourdillon hotspot room.", layout: HOTSPOT_IKOYI },
  { key: "hotspot-ajah", kind: "hotspot", slug: "ajah", name: "Ajah", description: "The Ajah hotspot room.", layout: HOTSPOT_AJAH },
  { key: "hotspot-alimosho", kind: "hotspot", slug: "alimosho", name: "Ikotun", description: "The Ikotun hotspot room.", layout: HOTSPOT_ALIMOSHO },
  { key: "hotspot-ojo-badagry", kind: "hotspot", slug: "ojo-badagry", name: "Iyana Iba", description: "The Iyana Iba hotspot room.", layout: HOTSPOT_OJO_BADAGRY },
  { key: "hotspot-ikorodu", kind: "hotspot", slug: "ikorodu", name: "Ikorodu Garage", description: "The Ikorodu Garage hotspot room.", layout: HOTSPOT_IKORODU },
];

export const PLACE_ROOMS: PlaceRoom[] = [...EVENT_ROOMS, ...HOTSPOT_ROOMS];
/** The same list under the name the render and check scripts use. */
export const ALL_PLACE_ROOMS = PLACE_ROOMS;

/** A place room by key, or null (never the clubhouse: an unknown key is the caller's to handle). */
export function placeRoom(key: string | null | undefined): PlaceRoom | null {
  return PLACE_ROOMS.find((r) => r.key === key) ?? null;
}
/** The hotspot room for a hotspot slug, or null while that hotspot has no room of its own. */
export function hotspotRoom(slug: string | null | undefined): PlaceRoom | null {
  return HOTSPOT_ROOMS.find((r) => r.slug === slug) ?? null;
}
/** The event room for an event template key (`event-theatre`, ...), or null. */
export function eventRoom(key: string | null | undefined): PlaceRoom | null {
  return EVENT_ROOMS.find((r) => r.key === key) ?? null;
}
