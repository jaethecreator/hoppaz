import { exitProp, prop, room, wall, zone } from "./build";
import { hotspotRoomData } from "../../rooms/hotspotRooms";

/**
 * Allen Roundabout, Ikeja: the circle where Allen Avenue meets Obafemi Awolowo Way, on a bright late afternoon.
 *
 * The room is a street plan seen from the south. The roundabout is the centre: an island of solid tiles (a stepped ellipse
 * 6, 8, 10, 10, 8, 6 tiles wide, the `hero` box plus four `island-*` pieces so people walk round a circle and not a
 * square), a two tile ring road round it and Allen Avenue running through, west to east. Four corners hold the venues,
 * numbered left to right as in the place data: Ikeja City Mall (top left, a mall front with a paved path in through a gate gap), New
 * Afrika Shrine (bottom left, an open-air stage with its yard), Computer Village (top right, a block of phone stalls with
 * umbrellas out front) and The Place GRA (bottom right, a restaurant with a patio). The map signpost, the spawn, a suya
 * grill, a newspaper stand and a bus stop are on the paved plaza at the bottom. Traffic stands at the edges, so the ring
 * and both lanes of the avenue stay walkable: at least two tiles wide everywhere.
 *
 * Prop ids are stable (Game Time hides boxes by id, other features find the exit by id): never rename one.
 */
const data = hotspotRoomData("ikeja");
const names = data?.landmarks.map((l) => l.name) ?? ["Ikeja City Mall", "New Afrika Shrine", "Computer Village", "The Place GRA"];
const heroName = data?.hero.name ?? "Allen Roundabout";

export const HOTSPOT_IKEJA = room("hotspot-ikeja", {
  walls: [
    // The backs of the Allen Avenue buildings along the top, either side of the ALLEN sign.
    wall(8, 1, 3, 2),
    wall(19, 1, 3, 2),
    // The mall's front kerb and hedge, with a gap at x 4 for the path in.
    wall(1, 5, 3, 1),
    wall(5, 5, 3, 1),
  ],
  zones: [
    zone("hero", heroName, "The circle everyone passes", "asphalt", { x: 8, y: 3, w: 14, h: 11 }, { x: 15, y: 13 }, { x: 15, y: 12 }),
    zone("venue-1", names[0], "Shops, snacks, cold air", "paving", { x: 1, y: 1, w: 7, h: 7 }, { x: 4, y: 6 }, { x: 5, y: 7 }),
    zone("venue-2", names[1], "An open-air stage, live music", "concrete", { x: 1, y: 11, w: 7, h: 8 }, { x: 4, y: 17 }, { x: 4, y: 16 }),
    zone("venue-3", names[2], "Phones, plugs and chargers", "paving", { x: 22, y: 1, w: 7, h: 7 }, { x: 24, y: 6 }, { x: 26, y: 7 }),
    zone("venue-4", names[3], "Food with a patio", "deck", { x: 22, y: 11, w: 7, h: 8 }, { x: 25, y: 17 }, { x: 25, y: 16 }),
    zone("suya", "Suya Spot", "Smoke, pepper and a queue", "concrete", { x: 16, y: 14, w: 6, h: 5 }, { x: 18, y: 16 }, { x: 18, y: 17 }),
  ],
  props: [
    // The roundabout: `hero` draws the whole island, the island-* pieces only finish its solid outline.
    prop("hero", "roundabout", 11, 7, 8, 4),
    prop("island-n", "island", 12, 6, 6, 1),
    prop("island-s", "island", 12, 11, 6, 1),
    prop("island-w", "island", 10, 8, 1, 2),
    prop("island-e", "island", 19, 8, 1, 2),

    // The four venue corners, left to right.
    prop("venue-1", "mall", 1, 1, 7, 4),
    prop("venue-2", "shrine", 1, 12, 7, 3),
    prop("venue-3", "computervillage", 22, 1, 7, 4),
    prop("venue-4", "placegra", 22, 12, 7, 3),

    // The ALLEN sign on the hoarding, and a billboard by the plaza.
    prop("sign-allen", "allensign", 11, 1, 8, 2),
    prop("billboard", "billboard", 8, 14, 3, 2),

    // Traffic, standing at the edges.
    prop("danfo-1", "danfo", 2, 8, 3, 1, { variant: 1 }),
    prop("danfo-2", "danfo", 26, 9, 3, 1, { variant: 0 }),
    prop("danfo-3", "danfo", 17, 18, 3, 1, { variant: 2 }),
    prop("danfo-4", "danfo", 23, 8, 3, 1, { variant: 3 }),
    prop("keke-1", "keke", 5, 9, 2, 1),
    prop("keke-2", "keke", 20, 13, 2, 1, { variant: 1 }),

    // Computer Village spills onto the street: umbrellas over phone tables, and a stack of boxes.
    prop("phone-umbrella-1", "umbrella", 22, 5, 2, 1, { variant: 0 }),
    prop("phone-umbrella-2", "umbrella", 25, 5, 2, 1, { variant: 1 }),
    prop("phone-umbrella-3", "umbrella", 27, 6, 1, 1, { variant: 2 }),
    prop("stock-boxes", "boxes", 21, 3, 1, 2),

    // Palms, street lamps.
    prop("palm-1", "palm", 10, 3, 1, 1),
    prop("palm-2", "palm", 20, 3, 1, 1),
    prop("palm-3", "palm", 8, 12, 1, 1),
    prop("palm-4", "palm", 21, 12, 1, 1),
    prop("palm-5", "palm", 9, 18, 1, 1),
    prop("palm-6", "palm", 22, 18, 1, 1),
    prop("lamp-1", "streetlamp", 9, 5, 1, 1),
    prop("lamp-2", "streetlamp", 21, 5, 1, 1),
    prop("lamp-3", "streetlamp", 11, 14, 1, 1),
    prop("lamp-4", "streetlamp", 18, 14, 1, 1),

    // The plaza: suya, the paper stand, the bus stop.
    prop("suya-grill", "suyagrill", 17, 15, 2, 1),
    prop("newspaper-stand", "newsstand", 11, 16, 1, 1),
    prop("bus-stop-sign", "busstop", 20, 15, 1, 2),

    // The shrine's speakers and the patio's tables.
    prop("shrine-speaker-l", "speakerstack", 1, 15, 1, 2),
    prop("shrine-speaker-r", "speakerstack", 7, 15, 1, 2),
    prop("patio-table-1", "patiotable", 23, 15, 2, 2),
    prop("patio-table-2", "patiotable", 27, 15, 2, 2, { variant: 1 }),

    // The way out: a city map signpost on the plaza.
    exitProp("mapboard"),
  ],
});
