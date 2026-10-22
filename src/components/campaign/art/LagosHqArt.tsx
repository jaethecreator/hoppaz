import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { BRAND_LINES, Defs, FONT, HopBus, HoppazWordmark, P, Plate, Props, RouteLine, Shade, type RoomArtProps } from "./kit";

/**
 * Lagos HQ (crew template `lagos-hq`): a bright Lagos street at the edge of the lagoon, drawn light and simple in the
 * 360Playlist pixel style (2 px ink, top-left light, a hard shadow to the lower right, flat colour). Draws from
 * src/lib/campaign/rooms/lagosHq.ts at both widths (30 and 36): every piece is placed from the layout's own props and zones.
 *
 * Colour. Light paving and a light grey road; the lagoon, a danfo yellow, a keke green and a few awnings are the colour. The
 * orange and cream of Hoppaz sit on the billboard, the bus and the vendor umbrellas, as in the hotspot rooms. No people: the
 * engine draws the avatars.
 */

const T = 32;
const SKY = "#BFE3F2";
const ROAD = "#A9AFB9";
const ROAD_DOT = "#BAC0C9";
const ROAD_DIM = "#98A0AB";
const CLOTH = ["#E83F6F", "#F5C842", "#2FA84F", "#3E8FB8", "#FF7A1A", "#F5EBDD"];

/** Subpaths for a row of identical rectangles: one SVG node instead of one per rectangle. */
const rects = (xs: number[], y: number, w: number, h: number) => xs.map((x) => `M${x} ${y}h${w}v${h}h${-w}Z`).join("");

// ---- Water and trees ----------------------------------------------------------------------------------------------------

/** A body of water with a concrete lip along the south edge. `boat` floats a small wooden boat on it. */
function Lagoon({ w, h, uid, boat }: { w: number; h: number; uid: string; boat: boolean }) {
  return (
    <g>
      <rect x="4" y="6" width={w} height={h} fill={P.shadow} opacity=".18" />
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-water)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="3" fill={P.paper} opacity=".4" />
      {boat && (
        <g>
          <rect x={w * 0.2} y={h * 0.42} width="46" height="4" fill={P.lagoonDark} opacity=".35" />
          <path d={`M${w * 0.2 - 4} ${h * 0.3}h54l-8 12h-38Z`} fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
          <rect x={w * 0.2} y={h * 0.3 + 3} width="46" height="3" fill={P.danfo} />
          <rect x={w * 0.2 + 22} y={h * 0.3 - 20} width="3" height="20" fill={P.ink} />
          <path d={`M${w * 0.2 + 25} ${h * 0.3 - 19}h16l-16 15Z`} fill={P.paper} stroke={P.ink} strokeWidth="1" />
        </g>
      )}
      <rect x="-1" y={h - 8} width={w + 2} height="10" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y={h - 6} width={w - 2} height="2" fill={P.paper} opacity=".6" />
    </g>
  );
}

/** The jetty: planks running out into the lagoon, with a bollard at each corner of the landward end and a rope along one side. */
function Jetty({ w, h, uid }: { w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x="4" y="4" width={w} height={h} fill={P.shadow} opacity=".2" />
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w / 2} 2V${h - 2}`} stroke={P.woodDark} strokeWidth="1" opacity=".5" />
      <path d={rects([4, w - 10], 6, 6, 6) + rects([4, w - 10], h * 0.5, 6, 6) + rects([4, w - 10], h - 18, 6, 6)} fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
      <rect x={w / 2 - 6} y="4" width="12" height="7" fill={P.danfo} stroke={P.ink} strokeWidth="1.5" />
    </g>
  );
}

/** A coconut palm: a curved trunk and a crown of fronds that rises above the tile. 1 by 1. */
function Palm() {
  return (
    <g>
      <ellipse cx="17" cy="29" rx="10" ry="3" fill={P.shadow} opacity=".25" />
      <path d="M14 30L16 4h5L21 30Z" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M15 12h6M15 19h6M14 25h7" stroke={P.woodDark} strokeWidth="1.5" />
      <path d="M18 5c-10-14-26-12-30 0c10-6 20-4 30 0ZM18 5c10-14 26-12 30 0c-10-6-20-4-30 0ZM18 5c-14-4-24 4-26 14c8-8 16-12 26-14ZM18 5c14-4 24 4 26 14c-8-8-16-12-26-14ZM18 5c-5-12-2-26 6-30c-1 10-2 20-6 30Z" fill={P.mint} stroke={P.ink} strokeWidth="2" />
      <path d="M18 5c-8-8-16-8-22-3c8-1 14 0 22 3Z" fill={P.leaf} />
      <circle cx="16" cy="7" r="3" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
      <circle cx="21" cy="8" r="3" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

// ---- The stage and the billboard ----------------------------------------------------------------------------------------

/**
 * The back wall of the stage: a pastel wall with the Lagos HQ billboard in the middle and a painted mural on each side. The
 * billboard is the room's one Hoppaz surface: orange, cream and night, the bounce wordmark and a conductor's line.
 */
function Billboard({ w, h }: { w: number; h: number }) {
  const bx = 60;
  const bw = w - 120;
  return (
    <g>
      <rect x="5" y="8" width={w} height={h} fill={P.shadow} opacity=".22" />
      <rect x="0" y="0" width={w} height={h} fill="#F6E6BC" stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="6" fill="#FFF6DD" />
      <rect x="0" y={h - 14} width={w} height="14" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <path d={rects(Array.from({ length: Math.floor(w / 16) }, (_, i) => 4 + i * 16), h - 11, 8, 4)} fill={P.lagoonLight} />
      {/* The mural on the left: a sun over a danfo-yellow stripe and a green hill. */}
      <rect x="8" y="10" width="44" height={h - 30} fill="#CDEAF4" stroke={P.ink} strokeWidth="2" />
      <circle cx="30" cy="30" r="10" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <path d={`M8 ${h - 20}q14-18 28-4t16-6V${h - 20}Z`} fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y={h - 34} width="40" height="4" fill={P.danfo} />
      <path d="M14 22h8M38 18h8" stroke={P.paper} strokeWidth="3" />
      {/* The mural on the right: a woman in ankara, a head wrap and big stripes. */}
      <rect x={w - 52} y="10" width="44" height={h - 30} fill="#FBE0E8" stroke={P.ink} strokeWidth="2" />
      <circle cx={w - 30} cy="34" r="9" fill="#77452E" stroke={P.ink} strokeWidth="2" />
      <rect x={w - 40} y="20" width="20" height="9" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w - 44} ${h - 22}v-22h28v22Z`} fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <path d={rects([w - 40, w - 31, w - 22], h - 42, 4, 18)} fill={P.paper} />
      {/* The billboard: night frame, orange board, cream letters with an ember shadow, the wordmark small above. */}
      <rect x={bx - 1} y="4" width={bw + 2} height={h - 20} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x={bx + 4} y="9" width={bw - 8} height={h - 30} fill={P.orange} />
      <rect x={bx + 4} y="9" width={bw - 8} height="3" fill={P.paper} opacity=".35" />
      <HoppazWordmark x={bx + bw / 2} y={26} h={9} fill={P.paper} anchor="middle" />
      <text x={bx + bw / 2 + 2} y={h - 31} textAnchor="middle" fill={P.brandEmber} fontFamily={FONT.display} fontWeight={900} fontSize="28" letterSpacing="1">LAGOS HQ</text>
      <text x={bx + bw / 2} y={h - 33} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="28" letterSpacing="1">LAGOS HQ</text>
      <rect x={bx + 4} y={h - 28} width={bw - 8} height="10" fill={P.night} />
      <text x={bx + bw / 2} y={h - 20.5} textAnchor="middle" fill={P.paper} fontFamily={FONT.mono} fontSize="6.5" letterSpacing="1.4">{BRAND_LINES.hop}</text>
      <path d={`M${bx + 14} 4v-6M${bx + bw - 14} 4v-6`} stroke={P.ink} strokeWidth="3" />
    </g>
  );
}

/** The low stage: pale boards with an orange lip along the front. A floor prop: you walk onto it. */
function StageFloor({ w, h, uid }: { w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-stagelight)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y={h - 8} width={w - 4} height="6" fill={P.orange} />
      <rect x="2" y={h - 3} width={w - 4} height="1" fill={P.brandEmber} />
    </g>
  );
}

/** The DJ's table: two decks and a laptop on a pale table with an orange skirt. The DJ stands behind it. */
function DjDesk({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="3" width={w - 2} height={h - 4} fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y={h - 9} width={w - 4} height="7" fill={P.orange} />
      <circle cx="26" cy="11" r="8" fill={P.night} stroke={P.ink} strokeWidth="2" /><circle cx="26" cy="11" r="2.5" fill={P.paper} />
      <circle cx={w - 26} cy="11" r="8" fill={P.night} stroke={P.ink} strokeWidth="2" /><circle cx={w - 26} cy="11" r="2.5" fill={P.paper} />
      <rect x={w / 2 - 12} y="5" width="24" height="12" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w / 2 - 9} 9h18M${w / 2 - 9} 12h10`} stroke={P.slateLight} strokeWidth="1.5" />
    </g>
  );
}

/** A tall speaker with two cones. 1 by 2. */
function SpeakerStack({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="3" y="2" width={w - 6} height={h - 4} fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <rect x="5" y="4" width="2" height={h - 8} fill={P.wall} />
      <circle cx={w / 2} cy="18" r="8" fill={P.wall} stroke={P.shadow} strokeWidth="2" /><circle cx={w / 2} cy="18" r="3" fill={P.slate} />
      <circle cx={w / 2} cy={h - 20} r="9" fill={P.wall} stroke={P.shadow} strokeWidth="2" /><circle cx={w / 2} cy={h - 20} r="3.5" fill={P.slate} />
      <rect x="8" y={h - 7} width={w - 16} height="2" fill={P.orange} />
    </g>
  );
}

/** The featured event's plinth at the foot of the stage: a yellow and black kerb stone with a NEXT UP plate. A floor prop. */
function Plinth({ w }: { w: number }) {
  return (
    <g>
      <ellipse cx={w / 2} cy="26" rx={w / 2 + 6} ry="8" fill={P.danfo} opacity=".35" />
      <rect x="4" y="9" width={w - 4} height="19" fill={P.shadow} opacity=".2" />
      <rect x="1" y="5" width={w - 4} height="21" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <path d={`M3 7h${w - 8}`} stroke={P.paper} strokeWidth="2" opacity=".6" />
      <path d={Array.from({ length: Math.floor((w - 8) / 12) }, (_, i) => `M${4 + i * 12} 24l6-0v-4h-6Z`).join("")} fill={P.ink} />
      <Plate x={w / 2 - 22} y={8} w={40} h={11} text="NEXT UP" fill={P.paper} color={P.night} size={7} spacing={0.6} />
    </g>
  );
}

// ---- The market -----------------------------------------------------------------------------------------------------------

/** A roadside stall under a striped awning. variant 0 akara, 1 phone accessories, 2 cloth. 3 by 2. */
function Stall({ uid, v, w, h }: { uid: string; v: number; w: number; h: number }) {
  const awn = ["akawn", "phawn", "clawn"][v] ?? "akawn";
  const name = ["AKARA", "PHONES", "CLOTH"][v] ?? "STALL";
  return (
    <g>
      <rect x="6" y="14" width={w} height={h - 10} fill={P.shadow} opacity=".25" />
      <rect x="4" y="22" width={w - 8} height={h - 24} fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="24" width={w - 12} height="4" fill="#D4AE86" />
      {v === 0 && (
        <g>
          <rect x="8" y="28" width={w - 16} height="14" fill={P.ink} />
          <path d={rects([12, 34, 56, 78].filter((x) => x < w - 20), 29, 14, 11)} fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
          {[18, 24, 40, 46, 62, 68, 84].filter((x) => x < w - 14).map((x) => <circle key={x} cx={x} cy="33" r="3" fill={P.danfo} stroke={P.emberDark} strokeWidth="1" />)}
        </g>
      )}
      {v === 1 && (
        <g>
          <rect x="8" y="28" width={w - 16} height="14" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1.5" />
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={13 + i * 15} y="31" width="7" height="10" fill={["#E83F6F", "#F5C842", "#2FA84F", "#3E8FB8", "#FF7A1A"][i]} stroke={P.ink} strokeWidth="1" />)}
          <path d={`M10 2V14M${w - 10} 2V14`} stroke={P.ink} strokeWidth="1" />
          {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${18 + i * 12} 14v8`} stroke={["#E83F6F", "#F5C842", "#2FA84F", "#3E8FB8", "#FF7A1A", "#F5EBDD"][i]} strokeWidth="2.5" />)}
        </g>
      )}
      {v === 2 && (
        <g>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i}>
              <rect x={9 + i * 13} y="14" width="11" height="24" fill={CLOTH[i]} stroke={P.ink} strokeWidth="1.5" />
              <path d={`M${11 + i * 13} 20h7M${11 + i * 13} 26h7M${11 + i * 13} 32h7`} stroke={P.paper} strokeWidth="1.5" opacity=".7" />
            </g>
          ))}
        </g>
      )}
      <path d={`M6 22V${h - 4}M${w - 6} 22V${h - 4}`} stroke={P.ink} strokeWidth="3" />
      <path d={`M-2 6H${w + 2}L${w - 4} -6H4Z`} fill={`url(#${uid}-${awn})`} stroke={P.ink} strokeWidth="2" />
      <rect x="-2" y="6" width={w + 4} height="5" fill={P.ink} />
      <Plate x={w / 2 - 22} y={-12} w={44} h={11} text={name} fill={P.paper} color={P.night} size={7} spacing={0.5} />
    </g>
  );
}

/** A vendor's umbrella over a stool and a tray. 1 by 1, the canopy rises above the box. */
function Parasol({ uid }: { uid: string }) {
  return (
    <g>
      <ellipse cx="17" cy="29" rx="12" ry="3" fill={P.shadow} opacity=".28" />
      <rect x="15" y="-4" width="3" height="32" fill={P.ink} />
      <path d="M-4 0H38L31 -14H3Z" fill={`url(#${uid}-umbrella)`} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="16" width="24" height="5" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M8 21V28M26 21V28" stroke={P.ink} strokeWidth="2" />
      <path d={rects([8, 13, 18, 23], 10, 3, 6)} fill={P.keke} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

// ---- The road ---------------------------------------------------------------------------------------------------------------

/** Black-and-white bars across the road. Floor decoration. */
function Zebra({ w, h }: { w: number; h: number }) {
  const bars = Array.from({ length: Math.floor(h / 14) }, (_, i) => `M4 ${5 + i * 14}h${w - 8}v8h${-(w - 8)}Z`).join("");
  return <path d={bars} fill={P.paper} opacity=".95" />;
}

/** A danfo: a boxy yellow minibus with the black stripe and a roof rack. Faces left; variant 1 faces right. 3 by 1. */
function Danfo({ flip }: { flip: boolean }) {
  return (
    <g transform={flip ? "translate(96 0) scale(-1 1)" : undefined}>
      <rect x="10" y="22" width="88" height="10" fill={P.shadow} opacity=".3" />
      <path d="M14 -15H82M18 -15v5M48 -15v5M78 -15v5" stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="-21" width="26" height="7" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="-11" width="90" height="37" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="-9" width="86" height="2" fill={P.paper} opacity=".5" />
      <path d="M5 -6H17V8H5Z" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([22, 43, 64], -6, 17, 14)} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1.5" />
      <path d="M41 -9V11M62 -9V11" stroke={P.danfoDark} strokeWidth="1.5" />
      <rect x="3" y="11" width="88" height="7" fill={P.ink} />
      <path d="M8 14.5H86" stroke={P.danfo} strokeWidth="1" strokeDasharray="7 4" />
      <rect x="3" y="18" width="88" height="6" fill={P.danfoDark} />
      <rect x="0" y="20" width="8" height="6" fill={P.ink} />
      <rect x="1" y="8" width="4" height="3" fill={P.paper} />
      <rect x="89" y="-2" width="3" height="7" fill={P.red} />
      <circle cx="22" cy="27" r="6.5" fill={P.ink} /><circle cx="22" cy="27" r="2.5" fill={P.lagoonLight} />
      <circle cx="72" cy="27" r="6.5" fill={P.ink} /><circle cx="72" cy="27" r="2.5" fill={P.lagoonLight} />
    </g>
  );
}

/** A keke (tricycle taxi): green, yellow stripe, open cabin under a canopy, one wheel at the front. 2 by 1. */
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
      <rect x="5" y="1" width="7" height="8" fill={P.lagoonLight} />
      <path d="M0 -4H9" stroke={P.ink} strokeWidth="3" />
      <circle cx="8" cy="26" r="5" fill={P.ink} /><circle cx="8" cy="26" r="2" fill={P.lagoonLight} />
      <circle cx="46" cy="26" r="6" fill={P.ink} /><circle cx="46" cy="26" r="2" fill={P.lagoonLight} />
    </g>
  );
}

/** An okada (motorbike taxi) seen from the side: a yellow tank, a long seat, a headlamp, two big wheels. Faces left; variant 1 faces right. 2 by 1. */
function Okada({ flip }: { flip: boolean }) {
  return (
    <g transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
      <rect x="6" y="25" width="54" height="5" fill={P.shadow} opacity=".28" />
      <path d="M13 24L19 6" stroke={P.ink} strokeWidth="3" />
      <path d="M15 5H27" stroke={P.ink} strokeWidth="3" />
      <rect x="6" y="6" width="8" height="6" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d="M17 18H42L46 12H20Z" fill={P.red} stroke={P.ink} strokeWidth="2" />
      <rect x="20" y="9" width="12" height="6" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="8" width="22" height="5" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
      <rect x="22" y="18" width="16" height="7" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <path d="M40 22H56" stroke={P.ink} strokeWidth="3" />
      <rect x="52" y="12" width="9" height="3" fill={P.red} stroke={P.ink} strokeWidth="1" />
      <circle cx="14" cy="24" r="7.5" fill={P.ink} /><circle cx="14" cy="24" r="3" fill={P.paper} />
      <circle cx="50" cy="24" r="7.5" fill={P.ink} /><circle cx="50" cy="24" r="3" fill={P.paper} />
    </g>
  );
}

/** A street lamp. 1 by 1, the head rises above the box. */
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

// ---- The bus stop and the suya spot ----------------------------------------------------------------------------------------

/** The bus shelter: a yellow roof on four posts, a back panel with the route and a bench under it. 5 by 2. */
function BusShelter({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="8" y="14" width={w} height={h - 8} fill={P.shadow} opacity=".25" />
      <rect x="6" y="14" width={w - 12} height={h - 20} fill={P.lagoonLight} opacity=".65" stroke={P.ink} strokeWidth="2" />
      <path d={`M${w / 2} 16V${h - 8}`} stroke={P.paper} strokeWidth="2" opacity=".7" />
      <rect x="14" y={h - 24} width={w - 28} height="6" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d={`M20 ${h - 18}V${h - 10}M${w - 20} ${h - 18}V${h - 10}`} stroke={P.ink} strokeWidth="3" />
      <path d={`M8 6V${h - 6}M${w - 8} 6V${h - 6}`} stroke={P.ink} strokeWidth="3" />
      <rect x="-2" y="-2" width={w + 4} height="14" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="0" width={w + 0} height="3" fill={P.paper} opacity=".5" />
      <rect x="-2" y="9" width={w + 4} height="3" fill={P.danfoDark} />
      <Plate x={w / 2 - 38} y={-1} w={76} h={11} text="BUS STOP" fill={P.night} color={P.danfo} size={8} spacing={1.2} />
    </g>
  );
}

/** A bus stop sign on a pole: a yellow disc. 1 by 1, the disc rises above the box. */
function BusStopSign() {
  return (
    <g>
      <ellipse cx="17" cy="28" rx="8" ry="3" fill={P.shadow} opacity=".3" />
      <rect x="15" y="-6" width="4" height="35" fill={P.ink} />
      <circle cx="17" cy="-10" r="11" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="-14" width="18" height="9" fill={P.night} />
      <text x="17" y="-7" textAnchor="middle" fill={P.danfo} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".2">BUS</text>
    </g>
  );
}

/** The suya stall: a charcoal trough with skewers, a table, smoke and a canopy. 4 by 2, the smoke and canopy rise above the box. */
function SuyaStall({ uid, w, h }: { uid: string; w: number; h: number }) {
  return (
    <g>
      <rect x="8" y="18" width={w} height={h - 12} fill={P.shadow} opacity=".25" />
      <path d="M20 8h9v-9h-9ZM32 -4h11v-10h-11ZM46 -18h12v-11h-12Z" fill={P.cap} opacity=".55" />
      <path d="M24 16h7v-7h-7ZM37 5h9v-8h-9ZM52 -8h8v-8h-8Z" fill={P.stone} opacity=".8" />
      <rect x="4" y="24" width={w - 8} height={h - 26} fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="26" width={w - 12} height="4" fill="#D4AE86" />
      <rect x="10" y="16" width="62" height="14" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <path d={rects([13, 21, 29, 37, 45, 53, 61], 18, 5, 5)} fill={P.orange} />
      <path d="M10 16H72" stroke={P.cap} strokeWidth="2" />
      <path d={rects([14, 22, 30, 38, 46, 54, 62], 10, 3, 8)} fill={P.emberDark} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 44} y="30" width="34" height="16" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([w - 40, w - 31, w - 22], 33, 6, 5)} fill={P.emberDark} stroke={P.ink} strokeWidth="1" />
      <path d="M8 2V52M" stroke={P.ink} strokeWidth="3" />
      <path d={`M${w - 8} 2V52`} stroke={P.ink} strokeWidth="3" />
      <path d={`M-4 4H${w + 4}L${w - 6} -8H6Z`} fill={`url(#${uid}-umbrella)`} stroke={P.ink} strokeWidth="2" />
      <Plate x={w / 2 - 20} y={4} w={40} h={11} text="SUYA" fill={P.night} color={P.danfo} size={8} spacing={1} />
    </g>
  );
}

/** A low wooden stool. 1 by 1. */
function Stool() {
  return (
    <g>
      <ellipse cx="17" cy="28" rx="9" ry="3" fill={P.shadow} opacity=".28" />
      <rect x="8" y="14" width="18" height="6" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M11 20L9 28M23 20L25 28" stroke={P.ink} strokeWidth="3" />
    </g>
  );
}

// ---- The room -------------------------------------------------------------------------------------------------------------------

export default function LagosHqArt({ layout, uid }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const t = (n: number) => n * tile;
  const prop = (id: string): CampaignProp => layout.props.find((p) => p.id === id) as CampaignProp;
  const stop = (id: string) => layout.zones.find((z) => z.id === id)!.stop;
  const face = (p: CampaignProp, left: ReactNode, right: ReactNode) => ((p.variant ?? 0) === 1 ? right : left);
  const ROAD_Y = 9;
  const ROAD_H = 4;
  const shelter = prop("bus-shelter");
  const stage = prop("stage-platform");
  const hop = prop("hop-bus");
  const suya = stop("suya");
  const bus = stop("busstop");
  const stage1 = stop("stage");
  const order = (p: CampaignProp) => (p.kind === "zebra" || p.kind === "stagefloor" || p.kind === "jetty" ? -100 : p.y * tile + (p.kind === "lagoon" || p.kind === "billboard" ? -50 : 0));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["paving", "water", "deck"]} />
      <defs>
        <pattern id={`${uid}-road`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill={ROAD} /><path d="M4 5h2M20 14h3M11 25h2M27 8h1M6 19h1" stroke={ROAD_DOT} strokeWidth="1" /><path d="M15 3h1M25 27h2" stroke={ROAD_DIM} strokeWidth="1" /></pattern>
        <pattern id={`${uid}-stagelight`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill="#F0DCB4" /><path d="M0 0H32M16 0V16" stroke="#D7BF90" strokeWidth="1" /><path d="M3 7h8M20 12h5" stroke="#FFF1CF" strokeWidth="1" /></pattern>
        <pattern id={`${uid}-akawn`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill={P.orange} /><rect x="8" width="8" height="16" fill={P.paper} /></pattern>
        <pattern id={`${uid}-phawn`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill={P.lagoon} /><rect x="8" width="8" height="16" fill={P.paper} /></pattern>
        <pattern id={`${uid}-clawn`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill={P.keke} /><rect x="8" width="8" height="16" fill={P.danfo} /></pattern>
        <pattern id={`${uid}-umbrella`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill={P.orange} /><rect x="8" width="8" height="16" fill={P.paper} /></pattern>
        <pattern id={`${uid}-hedge`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#8DB57F" /><path d="M2 3h3v2M10 9h3v2M5 12h2" stroke="#6E9A62" strokeWidth="1" /><path d="M8 2h2M1 8h2" stroke="#A9CE9A" strokeWidth="1" /></pattern>
      </defs>

      {/* The sky and the edge of the world: a pale band above, hedges at the sides, a kerb below. */}
      <rect width={W} height={H} fill="#DCE6E4" />
      <rect x="0" y="0" width={W} height={t(1)} fill={SKY} />
      <rect x="0" y={t(1)} width={t(1)} height={t(18)} fill={`url(#${uid}-hedge)`} />
      <rect x={W - t(1)} y={t(1)} width={t(1)} height={t(18)} fill={`url(#${uid}-hedge)`} />
      <rect x="0" y={H - t(1)} width={W} height={t(1)} fill="#C9C3B3" />
      <path d={`M${t(1)} ${t(1)}V${H - t(1)}M${W - t(1)} ${t(1)}V${H - t(1)}`} stroke={P.ink} strokeWidth="2" />

      {/* Ground: the promenade and the market above the road, the road, the pavement below. */}
      <rect x={t(1)} y={t(1)} width={W - t(2)} height={t(8)} fill={`url(#${uid}-paving)`} />
      <rect x={t(1)} y={t(13)} width={W - t(2)} height={t(6)} fill={`url(#${uid}-paving)`} />
      <rect x={t(1)} y={t(1)} width={W - t(2)} height={t(8)} fill={P.paper} opacity=".38" />
      <rect x={t(1)} y={t(13)} width={W - t(2)} height={t(6)} fill={P.paper} opacity=".38" />
      <rect x={t(1)} y={t(ROAD_Y)} width={W - t(2)} height={t(ROAD_H)} fill={`url(#${uid}-road)`} />
      {/* Kerbs, the yellow edge lines, the dashed centre line. */}
      <rect x={t(1)} y={t(ROAD_Y) - 6} width={W - t(2)} height="6" fill="#E7E1D0" stroke={P.ink} strokeWidth="1" />
      <rect x={t(1)} y={t(ROAD_Y + ROAD_H)} width={W - t(2)} height="6" fill="#E7E1D0" stroke={P.ink} strokeWidth="1" />
      <path d={`M${t(1)} ${t(ROAD_Y) + 4}H${W - t(1)}M${t(1)} ${t(ROAD_Y + ROAD_H) - 4}H${W - t(1)}`} stroke={P.danfo} strokeWidth="3" />
      <path d={`M${t(1)} ${t(ROAD_Y + 2)}H${W - t(1)}`} stroke={P.paper} strokeWidth="3" strokeDasharray="16 14" />
      {/* Paving details: the quay along the water, a painted bay under the stage, a paler apron in front of the gate. */}
      <rect x={t(1)} y={t(4)} width={t(9) + 0} height="4" fill={P.concreteDark} opacity=".5" />
      <rect x={stage.x * tile - 10} y={t(6)} width={stage.w * tile + 20} height={t(2)} fill="#EFE6CC" stroke={P.concreteDark} strokeWidth="2" opacity=".85" />
      <rect x={t(layout.spawn.x - 5)} y={t(15)} width={t(9)} height={t(4)} fill="#EFE6CC" opacity=".8" />
      <rect x={t(layout.spawn.x - 5) + 3} y={t(15) + 3} width={t(9) - 6} height={t(4) - 6} fill="none" stroke={P.concreteDark} strokeWidth="2" />
      {/* A sunny market square and a shaded forecourt in front of the suya stall and the shelter. */}
      <rect x={t(shelter.x) - 6} y={t(shelter.y + shelter.h)} width={shelter.w * tile + 12} height={t(2)} fill="#EFE6CC" opacity=".8" />

      {/* The Hop route, stop 1 at the bus stop, past the gate, the finale at the suya stall. */}
      <RouteLine points={[[bus.x * tile + 16, t(18) + 10], [t(layout.spawn.x - 3), t(18) + 10], [t(layout.spawn.x + 3), t(18) + 10], [suya.x * tile + 16, t(18) + 10]]} />

      <Props
        layout={layout}
        uid={uid}
        order={order}
        custom={{
          lagoon: (p) => <Lagoon w={p.w * tile} h={p.h * tile} uid={uid} boat={(p.variant ?? 0) === 1} />,
          jetty: (p) => <Jetty w={p.w * tile} h={p.h * tile} uid={uid} />,
          palm: () => <Palm />,
          billboard: (p) => <Billboard w={p.w * tile} h={p.h * tile} />,
          stagefloor: (p) => <StageFloor w={p.w * tile} h={p.h * tile} uid={uid} />,
          djdesk: (p) => <DjDesk w={p.w * tile} h={p.h * tile} />,
          speakerstack: (p) => <SpeakerStack w={p.w * tile} h={p.h * tile} />,
          fountain: (p) => <Plinth w={p.w * tile} />,
          stall: (p) => <Stall uid={uid} v={p.variant ?? 0} w={p.w * tile} h={p.h * tile} />,
          parasol: () => <Parasol uid={uid} />,
          zebra: (p) => <Zebra w={p.w * tile} h={p.h * tile} />,
          danfo: (p) => face(p, <Danfo flip={false} />, <Danfo flip />),
          keke: (p) => face(p, <Keke flip={false} />, <Keke flip />),
          okada: (p) => face(p, <Okada flip={false} />, <Okada flip />),
          hopbus: () => <HopBus w={hop.w * tile} h={hop.h * tile} />,
          streetlamp: () => <StreetLamp />,
          busshelter: (p) => <BusShelter w={p.w * tile} h={p.h * tile} />,
          busstop: () => <BusStopSign />,
          suyastall: (p) => <SuyaStall uid={uid} w={p.w * tile} h={p.h * tile} />,
          stool: () => <Stool />,
        }}
      />

      {/* A pale glow where the stage is: the one place the street is lit. */}
      <ellipse cx={(stage1.x + 1) * tile} cy={t(7) + 4} rx={t(5)} ry={t(1)} fill={P.paper} opacity=".25" />
    </svg>
  );
}
