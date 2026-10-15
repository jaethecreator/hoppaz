import { hotspotRoomData } from "../../rooms/hotspotRooms";
import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Ikorodu Garage: the motor park at the end of the long road, a bright afternoon turning to evening.
 *
 * A yard, not a street. The garage is the middle of the room: a long BRT-style loading island (the `hero`, with its
 * gantry sign) with a loading lane on each side and a row of buses parked nose to tail along the far edge of each lane
 * (danfos and BRT, and the Hop bus first in the queue at the end of the south row). The yard is walled along the top by the
 * compound wall (the hoarding), and four corners hold the venues, numbered as in the place data:
 *
 *   top left      LASUSTECH (a university gate)         top right     Dream Park Cinemas
 *   bottom left   The Place Lounge (a night frontage)   bottom right  Ikorodu Ferry Terminal (pier, a boat, a bit of lagoon)
 *
 * Between the corners the strips are a market: stalls, hawkers with oranges, a queue pen, a keke rank. The paved plaza
 * under the yard holds the spawn and the map signpost (the exit).
 *
 *   rows 1-3    compound wall (centre), the venue backs (corners)
 *   rows 4-5    the north apron; the venue doors on row 5 either side
 *   row 6       bus row A: danfo, danfo, BRT, with gaps to cross through
 *   rows 7-8    loading lane A
 *   rows 9-11   the garage (hero)
 *   rows 12-13  loading lane B (the Hop route runs along row 12)
 *   row 14      bus row B: BRT, danfo, the Hop bus
 *   rows 15-18  the plaza: the exit and the spawn
 *
 * Walkable lanes are two tiles wide or more; column 7 and column 22 are the flank walkways round the island.
 * Prop ids are stable (Game Time hides boxes by id, other features find the exit by id): never rename one.
 */
const data = hotspotRoomData("ikorodu");
const names = data?.landmarks.map((l) => l.name) ?? ["LASUSTECH", "The Place Lounge", "Dream Park Cinemas", "Ikorodu Ferry Terminal"];
const heroName = data?.hero.name ?? "Ikorodu Garage";

export const HOTSPOT_IKORODU = room("hotspot-ikorodu", {
  walls: [
    // The compound wall along the top of the yard (the hoarding), between the university gate and the cinema.
    wall(8, 1, 14, 3),
    // The lagoon below the ferry pier.
    wall(23, 16, 6, 3),
  ],
  zones: [
    zone("hero", heroName, "Buses load, conductors shout", "asphalt", { x: 7, y: 4, w: 16, h: 8 }, { x: 15, y: 8 }, { x: 15, y: 7 }),
    zone("venue-1", names[0], "A campus gate on the long road", "paving", { x: 1, y: 1, w: 6, h: 9 }, { x: 4, y: 5 }, { x: 4, y: 6 }),
    zone("venue-2", names[1], "Lounge, late, finger food", "deck", { x: 1, y: 10, w: 6, h: 9 }, { x: 4, y: 14 }, { x: 4, y: 15 }),
    zone("venue-3", names[2], "Films, pool and play", "paving", { x: 23, y: 1, w: 6, h: 9 }, { x: 25, y: 5 }, { x: 25, y: 6 }),
    zone("venue-4", names[3], "Boats over the lagoon", "deck", { x: 23, y: 11, w: 6, h: 5 }, { x: 25, y: 14 }, { x: 25, y: 15 }),
    zone("hop-bay", "Hop Bay", "First bus in the queue", "asphalt", { x: 16, y: 12, w: 7, h: 3 }, { x: 19, y: 12 }, { x: 19, y: 13 }),
  ],
  props: [
    // The ferry pier is deck the avatars walk on.
    floorProp("pier", "pier", 23, 14, 6, 2),

    // The garage: the loading island with its gantry sign, between the two loading lanes.
    prop("hero", "garage", 9, 9, 12, 3),

    // The four venue corners, left to right as in the place data.
    prop("venue-1", "lasu", 1, 1, 7, 4),
    prop("venue-2", "lounge", 1, 11, 6, 3),
    prop("venue-3", "cinema", 22, 1, 7, 4),
    prop("venue-4", "ferry", 23, 11, 6, 3),

    // Bus row A (north of lane A): gaps at x 11, x 15 (a conductor's board) and x 21 to cross through. All face right.
    prop("danfo-1", "danfo", 8, 6, 3, 1, { variant: 0 }),
    prop("danfo-2", "danfo", 12, 6, 3, 1, { variant: 1 }),
    prop("brt-1", "brt", 16, 6, 5, 1, { variant: 3 }),
    prop("board-1", "board", 15, 6, 1, 1, { variant: 0 }),

    // Bus row B (south of lane B): the Hop bus is first in the queue, at the head of the row.
    prop("brt-2", "brt", 8, 14, 5, 1, { variant: 1 }),
    prop("board-2", "board", 13, 14, 1, 1, { variant: 1 }),
    prop("danfo-3", "danfo", 14, 14, 3, 1, { variant: 2 }),
    prop("hop-bus", "hopbus", 18, 14, 4, 1),

    // The market strip on the left: a queue pen, stalls, a hawker with oranges and a keke rank.
    prop("queue-pen-1", "queuepen", 2, 8, 4, 2),
    prop("stall-1", "stall", 1, 6, 2, 1, { variant: 0 }),
    prop("umbrella-1", "umbrella", 5, 6, 1, 1, { variant: 0 }),
    prop("orange-seller-1", "orangeseller", 1, 10, 2, 1),
    prop("keke-1", "keke", 3, 10, 2, 1, { variant: 0 }),

    // The market strip on the right.
    prop("stall-2", "stall", 23, 6, 2, 1, { variant: 1 }),
    prop("stall-3", "stall", 27, 6, 2, 1, { variant: 2 }),
    prop("umbrella-2", "umbrella", 26, 8, 1, 1, { variant: 1 }),
    prop("keke-2", "keke", 23, 9, 2, 1, { variant: 1 }),
    prop("orange-seller-2", "orangeseller", 27, 9, 2, 1),

    // Palms and street lamps.
    prop("palm-1", "palm", 1, 5, 1, 1),
    prop("palm-2", "palm", 28, 5, 1, 1),
    prop("palm-3", "palm", 8, 18, 1, 1),
    prop("palm-4", "palm", 21, 18, 1, 1),
    prop("lamp-1", "streetlamp", 8, 5, 1, 1),
    prop("lamp-2", "streetlamp", 21, 5, 1, 1),
    prop("lamp-3", "streetlamp", 11, 16, 1, 1),
    prop("lamp-4", "streetlamp", 20, 16, 1, 1),

    // The plaza: the ticket booth, benches, a stack of tyres and a bin.
    prop("ticket-booth", "booth", 17, 16, 2, 1),
    prop("bench-1", "bench", 9, 17, 2, 1),
    prop("bench-2", "bench", 17, 18, 2, 1),
    prop("tyres-1", "tyres", 21, 15, 1, 1),
    prop("bin-1", "bin", 10, 15, 1, 1),

    // The Place Lounge's patio.
    prop("plant-1", "plant", 1, 14, 1, 1),
    prop("plant-2", "plant", 6, 14, 1, 1),
    prop("cocktail-1", "cocktail", 2, 16, 1, 1),
    prop("cocktail-2", "cocktail", 5, 16, 1, 1, { variant: 1 }),

    // The ferry, moored along the pier in the lagoon.
    prop("boat-1", "boat", 23, 16, 5, 2),

    // The way out: the map signpost on the plaza.
    exitProp("mapboard"),
  ],
});
