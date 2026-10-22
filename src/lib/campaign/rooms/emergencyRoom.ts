import type { CampaignLayout } from "../layout";
import { floorProp, prop, room, wall, zone } from "./build";

/**
 * Emergency Room by SOS: a weekly electronic music night in Lagos (Afrohouse, Afrotech, Gqom, Techno, Deep House). A crew room
 * template (key `emergency-room`) in a light rave venue with their brand: brick red, bone and charcoal on a light grey floor.
 *
 * A hub and spokes. The deck is the hub in the centre, a light corridor ring runs round it, light-framed bays sit round the edge
 * and floor guide lines lead to them. Left: EXPERIENCES (their Instagram, the zone's pill opens it) and AFROTECH HEALING (a calm
 * lounge). Right: MERCH (clothes). The back wall: PERFORMERS ON DUTY (the next event's DJs), the HALL OF FAME and their logo in a
 * lightbox. ENTRANCE (where tickets will be) beside the gate. A small lit NEXT UP plinth at the foot of the deck is the
 * `courtyard-fountain` prop, where the crew's featured event sticker sits.
 *
 * Prop ids are stable: main-stage (the deck), tickets-desk (Entrance), brand-page (Experiences), merch, doctors-on-duty
 * (Performers on Duty), hall-of-fame, courtyard-fountain, entry-map-table. The zone id `stage` is the deck (stage voice).
 *
 * Two widths. 30 is the base. 36 keeps every section and adds three tiles of floor each side of the middle: the centre (the hub,
 * the ring, the Hall of Fame, the entrance and the gate) moves three tiles right, the right side six, as the clubhouse does.
 *
 * Zone tags: the engine draws a tag above each zone's plaque tile. Every plaque sits on empty floor in front of its section, a
 * row below the counter and a row above the stop, so a tag never sits beside the sign it repeats. The deck has no sign of its
 * own for the same reason: its tag names it.
 *
 * Walkable x 2..W-3, y 4..18. Lanes: the ring round the hub, a lane between the bays, the foyer in front.
 * Walk from the gate: the entrance desk beside it, along the guide lines into the ring, the deck, then the bays and the back wall.
 */

/** Their page and handle. A tap on the Experiences zone's pill opens it (the zone's `link`, below). */
export const EMERGENCY_ROOM_INSTAGRAM = "https://www.instagram.com/emergencyroombysos/";

/** The layout at a width (30 or 36). */
export function emergencyRoomLayout(width: 30 | 36): CampaignLayout {
  const c = (width - 30) / 2; // 0 or 3: the extra floor on each side of the middle
  const m = c; // middle shift
  const r = 2 * c; // right shift
  const layout = room("emergency-room", {
    spawn: { x: 15 + c, y: 17 },
    walls: [wall(1, 1, width - 2, 3), wall(1, 4, 1, 15), wall(width - 2, 4, 1, 15)],
    zones: [
      zone("stage", "THE DECK", "DJ is on", "stagedeck", { x: 10 + m, y: 7, w: 10, h: 7 }, { x: 14 + m, y: 13 }, { x: 13 + m, y: 13 }),
      zone("entrance", "ENTRANCE", "Tickets here", "concrete", { x: 14 + m, y: 14, w: 9, h: 5 }, { x: 18 + m, y: 18 }, { x: 18 + m, y: 18 }),
      zone("experiences", "EXPERIENCES", "Follow on Instagram", "concrete", { x: 2, y: 7, w: 5, h: 6 }, { x: 4, y: 12 }, { x: 4, y: 12 }, { label: "OPEN INSTAGRAM", url: EMERGENCY_ROOM_INSTAGRAM }),
      zone("healing", "AFROTECH HEALING", "Sit back, breathe", "concrete", { x: 2, y: 13, w: 5, h: 6 }, { x: 4, y: 18 }, { x: 4, y: 18 }),
      zone("merch", "MERCH", "The drip", "concrete", { x: 23 + r, y: 7, w: 5, h: 6 }, { x: 25 + r, y: 12 }, { x: 25 + r, y: 12 }),
      zone("hall-of-fame", "HALL OF FAME", "Past nights and awards", "concrete", { x: 9 + m, y: 2, w: 12, h: 5 }, { x: 14 + m, y: 6 }, { x: 14 + m, y: 6 }),
      zone("performers", "PERFORMERS ON DUTY", "Next event's DJs", "concrete", { x: 2, y: 2, w: 6, h: 5 }, { x: 5, y: 6 }, { x: 5, y: 6 }),
    ],
    props: [
      prop("er-sign", "erlightbox", 22 + r, 1, 6, 3),
      prop("hall-of-fame", "ravehall", 9 + m, 1, 12, 3),
      prop("doctors-on-duty", "performers", 2, 1, 6, 3),

      floorProp("corridor-ring", "wardring", 9 + m, 6, 12, 8),
      prop("main-stage", "hub", 13 + m, 8, 4, 4),
      floorProp("dj-booth", "erbooth", 13 + m, 8, 4, 1),
      prop("hub-speaker-l", "erspeaker", 11 + m, 8, 1, 3),
      prop("hub-speaker-r", "erspeaker", 18 + m, 8, 1, 3),
      // The featured event's sticker sits on this plinth (FountainSticker finds the prop of kind fountain).
      prop("courtyard-fountain", "fountain", 14 + m, 12, 2, 1),

      prop("brand-page", "experiences", 2, 7, 5, 4),
      prop("recovery", "healing", 2, 13, 5, 4),
      prop("merch", "merchrack", 23 + r, 7, 5, 4),
      prop("tickets-desk", "entrancedesk", 16 + m, 14, 4, 3),

      prop("plant-r1", "plant", 24 + r, 13, 1, 1),
      prop("plant-r2", "plant", 26 + r, 14, 1, 1),
      prop("lounge-bench", "erbench", 23 + r, 15, 3, 1),
      prop("gate-plant-l", "plant", 10 + m, 17, 1, 1),
      prop("gate-plant-r", "plant", 22 + m, 17, 1, 1),
      // The way out, two tiles left of the spawn, drawn as the gate.
      prop("entry-map-table", "ergate", 13 + m, 16, 2, 1),
    ],
  });
  // room() builds the 30 wide frame; the wide room is the same layout on a wider grid.
  return width === 30 ? layout : { ...layout, grid: { ...layout.grid, width } };
}

export const EMERGENCY_ROOM = emergencyRoomLayout(30);
export const EMERGENCY_ROOM_WIDE = emergencyRoomLayout(36);
