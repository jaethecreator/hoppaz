import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Outdoor party: a Lagos compound at dusk. A painted wall behind a stage truck with an LED screen and a PA tower each
 * side, crowd barriers in front, a plank dance floor on the lawn with string lights on poles round it. Food and drink
 * line the sides (jollof and suya up left, the ice stall up right), plastic chairs under canopy tents, a fire pit, and
 * at the front the compound gate: a wristband table (the exit) and a guard booth, with a danfo and a keke parked outside.
 * The flyer hangs on the back wall (left) and the line-up board (right). Prop ids are stable: Game Time and the event
 * sheet find things by id.
 *
 * Walls: back wall (rows 1 to 3), a hedge each side (rows 4 to 15), and the front wall (row 16) with the gateway at
 * x 15 and 16. The forecourt below it (rows 17 and 18) is the street side, where you arrive.
 */
export const EVENT_OUTDOOR = room("event-outdoor", {
  walls: [
    wall(1, 1, 28, 3),
    wall(1, 4, 1, 12),
    wall(28, 4, 1, 12),
    wall(1, 16, 12, 1),
    wall(17, 16, 12, 1),
  ],
  zones: [
    zone("stage", "The Stage", "Close enough to feel the bass", "stagewood", { x: 8, y: 4, w: 14, h: 5 }, { x: 15, y: 8 }, { x: 15, y: 7 }),
    zone("suya", "Suya Corner", "Extra yaji, no questions", "paving", { x: 2, y: 4, w: 6, h: 5 }, { x: 5, y: 6 }, { x: 4, y: 4 }),
    zone("drinks", "Cold Drinks", "Chapman, zobo, malt, ice", "paving", { x: 22, y: 4, w: 6, h: 4 }, { x: 24, y: 6 }, { x: 24, y: 4 }),
    zone("tents", "Chill Tents", "Plastic chairs, big gist", "grass", { x: 22, y: 8, w: 6, h: 8 }, { x: 23, y: 11 }, { x: 25, y: 9 }),
    zone("lawn", "The Lawn", "Dance where you stand", "grass", { x: 2, y: 9, w: 20, h: 7 }, { x: 13, y: 11 }, { x: 15, y: 9 }),
    zone("gate", "The Gate", "Wristband on, phone out", "concrete", { x: 1, y: 16, w: 28, h: 3 }, { x: 16, y: 16 }, { x: 10, y: 16 }),
  ],
  props: [
    // On the back wall, either side of the stage.
    prop("event-flyer", "flyer", 3, 1, 2, 3),
    prop("event-lineup", "lineup", 23, 1, 3, 3),
    // The stage: truck, PA towers, crowd barriers, the generator that feeds them.
    prop("stage-truck", "stage", 10, 4, 10, 3),
    prop("speaker-l", "speakerstack", 8, 4, 2, 3),
    prop("speaker-r", "speakerstack", 20, 4, 2, 3),
    prop("barrier-1", "barrier", 10, 7, 2, 1),
    prop("barrier-2", "barrier", 12, 7, 2, 1),
    prop("barrier-3", "barrier", 14, 7, 2, 1),
    prop("barrier-4", "barrier", 16, 7, 2, 1),
    prop("barrier-5", "barrier", 18, 7, 2, 1),
    prop("gen", "gen", 8, 7, 2, 1),
    // Food and drink.
    prop("jollof-stall", "jollof", 2, 4, 3, 2),
    prop("suya-stall", "suya", 5, 4, 3, 2),
    prop("water-drum", "drum", 7, 6, 1, 1),
    prop("ice-stall", "ice", 22, 4, 5, 2),
    // Greenery.
    prop("palm-l", "palm", 2, 7, 1, 2),
    prop("palm-r", "palm", 27, 4, 1, 2),
    prop("palm-m", "palm", 7, 11, 1, 2),
    // Canopy tents with Lagos plastic chairs under them.
    prop("tent-b", "tent", 24, 8, 4, 2, { variant: 0 }),
    prop("tent-b-set-1", "plasticset", 24, 10, 2, 1, { variant: 0 }),
    prop("tent-b-set-2", "plasticset", 26, 10, 2, 1, { variant: 1 }),
    prop("tent-c", "tent", 24, 13, 4, 2, { variant: 1 }),
    prop("tent-c-set-1", "plasticset", 24, 15, 2, 1, { variant: 2 }),
    prop("tent-c-set-2", "plasticset", 26, 15, 2, 1, { variant: 0 }),
    prop("tent-a", "tent", 2, 13, 4, 2, { variant: 2 }),
    prop("tent-a-set-1", "plasticset", 2, 15, 2, 1, { variant: 1 }),
    prop("tent-a-set-2", "plasticset", 4, 15, 2, 1, { variant: 2 }),
    // The fire pit and its log seats.
    prop("fire-pit", "firepit", 4, 9, 2, 2),
    prop("fire-seat-n", "logseat", 4, 8, 2, 1),
    prop("fire-seat-s", "logseat", 4, 11, 2, 1),
    // The lawn: a plank dance floor, string-light poles at its corners, stacked chairs, two high tables.
    floorProp("dance-floor", "dancefloor", 11, 9, 8, 4),
    prop("pole-1", "pole", 10, 9, 1, 1),
    prop("pole-2", "pole", 19, 9, 1, 1),
    prop("pole-3", "pole", 10, 13, 1, 1),
    prop("pole-4", "pole", 19, 13, 1, 1),
    prop("chairs-1", "chairstack", 8, 10, 1, 1),
    prop("high-table-1", "cocktail", 21, 10, 1, 1),
    prop("high-table-2", "cocktail", 20, 12, 1, 1),
    prop("bin-1", "bin", 21, 13, 1, 1),
    // The compound gate: guard booth, wristband table (the exit), and what is parked outside.
    prop("guard-booth", "guardbooth", 18, 14, 2, 2),
    exitProp("wristbands"),
    prop("danfo-1", "danfo", 24, 17, 5, 2),
    prop("keke-1", "keke", 1, 17, 2, 2),
  ],
});
