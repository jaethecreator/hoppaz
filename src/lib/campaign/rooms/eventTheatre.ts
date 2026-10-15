import { exitProp, prop, room, wall, zone } from "./build";

/**
 * Theatre night: a proper proscenium theatre for a play, spoken word, a live show or a gala.
 *
 *   rows 1-3   back wall: the proscenium arch, the marquee (the show title), the flyer and the line-up in frames
 *   rows 4-7   the stage (x 9-20, curtains on its two edge columns), the VIP corner (left wing), the bar (right wing)
 *   rows 8-9   the front aisle, under the footlights
 *   rows 10-13 the stalls: two blocks of 8 seats by 4 rows, a 2 tile centre aisle with the red runner, 2 tile side aisles
 *   x 1-3, 26-28 box seats (raised, solid), rows 4-13
 *   row 14     the foyer wall, with three openings (side aisles and the centre aisle)
 *   rows 15-18 the foyer: coat check, box office (the exit), merch table, plants, bistro tables, posters
 *
 * Prop ids are stable: Game Time and the event sheet find things by id. The exit is `entry-map-table` (the box office).
 */
export const EVENT_THEATRE = room("event-theatre", {
  walls: [
    wall(1, 1, 28, 3),
    // The foyer wall: openings at x 4-5, 14-15 and 24-25 (the two side aisles and the centre aisle).
    wall(1, 14, 3, 1), wall(6, 14, 8, 1), wall(16, 14, 8, 1), wall(26, 14, 3, 1),
  ],
  zones: [
    zone("stage", "The Stage", "Lights go down soon", "stagewood", { x: 10, y: 4, w: 10, h: 4 }, { x: 14, y: 6 }, { x: 14, y: 4 }),
    zone("stalls", "The Stalls", "Find your row, no wahala", "redcarpet", { x: 5, y: 8, w: 20, h: 6 }, { x: 15, y: 11 }, { x: 15, y: 9 }),
    zone("boxes", "Box Seats", "Up high, full view", "wood", { x: 1, y: 4, w: 4, h: 10 }, { x: 4, y: 10 }, { x: 2, y: 8 }),
    zone("vip", "VIP Corner", "Velvet rope, small chop", "redcarpet", { x: 5, y: 4, w: 4, h: 4 }, { x: 6, y: 6 }, { x: 7, y: 5 }),
    zone("bar", "The Bar", "Cold drinks before the curtain", "wood", { x: 21, y: 4, w: 5, h: 4 }, { x: 23, y: 7 }, { x: 23, y: 5 }),
    zone("foyer", "The Foyer", "Tickets, coats and gist", "floortile", { x: 1, y: 15, w: 28, h: 4 }, { x: 15, y: 16 }, { x: 15, y: 15 }),
  ],
  props: [
    // Posters in frames on the wall, either side of the proscenium.
    prop("event-flyer", "flyer", 4, 1, 2, 3),
    prop("event-lineup", "lineup", 23, 1, 4, 3),

    // The stage: curtains on the two edge columns, a grand piano, a stool, a mic stand and a lectern.
    prop("curtain-l", "curtain", 9, 4, 1, 4, { variant: 0 }),
    prop("curtain-r", "curtain", 20, 4, 1, 4, { variant: 1 }),
    prop("grand-piano", "piano", 17, 4, 2, 2),
    prop("piano-stool", "stagestool", 17, 6, 1, 1),
    prop("mic-stand", "mic", 12, 6, 1, 1),
    prop("lectern", "lectern", 11, 4, 1, 1),

    // The stalls: rows A to D, eight seats a row, either side of the centre aisle.
    prop("seats-l-a", "seatrow", 6, 10, 8, 1, { variant: 0 }),
    prop("seats-l-b", "seatrow", 6, 11, 8, 1, { variant: 1 }),
    prop("seats-l-c", "seatrow", 6, 12, 8, 1, { variant: 2 }),
    prop("seats-l-d", "seatrow", 6, 13, 8, 1, { variant: 3 }),
    prop("seats-r-a", "seatrow", 16, 10, 8, 1, { variant: 0 }),
    prop("seats-r-b", "seatrow", 16, 11, 8, 1, { variant: 1 }),
    prop("seats-r-c", "seatrow", 16, 12, 8, 1, { variant: 2 }),
    prop("seats-r-d", "seatrow", 16, 13, 8, 1, { variant: 3 }),

    // Box seats along both side walls: raised, with a rail.
    prop("box-l-1", "boxseat", 1, 4, 3, 2, { variant: 0 }),
    prop("box-l-2", "boxseat", 1, 6, 3, 2, { variant: 0 }),
    prop("box-l-3", "boxseat", 1, 8, 3, 2, { variant: 0 }),
    prop("box-l-4", "boxseat", 1, 10, 3, 2, { variant: 0 }),
    prop("box-l-5", "boxseat", 1, 12, 3, 2, { variant: 0 }),
    prop("box-r-1", "boxseat", 26, 4, 3, 2, { variant: 1 }),
    prop("box-r-2", "boxseat", 26, 6, 3, 2, { variant: 1 }),
    prop("box-r-3", "boxseat", 26, 8, 3, 2, { variant: 1 }),
    prop("box-r-4", "boxseat", 26, 10, 3, 2, { variant: 1 }),
    prop("box-r-5", "boxseat", 26, 12, 3, 2, { variant: 1 }),

    // VIP corner (left wing): a velvet sofa, an armchair, a tea table, a rope with a way in on the left.
    prop("vip-sofa", "velvetsofa", 5, 4, 3, 1),
    prop("vip-chair", "armchair", 8, 4, 1, 1),
    prop("vip-table", "teatable", 6, 5, 1, 1),
    prop("vip-rope", "rope", 6, 7, 3, 1),
    prop("vip-plant", "plant", 4, 4, 1, 1),

    // The bar (right wing): back bar, counter, two stools.
    prop("bar-back", "backbar", 22, 4, 4, 1),
    prop("bar-counter", "barcounter", 22, 5, 4, 1),
    prop("bar-stool-1", "barstool", 22, 6, 1, 1),
    prop("bar-stool-2", "barstool", 24, 6, 1, 1),
    prop("bar-plant", "plant", 21, 4, 1, 1),

    // The foyer: coat check on the left, merch on the right, the box office (the exit) at the centre, bistro tables, plants, easels.
    prop("coat-rack", "coatrack", 1, 15, 3, 1),
    prop("coat-counter", "coatcounter", 1, 16, 3, 1),
    exitProp("ticketdesk"),
    prop("foyer-plant-1", "plant", 6, 15, 1, 1),
    prop("foyer-plant-2", "plant", 12, 15, 1, 1),
    prop("foyer-plant-3", "plant", 17, 15, 1, 1),
    prop("foyer-plant-4", "plant", 23, 15, 1, 1),
    prop("easel-l", "easel", 8, 15, 2, 1, { variant: 0 }),
    prop("easel-r", "easel", 19, 15, 2, 1, { variant: 1 }),
    prop("bistro-1", "bistro", 9, 17, 1, 1),
    prop("bistro-2", "bistro", 20, 17, 1, 1),
    prop("merch-rack", "merchrack", 26, 15, 3, 1),
    prop("merch-counter", "merchcounter", 26, 16, 3, 1),
  ],
});
