import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, Defs, FONT, Frame, HopBay, HopBus, HoppazWordmark, P, Plate, Props, RouteLine, Shade, Stamp, type RoomArtProps } from "./kit";

/**
 * Ajah (Mobil Road) on the Lekki-Epe Expressway, a bright coastal afternoon: the far end of the island, past the traffic.
 * The Ajah Flyover is one wide deck arching across the top of the room (ramps coming down at both ends, four pillars
 * standing in the expressway, the Hoppaz billboard hung on its fascia); under it the expressway runs at grade with a
 * danfo, a BRT and a sand and block lorry; south of it, left to right, Pan-Atlantic University (a gate and its lawn), Novare
 * Lekki Mall, Mobil Estate Road running down to the sea with the filling station beside it, and La Campagne Tropicana (thatch
 * huts under the right ramp). Atican Beach is a beach bar on the sand, and the beach strip (loungers, parasols, palms, a corn
 * roaster) runs along the bottom to the pier where you arrive. Names, sign and palette come from the place data
 * (src/lib/rooms/hotspotRooms.ts, "ajah"); the layout is src/lib/campaign/rooms/hotspotAjah.ts.
 *
 * The place colours: teal (the data's primary) on the mall, the BRT, the station and the parasols, and sand cream (the
 * secondary) on walls; each venue prints its name only. The Hoppaz layer (docs/ROOM-TEMPLATES.md "Look"): the bounce
 * wordmark on an orange plate on the flyover (always visible, the loudest sign in the room), an orange band down the deck's
 * edge, the orange Hop bus at the bus stop with its painted bay, the route past the four venue doors, orange and cream
 * umbrellas on the beach, the corn roaster and the kiosk, and one stamp on the station forecourt. No violet at all.
 * Same pixel look as the clubhouse: 2 px ink, top-left light, hard shadow to the lower right, flat colour.
 */
const PLACE = hotspotRoomData("ajah");
const SIGN = PLACE?.sign ?? "AJAH";
const PAL = PLACE?.palette ?? { primary: "#00A6A6", secondary: "#F7E7CE", accent: "#FF4D00" };
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["Pan-Atlantic University", "Novare Lekki Mall", "Atican Beach", "La Campagne Tropicana"];
const ROAD = (PLACE?.roads[1] ?? "Mobil Estate Road").toUpperCase().split(" ");

const TEAL = PAL.primary;
const TEAL_DARK = "#00797A";
const TEAL_LIGHT = "#62D0CB";
const SAND = PAL.secondary;
const SAND_DARK = "#D9C5A0";
const STRAW = "#C8A752";
const STRAW_DARK = "#8F7230";
const STRAW_LIGHT = "#E3C97B";
const SKY = { top: "#BFE5E3", mid: "#D7EFE9", low: "#F1EDD3", sun: "#FBE2A0", far: "#A9D2CE", farDark: "#86BDB6", farLight: "#C9E6E3" } as const;
const DANFO_LIGHT = "#FFE066";

/** The flyover in scene px: the deck's top edge arches from 72 at the ends to 20 at the crown, in 16 px steps; 56 px of fascia under it. */
const STEP = 16;
const FASCIA = 56;
const topAt = (x: number) => {
  const u = (x - 480) / 448;
  return Math.round((20 + 52 * u * u) / 2) * 2;
};
const SEGS = Array.from({ length: (928 - 32) / STEP }, (_, i) => ({ x: 32 + i * STEP, top: topAt(32 + i * STEP + STEP / 2) }));
const LAST = SEGS[SEGS.length - 1];
/** The deck's top edge as a staircase, shifted by `off` px. */
const staircase = (off: number) => SEGS.map((s, i) => `${i === 0 ? `M${s.x} ${s.top + off}` : `V${s.top + off}`}H${s.x + STEP}`).join("");
/** The same staircase walked back from the right end, `off` px under the top edge. */
const back = (off: number) => [...SEGS].reverse().map((s, k, arr) => `H${s.x}${k < arr.length - 1 ? `V${arr[k + 1].top + off}` : ""}`).join("");
/** A strip of the fascia between two offsets from the top edge. */
const band = (a: number, b: number) => `${staircase(a)}V${LAST.top + b}${back(b)}Z`;

/** Far side under the deck: low buildings (x, width, height), standing on the far kerb at y 124. */
const FAR_BLOCKS: [number, number, number][] = [[40, 26, 22], [72, 18, 30], [96, 30, 18], [132, 22, 34], [160, 28, 20], [196, 20, 28], [222, 34, 16], [262, 18, 26], [286, 26, 34], [318, 22, 20], [346, 30, 28], [382, 20, 36], [408, 26, 18], [440, 34, 30], [480, 20, 24], [506, 28, 38], [540, 22, 20], [568, 30, 30], [604, 18, 26], [628, 34, 34], [668, 22, 18], [696, 26, 28], [728, 30, 22], [764, 20, 32], [790, 28, 18], [824, 24, 30], [854, 32, 22], [892, 28, 26]];
const FAR_PATH = FAR_BLOCKS.map(([x, w, h]) => `M${x} ${124 - h}h${w}v${h}h-${w}Z`).join("");
const FAR_WINDOWS = FAR_BLOCKS.map(([x, w, h]) => `M${x + 4} ${124 - h + 5}h3v3h-3Z${w > 22 ? `M${x + w - 8} ${124 - h + 5}h3v3h-3Z` : ""}${h > 24 ? `M${x + 4} ${124 - h + 13}h3v3h-3Z` : ""}`).join("");

const DESTS = ["EPE", "IKOTA", "LEKKI", "CMS"];

/** The flyover, the hero: drawn in scene px (the prop's box is only its solid footprint, rows 1 to 3). */
function Flyover({ ox, oy }: { ox: number; oy: number }) {
  const joints = [96, 160, 224, 288, 672, 736, 800, 864].map((x) => `M${x} ${topAt(x) + 3}V${topAt(x) + FASCIA - 12}`).join("");
  return (
    <g transform={`translate(${-ox},${-oy})`}>
      {/* the far side seen under the deck: low buildings, trees, a hedge and the far kerb */}
      <path d={FAR_PATH} fill={SKY.far} />
      <path d={FAR_WINDOWS} fill={SKY.farLight} />
      <path d="M60 110h14v14H60ZM218 106h16v18H218ZM372 108h14v16H372ZM520 104h16v20H520ZM700 108h14v16H700ZM840 106h16v18H840Z" fill={SKY.farDark} />
      <rect x="32" y="116" width="896" height="9" fill={P.leaf} />
      <path d="M40 118h10M120 120h12M210 118h10M300 120h14M410 118h12M520 120h10M620 118h14M720 120h12M820 118h10M890 120h12" stroke={P.mint} strokeWidth="2" />
      <rect x="32" y="124" width="896" height="4" fill={P.concrete} stroke={P.ink} strokeWidth="1" />

      {/* the road on top of the deck, with its centre line and two small vehicles seen side on */}
      <path d={band(-10, 0)} fill={P.asphalt} stroke={P.ink} strokeWidth="2" />
      <path d={staircase(-5)} fill="none" stroke={P.paper} strokeWidth="1.5" strokeDasharray="8 6" opacity=".8" />
      <rect x="296" y={topAt(309) - 9} width="26" height="7" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
      <rect x="640" y={topAt(660) - 9} width="40" height="7" fill={TEAL} stroke={P.ink} strokeWidth="1" />
      <path d={`M300 ${topAt(309) - 7}h4v2h-4ZM308 ${topAt(309) - 7}h4v2h-4ZM646 ${topAt(660) - 7}h5v2h-5ZM656 ${topAt(660) - 7}h5v2h-5ZM666 ${topAt(660) - 7}h5v2h-5Z`} fill={P.paper} />

      {/* the fascia: concrete, a light edge, a dark underside and an orange band down it, expansion joints */}
      <path d={band(0, FASCIA)} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d={band(0, 5)} fill={P.paper} opacity=".7" />
      <path d={band(FASCIA - 11, FASCIA)} fill={P.concreteDark} />
      <path d={band(FASCIA - 22, FASCIA - 14)} fill={P.orange} />
      <path d={joints} stroke={P.concreteDark} strokeWidth="2" />

      {/* the Hoppaz billboard on the fascia: the bounce wordmark on orange, the room's loudest sign */}
      <BrandSign x={382} y={21} w={196} h={52} tone="orange" text="" sub={BRAND_LINES.hop} />
      <HoppazWordmark x={480} y={38.9} h={17} fill={P.paper} shadow={P.brandEmber} anchor="middle" />

      {/* the ramps meet the kerb at both ends: a retaining wall's courses */}
      <path d="M40 112h20M40 120h20M900 112h20M900 120h20M44 104h14M902 104h14" stroke={P.concreteDark} strokeWidth="2" />
    </g>
  );
}

/** A pillar standing in the expressway, from the deck's underside to its foot at the bottom of its tile. */
function Pillar({ cx, y }: { cx: number; y: number }) {
  const top = topAt(cx) + FASCIA - y;
  return (
    <g>
      <rect x="12" y="25" width="30" height="7" fill={P.shadow} opacity=".25" />
      <rect x="4" y="22" width="24" height="10" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y={top} width="16" height={24 - top} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y={top + 2} width="4" height={20 - top} fill={P.paper} opacity=".6" />
      <rect x="18" y={top + 9} width="4" height={14 - top} fill={P.concreteDark} />
      <rect x="-4" y={top} width="40" height="9" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="-2" y={top + 1} width="36" height="2" fill={P.concrete} />
    </g>
  );
}

/** A tall street palm: base at (0,0), trunk up to about -40. */
function TallPalm() {
  return (
    <g>
      <ellipse cx="7" cy="2" rx="15" ry="4" fill={P.shadow} opacity=".28" />
      <path d="M-4 0L-2 -40H3L5 0Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M-2 -2L0 -38H1L0 -2Z" fill={P.woodLight} />
      <path d="M0 -40C-10 -60 -30 -56 -36 -40C-26 -47 -12 -46 0 -36ZM0 -40C10 -60 30 -56 36 -40C26 -47 12 -46 0 -36Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C-14 -38 -26 -30 -28 -18C-18 -26 -8 -28 0 -34ZM0 -40C14 -38 26 -30 28 -18C18 -26 8 -28 0 -34Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <path d="M0 -40C-6 -54 -2 -66 4 -70C6 -58 6 -48 0 -36Z" fill={P.mint} stroke={P.ink} strokeWidth="2" />
      <circle cx="1" cy="-38" r="3" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
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
      <rect x="26" y="-30" width="10" height="3" fill={DANFO_LIGHT} />
    </g>
  );
}

/** A danfo seen from the side, facing right (odd variants face left). The destination board is the only text. */
function Danfo({ w, h, v }: { w: number; h: number; v: number }) {
  const left = v % 2 === 1;
  return (
    <g>
      <g transform={left ? `translate(${w},0) scale(-1,1)` : undefined}>
        <rect x="6" y="21" width={w - 6} height="12" fill={P.shadow} opacity=".25" />
        <circle cx="20" cy="27" r="5" fill={P.ink} />
        <circle cx={w - 22} cy="27" r="5" fill={P.ink} />
        <circle cx="20" cy="27" r="2" fill={P.concrete} />
        <circle cx={w - 22} cy="27" r="2" fill={P.concrete} />
        <rect x="1" y="4" width={w - 2} height={h - 10} fill={P.danfo} stroke={P.ink} strokeWidth="2" />
        <rect x="3" y="5" width={w - 6} height="3" fill={DANFO_LIGHT} />
        <path d={Array.from({ length: 3 }, (_, i) => `M${6 + i * 17} 9h14v8h-14Z`).join("")} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
        <rect x={w - 24} y="9" width="18" height="8" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
        <rect x="2" y="19" width={w - 4} height="3" fill={P.night} />
        <rect x="2" y="22" width={w - 4} height="3" fill={P.danfoDark} />
        {v === 0 && <rect x="14" y="1" width="30" height="5" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />}
      </g>
      <Plate x={left ? 6 : w - 36} y={-3} w={30} h={8} text={DESTS[v % DESTS.length]} fill={P.night} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A BRT bus in the place's teal with a cream band and its number plate. */
function Brt({ w }: { w: number }) {
  const n = Math.floor((w - 60) / 20);
  return (
    <g>
      <rect x="8" y="22" width={w - 6} height="11" fill={P.shadow} opacity=".25" />
      <circle cx="26" cy="27" r="5" fill={P.ink} />
      <circle cx={w - 28} cy="27" r="5" fill={P.ink} />
      <rect x="1" y="2" width={w - 2} height="25" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="3" fill={TEAL_LIGHT} />
      <path d={Array.from({ length: n }, (_, i) => `M${8 + i * 20} 8h16v9h-16Z`).join("")} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 46} y="8" width="14" height="17" fill={P.night} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="20" width={w - 4} height="3" fill={SAND} />
      <Plate x={w - 30} y={7} w={26} h={9} text="BRT" fill={P.night} color={P.paper} mono size={6} />
    </g>
  );
}

/** A sand and block lorry: a grey cab, a timber bed with a heap of sand and a stack of blocks. */
function Lorry({ w }: { w: number }) {
  return (
    <g>
      <rect x="8" y="22" width={w - 6} height="11" fill={P.shadow} opacity=".25" />
      {[24, 46, w - 24].map((cx) => <circle key={cx} cx={cx} cy="27" r="5" fill={P.ink} />)}
      <rect x="2" y="17" width={w - 4} height="7" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="9" width={w - 46} height="9" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M6 9L14 -1L30 -6L46 -1L56 9Z" fill="#DBC896" stroke={P.ink} strokeWidth="2" />
      <path d="M20 2h5M36 0h4" stroke="#EBDDB1" strokeWidth="2" />
      <rect x="60" y="1" width={w - 106} height="8" fill={P.concrete} stroke={P.ink} strokeWidth="1.5" />
      <rect x="64" y="-6" width={w - 114} height="7" fill={P.concreteDark} stroke={P.ink} strokeWidth="1.5" />
      <rect x={w - 42} y="1" width="40" height="23" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 28} y="5" width="22" height="9" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 6} y="18" width="5" height="4" fill={P.white} />
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
      <rect x="4" y="12" width={w - 10} height="13" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="3" width={w - 20} height="9" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w - 24} height="2" fill={DANFO_LIGHT} />
      <rect x="8" y="14" width="22" height="8" fill={P.night} />
      <path d={`M${w - 18} 12L${w - 8} 15V24H${w - 18}Z`} fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A parked saloon, grey, facing right. */
function Car() {
  return (
    <g>
      <rect x="6" y="21" width="58" height="10" fill={P.shadow} opacity=".25" />
      <circle cx="17" cy="26" r="5" fill={P.ink} />
      <circle cx="49" cy="26" r="5" fill={P.ink} />
      <path d="M2 25V15H12L20 6H42L51 15H61V25Z" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d="M16 14L22 8H30V14ZM33 14V8H40L46 14Z" fill={P.lagoonLight} stroke={P.ink} strokeWidth="1" />
      <rect x="4" y="19" width="56" height="3" fill={P.slate} />
      <rect x="57" y="16" width="4" height="4" fill={P.white} />
    </g>
  );
}

/** The corn roaster: a coal drum on legs under an orange and cream umbrella, cobs on the rack. */
function CornRoast() {
  return (
    <g>
      <ellipse cx="34" cy="30" rx="26" ry="3.5" fill={P.shadow} opacity=".28" />
      <path d="M12 22V30M26 22V30" stroke={P.ink} strokeWidth="3" />
      <path d="M33 -4V16" stroke={P.ink} strokeWidth="3" />
      <path d="M4 3C4 -12 62 -12 62 3Z" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <path d="M17 2L22 -9H30L27 2ZM38 2L36 -9H44L51 2Z" fill={P.paper} />
      <rect x="8" y="14" width="30" height="9" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="15" width="26" height="3" fill={P.ember} />
      <path d="M12 11h6M21 11h6M30 11h6" stroke={P.ink} strokeWidth="5" />
      <path d="M13 11h4M22 11h4M31 11h4" stroke={P.danfo} strokeWidth="3" />
      <rect x="42" y="18" width="14" height="10" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="44" y="19" width="10" height="3" fill={P.paper} />
    </g>
  );
}

/** A wooden sun lounger with a pad: teal (variant 0) or sand (variant 1), and a head rest. */
function Lounger({ w, v }: { w: number; v: number }) {
  const pad = v === 1 ? SAND : TEAL;
  const stripe = v === 1 ? TEAL : SAND;
  return (
    <g>
      <rect x="8" y="20" width={w - 6} height="9" fill={P.shadow} opacity=".25" />
      <path d="M8 21v7M52 21v7" stroke={P.ink} strokeWidth="3" />
      <rect x="3" y="10" width={w - 8} height="12" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="12" width={w - 28} height="8" fill={pad} />
      <rect x={w - 20} y="7" width="14" height="11" fill={pad} stroke={P.ink} strokeWidth="2" />
      <path d={`M14 12v8M24 12v8M34 12v8`} stroke={stripe} strokeWidth="2" />
    </g>
  );
}

/** A beach parasol on a pole: orange and cream (Hoppaz, variant 0) or teal and cream (variant 1). */
function Parasol({ v }: { v: number }) {
  const a = v === 1 ? TEAL : P.orange;
  return (
    <g>
      <ellipse cx="19" cy="30" rx="12" ry="3" fill={P.shadow} opacity=".28" />
      <rect x="15" y="-6" width="3" height="34" fill={P.ink} />
      <path d="M-6 8C-6 -16 38 -16 38 8Z" fill={a} stroke={P.ink} strokeWidth="2" />
      <path d="M4 7C4 -12 14 -14 14 -14L17 -14L16 7ZM22 7L19 -14C26 -12 32 -6 32 7Z" fill={P.paper} />
      <rect x="-6" y="7" width="44" height="3" fill={a} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A green expressway sign on a post: the destination in cream with an arrow (variant 0 points left, 1 right). */
function RoadSign({ v }: { v: number }) {
  const text = v === 1 ? "EPE" : "LEKKI";
  const arrow = v === 1 ? "M40 -12L50 -19V-15H56V-9H50V-5Z" : "M20 -12L10 -19V-15H4V-9H10V-5Z";
  return (
    <g>
      <rect x="12" y="26" width="16" height="4" fill={P.shadow} opacity=".28" />
      <rect x="14" y="-6" width="4" height="34" fill={P.ink} />
      <rect x="-8" y="-34" width="64" height="30" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
      <rect x="-5" y="-31" width="58" height="24" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <path d={arrow} fill={P.paper} />
      <text x={v === 1 ? 20 : 36} y="-17" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="10" letterSpacing=".6">{text}</text>
    </g>
  );
}

/** The street name blade at the mouth of Mobil Estate Road: two lines on a teal board. */
function StreetBlade() {
  return (
    <g>
      <rect x="12" y="26" width="16" height="4" fill={P.shadow} opacity=".28" />
      <rect x="14" y="-6" width="4" height="34" fill={P.ink} />
      <rect x="-22" y="-30" width="80" height="26" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="-19" y="-27" width="74" height="20" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <text x="18" y="-17" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="9" letterSpacing=".6">{ROAD[0]}</text>
      <text x="18" y="-9" textAnchor="middle" fill={P.paper} fontFamily={FONT.mono} fontSize="5.5" letterSpacing=".6">{ROAD.slice(1).join(" ")}</text>
    </g>
  );
}

/** The bus stop sign: the place's sign over a small BUS STOP plate, on a post. */
function BusStopSign() {
  return (
    <g>
      <rect x="12" y="26" width="16" height="4" fill={P.shadow} opacity=".28" />
      <rect x="14" y="-18" width="4" height="46" fill={P.ink} />
      <Plate x={-6} y={-36} w={44} h={15} text={SIGN} fill={P.night} color={P.paper} />
      <Plate x={-2} y={-21} w={36} h={9} text="Bus stop" fill={TEAL} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** Pan-Atlantic University: a cream stone frontage with a teal cornice, a name plate and a central gate onto the lawn. */
function Campus({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const gx = w / 2;
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="1" y="6" width={w - 2} height={h - 8} fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="8" width={w - 6} height="9" fill={TEAL} />
      <rect x="3" y="8" width={w - 6} height="2" fill={TEAL_LIGHT} />
      <Plate x={10} y={20} w={w - 20} h={15} text={name} fill={P.night} color={P.paper} />
      {[10, 36, w - 58, w - 32].map((x) => (
        <g key={x}>
          <rect x={x} y="44" width="22" height="22" fill={P.night} stroke={P.ink} strokeWidth="2" />
          <path d={`M${x + 2} 46h8v18h-8ZM${x + 12} 46h8v18h-8Z`} fill={TEAL_DARK} />
          <rect x={x - 2} y="66" width="26" height="3" fill={SAND_DARK} stroke={P.ink} strokeWidth="1" />
        </g>
      ))}
      <rect x={gx - 27} y="38" width="10" height={h - 40} fill={SAND_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x={gx + 17} y="38" width="10" height={h - 40} fill={SAND_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x={gx - 29} y="34" width="14" height="6" fill={TEAL} stroke={P.ink} strokeWidth="1.5" />
      <rect x={gx + 15} y="34" width="14" height="6" fill={TEAL} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${gx - 17} 56Q${gx} 40 ${gx + 17} 56V${h - 2}H${gx - 17}Z`} fill={`url(#${uid}-grass)`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${gx - 17} 56Q${gx} 40 ${gx + 17} 56V${h - 2}H${gx - 17}Z`} fill={`url(#${uid}-bars)`} />
      <rect x={gx - 3} y="66" width="6" height={h - 68} fill={P.concrete} />
    </g>
  );
}

/** Novare Lekki Mall: a modern block, a teal glass curtain wall, a cantilevered entrance canopy and awninged shopfronts. */
function Mall({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const cx = w / 2;
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x={w - 56} y="-3" width="30" height="9" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="4" width={w - 2} height={h - 6} fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="6" width={w - 6} height="8" fill={TEAL} />
      <rect x="3" y="6" width={w - 6} height="2" fill={TEAL_LIGHT} />
      <Plate x={36} y={17} w={w - 72} h={17} text={name} fill={P.night} color={P.paper} />
      <rect x="12" y="40" width={w - 24} height="38" fill={`url(#${uid}-glass)`} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 36} y="58" width="72" height="8" fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 34} y="64" width="68" height="3" fill={TEAL} />
      <path d={`M${cx - 30} 67V${h - 2}M${cx + 30} 67V${h - 2}`} stroke={P.ink} strokeWidth="3" />
      <rect x={cx - 26} y="68" width="52" height={h - 70} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx} 68V${h - 2}`} stroke={P.nightLine} strokeWidth="2" />
      <path d={`M${cx - 6} 84h3v8h-3ZM${cx + 3} 84h3v8h-3Z`} fill={P.paper} />
      <rect x="14" y="80" width="60" height="9" fill={`url(#${uid}-tealawn)`} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 74} y="80" width="60" height="9" fill={`url(#${uid}-tealawn)`} stroke={P.ink} strokeWidth="2" />
      <rect x="18" y="89" width="52" height={h - 91} fill={P.night} opacity=".55" />
      <rect x={w - 70} y="89" width="52" height={h - 91} fill={P.night} opacity=".55" />
    </g>
  );
}

/** Atican Beach: a beach bar under a thatched palapa on four posts, a bottle shelf and a plank counter. */
function BeachBar({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  let fringe = `M-8 20`;
  for (let x = -8; x < w + 8; x += 12) fringe += `l6 6l6 -6`;
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="10" y="14" width={w - 20} height={h - 18} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M22 18h5v10h-5ZM40 18h5v10h-5ZM58 18h5v10h-5ZM130 18h5v10h-5ZM148 18h5v10h-5ZM166 18h5v10h-5Z" fill={TEAL_LIGHT} stroke={P.ink} strokeWidth="1" />
      <path d="M31 20h5v8h-5ZM49 20h5v8h-5ZM139 20h5v8h-5ZM157 20h5v8h-5Z" fill={SAND} stroke={P.ink} strokeWidth="1" />
      <rect x="6" y="38" width={w - 12} height="24" fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="34" width={w - 12} height="7" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="35" width={w - 16} height="2" fill={P.paper} opacity=".5" />
      <rect x="4" y="0" width="6" height="60" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 10} y="0" width="6" height="60" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d={`M-8 20L38 -32H${w - 38}L${w + 8} 20Z`} fill={`url(#${uid}-thatch)`} stroke={P.ink} strokeWidth="2" />
      <path d={fringe} fill={STRAW_DARK} stroke={P.ink} strokeWidth="1" />
      <Plate x={48} y={-10} w={w - 96} h={16} text={name} fill={P.night} color={P.paper} />
    </g>
  );
}

/** La Campagne Tropicana: three thatched huts on a timber deck against the forest, a name board on posts. */
function Resort({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const hut = (cx: number) => (
    <g key={cx}>
      <rect x={cx - 17} y="44" width="34" height="28" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 10} 46V70M${cx} 46V70M${cx + 10} 46V70`} stroke={P.wood} strokeWidth="1" />
      <path d={`M${cx - 26} 46L${cx} 14L${cx + 26} 46Z`} fill={`url(#${uid}-thatch)`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 26} 46l5 5l5 -5l5 5l5 -5l5 5l5 -5l5 5l5 -5l5 5l5 -5Z`} fill={STRAW_DARK} />
      <rect x={cx - 6} y="54" width="12" height="18" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 4} y="56" width="3" height="8" fill={TEAL_LIGHT} />
    </g>
  );
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <path d={`M0 36C0 12 14 6 24 14C30 0 52 0 58 12C70 -4 96 -2 100 12C112 0 138 2 140 16C152 8 164 20 ${w} 36V50H0Z`} fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <path d="M12 30C14 20 22 18 28 24ZM64 22C68 12 78 10 84 18ZM112 24C116 14 126 14 130 22Z" fill={P.leaf} />
      <rect x="2" y="64" width={w - 4} height={h - 66} fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <path d={`M6 66V${h - 4}M${w - 8} 66V${h - 4}`} stroke={P.woodDark} strokeWidth="4" />
      {[30, 80, 130].map(hut)}
      <path d={`M8 82H${w - 8}`} stroke={P.woodDark} strokeWidth="3" />
      <Plate x={14} y={2} w={w - 28} h={16} text={name} fill={P.night} color={P.paper} />
    </g>
  );
}

/** The filling station: a cream canopy with a teal band, two pumps on an island and a small kiosk with an orange and cream awning. */
function Station({ w, h, uid }: { w: number; h: number; uid: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="4" y="26" width={w - 8} height={h - 28} fill={P.shadow} opacity=".16" />
      <rect x="28" y="78" width="70" height="12" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      {[40, 74].map((x) => (
        <g key={x}>
          <rect x={x} y="44" width="16" height="36" fill={P.night} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="48" width="10" height="9" fill={P.paper} />
          <rect x={x} y="42" width="16" height="5" fill={TEAL} stroke={P.ink} strokeWidth="1.5" />
          <path d={`M${x + 16} 56h5v14`} fill="none" stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <rect x="112" y="46" width="42" height="44" fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="116" y="56" width="20" height="14" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
      <rect x="140" y="62" width="10" height="28" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
      <rect x="110" y="40" width="46" height="12" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <path d="M16 26V84M142 26V46" stroke={P.ink} strokeWidth="6" />
      <path d="M17 26V84" stroke={P.cap} strokeWidth="2" />
      <rect x="2" y="4" width={w - 4} height="24" fill={SAND} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="5" width={w - 8} height="3" fill={P.paper} />
      <rect x="4" y="19" width={w - 8} height="7" fill={TEAL} />
      <Plate x={36} y={9} w={w - 72} h={11} text="Filling station" fill={P.night} color={P.paper} mono size={6} />
    </g>
  );
}

export default function HotspotAjahArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const url = (name: string) => `url(#${uid}-${name})`;

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    hero: (p, tl) => <Flyover ox={p.x * tl} oy={p.y * tl} />,
    pillar: (p, tl) => <Pillar cx={p.x * tl + tl / 2} y={p.y * tl} />,
    "venue-1": (p, tl) => <Campus w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[0]} />,
    "venue-2": (p, tl) => <Mall w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[1]} />,
    "venue-3": (p, tl) => <BeachBar w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[2]} />,
    "venue-4": (p, tl) => <Resort w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[3]} />,
    station: (p, tl) => <Station w={p.w * tl} h={p.h * tl} uid={uid} />,
    danfo: (p, tl) => <Danfo w={p.w * tl} h={p.h * tl} v={p.variant ?? 0} />,
    brt: (p, tl) => <Brt w={p.w * tl} />,
    lorry: (p, tl) => <Lorry w={p.w * tl} />,
    keke: (p, tl) => <Keke w={p.w * tl} flip={(p.variant ?? 0) === 1} />,
    car: () => <Car />,
    hopbus: (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} />,
    roadsign: (p) => <RoadSign v={p.variant ?? 0} />,
    streetblade: () => <StreetBlade />,
    busstop: () => <BusStopSign />,
    palm: () => <g transform="translate(16,30)"><TallPalm /></g>,
    streetlamp: () => <StreetLamp />,
    cornroast: () => <CornRoast />,
    lounger: (p, tl) => <Lounger w={p.w * tl} v={p.variant ?? 0} />,
    parasol: (p) => <Parasol v={p.variant ?? 0} />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["concrete", "paving", "asphalt", "grass", "sand", "water", "deck"]} />
      <defs>
        <pattern id={`${uid}-hedge`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={P.leafDark} />
          <path d="M2 3h5v3H2ZM10 9h5v3h-5ZM5 12h3v2H5Z" fill={P.leaf} />
          <path d="M3 3h2M11 9h2" stroke={P.mint} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-thatch`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={STRAW} />
          <path d="M0 3H8M0 7H8" stroke={STRAW_DARK} strokeWidth="1" />
          <path d="M2 0v3M6 4v3" stroke={STRAW_LIGHT} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-glass`} width="24" height="19" patternUnits="userSpaceOnUse">
          <rect width="24" height="19" fill={TEAL} />
          <rect width="24" height="3" fill={TEAL_LIGHT} />
          <path d="M0 0V19M0 18H24" stroke={TEAL_DARK} strokeWidth="2" />
          <path d="M6 15l5-7" stroke={P.paper} strokeWidth="1.5" opacity=".55" />
        </pattern>
        <pattern id={`${uid}-tealawn`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="8" height="16" fill={TEAL} />
          <rect x="8" width="8" height="16" fill={SAND} />
        </pattern>
        <pattern id={`${uid}-awn`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="8" height="16" fill={P.orange} />
          <rect x="8" width="8" height="16" fill={P.paper} />
        </pattern>
        <pattern id={`${uid}-bars`} width="6" height="16" patternUnits="userSpaceOnUse"><rect x="2" width="2" height="16" fill={P.night} /></pattern>
        <pattern id={`${uid}-zebra`} width="24" height="16" patternUnits="userSpaceOnUse"><rect x="4" width="12" height="16" fill={P.paper} opacity=".92" /></pattern>
      </defs>
      <Frame layout={layout} ground={P.leafDark} />

      {/* The sky: three flat bands, a low sun over the right ramp and a few clouds; the ring at the sides is a hedge. */}
      <rect x="32" y="0" width={W - 64} height="48" fill={SKY.top} />
      <rect x="32" y="48" width={W - 64} height="40" fill={SKY.mid} />
      <rect x="32" y="88" width={W - 64} height="40" fill={SKY.low} />
      <circle cx="872" cy="32" r="19" fill={SKY.sun} opacity=".35" />
      <circle cx="872" cy="32" r="12" fill={SKY.sun} />
      <path d="M70 18h34v-5h18v-5h22v7h14v3ZM690 26h30v-5h16v-5h20v6h10v4Z" fill={P.white} opacity=".85" />
      <rect x="0" y="0" width="32" height={H} fill={url("hedge")} stroke={P.ink} strokeWidth="2" />
      <rect x={W - 32} y="0" width="32" height={H} fill={url("hedge")} stroke={P.ink} strokeWidth="2" />

      {/* The ground: the expressway, the pavements and forecourts, the lawn, Mobil Estate Road and the sand. */}
      <rect x="32" y="128" width={W - 64} height="128" fill={url("asphalt")} />
      <rect x="32" y="256" width={W - 64} height="96" fill={url("concrete")} />
      <rect x="32" y="352" width="160" height="224" fill={url("grass")} stroke={P.ink} strokeWidth="2" />
      <rect x="88" y="352" width="48" height="100" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="192" y="352" width="224" height="128" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="192" y="480" width="224" height="96" fill={url("sand")} />
      <rect x="544" y="352" width="160" height="64" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="704" y="256" width="64" height="160" fill={url("paving")} stroke={P.ink} strokeWidth="2" />
      <rect x="768" y="352" width="160" height="64" fill={url("grass")} stroke={P.ink} strokeWidth="2" />
      <rect x="544" y="416" width={W - 576} height="160" fill={url("sand")} />
      <rect x="192" y="560" width="224" height="16" fill={SAND_DARK} opacity=".5" />
      <rect x="544" y="560" width={W - 576} height="16" fill={SAND_DARK} opacity=".5" />

      {/* The expressway: edge lines, a dashed centre line, the deck's hard shadow and the south kerb. */}
      <rect x="32" y="128" width={W - 64} height="20" fill={P.shadow} opacity=".16" />
      <path d="M32 136H928M32 248H928" stroke={P.paper} strokeWidth="2" opacity=".7" />
      <path d="M32 192H928" stroke={P.paper} strokeWidth="2" strokeDasharray="16 12" opacity=".85" />
      <rect x="32" y="254" width={W - 64} height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />

      {/* Mobil Estate Road runs south to the pier: kerbs, a dashed centre line and a zebra crossing. */}
      <rect x="416" y="260" width="128" height="252" fill={url("asphalt")} />
      <path d="M412 260V512M548 260V512" stroke={P.ink} strokeWidth="6" />
      <path d="M412 260V512M548 260V512" stroke={P.concrete} strokeWidth="2" />
      <path d="M480 268V440M480 504V512" stroke={P.paper} strokeWidth="2" strokeDasharray="14 10" opacity=".85" />
      <rect x="416" y="448" width="128" height="16" fill={url("zebra")} />
      <path d="M224 384V416M288 384V416M320 384V416M384 384V416" stroke={P.paper} strokeWidth="2" opacity=".75" />

      {/* The sea along the bottom (the wall at row 18), its foam, and the pier it is reached by. */}
      <rect x="32" y="576" width={W - 64} height="64" fill={url("water")} />
      <path d="M32 578H928" stroke={P.paper} strokeWidth="3" strokeDasharray="14 8" opacity=".8" />
      <path d="M32 594H928" stroke={P.lagoonLight} strokeWidth="2" strokeDasharray="6 16" opacity=".8" />
      <path d="M32 612H928" stroke={P.paper} strokeWidth="2" strokeDasharray="8 22" opacity=".55" />
      <rect x="392" y="520" width="192" height="104" fill={P.shadow} opacity=".22" />
      <rect x="384" y="512" width="192" height="112" fill={url("deck")} stroke={P.ink} strokeWidth="2" />
      <path d="M386 512V622M574 512V622" stroke={P.woodDark} strokeWidth="5" />
      <path d="M384 592h8v28h-8ZM568 592h8v28h-8Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <HopBay x={728} y={216} w={176} h={44} />

      {/* The Hop's route: past the four doors in order (the gate, the mall, the beach bar, the huts), the finale at the huts. */}
      <RouteLine points={[[112, 368], [304, 368], [448, 368, 0], [448, 496, 0], [784, 496], [912, 496, 0], [912, 368, 0], [848, 368]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* A rubber stamp on the station forecourt. */}
      <Stamp x={588} y={392} text={BRAND_LINES.hop} size={8} rotate={-6} />
    </svg>
  );
}
