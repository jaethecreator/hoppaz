import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Tech event: a founders' night or a meetup in a hub or a hotel hall. A stage with a projector screen up top, session seats
 * in the middle with a centre aisle, demo booths down the left wall, sponsor booths down the right, a coffee bar in the
 * back right corner and networking tables by the registration desk (the way out). The flyer hangs on the left wall
 * and the line-up (the agenda board) on the right. Prop ids are stable: Game Time and the event sheet find things by id.
 *
 * Frame: the back wall is four tiles deep (the screen and the title banner hang on it), the side walls two. Everything
 * walkable is x 3..26, y 5..18.
 */
export const EVENT_TECH = room("event-tech", {
  walls: [wall(1, 1, 28, 4), wall(1, 5, 2, 14), wall(27, 5, 2, 14)],
  zones: [
    zone("stage", "MAIN STAGE", "Build in public", "stagewood", { x: 8, y: 5, w: 14, h: 4 }, { x: 13, y: 7 }, { x: 13, y: 6 }),
    zone("seats", "SESSION SEATS", "Phones on silent", "seatrug", { x: 10, y: 9, w: 10, h: 4 }, { x: 15, y: 10 }, { x: 14, y: 11 }),
    zone("demo", "DEMO BOOTHS", "Break it live", "techfloor", { x: 3, y: 5, w: 5, h: 9 }, { x: 7, y: 10 }, { x: 5, y: 8 }),
    zone("sponsors", "SPONSOR ROW", "Free pens inside", "techfloor", { x: 22, y: 8, w: 5, h: 6 }, { x: 22, y: 10 }, { x: 24, y: 8 }),
    zone("coffee", "COFFEE BAR", "Fuel for founders", "floortile", { x: 22, y: 5, w: 5, h: 3 }, { x: 24, y: 7 }, { x: 24, y: 6 }),
    zone("network", "NETWORKING", "Swap numbers, not pitches", "techfloor", { x: 3, y: 14, w: 24, h: 5 }, { x: 8, y: 17 }, { x: 8, y: 15 }),
  ],
  props: [
    // On the walls: the flyer (left), the agenda board (right), the title banner over the screen, the screen itself.
    prop("event-flyer", "flyer", 1, 5, 2, 3),
    prop("event-lineup", "lineup", 26, 5, 3, 3),
    prop("title-banner", "titlebanner", 10, 1, 10, 1),
    prop("main-screen", "screen", 11, 2, 8, 3),
    prop("whiteboard", "whiteboard", 4, 2, 3, 2),
    prop("wifi-sign", "wifisign", 7, 2, 3, 2),

    // The stage: a platform you can walk onto, a speaker each side, a podium and two stools for the panel.
    floorProp("stage-floor", "techstage", 9, 5, 12, 3),
    prop("speaker-l", "speakerstack", 8, 5, 1, 2),
    prop("speaker-r", "speakerstack", 21, 5, 1, 2),
    prop("podium", "podium", 11, 6, 1, 1),
    prop("stage-stool-1", "stool", 15, 6, 1, 1),
    prop("stage-stool-2", "stool", 17, 6, 1, 1),
    prop("stage-plant", "plant", 20, 5, 1, 1),

    // Session seats: four chairs a side, four rows, a two tile aisle down the middle.
    floorProp("aisle-runner", "runner", 14, 9, 2, 4),
    prop("seats-l-1", "chairrow", 10, 9, 4, 2),
    prop("seats-l-2", "chairrow", 10, 11, 4, 2),
    prop("seats-r-1", "chairrow", 16, 9, 4, 2),
    prop("seats-r-2", "chairrow", 16, 11, 4, 2),
    prop("av-desk", "avdesk", 9, 13, 2, 1),
    prop("camera", "camera", 11, 13, 1, 1),

    // Demo booths along the left wall: a roll-up banner, a table with a laptop and a monitor, a bean-bag.
    prop("demo-banner-1", "rollup", 3, 8, 1, 2, { variant: 0 }),
    prop("demo-table-1", "demotable", 4, 9, 3, 1, { variant: 0 }),
    prop("demo-bean-1", "beanbag", 5, 10, 1, 1, { variant: 0 }),
    prop("demo-banner-2", "rollup", 3, 11, 1, 2, { variant: 1 }),
    prop("demo-table-2", "demotable", 4, 12, 3, 1, { variant: 1 }),
    prop("demo-bean-2", "beanbag", 5, 13, 1, 1, { variant: 1 }),
    prop("charge-station", "charger", 3, 5, 2, 1),
    prop("plant-l", "plant", 5, 5, 1, 1),

    // Sponsor row down the right wall.
    prop("sponsor-banner-1", "rollup", 26, 8, 1, 2, { variant: 2 }),
    prop("sponsor-table-1", "demotable", 23, 9, 3, 1, { variant: 2 }),
    prop("sponsor-bean-1", "beanbag", 24, 10, 1, 1, { variant: 0 }),
    prop("sponsor-banner-2", "rollup", 26, 11, 1, 2, { variant: 0 }),
    prop("sponsor-table-2", "demotable", 23, 12, 3, 1, { variant: 0 }),
    prop("sponsor-bean-2", "beanbag", 24, 13, 1, 1, { variant: 2 }),

    // Coffee and snacks in the back right corner, a vending machine on the right wall.
    prop("coffee-counter", "coffeebar", 22, 5, 4, 1),
    prop("coffee-stool-1", "stool", 23, 6, 1, 1),
    prop("coffee-stool-2", "stool", 25, 6, 1, 1),
    prop("vending", "vending", 26, 14, 1, 2),

    // Networking and the lobby: a selfie wall, long high tables and a swag table; the registration desk is the way out and
    // a welcome banner stands each side of it.
    prop("selfie-wall", "selfiewall", 3, 15, 3, 2),
    prop("net-table-1", "hightable", 8, 16, 2, 1),
    prop("net-table-2", "hightable", 18, 16, 2, 1),
    prop("net-table-3", "hightable", 22, 16, 2, 1),
    prop("swag-table", "swagtable", 24, 16, 2, 1),
    prop("welcome-banner-l", "rollup", 12, 15, 1, 2, { variant: 0 }),
    prop("welcome-banner-r", "rollup", 15, 15, 1, 2, { variant: 1 }),
    prop("plant-fl", "plant", 3, 18, 1, 1),
    prop("plant-r", "plant", 26, 18, 1, 1),
    exitProp("regdesk"),
  ],
});
