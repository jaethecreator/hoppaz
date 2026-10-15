import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, Defs, Floor, FONT, Frame, HopBus, P, Plate, Props, RouteLine, Shade, Stamp, StringLights, type RoomArtProps } from "./kit";

/**
 * Allen Roundabout, Ikeja: a bright late afternoon in green and warm yellow. The big circular island is the room's
 * centre (a fountain and a spire in a planted ring), the ring road round it carries lane arrows, Allen Avenue runs
 * through it and zebra crossings guard every arm. Round it sit Ikeja City Mall (a glass-fronted shopping mall with a canopy,
 * flag banners and a car park edge with a gap for the entrance walkway), New Afrika Shrine (an open-air stage, tall
 * pillars, a long banner), Computer Village (a block of phone stalls under umbrellas) and The Place GRA (a restaurant with
 * a patio). Names, sign and palette come from the place data (src/lib/rooms/hotspotRooms.ts). Same pixel look as the
 * clubhouse: 2 px ink, top-left light, hard shadow to the lower right, flat colour. Names only on the venues: no logos, no
 * photos.
 *
 * The Hoppaz layer (brand kit, docs/ROOM-TEMPLATES.md "Look"): the orange Hop bus parked in its bay on the plaza (it is the
 * `danfo-3` prop, so the id and kind stay), the route running Stop 1 in the Shrine yard to the bus, the billboard as the
 * bounce wordmark sign, and one stamp in the yard. The Shrine banner is the room's one violet shape.
 */
const PLACE = hotspotRoomData("ikeja");
const SIGN = PLACE?.sign ?? "ALLEN";
const PAL = PLACE?.palette ?? { primary: "#2FA84F", secondary: "#0E0B0A", accent: "#F2B705" };
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["Ikeja City Mall", "New Afrika Shrine", "Computer Village", "The Place GRA"];

const GREEN = PAL.primary;
const GREEN_DARK = P.kekeDark;
const GREEN_LIGHT = "#6FCB87";
const YELLOW = PAL.accent;
const YELLOW_DARK = P.danfoDark;
const YELLOW_LIGHT = "#FFE066";
const NIGHT = PAL.secondary;

/** The roundabout in scene pixels: its centre, the island's radii and the ring road's outer radii (an ellipse: the room is seen from above and a little south). */
const CX = 480;
const CY = 288;
const ISLAND = { rx: 160, ry: 96 };
const ROAD = { rx: 224, ry: 160 };

/** Lane arrows on the ring, anticlockwise (Nigeria drives on the right): angle in degrees round the ellipse, in the inner or the outer lane. */
const RING_ARROWS = [50, 90, 130, 230, 270, 310].map((deg, k) => {
  const th = (deg * Math.PI) / 180;
  const rx = k % 2 === 0 ? 176 : 208;
  const ry = k % 2 === 0 ? 112 : 144;
  return {
    x: Math.round(CX + rx * Math.cos(th)),
    y: Math.round(CY + ry * Math.sin(th)),
    turn: Math.round((Math.atan2(-ry * Math.cos(th), rx * Math.sin(th)) * 180) / Math.PI),
  };
});
const ARROW = "M-9 -3H1V-7L10 0L1 7V3H-9Z";

const DESTINATIONS = ["OSHODI", "YABA", "CMS", "IKEJA"];
const UMBRELLAS: [string, string][] = [[YELLOW, GREEN], [P.orange, P.paper], [GREEN, P.white]];

/** A street palm: base at (0,0), trunk up to about -40, crown about 70 px wide. Taller than the kit's, to stand over a tile. */
function TallPalm({ s = 1 }: { s?: number }) {
  return (
    <g transform={`scale(${s})`}>
      <ellipse cx="7" cy="2" rx="15" ry="4" fill={P.shadow} opacity=".28" />
      <path d="M-4 0L-2 -40H3L5 0Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M-2 -2L0 -38H1L0 -2Z" fill={P.woodLight} />
      <path d="M0 -40C-10 -60 -30 -56 -36 -40C-26 -47 -12 -46 0 -36Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C10 -60 30 -56 36 -40C26 -47 12 -46 0 -36Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C-14 -38 -26 -30 -28 -18C-18 -26 -8 -28 0 -34Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C14 -38 26 -30 28 -18C18 -26 8 -28 0 -34Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C-6 -54 -2 -66 4 -70C6 -58 6 -48 0 -36Z" fill={P.mint} stroke={P.ink} strokeWidth="2" />
      <circle cx="1" cy="-38" r="3" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The island: kerb, planted ring, paved inner ring, the fountain basin, a spire and four palms. Drawn in scene pixels. */
function Roundabout({ ox, oy, uid }: { ox: number; oy: number; uid: string }) {
  return (
    <g transform={`translate(${-ox},${-oy})`}>
      <ellipse cx={CX + 8} cy={CY + 14} rx={ISLAND.rx} ry={ISLAND.ry} fill={P.shadow} opacity=".28" />
      <ellipse cx={CX} cy={CY + 8} rx={ISLAND.rx} ry={ISLAND.ry} fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={CX} cy={CY} rx={ISLAND.rx} ry={ISLAND.ry} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={CX} cy={CY} rx="146" ry="84" fill={`url(#${uid}-bed)`} stroke={P.leafDark} strokeWidth="2" />
      <ellipse cx={CX} cy={CY + 3} rx="100" ry="56" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <path d={`M${CX - 90} ${CY + 8}h14M${CX + 70} ${CY - 14}h16M${CX - 60} ${CY + 40}h18M${CX + 40} ${CY + 38}h14`} stroke={P.concrete} strokeWidth="2" />
      {/* basin */}
      <ellipse cx={CX} cy={CY + 6} rx="74" ry="40" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={CX} cy={CY} rx="74" ry="40" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={CX} cy={CY + 1} rx="62" ry="31" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <path d={`M${CX - 50} ${CY + 6}h18M${CX + 28} ${CY + 12}h22M${CX - 14} ${CY + 20}h14`} stroke={P.lagoonLight} strokeWidth="2" />
      {/* shrubs and the back palms */}
      {[[348, 288], [604, 284], [424, 232], [540, 234]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="16" height="10" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 2} y={y + 1} width="10" height="4" fill={P.mint} />
        </g>
      ))}
      <g transform="translate(404,252)"><TallPalm s={1.1} /></g>
      <g transform="translate(556,252)"><TallPalm s={1.1} /></g>
      {/* the spire: two steps, a tapering shaft with a green and a yellow band, a gold finial and four water jets */}
      <rect x={CX - 20} y={CY - 12} width="40" height="16" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x={CX - 14} y={CY - 22} width="28" height="12" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d={`M${CX - 8} ${CY - 22}L${CX - 4} ${CY - 106}H${CX + 4}L${CX + 8} ${CY - 22}Z`} fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x={CX - 6} y={CY - 60} width="12" height="6" fill={GREEN} />
      <rect x={CX - 5} y={CY - 76} width="10" height="6" fill={YELLOW} />
      <rect x={CX - 6} y={CY - 100} width="2" height="70" fill={P.paper} />
      <circle cx={CX} cy={CY - 112} r="7" fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <path d={`M${CX} ${CY - 20}Q${CX - 36} ${CY - 46} ${CX - 50} ${CY + 4}M${CX} ${CY - 20}Q${CX + 36} ${CY - 46} ${CX + 50} ${CY + 4}M${CX} ${CY - 20}Q${CX - 16} ${CY - 34} ${CX - 24} ${CY + 8}M${CX} ${CY - 20}Q${CX + 16} ${CY - 34} ${CX + 24} ${CY + 8}`} fill="none" stroke={P.lagoonLight} strokeWidth="3" />
      {/* the front palms */}
      <g transform="translate(372,322)"><TallPalm s={1.15} /></g>
      <g transform="translate(588,322)"><TallPalm s={1.15} /></g>
    </g>
  );
}

/** The sign's big word. The venue name from the place data goes small under it. */
const MALL_SIGN = "ICM";

type Pt = [number, number];
const CAR_BODY: Pt[] = [[1, 22], [1, 14], [6, 11], [14, 10], [19, 2], [37, 2], [46, 10], [54, 12], [55, 16], [55, 22]];
const CAR_GLASS: Pt[][] = [[[16, 10], [20, 4], [27, 4], [27, 10]], [[30, 4], [36, 4], [42, 10], [30, 10]]];

/** A parked car seen from the side, 56 px wide, as path data (body, glass, wheels, shadow) with its top-left at (x, y). `flip` faces it left. */
function carPaths(x: number, y: number, flip: boolean) {
  const X = (px: number) => x + (flip ? 56 - px : px);
  const poly = (pts: Pt[]) => `${pts.map(([px, py], i) => `${i ? "L" : "M"}${X(px)} ${y + py}`).join("")}Z`;
  const wheel = (px: number) => `M${X(px) - 5} ${y + 22}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z`;
  return { body: poly(CAR_BODY), glass: CAR_GLASS.map(poly).join(""), wheels: wheel(13) + wheel(43), shade: `M${x + 3} ${y + 22}h56v5h-56Z` };
}

/**
 * Ikeja City Mall ("ICM"): a modern shopping mall. A wide low-rise front of concrete with three shopfront windows under a
 * coloured signboard in each wing, a tall glass atrium in the middle with the dark sign on it (ICM big, the venue name small
 * under it, an orange edge), a canopy over glazed doors, flag banners on poles, and in front a car park with two parked
 * cars (art only) and planters. The paved walkway runs from the doors out through the gap in the car park's kerb (tile x 4
 * in the layout), so the gap reads as the way in.
 */
function IkejaCityMall({ w, name }: { w: number; name: string }) {
  const cx = w / 2;
  const flip = (x: number, wd: number) => w - x - wd;
  const bays = [6, 24, 42].flatMap((x) => [x, flip(x, 14)]);
  const boxes = (xs: number[], y: number, wd: number, ht: number) => xs.map((x) => `M${x} ${y}h${wd}v${ht}h${-wd}Z`).join("");
  const label = name.toUpperCase();
  const labelSize = Math.min(7, 90 / (label.length * 0.82));
  const bush = (x: number) => `M${x} 111V104L${x + 4} 99H${x + 12}L${x + 16} 104V111Z`;
  const left = carPaths(6, 100, false);
  const right = carPaths(w - 62, 100, true);
  return (
    <g>
      <Shade w={w} h={94} dx={6} dy={8} />
      {/* the entrance walkway: an apron under the canopy, then the path out through the kerb gap */}
      <path d={`M${cx - 22} 92H${cx + 22}V98H${cx + 16}V160H${cx - 16}V98H${cx - 22}Z`} fill={P.concrete} />
      <path d={`M${cx - 22} 92V98H${cx - 16}V160M${cx + 22} 92V98H${cx + 16}V160`} fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={`M4 100V127M68 100V127M${w - 68} 100V127M${w - 4} 100V127`} stroke={P.paper} strokeWidth="2" opacity=".9" />
      {/* the low front: roof edge, a signboard and a shopfront window per bay, the plinth */}
      <rect x="1" y="12" width={w - 2} height="80" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="14" width={w - 6} height="4" fill={P.paper} />
      <rect x="3" y="18" width={w - 6} height="5" fill={P.concreteDark} />
      <path d={boxes([6, 42, flip(24, 14)], 27, 14, 8)} fill={GREEN} stroke={P.ink} strokeWidth="1.5" />
      <path d={boxes([24, flip(6, 14), flip(42, 14)], 27, 14, 8)} fill={YELLOW} stroke={P.ink} strokeWidth="1.5" />
      <rect x="3" y="84" width={w - 6} height="8" fill={P.concreteDark} />
      <path d={boxes(bays, 38, 14, 44)} fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
      <path d={boxes(bays.map((x) => x + 1), 39, 12, 8)} fill={P.slate} />
      <path d={boxes(bays.map((x) => x + 3), 68, 8, 12)} fill={P.paper} />
      {/* the atrium: a steel frame, glass with a few light streaks, mullions and one transom */}
      <rect x={cx - 50} y="1" width="100" height="91" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 47} y="4" width="94" height="85" fill={P.lagoonLight} />
      <path d={`M${cx - 36} 88L${cx - 22} 36H${cx - 14}L${cx - 28} 88ZM${cx + 4} 88L${cx + 18} 36H${cx + 22}L${cx + 8} 88Z`} fill={P.paper} opacity=".45" />
      <path d={`M${cx - 36} 4V89M${cx - 24} 4V89M${cx - 12} 4V89M${cx} 4V89M${cx + 12} 4V89M${cx + 24} 4V89M${cx + 36} 4V89M${cx - 47} 50H${cx + 47}`} stroke={P.slate} strokeWidth="2" />
      {/* the sign: a dark plate, ICM big, the name small, one orange edge */}
      <rect x={cx - 52} y="3" width="104" height="30" fill={NIGHT} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 50} y="30" width="100" height="2" fill={P.orange} />
      <text x={cx} y="21" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="19" letterSpacing="2">{MALL_SIGN}</text>
      <text x={cx} y="28.5" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={labelSize} letterSpacing="1">{label}</text>
      {/* the glazed doors under the canopy */}
      <rect x={cx - 17} y="74" width="34" height="18" fill={NIGHT} stroke={P.ink} strokeWidth="2" />
      <path d={boxes([cx - 14, cx + 3], 77, 11, 13)} fill={P.lagoonLight} />
      <rect x={cx - 34} y="74" width="68" height="7" fill={P.shadow} opacity=".35" />
      <rect x={cx - 36} y="62" width="72" height="6" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 36} y="68" width="72" height="6" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 33} 75V100M${cx + 33} 75V100`} stroke={P.ink} strokeWidth="3" />
      {/* flag banners on poles, either side of the atrium */}
      <path d={`M${cx - 54} 96V30M${cx - 54} 33H${cx - 40}M${cx + 54} 96V30M${cx + 54} 33H${cx + 40}`} stroke={P.ink} strokeWidth="3" />
      <path d={`M${cx - 58} 93h8v5h-8ZM${cx + 50} 93h8v5h-8Z`} fill={P.concreteDark} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${cx - 52} 35H${cx - 40}V63L${cx - 46} 58L${cx - 52} 63Z`} fill={GREEN} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${cx + 40} 35H${cx + 52}V63L${cx + 46} 58L${cx + 40} 63Z`} fill={YELLOW} stroke={P.ink} strokeWidth="1.5" />
      {/* the kerb's end posts, planters, and the two parked cars */}
      <path d={`M${cx - 22} 130h6v16h-6ZM${cx + 16} 130h6v16h-6Z`} fill={P.cap} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${cx - 40} 110h18v14h-18ZM${cx + 22} 110h18v14h-18Z`} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d={bush(cx - 39) + bush(cx + 23)} fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d={left.shade + right.shade} fill={P.shadow} opacity=".25" />
      <path d={left.body} fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <path d={right.body} fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <path d={left.glass + right.glass} fill={P.lagoonLight} />
      <path d={left.wheels + right.wheels} fill={P.ink} />
    </g>
  );
}

/** New Afrika Shrine: an open-air stage under a long banner between two tall pillars. */
function Shrine({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="12" y="26" width={w - 24} height="46" fill={NIGHT} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="30" width={w - 28} height="6" fill={GREEN} />
      <rect x="14" y="38" width={w - 28} height="6" fill={YELLOW} />
      <rect x="14" y="46" width={w - 28} height="6" fill={GREEN} />
      <circle cx={w / 2} cy="56" r="10" fill={YELLOW} stroke={P.ink} strokeWidth="2" />
      <circle cx={w / 2 - 3} cy="53" r="3" fill={YELLOW_LIGHT} />
      {/* the long banner */}
      <rect x="10" y="2" width={w - 20} height="26" fill={P.violet} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="4" width={w - 24} height="2" fill={P.violetLight} />
      <Plate x={22} y={8} w={w - 44} h={18} text={name} fill={P.violet} color={YELLOW} />
      {/* the stage */}
      <rect x="8" y="58" width={w - 16} height="36" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="60" width={w - 20} height="20" fill={`url(#${uid}-stagewood)`} />
      <rect x="10" y="80" width={w - 20} height="12" fill={P.woodDark} />
      <rect x="10" y="85" width={w - 20} height="2" fill={P.orange} />
      <rect x="26" y="62" width="16" height="16" fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <circle cx="34" cy="70" r="4" fill={P.slate} />
      <rect x={w - 42} y="62" width="16" height="16" fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <circle cx={w - 34} cy="70" r="4" fill={P.slate} />
      <circle cx={w / 2} cy="70" r="7" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <circle cx={w / 2 - 18} cy="72" r="5" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <circle cx={w / 2 + 18} cy="72" r="5" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 + 40} y="62" width="2" height="14" fill={P.ink} />
      <rect x={w / 2 + 38} y="60" width="6" height="4" fill={P.ink} />
      <StringLights x1={22} x2={w - 22} y={28} sag={6} bulbs={8} colors={[YELLOW, P.white, GREEN]} />
      {/* the tall pillars */}
      {[0, w - 16].map((x) => (
        <g key={x}>
          <rect x={x} y="0" width="16" height="94" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="6" width="4" height="86" fill={P.paper} />
          <rect x={x} y="32" width="16" height="6" fill={YELLOW} stroke={P.ink} strokeWidth="1" />
          <rect x={x} y="42" width="16" height="6" fill={GREEN} stroke={P.ink} strokeWidth="1" />
          <rect x={x - 2} y="0" width="20" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
    </g>
  );
}

/** Computer Village: a block of phone stalls under a corrugated roof, signs for phones and chargers, awnings and tables. */
function ComputerVillage({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const bay = (w - 24) / 5;
  const signs = ["PHONES", "SIM", "REPAIR", "CHARGER", "SCREEN"];
  const cloths = [YELLOW, P.white, GREEN, P.orange, YELLOW];
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="22" fill={`url(#${uid}-corr)`} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w - 8} height="3" fill={GREEN_LIGHT} />
      <Plate x={10} y={27} w={w - 20} h={20} text={name} fill={NIGHT} color={YELLOW} />
      {Array.from({ length: 5 }, (_, i) => {
        const x = 12 + i * bay;
        const bw = bay - 3;
        return (
          <g key={i}>
            <rect x={x} y="50" width={bw} height="9" fill={i % 2 ? P.white : YELLOW} stroke={P.ink} strokeWidth="2" />
            <rect x={x + 1} y="59" width={bw - 2} height="26" fill={NIGHT} />
            <Plate x={x + 3} y={62} w={bw - 6} h={9} text={signs[i]} fill={GREEN} color={P.paper} mono size={5.5} />
            <rect x={x + 5} y="74" width="7" height="10" fill={P.white} />
            <rect x={x + 15} y="74" width="7" height="10" fill={YELLOW} />
            <rect x={x + 25} y="74" width="7" height="10" fill={P.lagoonLight} />
            <rect x={x} y="85" width={bw} height="14" fill={P.wood} stroke={P.ink} strokeWidth="2" />
            <rect x={x + 2} y="86" width={bw - 4} height="4" fill={cloths[i]} />
          </g>
        );
      })}
      <Plate x={10} y={104} w={w - 20} h={16} text="Phones  Chargers  Repairs  Accessories" fill={YELLOW} color={NIGHT} mono />
    </g>
  );
}

/** The Place GRA: a casual restaurant frontage with a striped awning, warm windows, an orange door and a patio under lights. */
function PlaceGra({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  let zig = "M6 50";
  for (let x = 6; x < w - 12; x += 16) zig += "l8 6l8 -6";
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="10" fill={GREEN} />
      <rect x="3" y="3" width={w - 6} height="3" fill={GREEN_LIGHT} />
      <Plate x={36} y={15} w={w - 72} h={18} text={name} fill={NIGHT} color={YELLOW} />
      <rect x="6" y="36" width={w - 12} height="14" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <path d={`${zig}V50Z`} fill={GREEN} stroke={P.ink} strokeWidth="1" />
      {[12, w - 84].map((x) => (
        <g key={x}>
          <rect x={x} y="58" width="72" height="28" fill={YELLOW_LIGHT} stroke={P.ink} strokeWidth="2" />
          <path d={`M${x + 36} 58V86M${x} 70H${x + 72}`} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 8} y="74" width="14" height="8" fill={P.wood} />
          <rect x={x + 46} y="74" width="14" height="8" fill={P.wood} />
        </g>
      ))}
      <rect x={w / 2 - 16} y="56" width="32" height="38" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 11} y="61" width="22" height="20" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w / 2 + 8} y="84" width="3" height="6" fill={P.paper} />
      <rect x={w / 2 - 22} y={h - 4} width="44" height="4" fill={P.concreteDark} />
      <g transform={`translate(0,${h - 2})`}>
        <StringLights x1={6} x2={w - 6} y={0} sag={8} bulbs={9} colors={[YELLOW, P.white, GREEN]} />
      </g>
    </g>
  );
}

/** A danfo seen from the side, facing right (odd variants face left). The destination board is the only text. */
function Danfo({ w, h, v }: { w: number; h: number; v: number }) {
  const left = v % 2 === 1;
  const plateX = left ? 6 : w - 36;
  return (
    <g>
      <g transform={left ? `translate(${w},0) scale(-1,1)` : undefined}>
        <rect x="6" y="21" width={w - 6} height="12" fill={P.shadow} opacity=".25" />
        <circle cx="20" cy="27" r="5" fill={P.ink} />
        <circle cx={w - 22} cy="27" r="5" fill={P.ink} />
        <circle cx="20" cy="27" r="2" fill={P.concrete} />
        <circle cx={w - 22} cy="27" r="2" fill={P.concrete} />
        <rect x="1" y="4" width={w - 2} height={h - 10} fill={YELLOW} stroke={P.ink} strokeWidth="2" />
        <rect x="3" y="5" width={w - 6} height="3" fill={YELLOW_LIGHT} />
        {Array.from({ length: 4 }, (_, i) => <rect key={i} x={6 + i * 17} y="9" width="14" height="8" fill="#9FD3E8" stroke={P.ink} strokeWidth="1" />)}
        <rect x={w - 24} y="9" width="18" height="8" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
        <rect x="2" y="19" width={w - 4} height="3" fill={NIGHT} />
        <rect x="2" y="22" width={w - 4} height="3" fill={YELLOW_DARK} />
        {(v === 0 || v === 3) && <rect x="14" y="1" width="30" height="5" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />}
        <rect x={w - 5} y="20" width="3" height="3" fill={P.white} />
        <rect x="2" y="20" width="3" height="3" fill={P.red} />
      </g>
      <Plate x={plateX} y={-3} w={30} h={8} text={DESTINATIONS[v % DESTINATIONS.length]} fill={NIGHT} color={YELLOW} mono size={5.5} />
    </g>
  );
}

/** A keke (tricycle taxi): green body, yellow roof, one wheel in front. */
function Keke({ w, flip }: { w: number; flip: boolean }) {
  return (
    <g transform={flip ? `translate(${w},0) scale(-1,1)` : undefined}>
      <rect x="6" y="21" width={w - 6} height="10" fill={P.shadow} opacity=".25" />
      <circle cx="16" cy="26" r="5" fill={P.ink} />
      <circle cx={w - 12} cy="27" r="4" fill={P.ink} />
      <circle cx="16" cy="26" r="2" fill={P.concrete} />
      <rect x="4" y="12" width={w - 10} height="13" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="3" width={w - 20} height="9" fill={YELLOW} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w - 24} height="2" fill={YELLOW_LIGHT} />
      <rect x="8" y="14" width="26" height="8" fill={NIGHT} />
      <path d={`M${w - 18} 12L${w - 8} 15V24H${w - 18}Z`} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 8} y="19" width="3" height="3" fill={P.white} />
    </g>
  );
}

/** A phone seller's table under a parasol. */
function Umbrella({ w, v }: { w: number; v: number }) {
  const [a, b] = UMBRELLAS[v % UMBRELLAS.length];
  const cx = w / 2;
  const r = Math.max(13, cx - 3);
  return (
    <g>
      <ellipse cx={cx + 4} cy="28" rx={Math.max(8, cx - 6)} ry="3" fill={P.shadow} opacity=".25" />
      <rect x={cx - 1} y="6" width="3" height="14" fill={P.ink} />
      <rect x={cx - 13} y="18" width="26" height="9" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 11} y="19" width="22" height="3" fill={P.paper} />
      <rect x={cx - 9} y="15" width="5" height="3" fill={P.white} />
      <rect x={cx - 2} y="15" width="5" height="3" fill={NIGHT} />
      <rect x={cx + 5} y="15" width="5" height="3" fill={P.lagoonLight} />
      <path d={`M${cx - r} 12C${cx - r} -4 ${cx + r} -4 ${cx + r} 12Z`} fill={a} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - r * 0.55} 11L${cx - r * 0.25} -1H${cx - r * 0.02}L${cx - r * 0.2} 11ZM${cx + r * 0.3} 11L${cx + r * 0.15} -1H${cx + r * 0.38}L${cx + r * 0.62} 11Z`} fill={b} />
    </g>
  );
}

/** A stack of boxes of phones and chargers. */
function Boxes({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="6" y="14" width={w} height={h - 12} fill={P.shadow} opacity=".25" />
      <rect x="3" y={h - 26} width={w - 6} height="22" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 2} y={h - 26} width="4" height="22" fill={P.wood} />
      <rect x="5" y={h - 46} width={w - 10} height="20" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 2} y={h - 46} width="4" height="20" fill={P.wood} />
      <rect x="8" y={h - 62} width={w - 16} height="16" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y={h - 58} width="8" height="4" fill={P.white} />
    </g>
  );
}

/** A street lamp: the pole rises above its tile. */
function StreetLamp() {
  return (
    <g>
      <rect x="10" y="26" width="18" height="5" fill={P.shadow} opacity=".28" />
      <rect x="10" y="24" width="12" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <path d="M16 24V-24" stroke={P.ink} strokeWidth="4" />
      <path d="M15 22V-22" stroke={P.cap} strokeWidth="1" />
      <path d="M16 -24Q16 -32 28 -32" fill="none" stroke={P.ink} strokeWidth="3" />
      <rect x="24" y="-36" width="14" height="7" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="26" y="-30" width="10" height="3" fill={YELLOW_LIGHT} />
    </g>
  );
}

/** The way out: a city map signpost. A tall board on a post over a concrete foot, with its own MAP plate. */
function MapPost({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="10" y="20" width={w - 4} height="12" fill={P.shadow} opacity=".25" />
      <rect x="10" y={h - 8} width={w - 20} height="7" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 3} y="-4" width="6" height={h - 10} fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="-38" width={w - 8} height="36" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="-35" width={w - 14} height="26" fill={P.paper} />
      <path d={`M9 -14L20 -24L32 -18L44 -28L${w - 9} -22`} fill="none" stroke={P.lagoon} strokeWidth="3" />
      <rect x="11" y="-31" width="8" height="5" fill={GREEN} />
      <rect x={w - 22} y="-17" width="8" height="5" fill={YELLOW} />
      <path d={`M${w / 2 + 4} -32h6v7l-3 4-3-4Z`} fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <Plate x={w / 2 - 14} y={-9} w={28} h={10} text="MAP" fill={P.orange} color={NIGHT} size={7} />
    </g>
  );
}

/** The Hoppaz billboard: the brand sign (bounce wordmark on orange, HOP OR STAY on the night strip) on two legs. */
function Billboard({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="8" y="28" width={w - 6} height={h - 28} fill={P.shadow} opacity=".25" />
      <rect x="14" y="36" width="5" height={h - 38} fill={P.ink} />
      <rect x={w - 19} y="36" width="5" height={h - 38} fill={P.ink} />
      <BrandSign x={2} y={0} w={w - 4} h={42} wordmark tone="orange" sub={BRAND_LINES.hop} />
    </g>
  );
}

/** The road sign over the north arm: a green board with the sign's word in white, arrows either side. */
function AllenSign({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="10" y="12" width={w - 8} height={h - 12} fill={P.shadow} opacity=".25" />
      <rect x="28" y="44" width="6" height={h - 44} fill={P.ink} />
      <rect x={w - 34} y="44" width="6" height={h - 44} fill={P.ink} />
      <rect x="6" y="4" width={w - 12} height="42" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="8" width={w - 20} height="34" fill={GREEN} />
      <rect x="10" y="8" width={w - 20} height="3" fill={GREEN_LIGHT} />
      <text x={w / 2} y="35" textAnchor="middle" fill={P.white} fontFamily={FONT.display} fontWeight={900} fontSize="28" letterSpacing="6">{SIGN}</text>
      <path d="M18 25L30 17V22H38V28H30V33Z" fill={YELLOW} />
      <path d={`M${w - 18} 25L${w - 30} 17V22H${w - 38}V28H${w - 30}V33Z`} fill={YELLOW} />
      {[40, 100, w - 100, w - 40].map((x) => <rect key={x} x={x - 3} y="0" width="6" height="4" fill={P.cap} stroke={P.ink} strokeWidth="1" />)}
    </g>
  );
}

/** A suya grill: coals, skewers, smoke and a small yellow sign. */
function SuyaGrill({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="6" y="22" width={w - 4} height={h - 22} fill={P.shadow} opacity=".25" />
      <path d={`M10 24V${h}M${w - 10} 24V${h}`} stroke={P.ink} strokeWidth="3" />
      <rect x="4" y="14" width={w - 8} height="12" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="16" width={w - 14} height="5" fill={P.ember} />
      {Array.from({ length: 5 }, (_, i) => <rect key={i} x={9 + i * 10} y="9" width="6" height="8" fill={P.emberDark} stroke={P.ink} strokeWidth="1" />)}
      <path d={`M8 12H${w - 8}`} stroke={P.woodDark} strokeWidth="1" />
      <rect x="14" y="1" width="7" height="5" fill={P.paper} opacity=".55" />
      <rect x="36" y="0" width="8" height="5" fill={P.paper} opacity=".45" />
      <Plate x={w / 2 - 14} y={22} w={28} h={9} text="SUYA" fill={YELLOW} color={NIGHT} mono size={6} />
    </g>
  );
}

/** A newspaper stand: a green awning over a rack of papers. */
function NewsStand() {
  return (
    <g>
      <rect x="6" y="14" width="26" height="17" fill={P.shadow} opacity=".25" />
      <rect x="3" y="13" width="26" height="17" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="3" width="30" height="10" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="4" width="26" height="3" fill={GREEN_LIGHT} />
      <rect x="6" y="15" width="6" height="9" fill={P.white} />
      <rect x="13" y="15" width="6" height="9" fill={P.paper} />
      <rect x="20" y="15" width="6" height="9" fill={YELLOW} />
      <rect x="6" y="15" width="6" height="3" fill={P.red} />
    </g>
  );
}

/** A bus stop sign on a pole. */
function BusStop({ h }: { h: number }) {
  return (
    <g>
      <rect x="14" y="30" width="14" height={h - 32} fill={P.shadow} opacity=".25" />
      <rect x="9" y={h - 8} width="14" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="14" width="4" height={h - 22} fill={P.cap} stroke={P.ink} strokeWidth="1" />
      <rect x="4" y="2" width="24" height="16" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="5" width="16" height="7" fill={P.white} />
      <rect x="10" y="12" width="4" height="2" fill={P.white} />
      <rect x="18" y="12" width="4" height="2" fill={P.white} />
    </g>
  );
}

/** A patio table under a striped parasol. */
function PatioTable({ w, h, v }: { w: number; h: number; v: number }) {
  const cx = w / 2;
  const tone = v % 2 ? YELLOW : GREEN;
  return (
    <g>
      <ellipse cx={cx + 6} cy={h - 6} rx="24" ry="6" fill={P.shadow} opacity=".25" />
      <rect x="3" y="38" width="10" height="13" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 13} y="38" width="10" height="13" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 2} y="26" width="4" height="20" fill={P.ink} />
      <ellipse cx={cx} cy="46" rx="14" ry="7" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 28} 28C${cx - 28} 2 ${cx + 28} 2 ${cx + 28} 28Z`} fill={tone} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 14} 27L${cx - 8} 6H${cx - 2}L${cx - 4} 27ZM${cx + 6} 27L${cx + 4} 6H${cx + 10}L${cx + 16} 27Z`} fill={P.paper} />
    </g>
  );
}

/** Building backs along the top (h 2) and the car park's kerb with a clipped hedge in front of the mall (h 1). */
function WallPiece({ x, y, w, h, tall }: { x: number; y: number; w: number; h: number; tall: boolean }) {
  if (tall) {
    return (
      <g>
        <rect x={x + 5} y={y + 7} width={w} height={h} fill={P.shadow} opacity=".25" />
        <rect x={x} y={y} width={w} height={h} fill={P.ink} />
        <rect x={x + 3} y={y + 3} width={w - 6} height={h - 8} fill={P.concrete} />
        <rect x={x + 2} y={y + 2} width={w - 4} height="5" fill={P.paper} />
        <rect x={x + 3} y={y + h - 22} width={w - 6} height="8" fill={GREEN} />
        <path d={Array.from({ length: Math.floor(w / 32) }, (_, i) => `M${x + 16 + i * 32} ${y + 8}V${y + h - 22}`).join("")} stroke={P.concreteDark} strokeWidth="2" />
        {[P.orange, P.lagoon].map((c, i) => (
          <g key={i}>
            <rect x={x + 12 + i * 40} y={y + 12} width="24" height="22" fill={c} stroke={P.ink} strokeWidth="2" />
            <rect x={x + 16 + i * 40} y={y + 22} width="16" height="4" fill={P.paper} />
          </g>
        ))}
      </g>
    );
  }
  const bumps = Math.round((w - 4) / 8);
  const bump = (w - 4) / bumps;
  let hedge = `M${x + 2} ${y + 16}`;
  for (let i = 0; i < bumps; i++) hedge += `V${y + [8, 6, 9, 7][i % 4]}h${bump}`;
  hedge += `V${y + 16}Z`;
  return (
    <g>
      <rect x={x + 4} y={y + 8} width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x={x} y={y + 14} width={w} height={h - 14} fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <path d={hedge} fill={P.leaf} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

export default function HotspotIkejaArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const fill = (name: string) => `url(#${uid}-${name})`;
  const t = (n: number) => n * tile;

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    hero: (p, tl) => <Roundabout ox={p.x * tl} oy={p.y * tl} uid={uid} />,
    island: () => null,
    "venue-1": (p, tl) => <IkejaCityMall w={p.w * tl} name={NAMES[0]} />,
    "venue-2": (p, tl) => <Shrine w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[1]} />,
    "venue-3": (p, tl) => <ComputerVillage w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[2]} />,
    "venue-4": (p, tl) => <PlaceGra w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[3]} />,
    allensign: (p, tl) => <AllenSign w={p.w * tl} h={p.h * tl} />,
    billboard: (p, tl) => <Billboard w={p.w * tl} h={p.h * tl} />,
    "entry-map-table": (p, tl) => <MapPost w={p.w * tl} h={p.h * tl} />,
    "danfo-3": (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} />,
    danfo: (p, tl) => <Danfo w={p.w * tl} h={p.h * tl} v={p.variant ?? 0} />,
    keke: (p, tl) => <Keke w={p.w * tl} flip={(p.variant ?? 0) === 1} />,
    umbrella: (p, tl) => <Umbrella w={p.w * tl} v={p.variant ?? 0} />,
    boxes: (p, tl) => <Boxes w={p.w * tl} h={p.h * tl} />,
    palm: () => <g transform="translate(16,30)"><TallPalm /></g>,
    streetlamp: () => <StreetLamp />,
    suyagrill: (p, tl) => <SuyaGrill w={p.w * tl} h={p.h * tl} />,
    newsstand: () => <NewsStand />,
    busstop: (p, tl) => <BusStop h={p.h * tl} />,
    patiotable: (p, tl) => <PatioTable w={p.w * tl} h={p.h * tl} v={p.variant ?? 0} />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["paving", "asphalt", "concrete", "grass", "deck", "stagewood"]} />
      <defs>
        <pattern id={`${uid}-zebraH`} width="32" height="12" patternUnits="userSpaceOnUse"><rect width="32" height="6" fill={P.white} /></pattern>
        <pattern id={`${uid}-zebraV`} width="12" height="32" patternUnits="userSpaceOnUse"><rect width="6" height="32" fill={P.white} /></pattern>
        <pattern id={`${uid}-bed`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={P.leaf} />
          <path d="M2 3h3M9 11h3M12 4h2" stroke={P.leafDark} strokeWidth="1" />
          <rect x="3" y="9" width="2" height="2" fill={YELLOW} />
          <rect x="11" y="1" width="2" height="2" fill={P.white} />
          <rect x="7" y="5" width="2" height="2" fill={P.orange} />
        </pattern>
        <pattern id={`${uid}-corr`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={GREEN} />
          <rect width="3" height="8" fill={GREEN_DARK} />
          <rect x="4" width="1" height="8" fill={GREEN_LIGHT} />
        </pattern>
        <pattern id={`${uid}-awn`} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={GREEN} />
          <rect x="16" width="16" height="16" fill={P.paper} />
        </pattern>
      </defs>

      {/* The ground: hedge all round, paving inside it, the plaza and the two yards. */}
      <Frame layout={layout} ground="#2F3A2C" />
      <rect width={W} height={H} fill={fill("grass")} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={fill("paving")} stroke={P.ink} strokeWidth="4" />
      <path d={`M0 0H${W}V${H}H0Z M${tile} ${tile}V${H - tile}H${W - tile}V${tile}Z`} fill={P.leafDark} fillRule="evenodd" opacity=".5" />
      <Floor uid={uid} rect={{ x: 8, y: 14, w: 14, h: 5 }} material="concrete" tile={tile} />
      <Floor uid={uid} rect={{ x: 1, y: 15, w: 7, h: 4 }} material="concrete" tile={tile} />
      <Floor uid={uid} rect={{ x: 22, y: 15, w: 7, h: 4 }} material="deck" tile={tile} />
      <path d={`M${t(1)} ${t(15)}H${t(8)}M${t(22)} ${t(15)}H${t(29)}`} stroke={P.ink} strokeWidth="2" />
      <rect x={t(16) + 6} y={t(17) + 4} width={t(5) - 12} height={t(1) - 8} fill="none" stroke={P.orange} strokeWidth="2" strokeDasharray="8 6" />

      {/* The roads: a planted verge, the kerb, Allen Avenue, the two stubs and the ring. */}
      <ellipse cx={CX} cy={CY} rx={ROAD.rx + 20} ry={ROAD.ry + 20} fill={fill("grass")} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={CX} cy={CY} rx={ROAD.rx + 5} ry={ROAD.ry + 5} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y={t(7)} width={W} height={t(4)} fill={fill("asphalt")} />
      <rect x={t(13)} y={t(3)} width={t(4)} height={t(2)} fill={fill("asphalt")} />
      <rect x={t(12)} y={t(13)} width={t(6)} height={t(2)} fill={fill("asphalt")} />
      <ellipse cx={CX} cy={CY} rx={ROAD.rx} ry={ROAD.ry} fill={fill("asphalt")} />
      <path d={`M0 ${t(7)}H275M685 ${t(7)}H${W}M0 ${t(11)}H275M685 ${t(11)}H${W}M${t(13)} ${t(3)}V134M${t(17)} ${t(3)}V134M${t(12)} 436V${t(15)}M${t(18)} 436V${t(15)}`} stroke={P.ink} strokeWidth="5" />
      <path d={`M0 ${t(7)}H275M685 ${t(7)}H${W}M0 ${t(11)}H275M685 ${t(11)}H${W}M${t(13)} ${t(3)}V134M${t(17)} ${t(3)}V134M${t(12)} 436V${t(15)}M${t(18)} 436V${t(15)}`} stroke={P.concrete} strokeWidth="2" />

      {/* Lane marks: the avenue's centre line, the ring's lane line, arrows and zebra crossings. */}
      <path d={`M0 ${CY}H262M698 ${CY}H${W}`} stroke={P.white} strokeWidth="2" strokeDasharray="14 10" opacity=".85" />
      <ellipse cx={CX} cy={CY} rx="192" ry="128" fill="none" stroke={P.white} strokeWidth="2" strokeDasharray="12 10" opacity=".85" />
      {RING_ARROWS.map((a) => <path key={`${a.x}-${a.y}`} d={ARROW} transform={`translate(${a.x},${a.y}) rotate(${a.turn})`} fill={P.white} opacity=".9" />)}
      {[[60, 322, 0], [120, 322, 0], [770, 322, 0], [190, 254, 180], [860, 254, 180], [910, 254, 180]].map(([x, y, r]) => <path key={`${x}-${y}`} d={ARROW} transform={`translate(${x},${y}) rotate(${r})`} fill={P.white} opacity=".9" />)}
      <rect x={t(7)} y={t(7) + 4} width={tile} height={t(4) - 8} fill={fill("zebraH")} />
      <rect x={t(22)} y={t(7) + 4} width={tile} height={t(4) - 8} fill={fill("zebraH")} />
      <rect x="420" y={t(3)} width="120" height={tile} fill={fill("zebraV")} />
      <rect x="384" y={t(14)} width="192" height={tile} fill={fill("zebraV")} />

      {/* Building backs along the top and the car park's kerb in front of the mall (the gap in it is the mall's walkway, drawn with the venue). */}
      {layout.walls.map((wl, i) => <WallPiece key={i} x={t(wl.x)} y={t(wl.y)} w={t(wl.w)} h={t(wl.h)} tall={wl.h >= 2} />)}

      {/* The Hop's route: Stop 1 in the Shrine yard (the natural first stop), along the plaza, finale at the bus in its bay. */}
      <RouteLine points={[[144, 552], [240, 552], [400, 552], [536, 552]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* A rubber stamp in the Shrine yard, under Stop 1. */}
      <Stamp x={t(4) + 16} y={t(18) + 8} text={BRAND_LINES.hop} size={7} rotate={-5} />

      {/* Late sun: a warm wash over everything. */}
      <rect width={W} height={H} fill={P.orange} opacity=".05" />
    </svg>
  );
}
