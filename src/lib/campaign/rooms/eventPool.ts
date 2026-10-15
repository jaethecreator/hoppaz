import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Pool party: a Lagos hotel or villa pool in the afternoon sun. The big pool sits in the middle with a deck lane all round
 * it, the DJ deck is on a raised platform at the top with a speaker stack each side, the cabana bar is top right,
 * loungers and parasols line the left, a daybed and cocktail tables the right, and the towel desk by the door is the way out. The flyer
 * (left of the DJ) and the line-up board (right) hang on the white back wall. Prop ids are stable: Game Time and the
 * event sheet find things by id.
 */
export const EVENT_POOL = room("event-pool", {
  walls: [wall(1, 1, 28, 3), wall(1, 4, 1, 15), wall(28, 4, 1, 15)],
  zones: [
    zone("deck", "DJ Deck", "Sun out, speakers out", "wood", { x: 10, y: 4, w: 10, h: 4 }, { x: 15, y: 6 }, { x: 15, y: 5 }),
    zone("pool", "The Pool", "Water is cold. Vibes are not", "water", { x: 7, y: 8, w: 14, h: 8 }, { x: 15, y: 8 }, { x: 15, y: 10 }),
    zone("cabana", "Cabana Bar", "Stools go fast", "paving", { x: 21, y: 4, w: 7, h: 5 }, { x: 24, y: 7 }, { x: 24, y: 5 }),
    zone("loungers", "Loungers", "Tan lines loading", "deck", { x: 2, y: 8, w: 5, h: 8 }, { x: 5, y: 12 }, { x: 3, y: 8 }),
    zone("tables", "Poolside Tables", "Cocktails and gist", "paving", { x: 21, y: 9, w: 7, h: 7 }, { x: 23, y: 12 }, { x: 23, y: 9 }),
    zone("lifeguard", "Lifeguard Chair", "He saw that cannonball", "deck", { x: 2, y: 4, w: 8, h: 4 }, { x: 4, y: 6 }, { x: 4, y: 5 }),
  ],
  props: [
    prop("event-flyer", "flyer", 7, 1, 2, 3),
    prop("event-lineup", "lineup", 21, 1, 3, 3),
    // The DJ deck: a raised platform (floor art), the booth against the wall, a speaker stack each side.
    floorProp("dj-platform", "platform", 11, 4, 8, 3),
    prop("dj-booth", "djbooth", 13, 4, 4, 1),
    prop("speaker-l", "speakerstack", 10, 4, 1, 3),
    prop("speaker-r", "speakerstack", 19, 4, 1, 3),
    // The pool: solid, 12 by 6, with a deck lane at least 2 tiles wide all round it.
    prop("pool", "pool", 9, 9, 12, 6),
    // The cabana bar, top right, with three stools in front of the counter.
    prop("cabana-bar", "cabana", 22, 4, 6, 3),
    prop("bar-stool-1", "stool", 23, 7, 1, 1),
    prop("bar-stool-2", "stool", 25, 7, 1, 1),
    prop("bar-stool-3", "stool", 27, 7, 1, 1),
    // The lounger area, left: a striped mat, three loungers each with a parasol, towels on the deck.
    floorProp("beach-mat", "mat", 2, 9, 4, 6),
    prop("lounger-1", "lounger", 2, 9, 2, 1, { variant: 0 }),
    prop("parasol-1", "parasol", 4, 9, 1, 1, { variant: 0 }),
    prop("lounger-2", "lounger", 2, 11, 2, 1, { variant: 1 }),
    prop("parasol-2", "parasol", 4, 11, 1, 1, { variant: 1 }),
    prop("lounger-3", "lounger", 2, 13, 2, 1, { variant: 2 }),
    prop("parasol-3", "parasol", 4, 13, 1, 1, { variant: 2 }),
    floorProp("towel-1", "towel", 5, 10, 1, 1, 0),
    floorProp("towel-2", "towel", 5, 14, 1, 1, 1),
    // Bottom left and bottom right: one more lounger and parasol each side of the way in.
    prop("lounger-4", "lounger", 3, 16, 2, 1, { variant: 1 }),
    prop("parasol-4", "parasol", 5, 16, 1, 1, { variant: 1 }),
    floorProp("towel-3", "towel", 7, 17, 1, 1, 2),
    prop("lounger-5", "lounger", 19, 16, 2, 1, { variant: 0 }),
    prop("parasol-5", "parasol", 21, 16, 1, 1, { variant: 0 }),
    floorProp("towel-4", "towel", 18, 18, 1, 1, 1),
    // Poolside, right: a daybed with a striped canopy, the shower, cocktail tables and a cool box.
    prop("daybed", "daybed", 24, 10, 3, 2),
    prop("shower", "shower", 27, 9, 1, 2),
    prop("table-1", "cocktail", 23, 13, 1, 1, { variant: 0 }),
    prop("table-2", "cocktail", 26, 13, 1, 1, { variant: 1 }),
    prop("table-3", "cocktail", 24, 15, 1, 1, { variant: 2 }),
    prop("lounger-6", "lounger", 26, 15, 2, 1, { variant: 2 }),
    prop("cooler", "cooler", 24, 17, 1, 1),
    // Top left: the lifeguard chair at the pool's corner, a rack of floats and a planter.
    prop("lifeguard-chair", "lifeguard", 6, 7, 1, 2),
    prop("float-rack", "floatrack", 5, 4, 2, 1),
    prop("planter-3", "planter", 9, 5, 1, 1),
    prop("planter-4", "planter", 20, 5, 1, 1),
    // Palms in the corners and planters either side of the towel desk.
    prop("palm-1", "palm", 2, 5, 1, 1, { variant: 0 }),
    prop("palm-3", "palm", 2, 18, 1, 1, { variant: 1 }),
    prop("palm-4", "palm", 27, 18, 1, 1, { variant: 0 }),
    prop("planter-l", "planter", 11, 16, 1, 1),
    prop("planter-r", "planter", 17, 16, 1, 1),
    // The way out: the towel and key desk by the gate. The tile under it is deck.
    exitProp("toweldesk"),
  ],
});
