import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Indoor party: a club night. A DJ stage up top with a speaker stack each side, a dance floor under it, a bar on the
 * right, VIP booths on the left and a lounge by the door. The flyer hangs on the back wall (left) and the line-up board
 * (right). Prop ids are stable: Game Time and the event sheet find things by id.
 */
export const EVENT_INDOOR = room("event-indoor", {
  walls: [wall(1, 1, 28, 3), wall(1, 4, 1, 15), wall(28, 4, 1, 15)],
  zones: [
    zone("booth", "The Booth", "DJ is on", "stagewood", { x: 11, y: 4, w: 8, h: 3 }, { x: 14, y: 5 }, { x: 14, y: 4 }),
    zone("floor", "Dance Floor", "Everybody up", "dance", { x: 9, y: 8, w: 12, h: 6 }, { x: 15, y: 11 }, { x: 15, y: 8 }),
    zone("bar", "The Bar", "Drinks this way", "checker", { x: 21, y: 4, w: 7, h: 4 }, { x: 23, y: 5 }, { x: 24, y: 4 }),
    zone("vip", "VIP Booths", "Your table, your people", "carpet", { x: 2, y: 4, w: 6, h: 7 }, { x: 6, y: 7 }, { x: 5, y: 4 }),
    zone("lounge", "Lounge", "Sit, chat, repeat", "carpet", { x: 2, y: 13, w: 6, h: 6 }, { x: 6, y: 16 }, { x: 5, y: 13 }),
  ],
  props: [
    prop("event-flyer", "flyer", 4, 1, 2, 3),
    prop("event-lineup", "lineup", 23, 1, 3, 3),
    prop("dj-booth", "djbooth", 13, 4, 4, 1),
    prop("speaker-l", "speakerstack", 10, 4, 1, 3),
    prop("speaker-r", "speakerstack", 19, 4, 1, 3),
    prop("bar-counter", "bar", 21, 4, 6, 1),
    prop("bar-stool-1", "stool", 22, 6, 1, 1),
    prop("bar-stool-2", "stool", 24, 6, 1, 1),
    prop("bar-stool-3", "stool", 26, 6, 1, 1),
    floorProp("dance-floor", "dancefloor", 9, 8, 12, 6),
    prop("vip-booth-1", "booth", 2, 5, 4, 1, { variant: 1 }),
    prop("vip-table-1", "cocktail", 3, 6, 2, 1),
    prop("vip-booth-2", "booth", 2, 10, 4, 1, { variant: 1 }),
    prop("vip-table-2", "cocktail", 3, 9, 2, 1),
    prop("floor-table-1", "cocktail", 7, 9, 1, 1),
    prop("floor-table-2", "cocktail", 22, 9, 1, 1),
    prop("floor-table-3", "cocktail", 7, 12, 1, 1),
    prop("floor-table-4", "cocktail", 22, 12, 1, 1),
    prop("lounge-sofa-l", "booth", 2, 15, 4, 1),
    prop("lounge-table-l", "cocktail", 3, 16, 2, 1),
    prop("lounge-sofa-r", "booth", 24, 15, 4, 1),
    prop("lounge-table-r", "cocktail", 24, 16, 2, 1),
    prop("plant-l", "plant", 2, 17, 1, 1),
    prop("plant-r", "plant", 27, 17, 1, 1),
    exitProp("gate"),
  ],
});
