import { exitProp, prop, room, zone } from "./build";
import { hotspotRoomData } from "../../rooms/hotspotRooms";

/**
 * Victoria Island: Adeola Odeku at night. The one hotspot room set after dark: a dark street with neon, valets and SUVs.
 *
 * North side (top): four venue facades shoulder to shoulder, left to right Terra Kulture, RSVP, Eko Hotels, The Place, each
 * with its own bit of pavement in front (ropes, a patio, a drop-off). The road runs under them with a zebra crossing, and in
 * the middle of the road sits the hero: the neon ADEOLA ODEKU gantry over the strip's rope-and-stanchion queue and a valet
 * podium. South side (bottom): the kerb, palms, a suya grill on the right corner, two billboards and the way out (the city
 * map signpost) on the spawn's left.
 *
 * Zone names come from src/lib/rooms/hotspotRooms.ts (the real venue names). Prop ids are stable: never rename one.
 */
const DATA = hotspotRoomData("victoria-island");
const FALLBACK = ["Terra Kulture", "RSVP", "Eko Hotels", "The Place"];
const venue = (i: number) => DATA?.landmarks[i]?.name ?? FALLBACK[i];

export const HOTSPOT_VICTORIA_ISLAND = room("hotspot-victoria-island", {
  walls: [],
  zones: [
    zone("hero", DATA?.junction ?? "Adeola Odeku", "The queue never ends", "road", { x: 8, y: 8, w: 14, h: 7 }, { x: 15, y: 14 }, { x: 15, y: 13 }),
    zone("venue-1", venue(0), "Stage lights and stories", "paving", { x: 1, y: 5, w: 7, h: 3 }, { x: 4, y: 6 }, { x: 4, y: 5 }),
    zone("venue-2", venue(1), "Glass, rope and a long queue", "paving", { x: 8, y: 5, w: 6, h: 3 }, { x: 11, y: 6 }, { x: 11, y: 5 }),
    zone("venue-3", venue(2), "Valets and a big entrance", "paving", { x: 14, y: 5, w: 8, h: 3 }, { x: 18, y: 6 }, { x: 18, y: 5 }),
    zone("venue-4", venue(3), "Patio, lights, good food", "paving", { x: 22, y: 5, w: 7, h: 3 }, { x: 25, y: 6 }, { x: 25, y: 5 }),
    zone("suya", "Suya Corner", "Smoke, pepper, one more stick", "paving", { x: 22, y: 14, w: 7, h: 3 }, { x: 23, y: 16 }, { x: 24, y: 14 }),
  ],
  props: [
    // The four venue facades, left to right.
    prop("venue-1", "facade", 1, 1, 7, 4),
    prop("venue-2", "facade", 8, 1, 6, 4),
    prop("venue-3", "facade", 14, 1, 8, 4),
    prop("venue-4", "facade", 22, 1, 7, 4),
    // The hero: the neon gantry over the queue and the valet podium, in the middle of the road.
    prop("hero", "gantry", 9, 9, 12, 4),
    // Venue forecourts.
    prop("poster-rail", "posterrail", 6, 5, 2, 1),
    prop("rope-rsvp-l", "rope", 9, 5, 1, 2),
    prop("rope-rsvp-r", "rope", 12, 5, 1, 2),
    prop("valet-stand", "valet", 15, 5, 2, 1),
    prop("patio-table-1", "patiotable", 23, 5, 1, 1),
    prop("patio-table-2", "patiotable", 26, 5, 1, 1, { variant: 1 }),
    prop("menu-board", "menuboard", 24, 7, 1, 1),
    // Street lamps (with their light pools) down both kerbs; two carry the street name plates.
    prop("lamp-1", "streetlamp", 6, 7, 1, 1, { variant: 1 }),
    prop("lamp-2", "streetlamp", 14, 7, 1, 1),
    prop("lamp-3", "streetlamp", 21, 7, 1, 1),
    prop("lamp-4", "streetlamp", 28, 7, 1, 1, { variant: 2 }),
    prop("lamp-5", "streetlamp", 6, 14, 1, 1),
    prop("lamp-6", "streetlamp", 21, 14, 1, 1),
    // Palms in planters.
    prop("palm-1", "planterpalm", 1, 7, 1, 1),
    prop("palm-2", "planterpalm", 28, 5, 1, 1, { variant: 1 }),
    prop("palm-3", "planterpalm", 1, 14, 1, 1, { variant: 1 }),
    prop("palm-4", "planterpalm", 10, 14, 1, 1),
    prop("palm-5", "planterpalm", 28, 14, 1, 1),
    prop("palm-6", "planterpalm", 11, 16, 1, 1, { variant: 1 }),
    prop("palm-7", "planterpalm", 17, 16, 1, 1),
    // Parked SUVs (dark, glossy) and a keke.
    prop("suv-1", "suv", 2, 8, 3, 2, { variant: 0 }),
    prop("suv-2", "suv", 24, 8, 3, 2, { variant: 4 }),
    prop("suv-3", "suv", 4, 12, 3, 2, { variant: 2 }),
    prop("suv-4", "suv", 21, 12, 3, 2, { variant: 3 }),
    prop("suv-5", "suv", 7, 15, 3, 2, { variant: 5 }),
    prop("keke-1", "keke", 26, 12, 2, 1),
    prop("keke-2", "keke", 19, 16, 2, 1),
    // Billboards on the bottom edge.
    prop("billboard-1", "billboard", 1, 17, 5, 2, { variant: 0 }),
    prop("billboard-2", "billboard", 24, 17, 5, 2, { variant: 1 }),
    // The suya corner.
    prop("suya-grill", "suyagrill", 23, 15, 2, 1),
    prop("suya-stool-1", "stool", 25, 16, 1, 1),
    prop("suya-stool-2", "stool", 26, 15, 1, 1),
    // The way out: the city map signpost, two tiles left of the spawn.
    exitProp("mapboard"),
  ],
});
