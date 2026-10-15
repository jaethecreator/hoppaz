import { exitProp, prop, room, wall, zone } from "./build";
import { hotspotRoomData } from "../../rooms/hotspotRooms";

/**
 * Ajah (Mobil Road) on the Lekki-Epe Expressway: the far end of the island, past the traffic and under the bridge. A
 * bright coastal afternoon, read from the top of the room to the bottom as the welcome line says: busy, then breathe.
 *
 *   rows 1-3    the Ajah Flyover: one wide deck arching across the whole room, its ramps coming down at both ends
 *               (the `hero`, solid), with four pillars standing in the expressway below it
 *   rows 4-7    the Lekki-Epe Expressway at grade, under the deck: a danfo, a BRT, a sand and block lorry along the far
 *               kerb, the Hop bus at the bus stop on the right, two lanes kept clear down the middle
 *   rows 8-10   the frontage, left to right: Pan-Atlantic University (a gate and its lawn), Novare Lekki Mall, Mobil Estate
 *               Road running south to the sea with the filling station beside it, and La Campagne Tropicana (thatch huts
 *               under the right ramp, the way on to Epe)
 *   rows 11-14  the lawn, the mall's car park, the station forecourt, and Atican Beach (a beach bar on the sand)
 *   rows 15-18  the beach strip along the bottom: loungers, parasols, palms, a corn roaster, then the pier at the bottom
 *               centre where you arrive (the spawn and the map signpost) and the sea edge (a wall along row 18)
 *
 * Venues, by prop x: Pan-Atlantic University (x 1), Novare Lekki Mall (x 6), Atican Beach (x 21), La Campagne Tropicana
 * (x 24). Prop ids are stable (Game Time hides boxes by id, other features find the exit by id): never rename one.
 */
const data = hotspotRoomData("ajah");
const names = data?.landmarks.map((l) => l.name) ?? ["Pan-Atlantic University", "Novare Lekki Mall", "Atican Beach", "La Campagne Tropicana"];
const heroName = data?.hero.name ?? "Ajah Flyover";

export const HOTSPOT_AJAH = room("hotspot-ajah", {
  walls: [
    // The sea edge along row 18, either side of the pier (x 12 to 17).
    wall(1, 18, 11, 1),
    wall(18, 18, 11, 1),
  ],
  zones: [
    zone("hero", heroName, "The bridge over the junction", "asphalt", { x: 1, y: 4, w: 28, h: 4 }, { x: 15, y: 6 }, { x: 15, y: 5 }),
    zone("venue-1", names[0], "A gate, a lawn, lecture halls", "grass", { x: 1, y: 8, w: 5, h: 9 }, { x: 3, y: 11 }, { x: 3, y: 12 }),
    zone("venue-2", names[1], "Shops, snacks, cold air", "concrete", { x: 6, y: 8, w: 7, h: 6 }, { x: 9, y: 11 }, { x: 9, y: 12 }),
    zone("venue-3", names[2], "Sand, loungers, a cold drink", "sand", { x: 17, y: 13, w: 12, h: 5 }, { x: 24, y: 15 }, { x: 24, y: 16 }),
    zone("venue-4", names[3], "Thatch huts, lagoon, forest", "grass", { x: 22, y: 8, w: 7, h: 5 }, { x: 26, y: 11 }, { x: 26, y: 12 }),
    zone("pier", "The Pier", "Now breathe", "deck", { x: 11, y: 15, w: 8, h: 4 }, { x: 15, y: 16 }, { x: 16, y: 17 }),
  ],
  props: [
    // The flyover: `hero` draws the deck, the ramps and the billboard; the pillars stand in the expressway under it.
    prop("hero", "flyover", 1, 1, 28, 3),
    prop("pillar-1", "pillar", 5, 4, 1, 1),
    prop("pillar-2", "pillar", 11, 4, 1, 1),
    prop("pillar-3", "pillar", 18, 4, 1, 1),
    prop("pillar-4", "pillar", 24, 4, 1, 1),

    // The expressway: traffic at the kerbs, rows 5 and 6 kept clear. Road signs at the two ends.
    prop("danfo-1", "danfo", 6, 4, 3, 1, { variant: 0 }),
    prop("brt-1", "brt", 13, 4, 5, 1),
    prop("lorry-1", "lorry", 19, 4, 4, 1),
    prop("sign-lekki", "roadsign", 2, 4, 1, 1, { variant: 0 }),
    prop("sign-epe", "roadsign", 27, 4, 1, 1, { variant: 1 }),
    prop("danfo-2", "danfo", 3, 7, 3, 1, { variant: 1 }),
    prop("keke-1", "keke", 9, 7, 2, 1),
    prop("sign-mobil", "streetblade", 12, 7, 1, 1),
    prop("bus-stop-sign", "busstop", 22, 7, 1, 1),
    prop("hop-bus", "hopbus", 23, 7, 5, 1),

    // The four venues and the filling station, left to right.
    prop("venue-1", "campus", 1, 8, 5, 3),
    prop("venue-2", "mall", 6, 8, 7, 3),
    prop("station", "station", 17, 8, 5, 3),
    prop("venue-4", "resort", 24, 8, 5, 3),
    prop("venue-3", "beachbar", 21, 13, 6, 2),

    // The mall's car park, the campus lawn.
    prop("car-1", "car", 7, 12, 2, 1),
    prop("keke-2", "keke", 10, 12, 2, 1, { variant: 1 }),
    prop("tree-1", "tree", 1, 12, 1, 1),
    prop("tree-2", "tree", 5, 14, 1, 1),
    prop("tree-3", "tree", 2, 16, 1, 1),

    // Palms and street lamps.
    prop("palm-1", "palm", 7, 16, 1, 1),
    prop("palm-2", "palm", 11, 17, 1, 1),
    prop("palm-3", "palm", 19, 16, 1, 1),
    prop("palm-4", "palm", 28, 15, 1, 1),
    prop("palm-5", "palm", 28, 12, 1, 1),
    prop("palm-6", "palm", 17, 13, 1, 1),
    prop("lamp-1", "streetlamp", 12, 13, 1, 1),
    prop("lamp-2", "streetlamp", 20, 12, 1, 1),

    // The beach strip: the corn roaster, loungers and parasols.
    prop("corn-roast", "cornroast", 9, 15, 2, 1),
    prop("lounger-1", "lounger", 22, 16, 2, 1, { variant: 0 }),
    prop("lounger-2", "lounger", 26, 16, 2, 1, { variant: 1 }),
    prop("lounger-3", "lounger", 7, 17, 2, 1, { variant: 1 }),
    prop("parasol-1", "parasol", 20, 16, 1, 1, { variant: 0 }),
    prop("parasol-2", "parasol", 25, 16, 1, 1, { variant: 1 }),
    prop("parasol-3", "parasol", 6, 16, 1, 1, { variant: 0 }),

    // The way out: the city map signpost at the head of the pier.
    exitProp("mapboard"),
  ],
});
