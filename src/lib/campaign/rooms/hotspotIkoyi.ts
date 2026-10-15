import { exitProp, floorProp, prop, room, wall, zone } from "./build";
import { hotspotRoomData } from "../../rooms/hotspotRooms";

/**
 * Bourdillon, Ikoyi: the quiet side of the island at dusk. Leafy, walled and calm.
 *
 *   rows 1-4    the lagoon with the Lekki-Ikoyi Link Bridge across it (the hero, solid): one tall pylon on the right, cable
 *               fans, a lit deck and two boats on the water
 *   rows 5-6    the lagoon-side promenade: benches and lamps along the quay rail
 *   rows 7-10   Bogobiri House (left) and Danfo Bistro (centre) behind their frontages, a tree-lined alley between them
 *   rows 11-12  the cross lane: the Hoppaz route runs along it
 *   rows 13-16  The Jazzhole (left); the square with the big rain tree and the map signpost (the way out); Pitstop Village's
 *               cabins and their yard (right of centre)
 *   rows 17-18  the forecourt, the spawn and the plantain chip seller
 *   cols 22-27  Alexander Avenue runs down the right of the room under the estate gateway (the BOURDILLON sign over two
 *               pillars, a gate leaf and the guard booth): SUVs at the kerbs, a danfo passing and the Hop bus in its bay
 *
 * Venues, numbered as in the place data: Bogobiri House, The Jazzhole, Danfo Bistro, Pitstop Village. Prop ids are stable:
 * never rename one once shipped.
 */
const data = hotspotRoomData("ikoyi");
const names = data?.landmarks.map((l) => l.name) ?? ["Bogobiri House", "The Jazzhole", "Danfo Bistro", "Pitstop Village"];

export const HOTSPOT_IKOYI = room("hotspot-ikoyi", {
  // The water is the hero prop and the compounds are venue props. The estate wall closes the east side of the avenue
  // below the guard booth (rows 11 to 18, so the verge is never a one tile dead end).
  walls: [wall(28, 11, 1, 8)],
  zones: [
    zone("hero", "Bourdillon", "Bridge, lagoon and a slow evening", "paving", { x: 14, y: 5, w: 14, h: 2 }, { x: 20, y: 6 }, { x: 20, y: 5 }),
    zone("venue-1", names[0], "Art on the walls, music at night", "paving", { x: 1, y: 11, w: 8, h: 2 }, { x: 4, y: 11 }, { x: 5, y: 12 }),
    zone("venue-2", names[1], "Vinyl, books and a slow coffee", "paving", { x: 1, y: 17, w: 8, h: 2 }, { x: 4, y: 17 }, { x: 5, y: 18 }),
    zone("venue-3", names[2], "Nigerian classics, group tables", "paving", { x: 13, y: 11, w: 8, h: 2 }, { x: 16, y: 11 }, { x: 17, y: 12 }),
    zone("venue-4", names[3], "Coffee, plates and a quiet yard", "paving", { x: 15, y: 15, w: 7, h: 2 }, { x: 18, y: 15 }, { x: 19, y: 16 }),
    zone("gate", "Estate Gate", "Good evening, ma. Good evening, sir.", "paving", { x: 26, y: 8, w: 3, h: 4 }, { x: 27, y: 9 }, { x: 27, y: 8 }),
  ],
  props: [
    // The lagoon and the bridge: drawn across the whole top of the room.
    prop("hero", "bridge", 1, 1, 28, 4),

    // The four venues, left to right.
    prop("venue-1", "arthouse", 1, 7, 8, 4),
    prop("venue-2", "recordshop", 1, 13, 7, 4),
    prop("venue-3", "bistro", 13, 7, 8, 4),
    prop("venue-4", "village", 15, 13, 7, 2),

    // The estate gateway over the head of the avenue: the sign hangs over the road (floor), the pillars stand either side.
    floorProp("gate-sign", "gatesign", 21, 6, 8, 2),
    prop("gate-pillar-l", "pillar", 21, 7, 1, 2),
    prop("gate-pillar-r", "pillar", 28, 7, 1, 2),
    prop("gate-leaf", "gateleaf", 21, 9, 1, 1),
    prop("guard-booth", "booth", 28, 9, 1, 2),

    // Alexander Avenue: parked SUVs on the kerbs, a danfo passing through, the Hop bus in its bay.
    prop("suv-1", "suv", 22, 9, 2, 3, { variant: 0 }),
    prop("danfo-1", "danfo", 24, 10, 2, 4),
    prop("suv-2", "suv", 26, 12, 2, 3, { variant: 1 }),
    prop("suv-3", "suv", 22, 15, 2, 3, { variant: 2 }),
    prop("hop-bus", "hopbus", 26, 15, 2, 4),

    // Trees: the big rain tree in the square, street trees in the alley, palms down the avenue and along the quay.
    prop("raintree-1", "raintree", 12, 14, 1, 1),
    prop("tree-1", "tree", 9, 8, 1, 1),
    prop("tree-2", "tree", 12, 9, 1, 1, { variant: 1 }),
    prop("palm-1", "palm", 1, 6, 1, 1),
    prop("palm-2", "palm", 26, 5, 1, 1, { variant: 1 }),
    prop("palm-3", "palm", 21, 17, 1, 1),
    prop("palm-4", "palm", 3, 18, 1, 1, { variant: 1 }),
    prop("palm-5", "palm", 19, 18, 1, 1),

    // Lamps.
    prop("lamp-1", "streetlamp", 6, 5, 1, 1),
    prop("lamp-2", "streetlamp", 13, 5, 1, 1),
    prop("lamp-3", "streetlamp", 24, 5, 1, 1),
    prop("lamp-4", "streetlamp", 9, 10, 1, 1),
    prop("lamp-5", "streetlamp", 20, 12, 1, 1),
    prop("lamp-6", "streetlamp", 9, 17, 1, 1),

    // The quay: benches against the rail.
    prop("bench-1", "bench", 4, 5, 2, 1),
    prop("bench-2", "bench", 9, 5, 2, 1),
    prop("bench-3", "bench", 16, 5, 2, 1),

    // Frontages: clipped hedges and planters, the record shop's sign board and book rack.
    prop("hedge-1", "hedge", 9, 7, 1, 1),
    prop("hedge-2", "hedge", 8, 13, 1, 1),
    prop("plant-1", "plant", 1, 11, 1, 1),
    prop("plant-2", "plant", 8, 11, 1, 1),
    prop("jazz-board", "aboard", 6, 18, 1, 1),
    prop("book-rack", "bookrack", 8, 15, 1, 2),

    // Pitstop Village's yard: tables under the lights.
    floorProp("yard-lights", "yardlights", 15, 15, 7, 2),
    prop("picnic-1", "picnic", 16, 16, 2, 1),
    prop("picnic-2", "picnic", 19, 16, 2, 1, { variant: 1 }),

    // The forecourt: the plantain chip seller under an orange and cream umbrella.
    prop("chips-cart", "chipscart", 11, 18, 2, 1),
    prop("bin-1", "bin", 14, 12, 1, 1),

    // The way out: the map signpost in the square, left of the spawn.
    exitProp("mapboard"),
  ],
});
