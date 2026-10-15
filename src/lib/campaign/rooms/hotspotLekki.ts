import { hotspotRoomData } from "../../rooms/hotspotRooms";
import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Lekki Phase 1: Admiralty Way running straight down to the lagoon. A calm late-afternoon boulevard.
 *
 *   rows 1-2   sky and the Lekki-Ikoyi bridge (the hero's backdrop, solid)
 *   rows 3-5   the lagoon, with a short jetty and a moored boat (water is a wall)
 *   rows 6-8   the waterfront promenade: benches on the rail, palms, the coconut seller; the Bay Lounge deck to the left,
 *              the conservation garden to the right
 *   rows 9-15  Admiralty Way: sidewalks with palms and lamps, a road with a lane line, a keke parked at the kerb
 *   rows 16-18 the forecourt with the map signpost (the exit) and the spawn
 *
 * Venues, left to right: Bay Lounge (top left, on the water), Circa Lagos (left, with a patio), Ile Eros (right, with a
 * patio), Lekki Conservation Centre (top right, the grove). Prop ids are stable: never rename one once shipped.
 */
const data = hotspotRoomData("lekki");
if (!data) throw new Error("hotspot data for lekki is missing");
const [bay, circa, eros, nature] = data.landmarks;

export const HOTSPOT_LEKKI = room("hotspot-lekki", {
  walls: [
    wall(7, 3, 7, 3), // the lagoon, left of the jetty
    wall(16, 3, 7, 3), // the lagoon, right of the jetty
    wall(14, 3, 2, 1), // open water past the end of the jetty
  ],
  zones: [
    zone("hero", data.roads[0], "Palms, benches and the lagoon", "paving", { x: 9, y: 6, w: 12, h: 13 }, { x: 15, y: 7 }, { x: 12, y: 8 }),
    zone("venue-1", bay.name, "Umbrellas on the water", "deck", { x: 1, y: 1, w: 8, h: 9 }, { x: 4, y: 7 }, { x: 4, y: 6 }),
    zone("venue-2", circa.name, "Smart tables, easy patio", "floortile", { x: 1, y: 10, w: 8, h: 9 }, { x: 5, y: 16 }, { x: 5, y: 15 }),
    zone("venue-3", eros.name, "Warm wood, good food", "deck", { x: 21, y: 10, w: 8, h: 9 }, { x: 24, y: 16 }, { x: 24, y: 15 }),
    zone("venue-4", nature.name, "Trees and a canopy walk", "grass", { x: 21, y: 1, w: 8, h: 9 }, { x: 25, y: 7 }, { x: 25, y: 6 }),
    zone("jetty", "The Jetty", "Boats and breeze", "deck", { x: 14, y: 3, w: 2, h: 3 }, { x: 15, y: 4 }, { x: 14, y: 4 }),
  ],
  props: [
    // The skyline and the water: the lagoon edge of Admiralty Way, with the bridge pylon behind it.
    prop("hero", "lagoon", 7, 1, 16, 2),
    prop("venue-1", "lounge", 1, 1, 6, 5),
    prop("venue-4", "grove", 23, 1, 6, 4),
    floorProp("jetty", "jetty", 14, 4, 2, 2),
    prop("boat-1", "boat", 16, 4, 2, 2),

    // The promenade.
    prop("palm-1", "palm", 9, 6, 1, 1),
    prop("bench-1", "bench", 10, 6, 2, 1),
    prop("bench-2", "bench", 12, 6, 2, 1),
    prop("bench-3", "bench", 16, 6, 2, 1),
    prop("bench-4", "bench", 18, 6, 2, 1),
    prop("palm-2", "palm", 20, 6, 1, 1, { variant: 1 }),
    prop("coconut-cart-1", "coconut", 21, 6, 2, 2),

    // The Bay Lounge deck.
    prop("umbrella-1", "umbrella", 2, 8, 2, 1),
    prop("umbrella-2", "umbrella", 5, 8, 2, 1, { variant: 1 }),

    // The plaza corners.
    prop("plant-5", "plant", 1, 9, 1, 1),
    prop("plant-6", "plant", 28, 9, 1, 1),

    // The conservation garden.
    prop("signboard-1", "signboard", 23, 5, 2, 1),
    prop("tree-1", "tree", 28, 5, 1, 1),
    prop("tree-2", "tree", 28, 7, 1, 1),

    // Admiralty Way.
    prop("sign-admiralty", "streetsign", 8, 9, 1, 1),
    prop("palm-3", "palm", 10, 10, 1, 1),
    prop("palm-4", "palm", 10, 13, 1, 1, { variant: 1 }),
    prop("palm-5", "palm", 10, 16, 1, 1),
    prop("palm-6", "palm", 19, 10, 1, 1, { variant: 1 }),
    prop("palm-7", "palm", 19, 13, 1, 1),
    prop("palm-8", "palm", 19, 16, 1, 1, { variant: 1 }),
    prop("lamp-1", "streetlamp", 9, 12, 1, 1),
    prop("lamp-2", "streetlamp", 9, 15, 1, 1),
    prop("lamp-3", "streetlamp", 20, 12, 1, 1),
    prop("lamp-4", "streetlamp", 20, 15, 1, 1),
    prop("keke-1", "keke", 17, 11, 2, 1),
    prop("keke-2", "keke", 13, 13, 2, 1, { variant: 1 }),

    // Circa Lagos and its patio.
    prop("venue-2", "restaurant", 3, 11, 5, 4),
    prop("circa-table-1", "cocktail", 3, 16, 1, 1),
    prop("circa-table-2", "cocktail", 7, 16, 1, 1),
    prop("plant-1", "plant", 3, 15, 1, 1),
    prop("plant-2", "plant", 7, 15, 1, 1),

    // Ile Eros and its patio.
    prop("venue-3", "woodhouse", 22, 11, 5, 4),
    prop("eros-table-1", "cocktail", 22, 16, 1, 1, { variant: 1 }),
    prop("eros-table-2", "cocktail", 26, 16, 1, 1, { variant: 1 }),
    prop("plant-3", "plant", 22, 15, 1, 1),
    prop("plant-4", "plant", 26, 15, 1, 1),

    // The forecourt: lamps either side of the spawn, the map signpost (the way out), the bike rack and the welcome wall.
    prop("lamp-5", "streetlamp", 11, 17, 1, 1),
    prop("lamp-6", "streetlamp", 20, 17, 1, 1),
    prop("palm-9", "palm", 27, 17, 1, 1),
    prop("bike-rack-1", "bikerack", 17, 16, 2, 1),
    prop("sign-lekki", "monument", 5, 17, 4, 2),
    exitProp("mapboard"),
  ],
});
