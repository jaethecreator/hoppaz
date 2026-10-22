import type { Block, Tile } from "../geometry";
import type { AmbientMember, CampaignLayout } from "../layout";
import { exitProp, floorProp, prop, room, wall, zone } from "./build";

/**
 * Lagos HQ: the one central room of Hoppaz. A bright Lagos street at the edge of the lagoon, drawn light and simple.
 * A crew room template (key `lagos-hq`), 30 or 36 tiles wide.
 *
 * From the top: the LAGOON SIDE (water, a jetty and palms), THE STAGE (a small stage under the Lagos HQ billboard) and the
 * MARKET (akara, phones and cloth stalls). Across the middle a road with a danfo, a keke, okadas and a Hoppaz bus. Below it
 * the BUS STOP (a shelter and a sign), THE JUNCTION (the gate to the map and where you arrive) and the SUYA SPOT.
 *
 * Prop ids are stable (Game Time and the exit find things by id): billboard `hq-billboard`, stage `stage-platform`, booth
 * `dj-booth`, `courtyard-fountain` (the featured sticker's plinth, a floor prop at the foot of the stage), the door
 * `entry-map-table`. The stage zone id is `stage` (stage voice).
 *
 * Two widths. 30 is the base. 36 keeps every section and adds three tiles of street each side of the stage: the middle group
 * (stage, junction, gate) moves three tiles right and the right group (market, suya spot) six, as the clubhouse does.
 *
 * Walkable x 1..W-2, y 1..18. Vehicles stand on the road but leave two open rows, so the road can always be crossed.
 *
 * Scenery people: `ambient` lists twelve characters who live on each phone only (ambient.ts). They wander in their own zone.
 * They are not Hoppers: no name, no count, no tap, never in chat.
 */

/** The x of a base (30 wide) tile in the room at `width`: the middle group moves c right, the right group 2c. */
const shift = (x: number, c: number) => (x >= 20 ? x + 2 * c : x >= 10 ? x + c : x);

export function lagosHqLayout(width: 30 | 36): CampaignLayout {
  const c = (width - 30) / 2; // 0 or 3
  const X = (x: number) => shift(x, c);
  const P = (id: string, kind: string, x: number, y: number, w: number, h: number, variant?: number) => prop(id, kind, X(x), y, w, h, { variant });
  const F = (id: string, kind: string, x: number, y: number, w: number, h: number) => floorProp(id, kind, X(x), y, w, h);
  /** A block from base columns x1..x2 (inclusive) and rows y..y+h-1: the ends move with their own group. */
  const B = (x1: number, x2: number, y: number, h: number): Block => ({ x: X(x1), y, w: X(x2) - X(x1) + 1, h });
  const T = (x: number, y: number): Tile => ({ x: X(x), y });

  const base = room("lagos-hq", {
    spawn: { x: 15 + c, y: 17 },
    walls: [],
    zones: [
      // The north row. Lagoon side: the promenade beside the water (the water itself is a solid prop).
      zone("lagoon", "LAGOON SIDE", "Water, wind, a jetty", "paving", B(1, 9, 1, 8), T(4, 6), T(5, 7)),
      zone("stage", "THE STAGE", "Music on the street", "paving", B(10, 19, 1, 8), T(13, 7), T(13, 6)),
      zone("market", "MARKET", "Akara, phones, cloth", "paving", B(20, 28, 1, 8), T(24, 4), T(24, 5)),
      // The south row, the road included.
      zone("busstop", "BUS STOP", "Danfos and okadas", "paving", B(1, 10, 9, 10), T(4, 16), T(4, 18)),
      zone("junction", "THE JUNCTION", "The way to the map", "paving", B(11, 18, 9, 10), T(15, 14), T(16, 14)),
      zone("suya", "SUYA SPOT", "Smoke and stools", "paving", B(19, 28, 9, 10), T(23, 16), T(23, 18)),
    ],
    props: [
      // ---- Lagoon side: two bodies of water and a jetty between them (the jetty is floor you can walk out on).
      P("lagoon-l", "lagoon", 1, 1, 3, 3),
      F("jetty", "jetty", 4, 1, 2, 3),
      P("lagoon-r", "lagoon", 6, 1, 3, 3, 1),
      P("palm-1", "palm", 9, 2, 1, 1),
      P("palm-2", "palm", 1, 5, 1, 1),

      // ---- The stage: the billboard on the back wall, a low stage, a booth and two speakers.
      P("hq-billboard", "billboard", 10, 1, 10, 3),
      F("stage-platform", "stagefloor", 11, 4, 8, 2),
      P("dj-booth", "djdesk", 13, 5, 4, 1),
      P("stage-speaker-l", "speakerstack", 11, 4, 1, 2),
      P("stage-speaker-r", "speakerstack", 18, 4, 1, 2),
      // The featured event's sticker sits on this plinth. A floor prop: it is not one of the objects Game Time may hide a box in.
      F("courtyard-fountain", "fountain", 14, 7, 2, 1),

      // ---- The market: three stalls, two umbrellas.
      P("stall-akara", "stall", 21, 1, 3, 2, 0),
      P("stall-phones", "stall", 25, 1, 3, 2, 1),
      P("stall-cloth", "stall", 21, 5, 3, 2, 2),
      P("umbrella-1", "parasol", 25, 5, 1, 1),
      P("umbrella-2", "parasol", 27, 4, 1, 1),

      // ---- The road: a crossing, then a danfo, a keke, okadas and the Hoppaz bus. Variant 1 faces right.
      F("zebra", "zebra", 9, 9, 3, 4),
      P("danfo-1", "danfo", 2, 10, 3, 1, 0),
      P("danfo-2", "danfo", 12, 11, 3, 1, 1),
      P("keke-1", "keke", 17, 10, 2, 1, 0),
      P("hop-bus", "hopbus", 22, 10, 3, 1),
      P("okada-1", "okada", 6, 12, 2, 1, 0),
      P("okada-2", "okada", 19, 12, 2, 1, 1),
      P("okada-3", "okada", 26, 11, 2, 1, 0),
      P("lamp-1", "streetlamp", 10, 8, 1, 1),
      P("lamp-2", "streetlamp", 20, 8, 1, 1),

      // ---- The bus stop and the suya spot below the road.
      P("bus-shelter", "busshelter", 2, 14, 5, 2),
      P("bus-stop-sign", "busstop", 8, 14, 1, 1),
      P("suya-stall", "suyastall", 21, 14, 4, 2),
      P("stool-1", "stool", 26, 15, 1, 1),
      P("stool-2", "stool", 26, 17, 1, 1),

      // The way out to the map: a signpost, two tiles left of the spawn.
      { ...exitProp("mapboard"), x: 13 + c },
    ],
  });

  // ---- Scenery people --------------------------------------------------------------------------------------------------
  // Nobody here is a Hopper. Looks are the same avatar system the app uses, dressed from the wardrobe, in Lagos street roles.
  // The first six are the ones a phone short of memory keeps. `home` is always floor (checked by check-campaign.mjs).
  const ambient: AmbientMember[] = [
    { id: "suya-seller", role: "Suya seller", mode: "post", home: T(22, 16), range: B(21, 25, 16, 3), look: { frame: "male", skin: 2, hair: "fade", beard: "stubble", top: "ma-senator", bottom: "ok-black-trousers", shoes: "ok-palm", head: "ki-fila", eyes: "happy", mouth: "grin" } },
    { id: "dj", role: "DJ", mode: "post", home: T(14, 4), range: B(12, 17, 4, 1), look: { frame: "male", skin: 4, hair: "locs", hairColor: 0, glasses: "shades", top: "ml-hoodie", bottom: "wnc-cargo", shoes: "ok-sneakers", head: "ml-beanie", mouth: "smirk", eyes: "sharp" } },
    { id: "conductor", role: "Agbero conductor", mode: "wander", home: T(5, 11), range: B(1, 10, 11, 3), look: { frame: "male", skin: 1, hair: "lowcut", beard: "stubble", top: "hz-tee", bottom: "ok-black-trousers", shoes: "ok-palm", head: "hz-bucket", eyes: "open", mouth: "laugh" } },
    { id: "market-woman", role: "Market woman", mode: "wander", home: T(24, 3), range: B(20, 28, 3, 5), look: { frame: "female", body: "curvy", skin: 3, hair: "bun", top: "lf-dress", bottom: "ki-skirt", shoes: "ok-palm", head: "lf-gele", eyes: "happy", mouth: "smile", lips: "tint" } },
    { id: "okada-a", role: "Okada rider", mode: "wander", home: T(5, 13), range: B(3, 10, 13, 2), look: { frame: "male", skin: 3, hair: "fade", top: "ok-tee-black", bottom: "wnc-cargo", shoes: "ok-sneakers", head: "wnc-cap", eyes: "open", mouth: "smirk" } },
    { id: "student-a", role: "Student", mode: "wander", home: T(5, 7), range: B(1, 9, 4, 5), look: { frame: "female", skin: 4, hair: "braids", top: "cs-hoodie", bottom: "ok-jeans", shoes: "ok-sneakers", eyes: "sparkle", mouth: "smile" } },
    { id: "okada-b", role: "Okada rider", mode: "wander", home: T(27, 13), range: B(21, 28, 12, 3), look: { frame: "male", skin: 1, hair: "bald", beard: "full", top: "sn-shirt", bottom: "ok-jeans", shoes: "ok-palm", head: "sn-bucket", eyes: "sleepy", mouth: "grin" } },
    { id: "akara-seller", role: "Akara seller", mode: "post", home: T(22, 3), range: B(21, 24, 3, 1), look: { frame: "female", body: "curvy", skin: 2, hair: "twinpuffs", top: "oc-shirt", bottom: "ki-skirt", shoes: "ok-palm", eyes: "happy", mouth: "laugh", ears: "hoops" } },
    { id: "student-b", role: "Student", mode: "wander", home: T(14, 8), range: B(10, 19, 6, 3), look: { frame: "male", skin: 5, hair: "afro", top: "ml-tee", bottom: "ok-shorts", shoes: "ok-sneakers", head: "wnc-cap", eyes: "happy", mouth: "grin" } },
    { id: "waiting", role: "Waiting for a bus", mode: "post", home: T(4, 16), range: B(2, 7, 16, 1), look: { frame: "female", skin: 3, hair: "bob", top: "lsp-shirt", bottom: "lsp-trousers", shoes: "fh-loafers", glasses: "round", eyes: "open", mouth: "oh" } },
    { id: "friend-a", role: "Friend", mode: "chat", partner: "friend-b", home: T(7, 6), range: B(1, 9, 4, 5), look: { frame: "female", skin: 5, hair: "curls", top: "ai-dress", bottom: "ok-shorts", shoes: "ok-palm", eyes: "wink", mouth: "laugh", lips: "berry" } },
    { id: "friend-b", role: "Friend", mode: "chat", partner: "friend-a", home: T(8, 6), range: B(1, 9, 4, 5), look: { frame: "male", skin: 2, hair: "spiky", top: "oc-kaftan", bottom: "oc-trousers", shoes: "ok-sneakers", eyes: "happy", mouth: "smile" } },
  ];

  const layout: CampaignLayout = { ...base, ambient };
  // room() builds the 30 wide frame; the wide room is the same layout on a wider grid.
  return width === 30 ? layout : { ...layout, grid: { ...layout.grid, width } };
}

export const LAGOS_HQ = lagosHqLayout(30);
export const LAGOS_HQ_WIDE = lagosHqLayout(36);
