import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, Defs, FONT, Frame, HopBus, P, PaperScraps, Plate, Props, RouteLine, Shade, Stamp, type RoomArtProps } from "./kit";

/**
 * Ikotun, in Alimosho: a market grid on a busy late morning, in the place's brown and sand. Rows of umbrella stalls and
 * stacks of bales fill the middle, a covered shed with a big orange IKOTUN board stands over the top lane, lock-up shops
 * flank it, and the four venues sit at the corners: Iyana Ipaja Terminal (bottom left, coaches on the road in front),
 * The Place (top left, big screens and a snooker table), KAF Mall (top right, glass front and a cinema block) and
 * Brainfield Event Centre (bottom right, a hall with a pool and a slide). Names, sign and palette come from the place data
 * (src/lib/rooms/hotspotRooms.ts). Same pixel look as the clubhouse: 2 px ink, top-left light, hard shadow to the lower
 * right, flat colour. Names only on the venues: no logos, no photos.
 *
 * The Hoppaz layer (brand kit, docs/ROOM-TEMPLATES.md "Look"): the orange Hop bus in its bay beside the spawn (prop
 * `hop-bus`), the route running up the left lane, across under the shed and down the right lane past the four venue doors
 * (the finale at Brainfield), the Hop board by the bus with the bounce wordmark, orange and cream vendor umbrellas on the
 * stalls, one scrap patch on the lock-ups and one stamp on the road. No violet shape in this room.
 */
const PLACE = hotspotRoomData("alimosho");
const SIGN = PLACE?.sign ?? "IKOTUN";
const PAL = PLACE?.palette ?? { primary: "#8E3B1F", secondary: "#F2D0A4", accent: "#FF4D00" };
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["Iyana Ipaja Terminal", "The Place", "KAF Mall", "Brainfield Event Centre"];

const BROWN = PAL.primary;
const BROWN_DARK = "#5F2712";
const BROWN_LIGHT = "#B4572F";
const SAND = PAL.secondary;
const SAND_DARK = "#D9AE7C";
const SAND_LIGHT = "#FBE6C6";
const DUST = "#C99A6A";
const SACK = "#C9A06C";
const SACK_DARK = "#9C7444";
const SACK_LIGHT = "#E0BE8A";

/** Umbrella canopies: [main, stripe]. Orange and cream is the Hoppaz vendor umbrella, brown and sand the market's own, yellow the danfo's. */
const UMBRELLAS: [string, string][] = [[P.orange, P.paper], [BROWN, SAND], [P.danfo, P.paper], [P.paper, P.orange]];
const DESTINATIONS = ["IKOTUN", "IPAJA", "EGBEDA"];

/** Subpaths for a row of identical rectangles: one SVG node instead of one per rectangle. */
const rects = (xs: number[], y: number, w: number, h: number) => xs.map((x) => `M${x} ${y}h${w}v${h}h${-w}Z`).join("");

// ---- Market goods (each drawn in its own box, (0,0) is the box's top-left) ----------------------------------------------

/** An umbrella stall: a big canopy over a table of folded clothes, shirts hanging from its rim. 2 by 2 tiles. */
function Stall({ v }: { v: number }) {
  const [a, b] = UMBRELLAS[v % UMBRELLAS.length];
  const xb = (i: number) => -3 + i * 14;
  const xt = (i: number) => 8 + i * 9.6;
  const stripes = [1, 3].map((i) => `M${xb(i)} 28L${xt(i)} 6H${xt(i + 1)}L${xb(i + 1)} 28Z`).join("");
  return (
    <g>
      <rect x="8" y="52" width="58" height="12" fill={P.shadow} opacity=".25" />
      <rect x="30" y="8" width="4" height="52" fill={P.ink} />
      <rect x="6" y="42" width="52" height="7" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="49" width="52" height="11" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="51" width="48" height="6" fill={v % 2 ? a : b} />
      <path d={rects([9, 27, 45], 34, 11, 8)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d={rects([20, 38, 52], 36, 7, 6)} fill={BROWN_LIGHT} stroke={P.ink} strokeWidth="1" />
      <path d={rects([5, 15, 24, 40, 48, 56], 30, 5, 11)} fill={b} stroke={P.ink} strokeWidth="1" />
      <path d={rects([10, 34, 52], 30, 4, 8)} fill={a} stroke={P.ink} strokeWidth="1" />
      <path d="M-3 28L8 6H56L67 28Z" fill={a} stroke={P.ink} strokeWidth="2" />
      <path d={stripes} fill={b} />
      <rect x="10" y="7" width="44" height="2" fill={P.paper} opacity=".4" />
      <rect x="-1" y="28" width="66" height="3" fill={P.ink} opacity=".35" />
    </g>
  );
}

/** A stack of bales of second-hand clothes: sacking, nylon wrap, rope, a few colours poking out. 2 by 2 tiles. */
function Bales({ v }: { v: number }) {
  const top = [BROWN_LIGHT, SAND_DARK, P.paper][v % 3];
  return (
    <g>
      <rect x="8" y="48" width="58" height="14" fill={P.shadow} opacity=".25" />
      <rect x="4" y="32" width="30" height="28" fill={SACK} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="34" width="26" height="3" fill={SACK_LIGHT} />
      <rect x="36" y="36" width="26" height="24" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="38" y="38" width="22" height="3" fill={SAND_LIGHT} />
      <rect x="14" y="10" width="34" height="24" fill={top} stroke={P.ink} strokeWidth="2" />
      <rect x="16" y="12" width="30" height="3" fill={SACK_LIGHT} opacity=".7" />
      <path d="M4 46H34M19 32V60M36 48H62M49 36V60M14 22H48M31 10V34" stroke={P.ink} strokeWidth="1.5" opacity=".55" />
      <path d="M42 6h8v5h-8ZM8 28h7v4h-7Z" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <path d="M50 8h6v4h-6ZM54 32h6v4h-6Z" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="56" width="62" height="3" fill={SACK_DARK} opacity=".5" />
    </g>
  );
}

/** A petrol generator on a frame, humming: a yellow fuel cap, a pipe and a puff of smoke. 1 tile. */
function Generator() {
  return (
    <g>
      <rect x="6" y="24" width="26" height="7" fill={P.shadow} opacity=".3" />
      <rect x="9" y="-3" width="7" height="5" fill={P.paper} opacity=".5" />
      <rect x="10" y="3" width="3" height="10" fill={P.ink} />
      <rect x="3" y="12" width="26" height="17" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="14" width="22" height="3" fill={P.cap} />
      <rect x="6" y="19" width="13" height="8" fill={P.ink} />
      <rect x="21" y="6" width="8" height="7" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="29" width="5" height="3" fill={P.ink} />
      <rect x="25" y="29" width="5" height="3" fill={P.ink} />
    </g>
  );
}

/** A hawker's orange basin of pure water sachets on a stool. 1 tile. */
function Sachets() {
  return (
    <g>
      <ellipse cx="17" cy="29" rx="12" ry="3" fill={P.shadow} opacity=".3" />
      <rect x="10" y="22" width="12" height="8" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d={rects([6, 12, 18, 24], 4, 5, 9)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d={rects([6, 12, 18, 24], 4, 5, 2)} fill={P.lagoonLight} />
      <path d="M2 12H30L26 24H6Z" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="13" width="24" height="3" fill={P.paper} opacity=".4" />
    </g>
  );
}

/** An electric pole with its crossarm and wires: it rises two tiles above its box. 1 tile. */
function Pole() {
  return (
    <g>
      <rect x="8" y="27" width="20" height="5" fill={P.shadow} opacity=".3" />
      <rect x="13" y="-66" width="7" height="95" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="15" y="-64" width="2" height="90" fill={P.woodLight} />
      <rect x="2" y="-56" width="30" height="4" fill={P.ink} />
      <rect x="6" y="-44" width="22" height="3" fill={P.ink} />
      <path d={rects([3, 14, 28], -62, 3, 6) + rects([8, 24], -50, 3, 6)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d="M4 -52Q-26 -40 -58 -50M31 -52Q60 -40 92 -48M9 -41Q-18 -30 -50 -38" fill="none" stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

// ---- Vehicles ------------------------------------------------------------------------------------------------------

/** A danfo, side on: yellow with the black stripe, a roof rack and a destination board. Odd variants face the other way. 3 by 1 tiles. */
function Danfo({ w, v }: { w: number; v: number }) {
  const flip = v % 2 === 1;
  return (
    <g>
      <g transform={flip ? `translate(${w} 0) scale(-1 1)` : undefined}>
        <rect x="8" y="20" width={w - 8} height="10" fill={P.shadow} opacity=".3" />
        <path d={`M14 -15H${w - 14}M18 -15v5M${w / 2} -15v5M${w - 18} -15v5`} stroke={P.ink} strokeWidth="2" />
        <rect x="2" y="-11" width={w - 6} height="37" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
        <rect x="4" y="-9" width={w - 10} height="2" fill={P.paper} opacity=".45" />
        <path d={`M5 -6H17V8H5Z${rects([22, 43, 64], -6, 17, 14)}`} fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
        <rect x="3" y="11" width={w - 8} height="7" fill={P.ink} />
        <path d={`M8 14.5H${w - 12}`} stroke={P.danfo} strokeWidth="1" strokeDasharray="7 4" />
        <rect x="3" y="18" width={w - 8} height="6" fill={P.danfoDark} />
        <rect x="1" y="8" width="4" height="3" fill={P.paper} />
        <rect x={w - 7} y="-2" width="3" height="7" fill={P.red} />
        <circle cx="22" cy="27" r="6.5" fill={P.ink} />
        <circle cx="22" cy="27" r="2.5" fill={P.slateLight} />
        <circle cx={w - 26} cy="27" r="6.5" fill={P.ink} />
        <circle cx={w - 26} cy="27" r="2.5" fill={P.slateLight} />
      </g>
      <Plate x={flip ? w - 52 : 12} y={-26} w={40} h={10} text={DESTINATIONS[v % DESTINATIONS.length]} fill={P.night} color={SAND} mono size={6} />
    </g>
  );
}

/** An intercity coach, side on: cream body, a brown stripe, a long window band, a board over the windscreen. 4 by 1 tiles. */
function Coach({ w }: { w: number }) {
  return (
    <g>
      <rect x="10" y="20" width={w - 12} height="10" fill={P.shadow} opacity=".3" />
      <rect x="2" y="-12" width={w - 6} height="38" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="-10" width={w - 10} height="3" fill={SAND_LIGHT} />
      <path d={`M8 -5h${w - 38}v12h-${w - 38}ZM${w - 26} -5h16l4 7v5h-20Z`} fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([34, 56, 78].filter((x) => x < w - 50), -5, 2, 12)} fill={P.ink} />
      <rect x="3" y="11" width={w - 8} height="6" fill={BROWN} />
      <rect x="3" y="17" width={w - 8} height="7" fill={BROWN_DARK} />
      <rect x="3" y="-1" width="3" height="5" fill={P.paper} />
      <rect x={w - 8} y="9" width="3" height="5" fill={P.danfo} />
      <circle cx="28" cy="27" r="7" fill={P.ink} />
      <circle cx="28" cy="27" r="2.5" fill={P.paper} />
      <circle cx={w - 30} cy="27" r="7" fill={P.ink} />
      <circle cx={w - 30} cy="27" r="2.5" fill={P.paper} />
      <Plate x={w - 62} y={-22} w={44} h={10} text="IKEJA" fill={P.night} color={SAND} mono size={6} />
    </g>
  );
}

/** A keke (tricycle taxi): green body, yellow roof, a wheel in front. Odd variants face the other way. 2 by 1 tiles. */
function Keke({ w, flip }: { w: number; flip: boolean }) {
  return (
    <g transform={flip ? `translate(${w} 0) scale(-1 1)` : undefined}>
      <rect x="6" y="21" width={w - 6} height="10" fill={P.shadow} opacity=".3" />
      <circle cx="16" cy="26" r="5" fill={P.ink} />
      <circle cx={w - 12} cy="27" r="4" fill={P.ink} />
      <circle cx="16" cy="26" r="2" fill={P.concrete} />
      <rect x="4" y="12" width={w - 10} height="13" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="3" width={w - 20} height="9" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w - 24} height="2" fill={P.paper} opacity=".5" />
      <rect x="8" y="14" width="26" height="8" fill={P.ink} />
      <path d={`M${w - 18} 12L${w - 8} 15V24H${w - 18}Z`} fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 8} y="19" width="3" height="3" fill={P.paper} />
    </g>
  );
}

/** The Hop board on its legs by the bus: the bounce wordmark on orange, the brand's own line on the night strip. 4 by 2 tiles. */
function Billboard({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="10" y="40" width={w - 8} height={h - 36} fill={P.shadow} opacity=".25" />
      <rect x="18" y="44" width="6" height={h - 46} fill={P.ink} />
      <rect x={w - 24} y="44" width="6" height={h - 46} fill={P.ink} />
      <BrandSign x={2} y={0} w={w - 4} h={46} wordmark tone="orange" sub={BRAND_LINES.hop} />
    </g>
  );
}

// ---- The shed and the lock-ups -------------------------------------------------------------------------------------

/** The covered market shed (the hero): a long pitched tin roof on steel posts, clothes hanging in the dark, tables of piles along the front, bunting, and the big orange board. 10 by 4 tiles. */
function MarketShed({ uid, sign }: { uid: string; sign: string }) {
  const bunting = (parity: number) => Array.from({ length: 22 }, (_, i) => i).filter((i) => i % 2 === parity).map((i) => `M${8 + i * 14} 56h10l-5 9Z`).join("");
  const size = Math.min(27, 150 / Math.max(4, sign.length * 0.8));
  return (
    <g>
      <rect x="8" y="16" width="316" height="112" fill={P.shadow} opacity=".25" />
      <rect x="3" y="44" width="314" height="76" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="52" width="308" height="30" fill={`url(#${uid}-clothes)`} />
      <rect x="4" y="94" width="312" height="24" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="96" width="308" height="5" fill={P.woodLight} />
      <path d={rects([12, 54, 104, 156, 200, 254, 286], 86, 14, 10)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d={rects([30, 76, 128, 178, 232, 270], 84, 12, 12)} fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <path d={rects([42, 118, 214], 88, 10, 8)} fill={SAND} stroke={P.ink} strokeWidth="1" />
      <path d={rects([8, 76, 150, 224, 300], 46, 10, 74)} fill={P.ink} />
      <path d={rects([10, 78, 152, 226, 302], 50, 2, 66)} fill={P.cap} />
      <path d="M0 48L36 8H284L320 48Z" fill={`url(#${uid}-tin)`} stroke={P.ink} strokeWidth="2" />
      <path d="M4 46L38 11H150" fill="none" stroke={BROWN_LIGHT} strokeWidth="2" />
      <rect x="34" y="3" width="252" height="7" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="44" width="320" height="9" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="46" width="316" height="2" fill={BROWN_LIGHT} />
      <path d="M6 55H314" stroke={P.ink} strokeWidth="1" />
      <path d={bunting(0)} fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <path d={bunting(1)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      {/* the board over the top lane: orange, the room's loudest sign */}
      <rect x="76" y="19" width="176" height="40" fill={P.shadow} opacity=".3" />
      <rect x="72" y="15" width="176" height="40" fill={P.brandEmber} stroke={P.ink} strokeWidth="2" />
      <rect x="72" y="12" width="176" height="40" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="76" y="16" width="168" height="32" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <text x="162" y="41" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="4">{sign}</text>
      <text x="160" y="39" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="4">{sign}</text>
    </g>
  );
}

/** A block of lock-up shops, seen from the front: signboards over rolled-up shutters, goods hanging in the dark. 2 by 4 tiles. */
function Lockups({ w, h, uid, v }: { w: number; h: number; uid: string; v: number }) {
  const boards = v % 2 ? [P.orange, P.night, P.paper, P.danfo] : [P.danfo, P.orange, P.night, P.paper];
  const cells = [[3, 14], [33, 14], [3, 70], [33, 70]];
  return (
    <g>
      <rect x="5" y="8" width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height={h} fill={SAND_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="10" fill={BROWN_DARK} />
      <rect x="2" y="2" width={w - 4} height="3" fill={BROWN_LIGHT} />
      {cells.map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="28" height="9" fill={boards[i]} stroke={P.ink} strokeWidth="1.5" />
          <rect x={x + 1} y={y + 10} width="26" height="36" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
          <rect x={x + 4} y={y + 22} width="8" height="22" fill={boards[(i + 1) % 4]} />
          <rect x={x + 15} y={y + 28} width="8" height="16" fill={boards[(i + 2) % 4]} />
          <rect x={x + 1} y={y + 10} width="26" height="8" fill={`url(#${uid}-shutter)`} stroke={P.ink} strokeWidth="1.5" />
        </g>
      ))}
      <rect x="2" y={h - 6} width={w - 4} height="4" fill={P.concreteDark} />
    </g>
  );
}

/** The end of The Place's yard: a corrugated fence with wire along the top and a bit of Lagos street copy. 1 by 4 tiles. */
function Fence({ w, h, uid }: { w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x="4" y="8" width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-tin)`} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="0" width={w} height="6" fill={BROWN_DARK} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M0 2H${w}`} stroke={P.cap} strokeWidth="2" strokeDasharray="3 5" />
      <text transform={`translate(${w - 8} ${h - 14}) rotate(-90)`} fill={P.paper} opacity=".8" fontFamily={FONT.mono} fontSize="6.5" letterSpacing=".8">POST NO BILL</text>
    </g>
  );
}

// ---- Venue facades (each fills its prop box exactly) ---------------------------------------------------------------

/** Iyana Ipaja Terminal: a long low building under a tin canopy on posts, ticket windows, a bus board, a door at the end by the lane. 7 by 3 tiles. */
function Terminal({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="18" width={w - 2} height={h - 19} fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="30" width={w - 6} height="3" fill={SAND_LIGHT} />
      <rect x="0" y="0" width={w} height="22" fill={`url(#${uid}-tin)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="3" fill={BROWN_LIGHT} />
      <rect x="0" y="18" width={w} height="6" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <Plate x={30} y={3} w={w - 60} h={15} text={name} fill={P.night} color={SAND} size={10} spacing={1} />
      <path d={rects([22, 78], 44, 32, 22)} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={rects([24, 80], 46, 28, 8)} fill={SAND_DARK} />
      <path d={rects([20, 76], 66, 36, 5)} fill={P.woodLight} stroke={P.ink} strokeWidth="1.5" />
      <rect x="130" y="40" width="32" height="28" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="135" y="48" width="22" height="11" fill={SAND} />
      <rect x="137" y="50" width="18" height="4" fill={P.night} />
      <path d="M140 62a3 3 0 1 0 0.1 0ZM152 62a3 3 0 1 0 0.1 0Z" fill={SAND} />
      <rect x="174" y="44" width="40" height={h - 44} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={rects([178, 196], 48, 14, h - 48)} fill={SAND_DARK} />
      <path d={rects([6, 62, 118, 166, 216], 24, 8, h - 28)} fill={P.ink} />
      <path d={rects([8, 64, 120, 168, 218], 26, 2, h - 32)} fill={P.cap} />
      <rect x="2" y={h - 6} width={w - 4} height="5" fill={P.concreteDark} />
    </g>
  );
}

/** The Place: a brown front with a night name plate, a big screen showing a match, a snooker table in the window, a lit door under an awning and speakers. 6 by 4 tiles. */
function ThePlace({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={BROWN} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="3" fill={BROWN_LIGHT} />
      <rect x="3" y="38" width={w - 6} height="3" fill={BROWN_DARK} />
      <Plate x={14} y={10} w={w - 28} h={24} text={name} fill={P.night} color={SAND} size={16} spacing={1.4} />
      <path d="M8 44H184" stroke={P.gold} strokeWidth="4" strokeDasharray="3 9" />
      <rect x="12" y="50" width="74" height="46" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="16" y="54" width="66" height="34" fill={P.leaf} />
      <path d="M49 54V88M16 71H82" stroke={P.paper} strokeWidth="1.5" />
      <rect x="40" y="63" width="18" height="16" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <rect x="16" y="90" width="66" height="4" fill={P.orange} />
      <rect x="96" y="54" width="42" height="36" fill={SAND_LIGHT} stroke={P.ink} strokeWidth="2" />
      <rect x="100" y="64" width="34" height="18" fill={P.woodDark} stroke={P.ink} strokeWidth="1.5" />
      <rect x="103" y="67" width="28" height="12" fill={P.leafDark} />
      <path d="M110 73h3M120 71h3M125 75h3" stroke={P.paper} strokeWidth="2" />
      <rect x="148" y="64" width="30" height="54" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="152" y="68" width="22" height="50" fill={SAND_DARK} />
      <rect x="168" y="90" width="3" height="6" fill={P.paper} />
      <rect x="142" y="50" width="42" height="14" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <path d="M12 100h16v20h-16ZM108 100h16v20h-16Z" fill={P.ink} />
      <path d="M20 108m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0ZM116 108m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z" fill={P.wall} />
      <rect x="2" y={h - 10} width={w - 4} height="8" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** KAF Mall: a sand front with a brown name band, a long glass wall and sliding doors under a canopy, and a cinema block with posters and a lit marquee. 7 by 4 tiles. */
function KafMall({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="30" fill={BROWN} />
      <rect x="3" y="3" width={w - 6} height="3" fill={BROWN_LIGHT} />
      <Plate x={12} y={8} w={w - 24} h={22} text={name} fill={P.night} color={SAND} size={15} spacing={1.6} />
      <rect x="10" y="40" width="138" height="70" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="42" width="134" height="66" fill={`url(#${uid}-glass)`} />
      <rect x="14" y="72" width="54" height="38" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={rects([17, 43], 75, 22, 35)} fill={P.slateLight} />
      <rect x="8" y="62" width="66" height="9" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="156" y="38" width="62" height="76" fill={BROWN_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="162" y="44" width="14" height="22" fill={P.orange} stroke={P.ink} strokeWidth="1.5" />
      <rect x="180" y="44" width="14" height="22" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <rect x="198" y="44" width="14" height="22" fill={SAND} stroke={P.ink} strokeWidth="1.5" />
      <rect x="158" y="70" width="58" height="9" fill={P.night} />
      <path d="M161 74.5H213" stroke={P.gold} strokeWidth="4" strokeDasharray="3 6" />
      <rect x="164" y="86" width="46" height="22" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="168" y="90" width="38" height="8" fill={SAND_DARK} />
      <rect x="2" y={h - 14} width={w - 4} height="12" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Brainfield Event Centre: a big hall under a brown roof band, a balloon cluster at the door, windows, and on the deck a pool with a slide, loungers and a parasol. 6 by 4 tiles. */
function EventCentre({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="1" width={w - 2} height="78" fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="26" fill={BROWN} />
      <rect x="3" y="3" width={w - 6} height="3" fill={BROWN_LIGHT} />
      <Plate x={12} y={6} w={w - 24} h={20} text={name} fill={P.night} color={SAND} size={10} spacing={0.8} />
      <rect x="10" y="36" width="26" height="42" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="13" y="39" width="20" height="39" fill={SAND_DARK} />
      <path d={rects([52, 100], 38, 38, 30)} fill={SAND_LIGHT} stroke={P.ink} strokeWidth="2" />
      <path d="M71 38V68M119 38V68M52 53H90M100 53H138" stroke={P.ink} strokeWidth="2" />
      <path d="M38 44m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0ZM44 38m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <path d="M42 50m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x="1" y="82" width={w - 2} height={h - 84} fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <rect x="90" y="88" width="94" height="34" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="94" y="92" width="86" height="26" fill={`url(#${uid}-water)`} />
      <rect x="144" y="70" width="4" height="22" fill={P.ink} />
      <path d="M148 70L172 100H182L156 70Z" fill={P.orange} stroke={P.ink} strokeWidth="1.5" />
      <path d="M8 92h26v8h-26ZM8 106h26v8h-26Z" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <rect x="58" y="94" width="3" height="22" fill={P.ink} />
      <path d="M44 100L50 90H70L76 100Z" fill={P.orange} stroke={P.ink} strokeWidth="1.5" />
    </g>
  );
}

// ---- The room -------------------------------------------------------------------------------------------------------

export default function HotspotAlimoshoArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const fill = (name: string) => `url(#${uid}-${name})`;
  const t = (n: number) => n * tile;

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    marketshed: () => <MarketShed uid={uid} sign={SIGN} />,
    terminal: (p, tl) => <Terminal w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[0]} />,
    theplace: (p, tl) => <ThePlace w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[1]} />,
    kafmall: (p, tl) => <KafMall w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[2]} />,
    eventcentre: (p, tl) => <EventCentre w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[3]} />,
    umbrellastall: (p) => <Stall v={p.variant ?? 0} />,
    bales: (p) => <Bales v={p.variant ?? 0} />,
    generator: () => <Generator />,
    sachets: () => <Sachets />,
    pole: () => <Pole />,
    billboard: (p, tl) => <Billboard w={p.w * tl} h={p.h * tl} />,
    danfo: (p, tl) => <Danfo w={p.w * tl} v={p.variant ?? 0} />,
    coach: (p, tl) => <Coach w={p.w * tl} />,
    keke: (p, tl) => <Keke w={p.w * tl} flip={(p.variant ?? 0) === 1} />,
    "hop-bus": (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} flip />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["asphalt", "concrete", "water", "deck"]} />
      <defs>
        <pattern id={`${uid}-dust`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill={SAND} />
          <path d="M4 6h3M20 22h3M12 14h2M26 4h3M8 27h4M28 16h2" stroke={SAND_DARK} strokeWidth="1" />
          <path d="M16 9h1M2 19h1M24 11h1M13 29h1" stroke={DUST} strokeWidth="1" />
          <path d="M22 2h2M6 17h2" stroke={SAND_LIGHT} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-tin`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={BROWN} />
          <rect width="3" height="8" fill={BROWN_DARK} />
          <rect x="4" width="1" height="8" fill={BROWN_LIGHT} />
        </pattern>
        <pattern id={`${uid}-clothes`} width="40" height="30" patternUnits="userSpaceOnUse">
          <rect width="40" height="30" fill={BROWN_DARK} />
          <rect x="2" width="6" height="18" fill={P.orange} />
          <rect x="9" width="5" height="24" fill={P.paper} />
          <rect x="15" width="6" height="14" fill={SAND} />
          <rect x="22" width="5" height="26" fill={BROWN_LIGHT} />
          <rect x="28" width="6" height="16" fill={P.danfo} />
          <rect x="35" width="4" height="21" fill={P.paper} />
        </pattern>
        <pattern id={`${uid}-shutter`} width="8" height="4" patternUnits="userSpaceOnUse">
          <rect width="8" height="4" fill={SACK_LIGHT} />
          <rect y="3" width="8" height="1" fill={SACK_DARK} />
        </pattern>
        <pattern id={`${uid}-awn`} width="16" height="14" patternUnits="userSpaceOnUse">
          <rect width="8" height="14" fill={SAND} />
          <rect x="8" width="8" height="14" fill={BROWN_DARK} />
        </pattern>
        <pattern id={`${uid}-glass`} width="22" height="66" patternUnits="userSpaceOnUse">
          <rect width="22" height="66" fill={P.slateLight} />
          <rect width="2" height="66" fill={P.ink} />
          <rect x="6" y="0" width="5" height="40" fill={P.paper} opacity=".3" />
        </pattern>
      </defs>

      {/* The ground: a corrugated fence all round, packed dust inside it. */}
      <Frame layout={layout} ground={BROWN_DARK} />
      <path d={`M0 0H${W}V${H}H0Z M${tile} ${tile}V${H - tile}H${W - tile}V${tile}Z`} fill={fill("tin")} fillRule="evenodd" />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={fill("dust")} stroke={P.ink} strokeWidth="4" />

      {/* The slab under the shed, the plaza, and the road along the bottom with its kerb, centre line and bay marks. */}
      <rect x={t(10)} y={t(5)} width={t(10)} height={t(2)} fill={fill("concrete")} stroke={P.concreteDark} strokeWidth="2" />
      <rect x={t(10)} y={t(13)} width={t(10)} height={t(3) - 6} fill={fill("concrete")} stroke={P.concreteDark} strokeWidth="2" />
      <rect x={t(1)} y={t(16)} width={t(28) - tile} height={t(3) - tile} fill={fill("asphalt")} />
      <rect x={t(1)} y={t(16) - 6} width={t(28) - tile} height="6" fill={P.stone} />
      <path d={`M${t(1)} ${t(16) - 6}H${t(29) - tile}`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${t(1) + 8} ${t(17) + 16}H${t(29) - tile - 8}`} stroke={P.paper} strokeWidth="2" strokeDasharray="14 12" opacity=".6" />
      <path d={`M${t(1)} ${t(17)}V${t(19) - tile}M${t(5)} ${t(17)}V${t(19) - tile}M${t(8)} ${t(17)}V${t(19) - tile}M${t(10)} ${t(17)}V${t(19) - tile}M${t(13)} ${t(17)}V${t(19) - tile}M${t(22)} ${t(17)}V${t(19) - tile}M${t(24)} ${t(17)}V${t(19) - tile}M${t(25)} ${t(17)}V${t(19) - tile}M${t(28)} ${t(17)}V${t(19) - tile}`} stroke={P.paper} strokeWidth="2" opacity=".5" />

      {/* The Hop bay: a dashed orange outline round the bus. */}
      <rect x={t(16) - 6} y={t(17) + 14} width={t(4) + 12} height={t(2) - 18} fill={P.orange} opacity=".14" />
      <rect x={t(16) - 6} y={t(17) + 14} width={t(4) + 12} height={t(2) - 18} fill="none" stroke={P.orange} strokeWidth="3" strokeDasharray="10 6" />

      {/* Lock-up shops and the fence end are walls in the layout. */}
      {layout.walls.map((wl, i) => (
        <g key={i} transform={`translate(${t(wl.x)},${t(wl.y)})`}>
          {wl.w === 1 ? <Fence w={t(wl.w)} h={t(wl.h)} uid={uid} /> : <Lockups w={t(wl.w)} h={t(wl.h)} uid={uid} v={i} />}
        </g>
      ))}
      <PaperScraps x={t(8)} y={t(1) + 10} w={t(2)} h={56} seed={0} />

      {/* The Hop's route: up the left lane past the Terminal and The Place, across under the shed, down the right lane past KAF Mall to Brainfield. */}
      <RouteLine points={[[288, 496], [288, 176], [672, 176], [672, 496]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* A rubber stamp on the road by the bus. */}
      <Stamp x={t(18)} y={t(16) + 16} text={BRAND_LINES.wait} size={7} rotate={-4} />
    </svg>
  );
}
