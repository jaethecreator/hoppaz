import { exitProp, prop, room, wall, zone } from "./build";
import { hotspotRoomData } from "../../rooms/hotspotRooms";

/**
 * Ikotun, in Alimosho: a market grid on a busy late morning.
 *
 *   rows 1-4    the frontage: The Place (top left), lock-up shops, the covered market shed (the hero), lock-up shops, KAF Mall
 *   rows 5-6    the top lane, under the shed's apron
 *   rows 7-12   the market itself: blocks of umbrella stalls and stacks of bales, a lane two tiles wide between every row and
 *               column, a wing either side of the middle block, generators humming at the ends of the rows
 *   rows 13-15  the plaza (the Hop billboard, a hawker's basin, a pole with its wires), the terminal on the left and Brainfield
 *               Event Centre on the right
 *   rows 16-18  the road: coaches, danfo and keke parked nose to tail, the exit board, the spawn and the Hop bus in its bay
 *
 * Venues, left to right: Iyana Ipaja Terminal (bottom left), The Place (top left), KAF Mall (top right), Brainfield Event
 * Centre (bottom right). A lane runs up the inside of each wing (x 8 and 9, x 20 and 21) and along the top (rows 5 and 6): the
 * Hop route follows it, door to door. The central aisle (x 14 and 15) runs from the spawn straight up to the shed.
 *
 * Prop ids are stable (Game Time hides boxes by id, other features find the exit by id): never rename one.
 */
const data = hotspotRoomData("alimosho");
const names = data?.landmarks.map((l) => l.name) ?? ["Iyana Ipaja Terminal", "The Place", "KAF Mall", "Brainfield Event Centre"];
const heroName = data?.hero.name ?? "Ikotun Market";

export const HOTSPOT_ALIMOSHO = room("hotspot-alimosho", {
  walls: [
    wall(1, 1, 1, 4), // the corrugated fence at the end of The Place
    wall(8, 1, 2, 4), // lock-up shops, left of the shed
    wall(20, 1, 2, 4), // lock-up shops, right of the shed
  ],
  zones: [
    zone("hero", heroName, "Umbrellas, bales and loud sellers", "concrete", { x: 10, y: 5, w: 10, h: 8 }, { x: 15, y: 9 }, { x: 14, y: 6 }),
    zone("venue-1", names[0], "Coaches and danfo, loading", "asphalt", { x: 1, y: 13, w: 9, h: 6 }, { x: 7, y: 16 }, { x: 5, y: 16 }),
    zone("venue-2", names[1], "Big screens, a band, snooker", "wood", { x: 2, y: 1, w: 7, h: 6 }, { x: 7, y: 5 }, { x: 4, y: 5 }),
    zone("venue-3", names[2], "Shops, food, a film", "floortile", { x: 21, y: 1, w: 8, h: 6 }, { x: 23, y: 5 }, { x: 26, y: 5 }),
    zone("venue-4", names[3], "A hall, a pool, a kids' corner", "paving", { x: 21, y: 11, w: 8, h: 8 }, { x: 23, y: 16 }, { x: 26, y: 16 }),
    zone("hop", "Hop Bay", "The bus never waits", "asphalt", { x: 15, y: 15, w: 5, h: 4 }, { x: 17, y: 16 }, { x: 17, y: 15 }),
  ],
  props: [
    // The covered market shed and the four venues.
    prop("hero", "marketshed", 10, 1, 10, 4),
    prop("venue-1", "terminal", 1, 13, 7, 3),
    prop("venue-2", "theplace", 2, 1, 6, 4),
    prop("venue-3", "kafmall", 22, 1, 7, 4),
    prop("venue-4", "eventcentre", 23, 12, 6, 4),

    // The middle block: two rows of umbrella stalls with stacks of bales between them, the aisle at x 14 and 15.
    prop("stall-1", "umbrellastall", 10, 7, 2, 2, { variant: 0 }),
    prop("bales-1", "bales", 12, 7, 2, 2, { variant: 0 }),
    prop("stall-2", "umbrellastall", 16, 7, 2, 2, { variant: 1 }),
    prop("stall-3", "umbrellastall", 18, 7, 2, 2, { variant: 2 }),
    prop("stall-4", "umbrellastall", 10, 11, 2, 2, { variant: 3 }),
    prop("stall-5", "umbrellastall", 12, 11, 2, 2, { variant: 1 }),
    prop("bales-2", "bales", 16, 11, 2, 2, { variant: 1 }),
    prop("stall-6", "umbrellastall", 18, 11, 2, 2, { variant: 0 }),

    // The left wing, with a lane of its own at x 3 and 4 between the two rows.
    prop("stall-7", "umbrellastall", 1, 7, 2, 2, { variant: 2 }),
    prop("stall-8", "umbrellastall", 5, 7, 2, 2, { variant: 3 }),
    prop("stall-9", "umbrellastall", 1, 11, 2, 2, { variant: 1 }),
    prop("bales-3", "bales", 3, 11, 2, 2, { variant: 2 }),
    prop("stall-10", "umbrellastall", 5, 11, 2, 2, { variant: 0 }),

    // The right wing: one long row under the lock-ups' shade.
    prop("stall-11", "umbrellastall", 22, 7, 2, 2, { variant: 1 }),
    prop("stall-12", "umbrellastall", 24, 7, 2, 2, { variant: 0 }),
    prop("stall-13", "umbrellastall", 26, 7, 2, 2, { variant: 2 }),

    // Generators at the ends of the rows, hawkers' basins of pure water, a crate, a tree for shade.
    prop("generator-1", "generator", 7, 12, 1, 1),
    prop("generator-2", "generator", 22, 11, 1, 1),
    prop("generator-3", "generator", 10, 13, 1, 1),
    prop("sachets-1", "sachets", 12, 14, 1, 1),
    prop("sachets-2", "sachets", 28, 7, 1, 1),
    prop("crate-1", "crate", 28, 8, 1, 1),
    prop("tree-1", "tree", 28, 11, 1, 1),

    // The plaza: the Hop sign, a pole with its wires.
    prop("billboard", "billboard", 16, 13, 4, 2),
    prop("pole-1", "pole", 10, 15, 1, 1),
    prop("pole-2", "pole", 28, 16, 1, 1),

    // The road: coaches and danfo parked nose to tail, the Hop bus in its bay beside the spawn.
    prop("coach-1", "coach", 1, 18, 4, 1),
    prop("danfo-1", "danfo", 5, 18, 3, 1, { variant: 0 }),
    prop("keke-1", "keke", 8, 18, 2, 1, { variant: 0 }),
    prop("danfo-2", "danfo", 10, 18, 3, 1, { variant: 1 }),
    prop("hop-bus", "hopbus", 16, 18, 4, 1),
    prop("keke-2", "keke", 22, 18, 2, 1, { variant: 1 }),
    prop("danfo-3", "danfo", 25, 18, 3, 1, { variant: 2 }),

    // The way out: the city map board on the road's edge.
    exitProp("mapboard"),
  ],
});
