import { hotspotRoomData } from "../../rooms/hotspotRooms";
import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Jibowu, the Yaba hotspot: the junction of Herbert Macaulay Street and Murtala Muhammed Way, on a Lagos afternoon.
 * A street plaza, not a building. Four venue facades along the top (UNILAG, Ozone Cinemas, CcHub, Beeriga, left to right),
 * the railway cutting down the room between CcHub and Beeriga with crossing barriers and a red light, and the road under
 * it: a BRT shelter (the hero) in the median with a footbridge over it. The danfo park, newspaper stand, suya grill and
 * the map signpost sit on the paved plaza below, and the spawn lands in front of the junction.
 *
 * Prop ids are stable (Game Time and the exit find things by id). Everything walkable is reachable from the spawn: the
 * only fences are on the plaza, either side of the rails, and the road crosses the tracks.
 */
const data = hotspotRoomData("yaba");
const landmark = (i: number, fallback: string) => data?.landmarks[i]?.name ?? fallback;

export const HOTSPOT_YABA = room("hotspot-yaba", {
  walls: [
    // The railway fence on the plaza, left and right of the tracks (the road and both pavements cross them).
    wall(19, 14, 1, 5),
    wall(23, 14, 1, 5),
  ],
  zones: [
    zone("hero", data?.junction ?? "Jibowu", "Danfos, trains, BRT", "asphalt", { x: 8, y: 6, w: 12, h: 7 }, { x: 13, y: 11 }, { x: 12, y: 7 }),
    zone("venue-1", landmark(0, "UNILAG"), "The campus gate", "paving", { x: 1, y: 1, w: 6, h: 5 }, { x: 3, y: 5 }, { x: 3, y: 5 }),
    zone("venue-2", landmark(1, "Ozone Cinemas"), "What's showing", "paving", { x: 7, y: 1, w: 6, h: 5 }, { x: 9, y: 5 }, { x: 9, y: 5 }),
    zone("venue-3", landmark(2, "CcHub"), "Laptops out, ideas loud", "paving", { x: 13, y: 1, w: 7, h: 5 }, { x: 16, y: 5 }, { x: 16, y: 5 }),
    zone("venue-4", landmark(3, "Beeriga"), "Down at the jetty", "paving", { x: 23, y: 1, w: 6, h: 5 }, { x: 25, y: 5 }, { x: 25, y: 5 }),
    zone("park", "Danfo Park", "Yellow, black, loud", "concrete", { x: 1, y: 13, w: 12, h: 6 }, { x: 6, y: 16 }, { x: 6, y: 16 }),
  ],
  props: [
    // Floor decoration the avatars walk over: the railway, the zebra crossing and the footbridge deck over the road.
    floorProp("rails", "rails", 20, 1, 3, 18),
    floorProp("zebra", "zebra", 5, 6, 3, 7),
    floorProp("footbridge-deck", "footbridge", 14, 6, 2, 7),

    // The four venue corners, left to right.
    prop("venue-1", "campus-gate", 1, 1, 6, 4),
    prop("venue-2", "cinema", 7, 1, 6, 4),
    prop("venue-3", "restaurant", 13, 1, 7, 4),
    prop("venue-4", "jetty-shack", 23, 1, 6, 4),

    // The hero: the BRT shelter on the median, under the footbridge (its two stair towers are props of their own).
    prop("hero", "brt-shelter", 11, 8, 8, 3),
    prop("footbridge-n", "stairs", 14, 5, 2, 1),
    prop("footbridge-s", "stairs", 14, 13, 2, 1),

    // The level crossing: a barrier and a red light on each corner of the tracks.
    prop("crossing-nw", "crossing", 19, 5, 1, 1, { variant: 0 }),
    prop("crossing-ne", "crossing", 23, 5, 1, 1, { variant: 1 }),
    prop("crossing-sw", "crossing", 19, 13, 1, 1, { variant: 2 }),
    prop("crossing-se", "crossing", 23, 13, 1, 1, { variant: 3 }),

    // Danfos: three in the park, one queuing in each carriageway's inner lane, beyond the zebra and beyond the crossing.
    // Variant 1 faces right.
    prop("danfo-1", "danfo", 2, 14, 3, 1, { variant: 0 }),
    prop("danfo-2", "danfo", 6, 14, 3, 1, { variant: 1 }),
    prop("danfo-3", "danfo", 2, 7, 3, 1, { variant: 0 }),
    prop("danfo-4", "danfo", 24, 11, 3, 1, { variant: 1 }),
    prop("danfo-5", "danfo", 7, 17, 3, 1, { variant: 0 }),
    prop("keke-1", "keke", 4, 17, 2, 1),
    // A BRT bus waiting in the inner lane beyond the crossing, nose to the junction (the pavement stays open behind it).
    prop("brt-bus", "brtbus", 24, 7, 5, 1),

    // Street furniture and the corner trade.
    prop("newsstand", "newsstand", 10, 16, 2, 1),
    prop("umbrella-1", "parasol", 6, 18, 1, 1),
    prop("suya-grill", "suya", 26, 14, 2, 1),
    prop("bench-1", "bench", 26, 17, 2, 1),
    prop("bus-stop-sign", "busstop", 12, 13, 1, 1),
    prop("sign-jibowu", "streetsign", 9, 13, 3, 1),
    prop("lamp-1", "streetlamp", 6, 5, 1, 1),
    prop("lamp-2", "streetlamp", 12, 5, 1, 1),
    prop("lamp-3", "streetlamp", 5, 13, 1, 1),
    prop("lamp-4", "streetlamp", 24, 13, 1, 1),
    prop("plant-1", "plant", 12, 17, 1, 1),
    prop("plant-2", "plant", 17, 17, 1, 1),
    prop("tree-1", "tree", 1, 17, 1, 1),
    prop("tree-2", "tree", 28, 17, 1, 1),
    prop("bin-1", "bin", 17, 13, 1, 1),
    prop("crate-1", "crate", 28, 14, 1, 1),

    // The way out to the map: a city signpost, two tiles left of the spawn.
    exitProp("mapboard"),
  ],
});
