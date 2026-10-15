import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { Defs, FONT, P, Plate, Props, type RoomArtProps } from "./kit";

/**
 * Lekki Phase 1: Admiralty Way running straight down to the lagoon, late afternoon. Cream and sand paving, blue water,
 * palms, the Lekki-Ikoyi bridge pylon on the skyline. The layout is src/lib/campaign/rooms/hotspotLekki.ts; the names,
 * the sign and the three colours come from src/lib/rooms/hotspotRooms.ts ("lekki").
 *
 * The lagoon, the bridge and the sky are the `hero` prop's art (drawn in scene pixels, so they run past its box); the
 * four venues are drawn as facades inside their own boxes; everything else is a small prop with a stable id.
 */

type Skin = { blue: string; cream: string; hot: string };
const FALLBACK_PALETTE = { primary: "#3E8FB8", secondary: "#F5EBDD", accent: "#FF4D00" };
const FALLBACK_NAMES = ["Bay Lounge", "Circa Lagos", "Ilé Eros", "Lekki Conservation Centre"];
const SKY = { high: "#A9D3E6", mid: "#C6E4EF", low: "#EEEBD3", sun: "#FBE2A0", far: "#B3CBD4", shore: "#8FB7A0" } as const;

const rep = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("");

/** A palm that stands on one tile and grows up out of its box. `flip` leans it the other way. */
function PalmArt({ flip }: { flip: boolean }) {
  return (
    <g>
      <ellipse cx="23" cy="29" rx="12" ry="4" fill={P.shadow} opacity=".25" />
      <g transform={flip ? "translate(37,0) scale(-1,1)" : undefined}>
        <path d="M12 30H20L19 8L21 -34H16L14 8Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
        <path d="M14.5 28L15.5 8L17.5 -32" fill="none" stroke={P.woodLight} strokeWidth="2" />
        <path d="M13 22h6M14 14h5M15 6h5M15 -2h5M16 -10h5M17 -18h4M17 -26h4" stroke={P.ink} strokeWidth="1" opacity=".5" />
        <path d="M18 -35C6 -50 -10 -47 -17 -33C-6 -41 6 -41 17 -33ZM19 -35C31 -50 47 -47 54 -33C43 -41 31 -41 20 -33ZM17 -36C8 -56 -1 -61 -9 -59C1 -56 9 -48 16 -37ZM20 -36C29 -56 38 -61 46 -59C36 -56 28 -48 21 -37ZM18 -36C15 -54 18 -66 24 -69C22 -58 23 -48 20 -36Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
        <path d="M17 -38C8 -48 -4 -47 -10 -39C0 -44 9 -43 16 -37ZM17 -38C14 -50 16 -58 20 -62C19 -54 19 -46 18 -38Z" fill={P.mint} />
        <path d="M14 -33a3 3 0 1 0 6 0a3 3 0 1 0 -6 0ZM20 -31a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
      </g>
    </g>
  );
}

/** A tall street lamp with a short arm to the right. */
function LampArt() {
  return (
    <g>
      <rect x="13" y="28" width="20" height="4" fill={P.shadow} opacity=".25" />
      <rect x="11" y="24" width="10" height="7" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <path d="M16 24V-18H28" fill="none" stroke={P.ink} strokeWidth="3" />
      <rect x="22" y="-24" width="15" height="7" fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="-22" width="6" height="2" fill={P.paper} />
      <path d="M29 -17l-6 15h12Z" fill={P.gold} opacity=".14" />
    </g>
  );
}

/** A keke parked at the kerb, facing right. `yellow` is the Lagos yellow-and-black one. */
function KekeArt({ yellow }: { yellow: boolean }) {
  const body = yellow ? P.danfo : P.keke;
  const dark = yellow ? P.danfoDark : P.kekeDark;
  return (
    <g>
      <ellipse cx="36" cy="30" rx="27" ry="3.5" fill={P.shadow} opacity=".3" />
      <circle cx="15" cy="25" r="6" fill={P.ink} />
      <circle cx="15" cy="25" r="2" fill={P.cap} />
      <circle cx="51" cy="25" r="5" fill={P.ink} />
      <circle cx="51" cy="25" r="2" fill={P.cap} />
      <path d="M6 8H40V23H6Z" fill={body} stroke={P.ink} strokeWidth="2" />
      <path d="M40 12H52L58 20V24H40Z" fill={body} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="3" width="38" height="7" fill={dark} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="4" width="30" height="2" fill={P.paper} opacity=".35" />
      <rect x="10" y="12" width="14" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x="28" y="12" width="9" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x="6" y="19" width="34" height="3" fill={yellow ? P.night : P.danfo} />
      <rect x="56" y="17" width="3" height="4" fill={P.gold} />
    </g>
  );
}

/** A table with two chairs and a striped parasol that rises out of the box. */
function UmbrellaArt({ a, b }: { a: string; b: string }) {
  return (
    <g>
      <ellipse cx="38" cy="30" rx="24" ry="4" fill={P.shadow} opacity=".25" />
      <rect x="4" y="12" width="10" height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="50" y="12" width="10" height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="-22" width="4" height="44" fill={P.ink} />
      <ellipse cx="32" cy="19" rx="15" ry="6" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M32 24v6" stroke={P.ink} strokeWidth="3" />
      <path d="M32 -46L-6 -20H13ZM32 -46V-20H51Z" fill={a} />
      <path d="M32 -46L13 -20H32ZM32 -46L51 -20H70Z" fill={b} />
      <path d="M32 -46L-6 -20H70Z" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="-6" y="-21" width="76" height="4" fill={a} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="-51" width="4" height="6" fill={P.orange} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The coconut seller's cart: green coconuts piled on the counter under a small striped awning. */
function CoconutArt({ a, b }: { a: string; b: string }) {
  return (
    <g>
      <rect x="8" y="54" width="56" height="8" fill={P.shadow} opacity=".25" />
      <circle cx="16" cy="56" r="5" fill={P.ink} />
      <circle cx="48" cy="56" r="5" fill={P.ink} />
      <path d="M31 6V32" stroke={P.ink} strokeWidth="3" />
      <path d="M32 -6L-2 12H34ZM32 -6L66 12H34Z" fill={a} />
      <path d="M32 -6L16 12H34ZM32 -6L50 12H34Z" fill={b} />
      <path d="M32 -6L-2 12H66Z" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="32" width="54" height="22" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="34" width="50" height="4" fill={P.paper} opacity=".6" />
      <path d="M9 30a5 5 0 1 0 10 0a5 5 0 1 0 -10 0ZM20 28a5 5 0 1 0 10 0a5 5 0 1 0 -10 0ZM31 30a5 5 0 1 0 10 0a5 5 0 1 0 -10 0ZM42 28a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" fill={P.mint} stroke={P.ink} strokeWidth="1.5" />
      <path d="M12 27h3M23 25h3M34 27h3M45 25h3" stroke={P.paper} strokeWidth="1.5" />
      <Plate x={10} y={40} w={42} h={12} text="Coconut" fill={P.leafDark} color={P.paper} />
    </g>
  );
}

/** A bike rack with two bicycles in it. */
function BikeRackArt({ a, b }: { a: string; b: string }) {
  const bike = (x: number, frame: string) => (
    <g transform={`translate(${x},0)`}>
      <circle cx="7" cy="19" r="6" fill="none" stroke={P.ink} strokeWidth="2" />
      <circle cx="25" cy="19" r="6" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d="M7 19L14 10L25 19M14 10H21M12 7h5M21 10L25 19" fill="none" stroke={frame} strokeWidth="2" />
    </g>
  );
  return (
    <g>
      <rect x="6" y="26" width="58" height="5" fill={P.shadow} opacity=".25" />
      {bike(1, a)}
      {bike(31, b)}
      <path d="M2 27H62M4 27V14M32 27V14M60 27V14" stroke={P.slate} strokeWidth="3" />
    </g>
  );
}

/** A street name blade on a pole, in two lines. */
function StreetSignArt({ line1, line2, blue }: { line1: string; line2: string; blue: string }) {
  return (
    <g>
      <rect x="14" y="28" width="12" height="4" fill={P.shadow} opacity=".25" />
      <path d="M16 30V-6" stroke={P.ink} strokeWidth="3" />
      <rect x="-18" y="-30" width="68" height="26" fill={blue} stroke={P.ink} strokeWidth="2" />
      <rect x="-15" y="-27" width="62" height="3" fill={P.lagoonLight} />
      <text x="16" y="-17" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="9" letterSpacing=".4">{line1}</text>
      <text x="16" y="-8" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="8" letterSpacing=".4">{line2}</text>
    </g>
  );
}

/** The welcome wall on the forecourt: the place's sign in two lines on a blue face. */
function MonumentArt({ line1, line2, blue, hot }: { line1: string; line2: string; blue: string; hot: string }) {
  return (
    <g>
      <rect x="6" y="9" width="126" height="56" fill={P.shadow} opacity=".25" />
      <rect x="0" y="4" width="128" height="58" fill={P.ink} />
      <rect x="3" y="7" width="122" height="52" fill={P.stone} />
      <rect x="0" y="0" width="128" height="9" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="12" width="116" height="38" fill={blue} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="14" width="112" height="3" fill={P.lagoonLight} />
      <text x="64" y="32" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="17" letterSpacing="1.5">{line1}</text>
      <rect x="26" y="36" width="76" height="3" fill={hot} />
      <text x="64" y="47" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="10" letterSpacing="2">{line2}</text>
      <path d="M3 59V56H12V54H26V56H40V54H56V56H70V54H86V56H100V54H114V56H125V59Z" fill={P.leaf} stroke={P.ink} strokeWidth="1.5" />
    </g>
  );
}

/** A small wooden sign on two posts, at the garden gate. */
function SignboardArt({ text }: { text: string }) {
  return (
    <g>
      <rect x="8" y="26" width="52" height="5" fill={P.shadow} opacity=".25" />
      <path d="M12 12V28M52 12V28" stroke={P.woodDark} strokeWidth="4" />
      <Plate x={2} y={2} w={60} h={16} text={text} fill={P.woodDark} color={P.paper} size={7} mono />
      <rect x="4" y="4" width="56" height="2" fill={P.woodLight} opacity=".5" />
    </g>
  );
}

/** One tree crown in three stepped tones. Drawn about (x, y). */
function Crown({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-26 6H-18V-6H-8V-14H10V-6H20V4H28V16H18V22H-18V16H-26Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <path d="M-22 6H-14V-4H-6V-11H8V-4H16V4H24V14H-22Z" fill={P.leaf} />
      <path d="M-20 4H-14V-2H-6V-9H4V-5H-8V1H-14V6H-20Z" fill={P.mint} />
    </g>
  );
}

/** Bay Lounge: a waterfront deck lounge, cream with a blue-and-cream awning. 6 by 5 tiles. */
function BayLounge({ name, blue, cream, hot }: Skin & { name: string }) {
  const stripes = rep(6, (i) => `M${8 + i * 32} 66h16v14h-16Z`);
  const skirtBlue = rep(6, (i) => `M${8 + i * 32} 80h16l-8 7Z`);
  const skirtCream = rep(5, (i) => `M${24 + i * 32} 80h16l-8 7Z`);
  return (
    <g>
      <rect x="7" y="9" width="190" height="152" fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width="192" height="158" fill={P.ink} />
      <rect x="3" y="3" width="186" height="152" fill={cream} />
      <rect x="3" y="3" width="5" height="152" fill={P.white} />
      <rect x="176" y="3" width="13" height="152" fill={P.cream} />
      <rect x="3" y="3" width="186" height="12" fill={blue} />
      <rect x="3" y="3" width="186" height="3" fill={P.lagoonLight} />
      <rect x="3" y="13" width="186" height="2" fill={P.lagoonDark} />
      <Plate x={16} y={26} w={160} h={30} text={name} fill={P.lagoonDark} color={P.paper} size={22} />
      <rect x="16" y="58" width="160" height="4" fill={hot} stroke={P.ink} strokeWidth="1" />
      <rect x="8" y="66" width="176" height="14" fill={cream} />
      <path d={stripes} fill={blue} />
      <path d={skirtCream} fill={cream} stroke={P.ink} strokeWidth="1.5" />
      <path d={skirtBlue} fill={blue} stroke={P.ink} strokeWidth="1.5" />
      <rect x="8" y="66" width="176" height="14" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="92" width="62" height="50" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="118" y="92" width="62" height="50" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d="M14 120H72V140H14ZM120 120H178V140H120Z" fill={P.gold} opacity=".45" />
      <path d="M43 92v50M12 118h62M149 92v50M118 118h62" stroke={P.ink} strokeWidth="2" />
      <path d="M18 98l14 14M34 98l16 16M124 98l14 14M140 98l16 16" stroke={P.paper} strokeWidth="2" opacity=".5" />
      <rect x="82" y="94" width="28" height="54" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="86" y="98" width="20" height="28" fill={P.slateLight} />
      <path d="M96 98v28" stroke={P.ink} strokeWidth="2" />
      <rect x="100" y="130" width="3" height="7" fill={P.gold} />
      <rect x="0" y="146" width="192" height="12" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="148" width="186" height="2" fill={P.woodLight} />
    </g>
  );
}

/** Circa Lagos: a smart restaurant frontage, slate and glass, a blue canopy and a ring for a mark. 5 by 4 tiles. */
function Circa({ name, blue, cream, hot }: Skin & { name: string }) {
  return (
    <g>
      <rect x="7" y="9" width="158" height="120" fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width="160" height="126" fill={P.ink} />
      <rect x="3" y="3" width="154" height="120" fill={P.slate} />
      <rect x="3" y="3" width="5" height="120" fill={P.slateLight} />
      <rect x="146" y="3" width="11" height="120" fill="#475D66" />
      <rect x="0" y="0" width="160" height="12" fill={cream} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="2" width="154" height="3" fill={P.white} />
      <circle cx="26" cy="31" r="9" fill="none" stroke={hot} strokeWidth="4" />
      <circle cx="26" cy="31" r="2.5" fill={cream} />
      <Plate x={42} y={19} w={110} h={24} text={name} fill={P.night} color={P.paper} size={14} />
      <rect x="6" y="48" width="148" height="10" fill={blue} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="50" width="144" height="2" fill={P.lagoonLight} />
      <rect x="10" y="64" width="44" height="46" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="106" y="64" width="44" height="46" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d="M12 88H52V108H12ZM108 88H148V108H108Z" fill={P.gold} opacity=".45" />
      <path d="M32 64v46M10 88h44M128 64v46M106 88h44" stroke={P.ink} strokeWidth="2" />
      <path d="M16 70l10 10M30 70l12 12M112 70l10 10M126 70l12 12" stroke={P.paper} strokeWidth="2" opacity=".5" />
      <rect x="62" y="64" width="36" height="54" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d="M66 68H78V100H66ZM82 68H94V100H82Z" fill={P.slateLight} />
      <path d="M77 90v8M81 90v8" stroke={P.gold} strokeWidth="2" />
      <path d="M10 108H54V117H10ZM106 108H150V117H106Z" fill={cream} stroke={P.ink} strokeWidth="1.5" />
      <path d="M12 108V103H20V100H32V103H40V100H52V108ZM108 108V103H116V100H128V103H136V100H148V108Z" fill={P.leaf} stroke={P.ink} strokeWidth="1.5" />
      <rect x="0" y="118" width="160" height="10" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Ile Eros: a warm contemporary Nigerian restaurant, a slatted wooden facade under an adire-style band. 5 by 4 tiles. */
function Eros({ name, blue, cream, hot }: Skin & { name: string }) {
  const slatsDark = rep(18, (i) => `M${10 + i * 8} 30V118`);
  const slatsLight = rep(18, (i) => `M${11.5 + i * 8} 30V118`);
  const diamonds = rep(10, (i) => `M${14 + i * 15} 15l6 6-6 6-6-6Z`);
  const dots = rep(9, (i) => `M${19 + i * 15} 19h4v4h-4Z`);
  return (
    <g>
      <rect x="7" y="9" width="158" height="120" fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width="160" height="126" fill={P.ink} />
      <rect x="3" y="3" width="154" height="120" fill={P.wood} />
      <path d={slatsDark} stroke={P.woodDark} strokeWidth="2" />
      <path d={slatsLight} stroke={P.woodLight} strokeWidth="1" />
      <rect x="3" y="3" width="5" height="120" fill={P.woodLight} opacity=".7" />
      <rect x="146" y="3" width="11" height="120" fill={P.woodDark} opacity=".7" />
      <rect x="0" y="0" width="160" height="12" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width="154" height="3" fill={P.woodLight} />
      <rect x="3" y="12" width="154" height="18" fill={cream} />
      <path d={diamonds} fill={blue} />
      <path d={dots} fill={hot} />
      <rect x="3" y="12" width="154" height="18" fill="none" stroke={P.ink} strokeWidth="2" />
      <Plate x={22} y={36} w={116} h={24} text={name} fill={P.brandEmber} color={P.paper} size={16} />
      <rect x="10" y="68" width="38" height="40" fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <rect x="112" y="68" width="38" height="40" fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <path d="M29 68v40M10 88h38M131 68v40M112 88h38" stroke={P.woodDark} strokeWidth="2" />
      <rect x="12" y="70" width="8" height="8" fill={P.paper} opacity=".45" />
      <rect x="114" y="70" width="8" height="8" fill={P.paper} opacity=".45" />
      <rect x="62" y="68" width="36" height="52" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M66 72H78V116H66ZM82 72H94V116H82Z" fill={P.woodLight} />
      <path d="M77 92v8M81 92v8" stroke={P.gold} strokeWidth="2" />
      <path d="M55 68v8M105 68v8" stroke={P.ink} strokeWidth="1" />
      <path d="M52 76H58V86H52ZM102 76H108V86H102Z" fill={P.gold} stroke={P.ink} strokeWidth="1" />
      <rect x="0" y="118" width="160" height="10" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Lekki Conservation Centre: a planted corner, tall crowns over a dense hedge, a raised canopy walkway and a name banner. 6 by 4 tiles. */
function Grove({ name, hot, grass, hedge }: Skin & { name: string; grass: string; hedge: string }) {
  const planks = rep(16, (i) => `M${14 + i * 11} 72v12`);
  const posts = rep(12, (i) => `M${12 + i * 16} 60v12`);
  const legs = rep(6, (i) => `M${16 + i * 32} 84V112`);
  return (
    <g>
      <rect x="0" y="84" width="192" height="44" fill={grass} />
      <rect x="3" y="30" width="186" height="54" fill={hedge} stroke={P.ink} strokeWidth="2" />
      <path d="M30 30V74M80 30V74M132 30V74M166 30V74" stroke={P.woodDark} strokeWidth="6" />
      <Crown x={30} y={20} s={1.3} />
      <Crown x={82} y={10} s={1.5} />
      <Crown x={134} y={18} s={1.4} />
      <Crown x={166} y={28} s={1.05} />
      <path d={legs} stroke={P.ink} strokeWidth="4" />
      <rect x="6" y="72" width="180" height="12" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d={planks} stroke={P.wood} strokeWidth="1" />
      <rect x="6" y="82" width="180" height="3" fill={P.woodDark} />
      <path d="M6 60H186" stroke={P.ink} strokeWidth="3" />
      <path d="M6 59H186" stroke={P.paper} strokeWidth="1" opacity=".5" />
      <path d={posts} stroke={P.ink} strokeWidth="2" />
      <Plate x={8} y={42} w={176} h={18} text={name} fill={P.woodDark} color={P.paper} size={10} />
      <path d="M78 85H114V93H122V101H128V109H64V101H70V93H78ZM66 85V109M126 85V109" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M72 97H120M68 105H124" stroke={P.woodDark} strokeWidth="2" />
      <path d="M0 128V116H10V110H26V116H40V112H52V118H60V128ZM132 128V118H140V112H156V116H168V110H184V116H192V128Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M12 114h4M42 116h4M144 114h4M172 114h4" stroke={hot} strokeWidth="3" />
    </g>
  );
}

/** A table for two on the patio: round top, a chair each side. */
function PatioTableArt({ wood, chair }: { wood: boolean; chair: string }) {
  return (
    <g>
      <ellipse cx="19" cy="29" rx="13" ry="3.5" fill={P.shadow} opacity=".25" />
      <rect x="1" y="12" width="7" height="13" fill={chair} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="12" width="7" height="13" fill={chair} stroke={P.ink} strokeWidth="2" />
      <path d="M16 18v10" stroke={P.ink} strokeWidth="3" />
      <ellipse cx="16" cy="16" rx="9" ry="5" fill={wood ? P.woodLight : P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="11" width="4" height="5" fill={P.orange} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The sun's glitter on the water: short pale dashes in a column. */
const GLITTER = "M392 108h14M384 116h22M396 124h12M388 134h18M398 144h10M386 154h12";

export default function HotspotLekkiArt({ layout, uid }: RoomArtProps) {
  const data = hotspotRoomData("lekki");
  const pal = data?.palette ?? FALLBACK_PALETTE;
  const names = data ? data.landmarks.map((l) => l.name) : FALLBACK_NAMES;
  const sign = (data?.sign ?? "LEKKI PHASE 1").toUpperCase();
  const street = (data?.roads[0] ?? "Admiralty Way").toUpperCase();
  const skin: Skin = { blue: pal.primary, cream: pal.secondary, hot: pal.accent };
  const { blue, cream, hot } = skin;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const url = (name: string) => `url(#${uid}-${name})`;
  const [signFirst, ...signRest] = sign.split(" ");
  const [streetFirst, ...streetRest] = street.split(" ");

  // The hero's art is drawn in scene pixels, so it is shifted back by the prop's own position.
  const lagoon = (p: CampaignProp): ReactNode => {
    const cables = rep(7, (i) => {
      const ay = 12 + i * 8;
      const dx = 40 + i * 28;
      return `M560 ${ay}L${560 - dx} 76M560 ${ay}L${560 + dx} 76`;
    });
    const posts = rep(16, (i) => {
      const x = 232 + i * 32;
      return x >= 448 && x < 512 ? "" : `M${x} 180v14`;
    });
    return (
      <g transform={`translate(${-p.x * tile},${-p.y * tile})`}>
        <path d="M238 88V66h10V58h8V88ZM262 88V70h12V88ZM300 88V62h8V54h6V88ZM322 88V72h14V88ZM640 88V64h10V56h8V88ZM664 88V72h12V88ZM686 88V60h8V88ZM702 88V70h16V88Z" fill={SKY.far} />
        <rect x="224" y="88" width="512" height="8" fill={SKY.shore} />
        <path d="M246 84v12M326 84v12M406 84v12M486 84v12M566 84v12M646 84v12M726 84v12" stroke={P.ink} strokeWidth="3" />
        <rect x="224" y="76" width="520" height="8" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
        <rect x="224" y="77" width="520" height="2" fill={P.paper} />
        <path d={cables} stroke={P.wall} strokeWidth="1.5" fill="none" />
        <path d="M553 78V14L560 4V78Z" fill={P.paper} />
        <path d="M560 4L567 14V78H560Z" fill={P.stone} />
        <path d="M553 78V14L560 4L567 14V78Z" fill="none" stroke={P.ink} strokeWidth="2" />
        <path d="M554 34h12M554 58h12" stroke={P.ink} strokeWidth="1.5" />
        <rect x="558" y="0" width="4" height="4" fill={P.red} stroke={P.ink} strokeWidth="1" />
        <rect x="224" y="96" width="512" height="96" fill={url("water")} />
        <rect x="224" y="96" width="512" height="10" fill={P.lagoonDark} opacity=".35" />
        <path d={GLITTER} stroke={SKY.sun} strokeWidth="2" opacity=".9" />
        <path d="M556 100v8M564 108v8M556 118v8M564 126v6" stroke={P.paper} strokeWidth="2" opacity=".55" />
        <path d="M652 99l9 10h-9Z" fill={P.paper} stroke={P.ink} strokeWidth="1" />
        <path d="M646 110h20l-3 4h-14Z" fill={P.red} stroke={P.ink} strokeWidth="1" />
        <circle cx="300" cy="158" r="4" fill={hot} stroke={P.ink} strokeWidth="2" />
        <circle cx="612" cy="166" r="4" fill={hot} stroke={P.ink} strokeWidth="2" />
        <rect x="224" y="192" width="224" height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
        <rect x="512" y="192" width="224" height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
        <path d="M224 180H448M512 180H736" stroke={P.ink} strokeWidth="5" />
        <path d="M224 178H448M512 178H736" stroke={P.paper} strokeWidth="2" />
        <path d={posts} stroke={P.ink} strokeWidth="3" />
      </g>
    );
  };

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    lagoon,
    lounge: () => <BayLounge name={names[0]} {...skin} />,
    restaurant: () => <Circa name={names[1]} {...skin} />,
    woodhouse: () => <Eros name={names[2]} {...skin} />,
    grove: () => <Grove name={names[3]} {...skin} grass={url("grass")} hedge={`url(#${uid}-hedge)`} />,
    cocktail: (p) => <PatioTableArt wood={p.variant === 1} chair={p.variant === 1 ? blue : P.emberDark} />,
    jetty: () => (
      <g>
        <rect x="6" y="6" width="58" height="58" fill={P.lagoonDark} opacity=".35" />
        <rect x="2" y="0" width="60" height="64" fill={url("deck")} stroke={P.ink} strokeWidth="2" />
        <path d="M5 0V64M59 0V64" stroke={P.woodDark} strokeWidth="3" />
        <path d="M0 0h8v10h-8ZM56 0h8v10h-8ZM0 30h8v10h-8ZM56 30h8v10h-8Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
        <path d="M2 2h4M58 2h4M2 32h4M58 32h4" stroke={P.woodLight} strokeWidth="2" />
        <path d="M8 6Q32 16 56 6" fill="none" stroke={P.paper} strokeWidth="2" />
      </g>
    ),
    boat: () => (
      <g>
        <rect x="6" y="54" width="56" height="6" fill={P.lagoonDark} opacity=".5" />
        <path d="M0 58h10M52 58h12M12 62h16M40 62h14" stroke={P.lagoonLight} strokeWidth="2" />
        <path d="M2 38H62L54 54H12Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d="M6 44H58L56 49H9Z" fill={hot} />
        <rect x="22" y="22" width="22" height="16" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d="M25 26H32V32H25ZM35 26H41V32H35Z" fill={P.slateLight} />
        <rect x="20" y="17" width="26" height="6" fill={blue} stroke={P.ink} strokeWidth="2" />
        <path d="M50 38V6" stroke={P.ink} strokeWidth="2" />
        <path d="M50 6H62L58 10L62 14H50Z" fill={hot} stroke={P.ink} strokeWidth="1" />
      </g>
    ),
    palm: (p) => <PalmArt flip={p.variant === 1} />,
    streetlamp: () => <LampArt />,
    keke: (p) => <KekeArt yellow={p.variant === 1} />,
    umbrella: (p) => <UmbrellaArt a={p.variant === 1 ? cream : blue} b={p.variant === 1 ? blue : cream} />,
    coconut: () => <CoconutArt a={P.keke} b={cream} />,
    bikerack: () => <BikeRackArt a={hot} b={blue} />,
    streetsign: () => <StreetSignArt line1={streetFirst} line2={streetRest.join(" ")} blue={blue} />,
    monument: () => <MonumentArt line1={signFirst} line2={signRest.join(" ")} blue={blue} hot={hot} />,
    signboard: () => <SignboardArt text="Canopy walk" />,
  };

  const clouds = "M470 30h30v-6h18v-6h22v8h14v4ZM120 20h24v-5h14v-5h18v6h10v4ZM700 40h24v-5h14v-5h16v6h8v4Z";
  const zebra = rep(8, (i) => `M${358 + i * 32} 293h18v22h-18Z`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["paving", "concrete", "asphalt", "water", "deck", "grass", "floortile"]} />
      <defs>
        <pattern id={`${uid}-hedge`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={P.leafDark} />
          <path d="M2 3h5v3H2ZM10 9h5v3h-5ZM5 12h3v2H5Z" fill={P.leaf} />
          <path d="M3 3h2M11 9h2" stroke={P.mint} strokeWidth="1" />
        </pattern>
      </defs>

      {/* Late-afternoon sky in three flat bands, a low sun and a few clouds. */}
      <rect width={W} height={H} fill={P.leafDark} />
      <rect width={W} height="96" fill={SKY.high} />
      <rect y="44" width={W} height="28" fill={SKY.mid} />
      <rect y="72" width={W} height="24" fill={SKY.low} />
      <circle cx="400" cy="58" r="21" fill={SKY.sun} opacity=".3" />
      <circle cx="400" cy="58" r="13" fill={SKY.sun} />
      <path d={clouds} fill={P.white} opacity=".85" />
      <path d="M610 42l4 3 4-3M630 54l3 2 3-2M600 60l3 2 3-2" fill="none" stroke={P.wall} strokeWidth="1.5" />

      {/* Ground: sand paving everywhere, a hedge frame round the edge. */}
      <rect x={tile} y="96" width={W - tile * 2} height={H - 96 - tile} fill={url("paving")} />
      <rect x="0" y={tile} width={tile} height={H - tile} fill={`url(#${uid}-hedge)`} stroke={P.ink} strokeWidth="2" />
      <rect x={W - tile} y={tile} width={tile} height={H - tile} fill={`url(#${uid}-hedge)`} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y={H - tile} width={W} height={tile} fill={`url(#${uid}-hedge)`} stroke={P.ink} strokeWidth="2" />

      {/* Floors: the lounge deck, the promenade, the garden and its path, the patios and the forecourt. */}
      <rect x="32" y="192" width="256" height="96" fill={url("deck")} stroke={P.ink} strokeWidth="2" />
      <rect x="288" y="192" width="448" height="96" fill={url("floortile")} stroke={P.ink} strokeWidth="2" />
      <rect x="290" y="244" width="444" height="5" fill={blue} opacity=".55" />
      <rect x="736" y="160" width="192" height="128" fill={url("grass")} stroke={P.ink} strokeWidth="2" />
      <rect x="800" y="160" width="64" height="128" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="96" y="480" width="160" height="64" fill={url("floortile")} stroke={blue} strokeWidth="2" />
      <rect x="704" y="480" width="160" height="64" fill={url("deck")} stroke={P.ink} strokeWidth="2" />
      <rect x="288" y="512" width="384" height="96" fill={url("floortile")} stroke={P.ink} strokeWidth="2" />
      <circle cx="496" cy="568" r="42" fill="none" stroke={blue} strokeWidth="4" />
      <circle cx="496" cy="568" r="34" fill={cream} stroke={P.ink} strokeWidth="2" />
      <path d="M496 540L506 568L496 596L486 568Z" fill={hot} stroke={P.ink} strokeWidth="2" />
      <path d="M468 568L496 558L524 568L496 578Z" fill={blue} stroke={P.ink} strokeWidth="2" />

      {/* Admiralty Way: sidewalks, the road with its lane line, the kerbs and the crossing at the promenade. */}
      <rect x="288" y="288" width="64" height="224" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="608" y="288" width="64" height="224" fill={url("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x="352" y="288" width="256" height="224" fill={url("asphalt")} />
      <rect x="346" y="288" width="6" height="224" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="608" y="288" width="6" height="224" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="352" y="508" width="256" height="6" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <path d="M360 330V500M600 330V500" stroke={P.paper} strokeWidth="2" opacity=".8" />
      <path d="M480 336V500" stroke={P.paper} strokeWidth="3" strokeDasharray="16 14" />
      <path d={zebra} fill={P.paper} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* A faint warm wash: the light is low. */}
      <rect width={W} height={H} fill="#FFB35C" opacity=".07" />
    </svg>
  );
}
