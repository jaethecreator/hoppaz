import { hotspotRoomData } from "../../rooms/hotspotRooms";
import { exitProp, prop, room, wall, zone } from "./build";

/**
 * Iyana Iba, the Ojo and Badagry hotspot: where the Lasu-Isheri Road runs into the Lagos-Badagry Expressway, on a hot
 * midday. Gadgets, hustle and LASU. The plan is a T seen from the south.
 *
 *   rows 1-5    the top of the T: LASU Ojo's gate and lawn (left), the Lasu-Isheri Road going up between it and the
 *               Alaba International Market (the hero, a long block of shops under one big gate sign), then the Trade Fair
 *               Complex with its hall and flags (right)
 *   rows 6-8    the pavement along the shops: TVs, speakers and fridges stacked out front, handcarts, a pure water seller
 *   rows 9-13   the Lagos-Badagry Expressway: a container trailer, a goods lorry, danfos and a keke, and the orange Hop
 *               bus in its bay near the right end
 *   row 14      the kerb, with the bus stop and the lamps
 *   rows 15-18  Macaulay's Lounge (bottom left), the plaza with the map signpost and the spawn, the Badagry Heritage
 *               Museum (bottom right) with a bit of creek and a boat beside it
 *
 * Venues, left to right as in the place data: LASU Ojo (top left), Macaulay's Lounge (bottom left), Trade Fair Complex
 * (top right) and Badagry Heritage Museum (bottom right). The route runs past the four doors in that order. Every lane stays
 * at least two tiles wide; vehicles stand on one or two rows of the expressway and the stem, and the columns the route
 * crosses on (x 4, x 9 and x 25) stay clear.
 *
 * Prop ids are stable (Game Time hides boxes by id, other features find the exit by id): never rename one.
 */
const data = hotspotRoomData("ojo-badagry");
const names = data?.landmarks.map((l) => l.name) ?? ["LASU Ojo", "Macaulay's Lounge", "Trade Fair Complex", "Badagry Heritage Museum"];
const heroName = data?.hero.name ?? "Alaba International Market";

export const HOTSPOT_OJO_BADAGRY = room("hotspot-ojo-badagry", {
  walls: [
    // The Badagry creek, bottom right, beside the museum.
    wall(26, 15, 3, 4),
  ],
  zones: [
    zone("hero", heroName, "Every gadget stacked out front", "paving", { x: 11, y: 1, w: 11, h: 8 }, { x: 16, y: 7 }, { x: 16, y: 8 }),
    zone("venue-1", names[0], "The campus crowd and the gate", "paving", { x: 1, y: 1, w: 7, h: 8 }, { x: 4, y: 7 }, { x: 5, y: 6 }),
    zone("venue-2", names[1], "Open late, just off the road", "concrete", { x: 1, y: 14, w: 7, h: 5 }, { x: 4, y: 14 }, { x: 5, y: 14 }),
    zone("venue-3", names[2], "Halls, flags and bargains", "paving", { x: 22, y: 1, w: 7, h: 8 }, { x: 25, y: 7 }, { x: 26, y: 8 }),
    zone("venue-4", names[3], "History beside the creek", "paving", { x: 19, y: 14, w: 10, h: 5 }, { x: 22, y: 14 }, { x: 23, y: 14 }),
    zone("expressway", "Badagry Expressway", "Trailers, danfos and hustle", "asphalt", { x: 1, y: 9, w: 28, h: 5 }, { x: 12, y: 11 }, { x: 13, y: 12 }),
  ],
  props: [
    // The market, the four venue corners (left to right) and the way out.
    prop("hero", "market", 11, 1, 11, 5),
    prop("venue-1", "campus-gate", 1, 1, 7, 5),
    prop("venue-2", "lounge", 1, 15, 6, 4),
    prop("venue-3", "tradefair", 22, 1, 7, 5),
    prop("venue-4", "museum", 19, 15, 7, 4),
    exitProp("mapboard"),

    // The road sign at the top of the Lasu-Isheri Road.
    prop("sign-iyana-iba", "roadsign", 8, 1, 3, 1),

    // The orange Hop bus in its bay on the expressway, nose to the museum (the finale of the route).
    prop("hop-bus", "hopbus", 17, 12, 5, 2),

    // The Hoppaz billboard on the plaza, and the pure water sellers' umbrellas (orange and cream).
    prop("billboard", "billboard", 9, 15, 4, 2),
    prop("pure-water-1", "umbrella", 6, 6, 2, 1, { variant: 0 }),
    prop("pure-water-2", "umbrella", 17, 15, 2, 1, { variant: 1 }),

    // The expressway: a container trailer, a goods lorry, two danfos and a keke. Variant 1 faces left.
    prop("trailer-1", "trailer", 11, 9, 6, 2),
    prop("lorry-1", "lorry", 11, 13, 5, 1),
    prop("danfo-1", "danfo", 22, 10, 3, 1, { variant: 1 }),
    prop("danfo-2", "danfo", 5, 12, 3, 1, { variant: 0 }),
    prop("keke-1", "keke", 2, 10, 2, 1),

    // Alaba's goods spill onto the pavement in front of the shops, and the handcarts ride the road.
    prop("tv-stack-1", "tvstack", 12, 6, 2, 1),
    prop("speaker-stack-1", "speakerstack", 14, 6, 1, 1),
    prop("fridge-row-1", "fridgerow", 15, 6, 2, 1),
    prop("tv-stack-2", "tvstack", 17, 6, 2, 1),
    prop("speaker-stack-2", "speakerstack", 19, 6, 1, 1),
    prop("handcart-1", "handcart", 20, 6, 2, 1),
    prop("handcart-2", "handcart", 19, 9, 2, 1),

    // The trade fair's flags, and a generator humming beside it.
    prop("flagpole-1", "flagpole", 23, 6, 1, 1),
    prop("flagpole-2", "flagpole", 27, 6, 1, 1),
    prop("generator-2", "generator", 28, 8, 1, 1),

    // The kerb and the plaza: the bus stop, lamps, palms and a generator at the lounge.
    prop("bus-stop-1", "busstop", 16, 14, 1, 2),
    prop("lamp-1", "streetlamp", 11, 6, 1, 1),
    prop("lamp-2", "streetlamp", 22, 6, 1, 1),
    prop("lamp-3", "streetlamp", 19, 14, 1, 1),
    prop("lamp-4", "streetlamp", 12, 14, 1, 1),
    prop("palm-1", "palm", 28, 14, 1, 1),
    prop("palm-2", "palm", 1, 14, 1, 1, { variant: 1 }),
    prop("palm-3", "palm", 18, 18, 1, 1),
    prop("generator-1", "generator", 7, 18, 1, 1),

    // A boat on the creek.
    prop("boat-1", "boat", 26, 17, 3, 1),
  ],
});
