import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { Defs, FONT, Frame, HopBus, HoppazWordmark, P, Plate, Props, RouteLine, Shade, type RoomArtProps } from "./kit";

/**
 * Jibowu, the Yaba hotspot (hotspot-yaba): the junction of Herbert Macaulay Street and Murtala Muhammed Way on a busy
 * Lagos afternoon. Danfo yellow and black, drawn like the 360Playlist room (2 px ink, top-left light, hard shadow to the
 * lower right, flat colour). Names, sign and colours come from the place data (src/lib/rooms/hotspotRooms.ts).
 *
 * From the top: the four venue facades (UNILAG, Ozone Cinemas, CcHub, Beeriga), the pavement, the road with the BRT shelter
 * on its median under a footbridge, the railway crossing it with barriers and a red light, the pavement and the plaza with
 * the danfo park, the newspaper stand, the suya grill and the map signpost.
 */
type Pal = { primary: string; secondary: string; accent: string };
const FALLBACK: Pal = { primary: "#F2B705", secondary: "#0E0B0A", accent: "#FF4D00" };
const VENUES = ["UNILAG", "Ozone Cinemas", "CcHub", "Beeriga"];

/** Subpaths for a row of identical rectangles: one SVG node instead of one per rectangle. */
const rects = (xs: number[], y: number, w: number, h: number) => xs.map((x) => `M${x} ${y}h${w}v${h}h${-w}Z`).join("");

// ---- Vehicles and street furniture (each drawn in its own box, (0,0) is the box's top-left) ----------------------------

/** A danfo: a boxy yellow minibus with the black stripe and a roof rack. Faces left; `flip` turns it to face right. 3 by 1 tiles. */
function Danfo({ flip }: { flip: boolean }) {
  return (
    <g transform={flip ? "translate(96 0) scale(-1 1)" : undefined}>
      <rect x="10" y="22" width="88" height="10" fill={P.shadow} opacity=".3" />
      <path d="M14 -15H82M18 -15v5M48 -15v5M78 -15v5" stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="-21" width="26" height="7" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="-11" width="90" height="37" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="-9" width="86" height="2" fill={P.paper} opacity=".45" />
      <path d="M5 -6H17V8H5Z" fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([22, 43, 64], -6, 17, 14)} fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
      <path d="M41 -9V11M62 -9V11" stroke={P.danfoDark} strokeWidth="1.5" />
      <rect x="3" y="11" width="88" height="7" fill={P.ink} />
      <path d="M8 14.5H86" stroke={P.danfo} strokeWidth="1" strokeDasharray="7 4" />
      <rect x="3" y="18" width="88" height="6" fill={P.danfoDark} />
      <rect x="0" y="20" width="8" height="6" fill={P.ink} />
      <rect x="1" y="8" width="4" height="3" fill={P.paper} />
      <rect x="89" y="-2" width="3" height="7" fill={P.red} />
      <circle cx="22" cy="27" r="6.5" fill={P.ink} /><circle cx="22" cy="27" r="2.5" fill={P.slateLight} />
      <circle cx="72" cy="27" r="6.5" fill={P.ink} /><circle cx="72" cy="27" r="2.5" fill={P.slateLight} />
    </g>
  );
}

/** A keke (tricycle taxi): green, yellow stripe, open cabin under a canopy, one wheel at the front. 2 by 1 tiles. */
function Keke({ flip }: { flip: boolean }) {
  return (
    <g transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
      <rect x="6" y="22" width="58" height="9" fill={P.shadow} opacity=".3" />
      <rect x="12" y="-10" width="46" height="9" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="-8" width="42" height="2" fill={P.paper} opacity=".35" />
      <rect x="15" y="-1" width="38" height="14" fill={P.ink} />
      <rect x="34" y="4" width="17" height="9" fill={P.cream} />
      <path d="M15 -1V13M53 -1V13" stroke={P.kekeDark} strokeWidth="3" />
      <rect x="14" y="12" width="42" height="12" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="16" y="17" width="38" height="3" fill={P.danfo} />
      <path d="M14 -2H5L2 22H14Z" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="1" width="7" height="8" fill={P.slateLight} />
      <path d="M0 -4H9" stroke={P.ink} strokeWidth="3" />
      <circle cx="8" cy="26" r="5" fill={P.ink} /><circle cx="8" cy="26" r="2" fill={P.slateLight} />
      <circle cx="46" cy="26" r="6" fill={P.ink} /><circle cx="46" cy="26" r="2" fill={P.slateLight} />
    </g>
  );
}

/** A BRT bus: a long blue articulated bus with a yellow stripe, nose to the left. 5 by 1 tiles. */
function BrtBus({ pal }: { pal: Pal }) {
  return (
    <g>
      <rect x="10" y="22" width="152" height="10" fill={P.shadow} opacity=".3" />
      <rect x="2" y="-10" width="154" height="36" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="-8" width="150" height="5" fill={P.paper} />
      <path d={rects([8, 30, 52, 74, 112, 134], -1, 19, 12)} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1.5" />
      <rect x="92" y="-10" width="14" height="36" fill={P.ink} />
      <path d="M95 -10V26M99 -10V26M103 -10V26" stroke={P.cap} strokeWidth="1" />
      <rect x="3" y="14" width="152" height="4" fill={pal.primary} />
      <rect x="3" y="18" width="152" height="6" fill={P.lagoonDark} />
      <Plate x={116} y={12} w={30} h={10} text="BRT" fill={pal.secondary} color={pal.primary} size={7} />
      <rect x="1" y="11" width="4" height="4" fill={P.paper} />
      <rect x="154" y="-2" width="3" height="7" fill={P.red} />
      <circle cx="24" cy="27" r="6.5" fill={P.ink} /><circle cx="24" cy="27" r="2.5" fill={P.slateLight} />
      <circle cx="78" cy="27" r="6.5" fill={P.ink} /><circle cx="78" cy="27" r="2.5" fill={P.slateLight} />
      <circle cx="132" cy="27" r="6.5" fill={P.ink} /><circle cx="132" cy="27" r="2.5" fill={P.slateLight} />
    </g>
  );
}

/** A drinks seller's umbrella over a small table. 1 by 1 tile, the canopy rises above the box. */
function Parasol({ uid }: { uid: string }) {
  return (
    <g>
      <ellipse cx="20" cy="28" rx="13" ry="3" fill={P.shadow} opacity=".3" />
      <rect x="15" y="-8" width="3" height="34" fill={P.ink} />
      <path d="M-2 -6H34L28 -17H4Z" fill={`url(#${uid}-hzawning)`} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="14" width="22" height="5" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M9 19V27M25 19V27" stroke={P.ink} strokeWidth="2" />
      <path d={rects([9, 14, 19], 6, 3, 8)} fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x="23" y="9" width="4" height="5" fill={P.paper} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A suya grill: charcoal trough, skewers, smoke. 2 by 1 tiles, the smoke rises above the box. */
function SuyaGrill() {
  return (
    <g>
      <rect x="8" y="14" width="58" height="18" fill={P.shadow} opacity=".28" />
      <path d="M12 -2h9v-9h-9ZM24 -13h11v-10h-11ZM37 -26h12v-11h-12Z" fill={P.cap} opacity=".6" />
      <path d="M16 6h7v-7h-7ZM29 -5h9v-8h-9ZM44 -18h8v-8h-8Z" fill={P.stone} opacity=".75" />
      <rect x="4" y="10" width="54" height="20" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="6" width="50" height="9" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <path d={rects([9, 17, 25, 33, 41, 49], 8, 5, 5)} fill={P.orange} />
      <path d="M8 6H54" stroke={P.cap} strokeWidth="2" />
      <path d={rects([10, 18, 26, 34, 42, 50], 2, 3, 8)} fill={P.emberDark} stroke={P.ink} strokeWidth="1" />
      <Plate x={14} y={19} w={36} h={9} text="SUYA" fill={P.night} color={P.danfo} size={7} spacing={0.4} />
    </g>
  );
}

/** A newspaper stand: kiosk with a striped awning and a rack of papers. 2 by 1 tiles. */
function Newsstand({ uid }: { uid: string }) {
  const colours = [P.paper, P.orange, P.danfo, P.lagoonLight, P.paper, P.ember];
  return (
    <g>
      <rect x="6" y="8" width="60" height="24" fill={P.shadow} opacity=".28" />
      <rect x="3" y="7" width="56" height="23" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="9" width="52" height="4" fill={P.woodLight} />
      {colours.map((c, i) => <rect key={i} x={8 + i * 8} y="15" width="6" height="9" fill={c} stroke={P.ink} strokeWidth="1" />)}
      <rect x="2" y="2" width="58" height="9" fill={`url(#${uid}-hzawning)`} stroke={P.ink} strokeWidth="2" />
      <Plate x={14} y={-10} w={36} h={10} text="NEWS" fill={P.night} color={P.danfo} size={7} spacing={0.4} />
    </g>
  );
}

/** A bus stop sign on a pole. 1 by 1 tile, the disc rises above the box. */
function BusStopSign({ pal }: { pal: Pal }) {
  return (
    <g>
      <ellipse cx="19" cy="28" rx="8" ry="3" fill={P.shadow} opacity=".3" />
      <rect x="15" y="-6" width="4" height="35" fill={P.ink} />
      <rect x="15" y="-6" width="1" height="35" fill={P.cap} />
      <circle cx="17" cy="-10" r="11" fill={pal.primary} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="-14" width="18" height="9" fill={pal.secondary} />
      <text x="17" y="-7" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".2">BUS</text>
    </g>
  );
}

/** The street sign with the place's name on it (white on green). 3 by 1 tiles. */
function StreetSign({ sign }: { sign: string }) {
  return (
    <g>
      <rect x="8" y="12" width="90" height="19" fill={P.shadow} opacity=".25" />
      <rect x="12" y="14" width="5" height="17" fill={P.ink} /><rect x="79" y="14" width="5" height="17" fill={P.ink} />
      <Plate x={2} y={1} w={92} h={20} text={sign} fill={P.kekeDark} color={P.paper} size={13} spacing={1.5} />
      <rect x="5" y="4" width="86" height="14" fill="none" stroke={P.paper} strokeWidth="1" />
    </g>
  );
}

/** A street lamp. 1 by 1 tile, the head rises above the box. */
function StreetLamp() {
  return (
    <g>
      <rect x="14" y="27" width="22" height="5" fill={P.shadow} opacity=".28" />
      <rect x="11" y="24" width="10" height="7" fill={P.ink} />
      <rect x="14" y="-16" width="4" height="42" fill={P.ink} />
      <rect x="14" y="-16" width="1" height="42" fill={P.cap} />
      <rect x="14" y="-18" width="18" height="4" fill={P.ink} />
      <rect x="24" y="-14" width="11" height="6" fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <rect x="26" y="-12" width="5" height="2" fill={P.cream} />
    </g>
  );
}

/** A dustbin. */
function Bin() {
  return (
    <g>
      <ellipse cx="18" cy="29" rx="9" ry="3" fill={P.shadow} opacity=".3" />
      <rect x="9" y="10" width="14" height="19" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="6" width="18" height="6" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <path d="M13 14V26M18 14V26" stroke={P.ink} strokeWidth="1" opacity=".5" />
    </g>
  );
}

/** One corner of the level crossing: a post, a raised barrier boom and the red light. `left` leans the boom out to the left. */
function Crossing({ uid, left }: { uid: string; left: boolean }) {
  const boom = left ? "M15 10L2 -10" : "M17 10L30 -10";
  return (
    <g>
      <rect x="16" y="26" width="14" height="5" fill={P.shadow} opacity=".3" />
      <path d={boom} stroke={P.ink} strokeWidth="7" />
      <path d={boom} stroke={P.paper} strokeWidth="4" />
      <path d={boom} stroke={P.red} strokeWidth="4" strokeDasharray="5 5" />
      <rect x="12" y="10" width="8" height="19" fill={`url(#${uid}-hazard)`} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="3" width="22" height="7" fill={P.ink} />
      <circle cx="10" cy="6.5" r="3" fill={P.red} /><circle cx="22" cy="6.5" r="3" fill={P.red} />
      <rect x="9" y="5" width="2" height="2" fill={P.paper} /><rect x="21" y="5" width="2" height="2" fill={P.paper} />
    </g>
  );
}

/** A flight of steps up to the footbridge. */
function Stairs({ w, h }: { w: number; h: number }) {
  const lines: string[] = [];
  for (let y = 7; y < h - 4; y += 6) lines.push(`M7 ${y}H${w - 7}`);
  return (
    <g>
      <rect x="5" y="6" width={w - 2} height={h - 4} fill={P.shadow} opacity=".28" />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d={lines.join("")} stroke={P.concreteDark} strokeWidth="2" />
      <rect x="2" y="2" width="6" height={h - 4} fill={P.cap} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 8} y="2" width="6" height={h - 4} fill={P.cap} stroke={P.ink} strokeWidth="1" />
      <rect x="9" y={h - 7} width={w - 18} height="4" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The footbridge deck over the road: walkway, truss railings, a hard shadow on the tarmac beneath. 2 by 7 tiles. */
function FootbridgeDeck({ uid }: { uid: string }) {
  return (
    <g>
      <rect x="14" y="20" width="70" height="206" fill={P.shadow} opacity=".4" />
      <rect x="4" y="7" width="62" height="216" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="0" width="62" height="216" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="9" y="3" width="44" height="210" fill={`url(#${uid}-walkway)`} />
      <rect x="2" y="2" width="7" height="212" fill={`url(#${uid}-truss)`} />
      <rect x="53" y="2" width="7" height="212" fill={`url(#${uid}-truss)`} />
      <rect x="2" y="1" width="58" height="2" fill={P.paper} opacity=".4" />
      <path d={rects([9, 52], 3, 1, 210)} fill={P.ink} />
      <path d="M9 108H53" stroke={P.concreteDark} strokeWidth="2" />
    </g>
  );
}

/** The railway: ballast, sleepers, two rails, and a level-crossing panel across the road. 3 by 18 tiles. */
function Rails({ uid }: { uid: string }) {
  return (
    <g>
      <rect x="4" y="0" width="90" height="576" fill={`url(#${uid}-ballast)`} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="0" width="72" height="576" fill={`url(#${uid}-sleepers)`} />
      <rect x="4" y="160" width="90" height="256" fill={`url(#${uid}-concrete)`} stroke={P.ink} strokeWidth="2" />
      <path d="M9 160H91M9 414H91" stroke={P.concreteDark} strokeWidth="2" />
      <rect x="20" y="0" width="10" height="576" fill={P.ink} />
      <rect x="66" y="0" width="10" height="576" fill={P.ink} />
      <rect x="22" y="0" width="4" height="576" fill={P.slateLight} />
      <rect x="68" y="0" width="4" height="576" fill={P.slateLight} />
      <path d="M12 164H84M12 410H84" stroke={P.danfo} strokeWidth="3" strokeDasharray="6 6" />
    </g>
  );
}

// ---- Venue facades (each fills its prop box exactly) ---------------------------------------------------------------

/** UNILAG: a campus gate with the lawn, a hedge and the clock tower behind. 6 by 4 tiles. */
function Unilag({ uid, pal, name }: { uid: string; pal: Pal; name: string }) {
  return (
    <g>
      <Shade w={192} h={128} dx={5} dy={7} o={0.3} />
      <rect x="1" y="1" width="190" height="126" fill={`url(#${uid}-grass)`} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="5" width="176" height="40" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="7" width="172" height="5" fill={P.stone} />
      <path d={rects([16, 36, 56, 124, 144, 164], 18, 12, 18)} fill={P.slate} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([16, 36, 56, 124, 144, 164], 20, 12, 3)} fill={P.slateLight} />
      <rect x="78" y="1" width="36" height="46" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="82" y="4" width="28" height="4" fill={P.cap} />
      <circle cx="96" cy="23" r="10" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M96 23V16M96 23H102" stroke={P.ink} strokeWidth="2" />
      <rect x="82" y="46" width="28" height="74" fill={`url(#${uid}-paving)`} stroke={P.ink} strokeWidth="1.5" />
      <rect x="10" y="50" width="60" height="9" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="52" width="56" height="3" fill={P.mint} />
      <rect x="122" y="50" width="60" height="9" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <rect x="124" y="52" width="56" height="3" fill={P.mint} />
      <path d="M21 90v10M171 90v10" stroke={P.woodDark} strokeWidth="4" />
      <circle cx="22" cy="82" r="11" fill={P.leaf} stroke={P.ink} strokeWidth="2" /><circle cx="19" cy="79" r="4" fill={P.mint} />
      <circle cx="170" cy="82" r="11" fill={P.leaf} stroke={P.ink} strokeWidth="2" /><circle cx="167" cy="79" r="4" fill={P.mint} />
      <rect x="1" y="116" width="190" height="11" fill={`url(#${uid}-concrete)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="100" width="34" height="20" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="102" width="30" height="4" fill={P.paper} opacity=".45" />
      <rect x="156" y="100" width="34" height="20" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="158" y="102" width="30" height="4" fill={P.paper} opacity=".45" />
      <path d="M61 92V118M66 92V118M71 92V118M121 92V118M126 92V118M131 92V118" stroke={P.ink} strokeWidth="2" />
      <rect x="36" y="60" width="22" height="62" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="39" y="63" width="4" height="56" fill={P.paper} opacity=".5" />
      <rect x="52" y="63" width="4" height="56" fill={P.concreteDark} opacity=".55" />
      <rect x="33" y="56" width="28" height="8" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="43" y="49" width="8" height="7" fill={pal.primary} stroke={P.ink} strokeWidth="1.5" />
      <rect x="134" y="60" width="22" height="62" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="137" y="63" width="4" height="56" fill={P.paper} opacity=".5" />
      <rect x="150" y="63" width="4" height="56" fill={P.concreteDark} opacity=".55" />
      <rect x="131" y="56" width="28" height="8" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="141" y="49" width="8" height="7" fill={pal.primary} stroke={P.ink} strokeWidth="1.5" />
      <Plate x={58} y={64} w={76} h={24} text={name} fill={pal.secondary} color={pal.primary} size={14} spacing={1} />
      <rect x="60" y="86" width="72" height="2" fill={pal.primary} />
    </g>
  );
}

/** Ozone Cinemas: a cinema frontage with a lit marquee, posters either side and glass doors. 6 by 4 tiles. */
function Ozone({ pal, name }: { pal: Pal; name: string }) {
  const posters = [
    { x: 8, c: pal.accent, shape: 0 }, { x: 34, c: P.violet, shape: 1 }, { x: 134, c: pal.primary, shape: 2 }, { x: 160, c: P.lagoon, shape: 0 },
  ];
  return (
    <g>
      <Shade w={192} h={128} dx={5} dy={7} o={0.3} />
      <rect x="1" y="1" width="190" height="126" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width="186" height="5" fill={P.cap} />
      <rect x="3" y="8" width="186" height="5" fill={P.ink} />
      <path d="M7 10.5H185" stroke={P.paper} strokeWidth="2" strokeDasharray="3 5" />
      <rect x="14" y="16" width="164" height="30" fill="none" stroke={pal.primary} strokeWidth="2" />
      <Plate x={18} y={19} w={156} h={24} text={name} fill={pal.secondary} color={pal.accent} size={14} spacing={0.8} />
      {posters.map((p) => (
        <g key={p.x}>
          <rect x={p.x} y="52" width="24" height="38" fill={P.night} stroke={P.ink} strokeWidth="2" />
          <rect x={p.x + 3} y="55" width="18" height="22" fill={p.c} />
          {p.shape === 1 ? <path d={`M${p.x + 5} 75V63h4v5h4v-9h4v16Z`} fill={P.night} /> : p.shape === 2 ? <path d={`M${p.x + 12} 58l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7Z`} fill={P.night} /> : <circle cx={p.x + 12} cy="66" r="6" fill={P.night} />}
          <rect x={p.x + 4} y="80" width="16" height="2" fill={P.paper} />
          <rect x={p.x + 7} y="84" width="10" height="2" fill={P.paper} opacity=".7" />
        </g>
      ))}
      <rect x="62" y="50" width="68" height="22" fill={pal.primary} stroke={P.ink} strokeWidth="2" />
      <path d="M66 53H126M66 69H126" stroke={P.paper} strokeWidth="2" strokeDasharray="3 5" />
      <text x="96" y="64" textAnchor="middle" fill={pal.secondary} fontFamily={FONT.mono} fontWeight={700} fontSize="7" letterSpacing="1.2">NOW SHOWING</text>
      <rect x="72" y="72" width="48" height="42" fill={P.ink} />
      <rect x="76" y="76" width="18" height="38" fill={P.cream} stroke={P.ink} strokeWidth="1.5" />
      <rect x="98" y="76" width="18" height="38" fill={P.cream} stroke={P.ink} strokeWidth="1.5" />
      <rect x="78" y="78" width="14" height="6" fill={P.gold} opacity=".7" /><rect x="100" y="78" width="14" height="6" fill={P.gold} opacity=".7" />
      <path d="M82 92l6-8M104 92l6-8" stroke={P.paper} strokeWidth="2" opacity=".7" />
      <rect x="2" y="114" width="188" height="12" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="66" y="112" width="60" height="12" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d="M68 118H124" stroke={P.concreteDark} strokeWidth="2" />
    </g>
  );
}

/**
 * CcHub: the Co-Creation Hub, Yaba's tech hub on Herbert Macaulay Way. A modern three-storey front: a glass curtain wall with
 * lit floors between two clad wings, the name on a roof-top sign plate (one orange edge), a glass door up two steps, laptops on
 * desks behind the ground-floor glass, a bike rack and two bean-bags on the forecourt. 7 by 4 tiles.
 */
function CcHub({ uid, name }: { uid: string; name: string }) {
  const bays = [54, 78, 102, 126, 150];
  const lobby = [54, 78, 126, 150];
  const wings = [6, 28, 180, 202];
  const inset = (xs: number[]) => xs.map((x) => x + 1);
  const bag = (x: number, y: number) => `M${x} ${y + 11}V${y + 6}L${x + 3} ${y + 2}H${x + 13}L${x + 16} ${y + 6}V${y + 11}Z`;
  const wheel = (cx: number) => `M${cx - 5} 118a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z`;
  return (
    <g>
      <Shade w={224} h={128} dx={5} dy={7} o={0.3} />
      <rect x="1" y="1" width="222" height="126" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width="218" height="3" fill={P.cap} />
      <path d="M8 29h12v7h-12ZM24 31h8v5h-8Z" fill={P.cap} stroke={P.ink} strokeWidth="1.5" />
      <path d="M190 26h13v10h-13ZM207 31h9v5h-9Z" fill={P.cap} stroke={P.ink} strokeWidth="1.5" />
      <rect x="1" y="36" width="48" height="72" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="175" y="36" width="48" height="72" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d="M3 38h44M177 38h44" stroke={P.paper} strokeWidth="2" opacity=".45" />
      <path d="M25 41V104M199 41V104" stroke={P.slate} strokeWidth="2" />
      <rect x="49" y="32" width="126" height="76" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <path d={rects(bays, 35, 20, 19) + rects(bays, 58, 20, 19) + rects([6, 28, 180, 202], 42, 16, 12) + rects(wings, 58, 16, 19)} fill={P.lagoon} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects(bays, 35, 20, 19) + rects([78, 126], 58, 20, 19) + rects([6, 202], 42, 16, 12) + rects([28, 180], 58, 16, 19)} fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d={bays.map((x) => `M${x} 44.5h20M${x} 67.5h20`).join("")} stroke={P.ink} strokeWidth="1" opacity=".45" />
      <path d={rects(lobby, 85, 20, 20) + rects(wings, 85, 16, 20)} fill={P.wall} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects(inset(lobby), 98, 18, 3) + rects(inset(wings), 98, 14, 3)} fill={P.woodLight} />
      <path d={rects(inset(lobby), 101, 18, 4) + rects(inset(wings), 101, 14, 4)} fill={P.woodDark} />
      <path d={rects([10, 32, 184, 206, 84, 130], 90, 8, 6)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d={rects([9, 31, 183, 205, 83, 129], 96, 10, 2)} fill={P.ink} />
      <path d={bays.map((x) => `M${x + 3} 51l6-9M${x + 3} 74l6-9`).join("")} stroke={P.paper} strokeWidth="2" opacity=".4" />
      <rect x="49" y="77" width="126" height="8" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="51" y="79" width="122" height="2" fill={P.paper} opacity=".45" />
      <rect x="50" y="85" width="124" height="3" fill={P.shadow} opacity=".35" />
      <rect x="98" y="85" width="28" height="23" fill={P.ink} />
      <path d={rects([100, 113], 87, 11, 21)} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1.5" />
      <path d="M109 96v7M115 96v7" stroke={P.ink} strokeWidth="2" />
      <path d="M102 104l5-8M115 104l5-8" stroke={P.paper} strokeWidth="2" opacity=".6" />
      <rect x="46" y="25" width="132" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="48" y="27" width="128" height="2" fill={P.paper} opacity=".45" />
      <path d="M70 23v2M154 23v2" stroke={P.ink} strokeWidth="4" />
      <Plate x={58} y={3} w={108} h={20} text={name} fill={P.night} color={P.paper} size={13} spacing={2} />
      <rect x="60" y="19" width="104" height="3" fill={P.orange} />
      <rect x="1" y="108" width="222" height="19" fill={`url(#${uid}-concrete)`} stroke={P.ink} strokeWidth="2" />
      <rect x="92" y="108" width="42" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="86" y="115" width="54" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d="M94 110h38M88 117h50" stroke={P.paper} strokeWidth="2" opacity=".5" />
      <path d="M10 124v-9h7v9M20 124v-9h7v9M30 124v-9h7v9" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={wheel(50) + wheel(68)} fill="none" stroke={P.ink} strokeWidth="2" />
      <path d="M50 118L56 111H64L68 118M56 111L60 118L64 111M62 108h5" fill="none" stroke={P.ink} strokeWidth="1.5" />
      <path d={bag(150, 114)} fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <path d={bag(170, 115)} fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M153 117h5M173 118h5" stroke={P.paper} strokeWidth="2" opacity=".5" /><path d="M156 122h6M176 123h6" stroke={P.ink} strokeWidth="1" opacity=".4" />
    </g>
  );
}

/** Beeriga: a waterfront shack at the jetty on the lagoon, with a small boat. 6 by 4 tiles. */
function Beeriga({ uid, pal, name }: { uid: string; pal: Pal; name: string }) {
  return (
    <g>
      <Shade w={192} h={128} dx={5} dy={7} o={0.3} />
      <rect x="1" y="1" width="190" height="126" fill={`url(#${uid}-water)`} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="1" width="190" height="9" fill={P.leafDark} />
      <rect x="1" y="1" width="190" height="4" fill={P.leaf} />
      <path d="M118 28L182 28L174 46L126 46Z" fill={pal.accent} stroke={P.ink} strokeWidth="2" />
      <path d="M122 33H178" stroke={pal.primary} strokeWidth="3" />
      <rect x="138" y="22" width="4" height="8" fill={P.woodDark} />
      <rect x="180" y="30" width="9" height="13" fill={P.ink} /><rect x="182" y="32" width="2" height="9" fill={P.cap} />
      <path d="M118 50H140M150 53H176M110 40H116" stroke={P.lagoonLight} strokeWidth="2" />
      <path d="M124 46L118 66" stroke={P.ink} strokeWidth="1" />
      <rect x="88" y="66" width="100" height="16" fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <path d={rects([92, 118, 144, 170], 61, 6, 9)} fill={P.woodDark} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([92, 118, 144, 170], 80, 6, 7)} fill={P.woodDark} stroke={P.ink} strokeWidth="1.5" />
      <rect x="1" y="98" width="190" height="29" fill={`url(#${uid}-sand)`} stroke={P.ink} strokeWidth="2" />
      <path d="M1 98H190" stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="62" width="82" height="38" fill={`url(#${uid}-planks)`} stroke={P.ink} strokeWidth="2" />
      <rect x="18" y="72" width="38" height="22" fill={P.ink} />
      <rect x="16" y="66" width="42" height="7" fill={pal.accent} stroke={P.ink} strokeWidth="1.5" />
      <rect x="16" y="90" width="42" height="6" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="66" y="72" width="18" height="28" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="40" width="94" height="24" fill={`url(#${uid}-tin)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="58" width="94" height="6" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="42" width="90" height="2" fill={P.paper} opacity=".4" />
      <Plate x={15} y={44} w={68} h={16} text={name} fill={pal.primary} color={pal.secondary} size={11} spacing={0.6} />
      <rect x="104" y="106" width="9" height="9" fill={pal.accent} stroke={P.ink} strokeWidth="1.5" />
      <rect x="132" y="106" width="9" height="9" fill={pal.accent} stroke={P.ink} strokeWidth="1.5" />
      <rect x="116" y="104" width="13" height="11" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="160" y="104" width="14" height="14" fill={P.wood} stroke={P.ink} strokeWidth="2" /><path d="M160 111H174" stroke={P.woodDark} strokeWidth="2" />
    </g>
  );
}

/** The hero: the BRT shelter on the median. Black roof, yellow lip, glass, benches; the footbridge crosses over its middle. 8 by 3 tiles. */
function BrtShelter({ pal, sign }: { pal: Pal; sign: string }) {
  return (
    <g>
      <rect x="9" y="40" width="250" height="54" fill={P.shadow} opacity=".28" />
      <rect x="2" y="70" width="252" height="14" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="72" width="248" height="3" fill={P.paper} opacity=".4" />
      <rect x="8" y="30" width="240" height="42" fill={P.lagoonLight} opacity=".6" stroke={P.ink} strokeWidth="2" />
      <path d="M16 66l10-18M30 66l10-18M72 66l10-18M86 66l10-18M164 66l10-18M178 66l10-18M222 66l10-18" stroke={P.paper} strokeWidth="2" opacity=".6" />
      <rect x="14" y="54" width="52" height="8" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="62" width="52" height="4" fill={P.woodDark} />
      <rect x="190" y="54" width="52" height="8" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="190" y="62" width="52" height="4" fill={P.woodDark} />
      <rect x="8" y="80" width="240" height="2" fill={pal.primary} />
      <rect x="72" y="38" width="20" height="24" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d="M75 44H88M75 49H84M75 54H88" stroke={P.lagoon} strokeWidth="2" />
      <rect x="226" y="42" width="14" height="26" fill={pal.secondary} stroke={P.ink} strokeWidth="2" />
      <rect x="229" y="46" width="8" height="6" fill={P.lagoonLight} /><rect x="229" y="56" width="8" height="2" fill={pal.accent} />
      <path d="M5 28h7v46h-7ZM63 28h6v46h-6ZM125 28h6v46h-6ZM187 28h6v46h-6ZM245 28h7v46h-7Z" fill={P.ink} />
      <rect x="0" y="0" width="256" height="32" fill={pal.secondary} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="24" width="256" height="8" fill={pal.primary} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width="252" height="3" fill={P.paper} opacity=".3" />
      <path d="M64 6V22M192 6V22" stroke={P.wall} strokeWidth="2" />
      <Plate x={8} y={5} w={84} h={17} text={sign} fill={pal.primary} color={pal.secondary} size={13} spacing={2} />
      <Plate x={164} y={5} w={84} h={17} text="BRT STOP" fill={pal.accent} color={pal.secondary} size={11} spacing={1} />
    </g>
  );
}

// ---- The room ---------------------------------------------------------------------------------------------------------

export default function HotspotYabaArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const data = hotspotRoomData("yaba");
  const pal = data?.palette ?? FALLBACK;
  const sign = data?.sign ?? "JIBOWU";
  const name = (i: number) => data?.landmarks[i]?.name ?? VENUES[i];
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const t = (n: number) => n * tile;
  const face = (p: CampaignProp, left: ReactNode, right: ReactNode) => ((p.variant ?? 0) === 1 ? right : left);
  const order = (p: CampaignProp) => (p.id === "footbridge-deck" ? 1000 : p.kind === "rails" || p.kind === "zebra" ? -100 : p.y);
  const roadX = t(1);
  const roadW = W - t(2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["concrete", "paving", "asphalt", "grass", "water", "deck", "sand"]} />
      <defs>
        <pattern id={`${uid}-hzawning`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill={P.orange} /><rect x="8" width="8" height="16" fill={P.paper} /></pattern>
        <pattern id={`${uid}-hazard`} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="4" fill={P.paper} /><rect y="4" width="8" height="4" fill={P.red} /></pattern>
        <pattern id={`${uid}-ballast`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill={P.cap} /><path d="M2 3h3v2H2ZM10 7h3v2h-3ZM5 12h3v2H5Z" fill={P.wall} /><path d="M12 2h2v2h-2ZM3 8h2v2H3Z" fill={P.stone} /></pattern>
        <pattern id={`${uid}-sleepers`} width="8" height="12" patternUnits="userSpaceOnUse"><rect y="3" width="8" height="6" fill={P.woodDark} /><rect y="3" width="8" height="1" fill={P.wood} /></pattern>
        <pattern id={`${uid}-zebra`} width="96" height="16" patternUnits="userSpaceOnUse"><rect x="4" y="4" width="88" height="8" fill={P.paper} opacity=".92" /></pattern>
        <pattern id={`${uid}-walkway`} width="44" height="14" patternUnits="userSpaceOnUse"><rect width="44" height="14" fill={P.concrete} /><path d="M0 13H44" stroke={P.concreteDark} strokeWidth="1" /><path d="M6 4h8M26 9h9" stroke={P.paper} strokeWidth="1" opacity=".6" /></pattern>
        <pattern id={`${uid}-truss`} width="7" height="14" patternUnits="userSpaceOnUse"><rect width="7" height="14" fill={P.wall} /><path d="M0 0L7 7L0 14" fill="none" stroke={P.slateLight} strokeWidth="1.5" /></pattern>
        <pattern id={`${uid}-tin`} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={P.slateLight} /><path d="M0 0V8" stroke={P.paper} strokeWidth="1" opacity=".6" /><path d="M4 0V8" stroke={P.slate} strokeWidth="2" /></pattern>
        <pattern id={`${uid}-planks`} width="10" height="32" patternUnits="userSpaceOnUse"><rect width="10" height="32" fill={P.woodLight} /><path d="M0 0V32" stroke={P.wood} strokeWidth="1" /><path d="M5 5v6M3 21v5" stroke={P.woodDark} strokeWidth="1" /></pattern>
        <pattern id={`${uid}-link`} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={P.slate} /><path d="M0 0L4 4M4 0L0 4" stroke={P.slateLight} strokeWidth="1" /></pattern>
      </defs>
      <Frame layout={layout} ground="#2E3431" />

      {/* Ground: the pavement under the facades, the road, the pavement and the paved plaza. */}
      <rect x={roadX} y={t(1)} width={roadW} height={t(5)} fill={`url(#${uid}-concrete)`} />
      <rect x={roadX} y={t(6)} width={roadW} height={t(7)} fill={`url(#${uid}-asphalt)`} />
      <rect x={roadX} y={t(13)} width={roadW} height={t(1)} fill={`url(#${uid}-concrete)`} />
      <rect x={roadX} y={t(14)} width={roadW} height={t(5)} fill={`url(#${uid}-paving)`} />
      <rect x={roadX} y={t(5) + 6} width={roadW} height="5" fill={P.shadow} opacity=".18" />
      <rect x={roadX} y={t(6) - 5} width={roadW} height="5" fill={pal.primary} />
      <path d={`M${roadX} ${t(6) - 3}H${roadX + roadW}`} stroke={pal.secondary} strokeWidth="5" strokeDasharray="10 10" />
      <rect x={roadX} y={t(13)} width={roadW} height="5" fill={pal.primary} />
      <path d={`M${roadX} ${t(13) + 3}H${roadX + roadW}`} stroke={pal.secondary} strokeWidth="5" strokeDasharray="10 10" />
      <path d={`M${roadX} ${t(6) + 7}H${roadX + roadW}M${roadX} ${t(13) - 8}H${roadX + roadW}`} stroke={P.paper} strokeWidth="2" opacity=".6" />
      <path d={`M${roadX} ${t(7)}H${roadX + roadW}M${roadX} ${t(12)}H${roadX + roadW}`} stroke={P.paper} strokeWidth="3" strokeDasharray="14 12" opacity=".75" />
      <text x={t(8) + 10} y={t(12) - 5} fill={P.paper} opacity=".7" fontFamily={FONT.display} fontWeight={900} fontSize="17" letterSpacing="7">BRT</text>
      <path d={`M${t(3) + 4} ${t(9) + 6}h3M${t(9)} ${t(7) + 12}h2M${t(25)} ${t(9) + 4}h3M${t(13)} ${t(12) + 20}h2M${t(26) + 8} ${t(7) + 2}h2`} stroke={P.asphaltLight} strokeWidth="2" />

      {/* The BRT island: concrete under the shelter with a black-and-yellow kerb. */}
      <rect x={t(10)} y={t(8)} width={t(10)} height={t(3)} fill={`url(#${uid}-concrete)`} stroke={P.ink} strokeWidth="2" />
      <rect x={t(10) + 2} y={t(8) + 2} width={t(10) - 4} height={t(3) - 4} fill="none" stroke={pal.primary} strokeWidth="4" />
      <rect x={t(10) + 2} y={t(8) + 2} width={t(10) - 4} height={t(3) - 4} fill="none" stroke={pal.secondary} strokeWidth="4" strokeDasharray="8 8" />

      {/* The paving: a lighter apron in front of the exit signpost. */}
      <rect x={t(11)} y={t(15)} width={t(7)} height={t(4)} fill={`url(#${uid}-concrete)`} opacity=".7" />
      <rect x={t(11) + 3} y={t(15) + 3} width={t(7) - 6} height={t(4) - 6} fill="none" stroke={P.concreteDark} strokeWidth="2" />

      {/* The Hop route along the pavement: UNILAG 1, Ozone 2, CcHub 3, Beeriga the finale (the rails cover it where it crosses). */}
      <RouteLine points={[[112, 176], [304, 176], [528, 176], [816, 176]]} />
      {/* The one bounce wordmark: road paint on the paving apron under the map signpost. */}
      <HoppazWordmark x={480} y={566} h={18} fill={P.orange} shadow={P.brandEmber} anchor="middle" />

      <Props
        layout={layout}
        uid={uid}
        order={order}
        custom={{
          "venue-1": () => <Unilag uid={uid} pal={pal} name={name(0)} />,
          "venue-2": () => <Ozone pal={pal} name={name(1)} />,
          "venue-3": () => <CcHub uid={uid} name={name(2)} />,
          "venue-4": () => <Beeriga uid={uid} pal={pal} name={name(3)} />,
          hero: () => <BrtShelter pal={pal} sign={sign} />,
          "footbridge-n": (p) => <Stairs w={p.w * tile} h={p.h * tile} />,
          "footbridge-s": (p) => <Stairs w={p.w * tile} h={p.h * tile} />,
          "footbridge-deck": () => <FootbridgeDeck uid={uid} />,
          rails: () => <Rails uid={uid} />,
          zebra: () => <rect x="0" y="0" width="96" height="224" fill={`url(#${uid}-zebra)`} />,
          crossing: (p) => <Crossing uid={uid} left={(p.variant ?? 0) % 2 === 0} />,
          "danfo-5": () => <HopBus w={96} h={32} />,
          danfo: (p) => face(p, <Danfo flip={false} />, <Danfo flip />),
          keke: (p) => face(p, <Keke flip={false} />, <Keke flip />),
          brtbus: () => <BrtBus pal={pal} />,
          parasol: () => <Parasol uid={uid} />,
          suya: () => <SuyaGrill />,
          newsstand: () => <Newsstand uid={uid} />,
          busstop: () => <BusStopSign pal={pal} />,
          streetsign: () => <StreetSign sign={sign} />,
          streetlamp: () => <StreetLamp />,
          bin: () => <Bin />,
        }}
      />

      {/* The railway fence on the plaza, either side of the tracks. */}
      {layout.walls.map((w, i) => (
        <g key={i}>
          <rect x={t(w.x) + 14} y={t(w.y) + 6} width={t(w.w) - 16} height={t(w.h)} fill={P.shadow} opacity=".25" />
          <rect x={t(w.x) + 10} y={t(w.y)} width={t(w.w) - 20} height={t(w.h)} fill={P.ink} />
          <rect x={t(w.x) + 13} y={t(w.y) + 2} width={t(w.w) - 26} height={t(w.h) - 4} fill={`url(#${uid}-link)`} />
          <path d={Array.from({ length: w.h + 1 }, (_, k) => `M${t(w.x) + 8} ${t(w.y) + k * tile - (k === w.h ? 5 : 0)}h${t(w.w) - 16}v5h${-(t(w.w) - 16)}Z`).join("")} fill={P.cap} stroke={P.ink} strokeWidth="1" />
        </g>
      ))}

      {/* A warm afternoon over the whole street. */}
      <rect x="0" y="0" width={W} height={H} fill={P.orange} opacity=".05" />
    </svg>
  );
}
