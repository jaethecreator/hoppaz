import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, FONT, Frame, HopBus, P, PaperScraps, Props, RouteLine, type RoomArtProps } from "./kit";

/**
 * Victoria Island, Adeola Odeku at night: the loud lounge-and-restaurant strip. A dark street in the app's warm night, wet
 * asphalt, the gantry in Hoppaz orange, the lounges' neon in the data's pink and yellow, lit windows, valets and SUVs, and
 * the Hop bus parked among them with the route running past the four doors. Same pixel look as the clubhouse (2 px ink outlines, top-left
 * light, hard lower-right shadow, flat colour); glow is flat low-opacity shapes, never a gradient.
 *
 * Everything is drawn here (night tones, so no kit prop is dimmed by a wash); the kit supplies the frame, the prop sorter
 * and the map signpost and stools. Layout: src/lib/campaign/rooms/hotspotVictoriaIsland.ts.
 */

/** Night materials: the app's warm night ramp for sky, walls and paving; roads, glass and lit windows keep the street. */
const T = {
  sky: P.night,
  wallA: P.nightCard,
  roadA: "#23252D",
  roadB: "#2D303A",
  roadC: "#3A3F4E",
  paveA: P.nightLine,
  paveB: P.nightCard,
  paveC: P.nightDim,
  kerb: P.nightDim,
  kerbDark: P.nightLine,
  glass: "#18233D",
  glassHi: "#3F5784",
  lit: "#F7D46A",
  litDeep: "#C98A1E",
  amber: "#7A4A12",
  steel: "#8A90A4",
  dusk: P.nightRaised,
} as const;

/** The room's two neon colours (the data's palette) and a bright core for each, so a tube reads as lit. The cores are brand cream. */
type Look = { pink: string; pinkCore: string; yellow: string; yellowCore: string };
type FacadeProps = { w: number; h: number; uid: string; name: string; k: Look };

const FIT = 0.72;
/** Font size that makes `text` fit `width` px at Poppins 900 (letter spacing `ls` px). */
const fit = (text: string, width: number, max: number, ls = 0) => Math.max(5, Math.min(max, ((width - 8) / Math.max(1, text.length) - ls) / FIT));

/** Neon text: a fat low-opacity halo under a bright core. Always on a dark plate, never bare. */
function Neon({ x, y, text, size, core, halo, ls = 1, mono = false }: { x: number | string; y: number | string; text: string; size: number; core: string; halo: string; ls?: number; mono?: boolean }) {
  const family = mono ? FONT.mono : FONT.display;
  return (
    <g>
      <text x={x} y={y} textAnchor="middle" fontFamily={family} fontWeight={900} fontSize={size} letterSpacing={ls} fill={halo} stroke={halo} strokeWidth={Math.max(3, size * 0.22)} strokeLinejoin="round" opacity=".42">{text}</text>
      <text x={x} y={y} textAnchor="middle" fontFamily={family} fontWeight={900} fontSize={size} letterSpacing={ls} fill={core}>{text}</text>
    </g>
  );
}

const Shadow = ({ w, h }: { w: number; h: number }) => <rect x="6" y="8" width={w - 2} height={h - 2} fill={P.shadow} opacity=".4" />;

/** Terra Kulture: a cultural centre. An arched, stage-like frontage with curtains and a lit stage, banners, a pediment. */
function Terra({ w, h, name, k }: FacadeProps) {
  const cx = w / 2;
  const t = name.toUpperCase();
  const base = h - 3;
  const arch = (r: number) => `M${cx - r} ${base}V96A${r} ${r} 0 0 1 ${cx + r} 96V${base}Z`;
  const win = (x: number) => `M${x} 112V82A14 14 0 0 1 ${x + 28} 82V112Z`;
  return (
    <g>
      <Shadow w={w} h={h} />
      <path d={`M${cx - 58} 4L${cx - 38} -20H${cx + 38}L${cx + 58} 4Z`} fill="#4A3040" stroke={P.ink} strokeWidth="2" />
      <circle cx={cx} cy="-9" r="6" fill={k.yellowCore} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill="#3A2733" stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="10" fill="#5B3E48" />
      <rect x="3" y="3" width={w - 6} height="2" fill={P.paper} opacity=".3" />
      <rect x="3" y="13" width={w - 6} height="3" fill={P.gold} />
      {[14, w - 28].map((x) => (
        <g key={x}>
          <rect x={x} y="20" width="14" height="40" fill={k.pink} stroke={P.ink} strokeWidth="2" />
          <rect x={x} y="52" width="14" height="8" fill={k.yellow} />
        </g>
      ))}
      <rect x={cx - 74} y="18" width="148" height="24" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x={cx} y="36" text={t} size={fit(t, 148, 15, 1)} core={k.yellowCore} halo={k.yellow} ls={1} />
      {[22, w - 50].map((x) => (
        <g key={x}>
          <path d={win(x)} fill={T.amber} stroke={P.ink} strokeWidth="2" />
          <path d={`M${x + 4} 108V82A10 10 0 0 1 ${x + 24} 82V108Z`} fill={T.litDeep} />
          <path d={`M${x + 14} 72V112M${x + 2} 94H${x + 26}`} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <path d={arch(50)} fill="#6D5A5A" stroke={P.ink} strokeWidth="2" />
      <path d={arch(42)} fill={T.amber} stroke={P.ink} strokeWidth="2" />
      <path d={arch(36)} fill={T.litDeep} />
      <circle cx={cx} cy="84" r="11" fill={k.yellowCore} opacity=".8" />
      <rect x={cx - 42} y="108" width="84" height="17" fill="#8E6D53" />
      <rect x={cx - 42} y="108" width="84" height="2" fill={P.woodLight} />
      <rect x={cx - 40} y="90" width="10" height="35" fill={k.pink} />
      <rect x={cx + 30} y="90" width="10" height="35" fill={k.pink} />
      <path d={`M${cx} 122V102M${cx - 4} 102H${cx + 4}M${cx - 6} 122H${cx + 6}`} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 58} y={h - 6} width="116" height="8" fill={P.stone} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** RSVP: a sleek restaurant-lounge. Dark front, a glass wall with a warm bar behind it, pink tube light, a roof terrace. */
function Rsvp({ w, h, name, k }: FacadeProps) {
  const cx = w / 2;
  const t = name.toUpperCase();
  const mullions = Array.from({ length: Math.floor((w - 24) / 24) }, (_, i) => `M${36 + i * 24} 60V122`).join("");
  return (
    <g>
      <Shadow w={w} h={h} />
      <rect x="10" y="-16" width={w - 20} height="18" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
      <path d={`M16 -9H${w - 16}`} stroke={k.yellowCore} strokeWidth="3" strokeDasharray="3 9" />
      <path d={`M14 -15V-1M${cx} -15V-1M${w - 14} -15V-1`} stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="2" fill={P.paper} opacity=".2" />
      <rect x="3" y="8" width={w - 6} height="3" fill={k.pinkCore} />
      <rect x={cx - 48} y="16" width="96" height="36" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x={cx} y="42" text={t} size={fit(t, 96, 28, 6)} core={k.pinkCore} halo={k.pink} ls={6} />
      <rect x="12" y="60" width={w - 24} height="62" fill={T.glass} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="98" width={w - 28} height="22" fill={T.amber} />
      <path d={`M20 72H${w - 20}`} stroke={k.pinkCore} strokeWidth="2" strokeDasharray="4 10" />
      <path d={mullions} stroke={P.ink} strokeWidth="2" />
      <path d="M26 62H52L30 120H14Z" fill={P.paper} opacity=".08" />
      <rect x={cx - 56} y="54" width="112" height="8" fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 54} y="62" width="108" height="3" fill={k.pinkCore} opacity=".85" />
      <rect x={cx - 24} y="70" width="48" height="54" fill={P.nightRaised} stroke={k.pinkCore} strokeWidth="3" />
      <rect x={cx - 20} y="74" width="40" height="48" fill={T.litDeep} opacity=".6" />
      <path d={`M${cx} 74V122M${cx - 8} 98v6M${cx + 6} 98v6`} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 34} y={h - 6} width="68" height="8" fill={T.kerbDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Eko Hotels: a hotel. A tall tower of lit windows behind a glazed podium, a gold-trimmed porte-cochere and a red carpet. */
function Eko({ w, h, uid, name, k }: FacadeProps) {
  const cx = w / 2;
  const t = name.toUpperCase();
  return (
    <g>
      <Shadow w={w} h={h} />
      <rect x={cx - 34} y="-32" width="68" height="84" fill="#1B2640" stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 30} y="-24" width="60" height="74" fill={`url(#${uid}-win)`} />
      <rect x={cx - 34} y="-32" width="68" height="8" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 32} y="-31" width="64" height="2" fill={P.lagoonLight} />
      <rect x="1" y="38" width={w - 2} height={h - 40} fill="#26334D" stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="40" width={w - 6} height="4" fill={P.gold} />
      <rect x="10" y="50" width={w - 20} height="70" fill={`url(#${uid}-win)`} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 76} y="48" width="152" height="26" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x={cx} y="67" text={t} size={fit(t, 152, 18, 2)} core={P.paper} halo={P.lagoonLight} ls={2} />
      <rect x={cx - 74} y="95" width="148" height="30" fill={P.nightRaised} />
      <rect x={cx - 26} y="100" width="52" height="25" fill={T.glass} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 22} y="104" width="44" height="21" fill={T.litDeep} opacity=".7" />
      <path d={`M${cx} 100V125`} stroke={P.ink} strokeWidth="2" />
      {[-72, -26, 18, 64].map((dx) => <rect key={dx} x={cx + dx} y="94" width="8" height="31" fill="#CFC8B4" stroke={P.ink} strokeWidth="2" />)}
      <rect x={cx - 78} y="80" width="156" height="14" fill="#8C93A6" stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 76} y="81" width="152" height="3" fill={P.paper} opacity=".4" />
      <rect x={cx - 76} y="92" width="152" height="3" fill={k.yellowCore} />
      <rect x={cx - 14} y="118" width="28" height="74" fill="#8E2B2B" stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - 8} 126V188M${cx + 8} 126V188`} stroke={P.gold} strokeWidth="2" />
    </g>
  );
}

/** The Place: a casual restaurant. Brick, a striped awning over big warm windows, a hanging sign and a string-lit patio. */
function Place({ w, h, uid, name, k }: FacadeProps) {
  const cx = w / 2;
  const t = name.toUpperCase();
  return (
    <g>
      <Shadow w={w} h={h} />
      <rect x="12" y="-14" width="34" height="18" fill="#3A2733" stroke={P.ink} strokeWidth="2" />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={`url(#${uid}-brick)`} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="2" fill={P.paper} opacity=".25" />
      <rect x={cx - 62} y="12" width="124" height="30" fill="#2A1B14" stroke={P.ink} strokeWidth="2" />
      <Neon x={cx} y="34" text={t} size={fit(t, 124, 20, 2)} core={k.yellowCore} halo={k.yellow} ls={2} />
      <rect x="4" y="52" width={w - 8} height="14" fill={`url(#${uid}-stripe)`} stroke={P.ink} strokeWidth="2" />
      {[12, w - 70].map((x) => (
        <g key={x}>
          <rect x={x} y="70" width="58" height="46" fill={T.litDeep} stroke={P.ink} strokeWidth="3" />
          <rect x={x + 4} y="94" width="50" height="18" fill={T.amber} />
          <path d={`M${x + 29} 70V116M${x} 92H${x + 58}`} stroke={P.ink} strokeWidth="2" />
          <rect x={x - 2} y="116" width="62" height="5" fill={P.stone} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <rect x={cx - 20} y="76" width="40" height="50" fill={P.woodDark} stroke={P.ink} strokeWidth="3" />
      <rect x={cx - 15} y="81" width="30" height="20" fill={T.lit} />
      <path d={`M${cx} 81V126`} stroke={P.ink} strokeWidth="2" />
      <path d={`M8 134Q${cx} 152 ${w - 8} 134`} fill="none" stroke={P.ink} strokeWidth="1" />
      {Array.from({ length: 9 }, (_, i) => {
        const tt = (i + 0.5) / 9;
        return <rect key={i} x={8 + (w - 16) * tt - 2} y={134 + Math.sin(tt * Math.PI) * 8} width="4" height="5" fill={i % 2 ? k.yellowCore : k.yellow} stroke={P.ink} strokeWidth="1" />;
      })}
    </g>
  );
}

/** The hero: the neon ADEOLA ODEKU gantry on its island in the middle of the road, with the rope-and-stanchion queue and a valet podium. */
function Hero({ w, h, uid, sign, place, k }: { w: number; h: number; uid: string; sign: string; place: string; k: Look }) {
  const posts: number[] = [];
  for (let x = 80; x <= w - 104; x += 24) posts.push(x);
  const rope = (y: number) => `M${posts[0]} ${y}${posts.slice(1).map((x, i) => `Q${(posts[i] + x) / 2} ${y + 5} ${x} ${y}`).join("")}`;
  return (
    <g>
      <rect x="8" y="14" width={w - 4} height={h - 14} fill={P.shadow} opacity=".4" />
      <rect x="0" y="62" width={w} height="66" fill={T.kerbDark} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="66" width={w - 8} height="44" fill={`url(#${uid}-pave)`} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="112" width={w - 4} height="14" fill={T.kerb} />
      <rect x="2" y="112" width={w - 4} height="2" fill={P.paper} opacity=".3" />
      <rect x="6" y="119" width={w - 12} height="3" fill={k.pinkCore} />
      {[18, w - 32].map((x) => (
        <g key={x}>
          <rect x={x} y="50" width="14" height="38" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="52" width="3" height="34" fill={k.pinkCore} />
          <rect x={x - 4} y="84" width="22" height="8" fill={P.ink} />
        </g>
      ))}
      <path d={`M14 54V24L30 8H${w - 30}L${w - 14} 24V54Z`} fill={P.night} stroke={P.ink} strokeWidth="3" />
      <path d={`M21 49V27L34 14H${w - 34}L${w - 21} 27V49Z`} fill="none" stroke={k.pink} strokeWidth="7" opacity=".4" />
      <path d={`M21 49V27L34 14H${w - 34}L${w - 21} 27V49Z`} fill="none" stroke={k.pinkCore} strokeWidth="3" />
      <path d={`M34 4H${w - 34}`} stroke={k.yellowCore} strokeWidth="4" strokeDasharray="3 9" />
      <Neon x={w / 2} y="38" text={sign} size={fit(sign, w - 96, 32, 2)} core={k.yellowCore} halo={k.yellow} ls={2} />
      <Neon x={w / 2} y="47" text={place} size={6.5} core={k.pinkCore} halo={k.pink} ls={4} mono />
      <rect x="76" y="80" width={w - 180} height="18" fill="#8E2B2B" />
      <path d={`M76 82H${w - 104}M76 96H${w - 104}`} stroke={P.gold} strokeWidth="2" />
      <path d={`${posts.map((x) => `M${x} 70v10M${x} 98v10`).join("")}`} stroke={P.goldDark} strokeWidth="4" />
      <path d={`${posts.map((x) => `M${x - 2} 70h4M${x - 2} 98h4`).join("")}`} stroke={P.gold} strokeWidth="4" />
      <path d={rope(74)} fill="none" stroke={P.red} strokeWidth="3" />
      <path d={rope(102)} fill="none" stroke={P.red} strokeWidth="3" />
      <rect x="44" y="84" width="24" height="20" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
      <rect x="46" y="86" width="20" height="6" fill={P.mint} />
      <rect x={w - 88} y="80" width="38" height="24" fill="#2B1D14" stroke={P.ink} strokeWidth="2" />
      <rect x={w - 90} y="76" width="42" height="8" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w - 80} 90v6M${w - 72} 90v6M${w - 64} 90v6M${w - 56} 90v6`} stroke={k.yellowCore} strokeWidth="2" />
      <path d={`M${w - 69} 76V62`} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 86} y="56" width="34" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x={w - 69} y="65.5" text="VALET" size={8} core={k.pinkCore} halo={k.pink} ls={1} />
      <rect x="62" y="54" width="26" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x="75" y="63.5" text="VIP" size={8} core={k.yellowCore} halo={k.yellow} ls={1} />
    </g>
  );
}

/** A parked SUV: dark, glossy, side on. Variants 0 to 2 face right, 3 to 5 face left; the colour is variant mod 3. */
function Suv({ v, k }: { v: number; k: Look }) {
  const body = ["#1A1F2E", "#1F2A24", "#2A2230"][v % 3];
  const art = (
    <g>
      <rect x="10" y="32" width="86" height="28" fill={P.shadow} opacity=".4" />
      <path d="M3 49V31Q3 25 9 23L20 21L27 5H69L81 21L91 24Q95 26 95 32V49Z" fill={body} stroke={P.ink} strokeWidth="2" />
      <path d="M31 8H66L77 20H24Z" fill="#3C4B66" />
      <path d="M48 8V20" stroke={P.ink} strokeWidth="3" />
      <path d="M33 10H43" stroke={P.paper} strokeWidth="2" opacity=".55" />
      <path d="M30 6H66" stroke={P.paper} strokeWidth="2" opacity=".3" />
      <path d="M8 31H90" stroke="#5A6A92" strokeWidth="2" opacity=".75" />
      <path d="M8 42H90" stroke="#0A0C14" strokeWidth="2" opacity=".6" />
      {[22, 74].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="49" r="8" fill={P.ink} />
          <circle cx={cx} cy="49" r="3" fill={T.steel} />
        </g>
      ))}
      <rect x="90" y="29" width="6" height="5" fill={k.yellowCore} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="29" width="4" height="5" fill={P.red} stroke={P.ink} strokeWidth="1" />
    </g>
  );
  return v >= 3 ? <g transform="translate(96,0) scale(-1,1)">{art}</g> : art;
}

/** A keke (three wheels, green with a yellow stripe), facing right, headlight lit. */
function Keke({ k }: { k: Look }) {
  return (
    <g>
      <rect x="8" y="24" width="54" height="8" fill={P.shadow} opacity=".4" />
      <rect x="4" y="7" width="32" height="17" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width="36" height="7" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
      <path d="M36 12H48L58 20V24H36Z" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="16" width="50" height="3" fill={P.danfo} />
      <circle cx="12" cy="26" r="5" fill={P.ink} />
      <circle cx="28" cy="26" r="5" fill={P.ink} />
      <circle cx="52" cy="26" r="4" fill={P.ink} />
      <rect x="56" y="16" width="5" height="4" fill={k.yellowCore} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A roadside billboard on two legs. Variant 0 is the Hoppaz board (the bounce wordmark on night), 1 a hoarding with posters pasted on it. */
function Billboard({ w, h, v, k }: { w: number; h: number; v: number; k: Look }) {
  const lamps = [w * 0.25, w * 0.5, w * 0.75];
  return (
    <g>
      <rect x="8" y="12" width={w - 4} height={h - 12} fill={P.shadow} opacity=".4" />
      <rect x="22" y="44" width="9" height={h - 44} fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 31} y="44" width="9" height={h - 44} fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      {v === 1 ? (
        <g>
          <rect x="2" y="4" width={w - 4} height="42" fill={P.nightCard} stroke={P.ink} strokeWidth="3" />
          <PaperScraps x={14} y={6} w={w - 28} h={38} seed={1} text={BRAND_LINES.wait} />
        </g>
      ) : (
        <BrandSign x={2} y={2} w={w - 4} h={44} wordmark sub={BRAND_LINES.friends} />
      )}
      <path d={lamps.map((x) => `M${x - 4} -1h8`).join("")} stroke={k.yellowCore} strokeWidth="4" />
      <path d={lamps.map((x) => `M${x - 3} 2L${x - 20} 44H${x + 20}L${x + 3} 2Z`).join("")} fill={k.yellowCore} opacity=".1" />
    </g>
  );
}

/** A street lamp. Variant 1 and 2 carry a street name plate (the two roads of the junction). */
function Lamp({ v, label, k }: { v: number; label: string; k: Look }) {
  return (
    <g>
      <rect x="12" y="25" width="17" height="6" fill={P.shadow} opacity=".35" />
      <rect x="11" y="23" width="10" height="7" fill={P.ink} />
      <path d="M16 24V-20H26" fill="none" stroke={P.ink} strokeWidth="4" />
      <rect x="21" y="-25" width="13" height="7" fill={k.yellowCore} stroke={P.ink} strokeWidth="2" />
      {v > 0 && (
        <g>
          <rect x="-62" y="-14" width="76" height="12" fill={P.lagoonDark} stroke={P.ink} strokeWidth="2" />
          <text x="-24" y="-5.5" textAnchor="middle" fontFamily={FONT.mono} fontSize="6" fill={P.paper} letterSpacing=".5">{label}</text>
        </g>
      )}
    </g>
  );
}

/** A palm in a lit planter, the light strip orange. */
function PlanterPalm() {
  return (
    <g>
      <ellipse cx="18" cy="29" rx="12" ry="3" fill={P.shadow} opacity=".35" />
      <path d="M13 22L15 8H18L19 22Z" fill={P.woodDark} stroke={P.ink} strokeWidth="1" />
      <g transform="translate(16 10) scale(.8)">
        <path d="M0 0c-12-12-24-8-28 2c9-5 17-3 24 3ZM0 0c12-12 24-8 28 2c-9-5-17-3-24 3ZM0 0c-4-15-1-24 7-26c-3 9-3 17-1 26ZM0 0c-14-2-20 5-20 12c6-6 12-8 20-8Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
        <path d="M-2-2c-8-8-14-8-20-3c8-1 14 0 19 5Z" fill={P.leaf} />
      </g>
      <rect x="8" y="20" width="18" height="10" fill={T.kerbDark} stroke={P.ink} strokeWidth="2" />
      <rect x="9" y="21" width="16" height="2" fill={T.kerb} />
      <rect x="10" y="26" width="14" height="2" fill={P.orange} />
    </g>
  );
}

/** A velvet-rope pair of posts, one above the other (a queue lane edge). */
function Rope() {
  return (
    <g>
      <rect x="6" y="14" width="24" height="52" fill={P.shadow} opacity=".25" />
      <path d="M16 14Q27 34 16 52" fill="none" stroke={P.red} strokeWidth="3" />
      {[14, 52].map((y) => (
        <g key={y}>
          <ellipse cx="16" cy={y + 8} rx="6" ry="3" fill={P.ink} />
          <rect x="14" y={y - 4} width="4" height="12" fill={P.goldDark} />
          <circle cx="16" cy={y - 5} r="4" fill={P.gold} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
    </g>
  );
}

/** A rail of event posters on the pavement (Terra Kulture's). */
function PosterRail({ k }: { k: Look }) {
  return (
    <g>
      <rect x="6" y="9" width="60" height="22" fill={P.shadow} opacity=".35" />
      <rect x="2" y="3" width="60" height="25" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="6" width="16" height="18" fill={k.pink} />
      <rect x="9" y="9" width="10" height="6" fill={k.pinkCore} />
      <rect x="24" y="6" width="16" height="18" fill={k.yellow} />
      <circle cx="32" cy="14" r="4" fill={P.night} />
      <rect x="42" y="6" width="16" height="18" fill={P.paper} />
      <rect x="45" y="9" width="10" height="3" fill={P.night} />
      <rect x="45" y="15" width="7" height="2" fill={P.night} />
      <path d="M8 28v3M56 28v3" stroke={P.ink} strokeWidth="3" />
    </g>
  );
}

/** The valet stand near a venue door: a lectern with a key rack and a lit VALET plate. */
function Valet({ k }: { k: Look }) {
  return (
    <g>
      <rect x="10" y="14" width="54" height="18" fill={P.shadow} opacity=".35" />
      <rect x="10" y="-2" width="44" height="14" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <path d="M16 3v6M24 3v6M32 3v6M40 3v6M48 3v6" stroke={k.yellowCore} strokeWidth="2" />
      <rect x="6" y="12" width="52" height="18" fill="#2B1D14" stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="9" width="56" height="7" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="18" y="-16" width="28" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x="32" y="-6.5" text="VALET" size={8} core={k.pinkCore} halo={P.orange} ls={1} />
    </g>
  );
}

/** A patio table under a parasol (orange or yellow). */
function PatioTable({ v, k }: { v: number; k: Look }) {
  const c = v ? k.yellow : P.orange;
  return (
    <g>
      <ellipse cx="18" cy="29" rx="12" ry="3" fill={P.shadow} opacity=".35" />
      <rect x="1" y="21" width="7" height="8" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="25" y="21" width="7" height="8" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M16 12V25" stroke={P.ink} strokeWidth="3" />
      <ellipse cx="16" cy="25" rx="9" ry="4" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <ellipse cx="16" cy="8" rx="19" ry="8" fill={c} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="4" width="9" height="2" fill={P.paper} opacity=".45" />
      <path d="M16 0V16" stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A chalk A-frame menu board on the pavement. */
function MenuBoard({ k }: { k: Look }) {
  return (
    <g>
      <rect x="9" y="22" width="18" height="9" fill={P.shadow} opacity=".3" />
      <path d="M10 28L7 31M22 28L25 31" stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="6" width="16" height="22" fill="#1A1410" stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="8" width="12" height="4" fill={k.yellow} />
      <path d="M11 16h10M11 20h8M11 24h10" stroke={P.paper} strokeWidth="1" />
    </g>
  );
}

/** The suya grill: coals, skewers, a lit SUYA board and smoke (flat pixel puffs). */
function SuyaGrill({ k }: { k: Look }) {
  return (
    <g>
      <rect x="8" y="22" width="56" height="10" fill={P.shadow} opacity=".35" />
      <rect x="16" y="-6" width="10" height="8" fill="#9A99A6" opacity=".35" />
      <rect x="20" y="-17" width="12" height="10" fill="#9A99A6" opacity=".28" />
      <rect x="27" y="-30" width="15" height="12" fill="#9A99A6" opacity=".2" />
      <path d="M8 12L16 4M18 12L26 4M28 12L36 4M38 12L46 4" stroke="#E8D9B0" strokeWidth="2" />
      <rect x="4" y="12" width="56" height="18" fill="#2A2A30" stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="14" width="50" height="6" fill="#7A2A12" />
      <path d="M10 17h46" stroke={P.orange} strokeWidth="3" strokeDasharray="4 5" />
      <path d="M8 30v2M54 30v2" stroke={P.ink} strokeWidth="3" />
      <path d="M52 12V-8" stroke={P.ink} strokeWidth="2" />
      <rect x="40" y="-18" width="26" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Neon x="53" y="-8.5" text="SUYA" size={8} core={k.yellowCore} halo={k.yellow} ls={1} />
    </g>
  );
}

export default function HotspotVictoriaIslandArt({ layout, uid, brand }: RoomArtProps) {
  const data = hotspotRoomData("victoria-island");
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const k: Look = {
    pink: data?.palette.primary ?? "#C94A8A",
    pinkCore: P.paper,
    yellow: data?.palette.accent ?? "#F2B705",
    yellowCore: P.paper,
  };
  // The gantry is Hoppaz neon: orange tubes with cream cores (the lounges keep the data's pink and yellow).
  const heroLook: Look = { pink: P.orange, pinkCore: P.paper, yellow: P.orange, yellowCore: P.paper };
  const sign = (data?.sign ?? brand).toUpperCase();
  const place = (data?.place ?? "Victoria Island").toUpperCase();
  const FALLBACK = ["Terra Kulture", "RSVP", "Eko Hotels", "The Place"];
  const names = [0, 1, 2, 3].map((i) => data?.landmarks[i]?.name ?? FALLBACK[i]);
  const roads = data?.roads ?? ["Akin Adesola Street", "Adeola Odeku Street"];
  const roadTag = (s: string) => s.replace(/ Street$/i, " ST").toUpperCase();
  const at = (id: string) => layout.props.find((p) => p.id === id);
  const kind = (name: string) => layout.props.filter((p) => p.kind === name);
  const px = (p: CampaignProp) => p.x * tile;
  const py = (p: CampaignProp) => p.y * tile;
  const roadTop = 8 * tile;
  const roadBottom = 14 * tile;
  const midY = (roadTop + roadBottom) / 2;
  const hero = at("hero");
  const exit = at("entry-map-table");
  const doors: { id: string; cx: number; c: string }[] = [
    { id: "venue-1", cx: 0, c: k.yellow },
    { id: "venue-2", cx: 0, c: k.pink },
    { id: "venue-3", cx: 0, c: k.yellowCore },
    { id: "venue-4", cx: 0, c: k.yellow },
  ];
  const custom: Record<string, (p: CampaignProp, t: number) => ReactNode> = {
    "venue-1": (p) => <Terra w={p.w * tile} h={p.h * tile} uid={uid} name={names[0]} k={k} />,
    "venue-2": (p) => <Rsvp w={p.w * tile} h={p.h * tile} uid={uid} name={names[1]} k={k} />,
    "venue-3": (p) => <Eko w={p.w * tile} h={p.h * tile} uid={uid} name={names[2]} k={k} />,
    "venue-4": (p) => <Place w={p.w * tile} h={p.h * tile} uid={uid} name={names[3]} k={k} />,
    hero: (p) => <Hero w={p.w * tile} h={p.h * tile} uid={uid} sign={sign} place={place} k={heroLook} />,
    "suv-4": () => <HopBus w={96} h={64} />,
    suv: (p) => <Suv v={p.variant ?? 0} k={k} />,
    keke: () => <Keke k={k} />,
    billboard: (p) => <Billboard w={p.w * tile} h={p.h * tile} v={p.variant ?? 0} k={k} />,
    streetlamp: (p) => <Lamp v={p.variant ?? 0} label={roadTag(roads[(p.variant ?? 1) - 1] ?? roads[0])} k={k} />,
    planterpalm: () => <PlanterPalm />,
    rope: () => <Rope />,
    posterrail: () => <PosterRail k={k} />,
    valet: () => <Valet k={k} />,
    patiotable: (p) => <PatioTable v={p.variant ?? 0} k={k} />,
    menuboard: () => <MenuBoard k={k} />,
    suyagrill: () => <SuyaGrill k={k} />,
  };
  // Where each venue's door sits (centre of its facade), for the light that spills onto the pavement.
  for (const d of doors) {
    const v = at(d.id);
    d.cx = v ? px(v) + (v.w * tile) / 2 : 0;
  }
  // The sign plates of the five big signs (scene px), for the neon glow around each.
  const plate = (id: string, lx: number, ly: number, lw: number, lh: number, c: string) => {
    const p = at(id);
    return p ? { x: px(p) + lx, y: py(p) + ly, w: lw, h: lh, c } : null;
  };
  const signGlows = [
    plate("venue-1", ((at("venue-1")?.w ?? 7) * tile) / 2 - 74, 18, 148, 24, k.yellow),
    plate("venue-2", ((at("venue-2")?.w ?? 6) * tile) / 2 - 48, 16, 96, 36, k.pink),
    plate("venue-3", ((at("venue-3")?.w ?? 8) * tile) / 2 - 76, 48, 152, 26, P.lagoonLight),
    plate("venue-4", ((at("venue-4")?.w ?? 7) * tile) / 2 - 62, 12, 124, 30, k.yellow),
    plate("hero", 14, 8, (at("hero")?.w ?? 12) * tile - 28, 46, P.orange),
  ].filter((g): g is { x: number; y: number; w: number; h: number; c: string } => g !== null);
  const zebraX = 7 * tile;
  // Neon on the wet road under the hero: short ripple bars (the gantry's orange, then the strip's yellow), n bars stacked under each letter group.
  const rippleY = (hero ? py(hero) + hero.h * tile : 416) + 3;
  const ripple = (list: [number, number][]) => list.map(([x, n]) => Array.from({ length: n }, (_, i) => `M${x + i} ${rippleY + i * 9}h${12 - i * 3}`).join("")).join("");
  const pinkRipple = ripple([[322, 3], [392, 3], [482, 3], [572, 2], [652, 2]]);
  const yellowRipple = ripple([[352, 2], [440, 2], [524, 3], [616, 3]]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <defs>
        <pattern id={`${uid}-pave`} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect width="32" height="16" fill={T.paveA} />
          <path d="M0 0H32M0 8H32M0 16H32M8 0V8M24 0V8M16 8V16M0 8V16" stroke={T.paveB} strokeWidth="1" />
          <path d="M3 3h2M20 12h2M26 5h1" stroke={T.paveC} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-road`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill={T.roadA} />
          <path d="M4 5h8M20 14h9M11 25h6M27 8h2" stroke={T.roadB} strokeWidth="1" />
          <path d="M2 20h10M18 29h9" stroke={T.roadC} strokeWidth="1" opacity=".6" />
        </pattern>
        <pattern id={`${uid}-zebra`} width="64" height="16" patternUnits="userSpaceOnUse">
          <rect width="64" height="9" fill={P.paper} opacity=".85" />
        </pattern>
        <pattern id={`${uid}-win`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill={T.wallA} />
          <rect x="4" y="5" width="10" height="9" fill={T.lit} />
          <rect x="18" y="5" width="10" height="9" fill={T.litDeep} />
          <rect x="4" y="19" width="10" height="9" fill={T.glassHi} />
          <rect x="18" y="19" width="10" height="9" fill={T.lit} />
        </pattern>
        <pattern id={`${uid}-brick`} width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill="#5A2E26" />
          <path d="M0 0H16M0 4H16M4 0V4M12 4V8" stroke="#3E1F1A" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-stripe`} width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill="#1A1410" />
          <rect width="8" height="8" fill={k.yellow} />
        </pattern>
        <clipPath id={`${uid}-play`}>
          <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} />
        </clipPath>
      </defs>
      <Frame layout={layout} ground={T.sky} />

      {/* The two flanking buildings (ring columns), the skyline above and the low wall below: all out of play. */}
      <path d={`M${tile} ${tile}V18H62V24H96V10H130V20H190V14H250V22H310V8H370V18H430V12H500V22H560V6H620V18H690V12H760V22H820V10H890V20H${W - tile}V${tile}Z`} fill={T.dusk} />
      <rect x="0" y="0" width={tile} height={H} fill={T.dusk} />
      <rect x={W - tile} y="0" width={tile} height={H} fill={T.dusk} />
      <rect x="0" y={tile} width={tile} height={H - tile * 2} fill={`url(#${uid}-win)`} opacity=".32" />
      <rect x={W - tile} y={tile} width={tile} height={H - tile * 2} fill={`url(#${uid}-win)`} opacity=".32" />
      <rect x="9" y="60" width="14" height="190" fill={P.orange} opacity=".3" />
      <rect x="14" y="60" width="4" height="190" fill={P.paper} />
      <rect x={W - 23} y="300" width="14" height="170" fill={k.yellow} opacity=".3" />
      <rect x={W - 18} y="300" width="4" height="170" fill={k.yellowCore} />
      <rect x="0" y={H - tile} width={W} height={tile} fill={T.dusk} />
      <rect x={tile} y={H - tile - 3} width={W - tile * 2} height="3" fill={T.kerbDark} />
      <path d={`M${tile + 16} ${H - 22}V${H - 4}M${W - tile - 16} ${H - 22}V${H - 4}`} stroke={P.ink} strokeWidth="3" />

      {/* Ground: night paving, the wet road, kerbs and the road paint. */}
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-pave)`} stroke={P.ink} strokeWidth="4" />
      <rect x={tile} y={roadTop} width={W - tile * 2} height={roadBottom - roadTop} fill={`url(#${uid}-road)`} />
      <rect x={tile} y={roadTop - 6} width={W - tile * 2} height="6" fill={T.kerb} />
      <rect x={tile} y={roadTop - 6} width={W - tile * 2} height="2" fill={P.paper} opacity=".35" />
      <rect x={tile} y={roadTop} width={W - tile * 2} height="3" fill={T.dusk} />
      <rect x={tile} y={roadBottom} width={W - tile * 2} height="6" fill={T.kerb} />
      <rect x={tile} y={roadBottom + 6} width={W - tile * 2} height="3" fill={T.dusk} opacity=".6" />
      <path d={`M${tile} ${midY}H${9 * tile}M${21 * tile} ${midY}H${W - tile}`} stroke={P.paper} strokeWidth="3" strokeDasharray="20 14" opacity=".75" />
      <path d={`M${tile} ${roadTop + 10}H${W - tile}M${tile} ${roadBottom - 10}H${W - tile}`} stroke={k.yellow} strokeWidth="2" opacity=".7" />
      <rect x={zebraX} y={roadTop + 8} width={2 * tile} height={roadBottom - roadTop - 16} fill={`url(#${uid}-zebra)`} />
      <rect x={zebraX} y={roadTop - 12} width={2 * tile} height="6" fill={k.yellow} opacity=".7" />
      <rect x={zebraX} y={roadBottom + 9} width={2 * tile} height="6" fill={k.yellow} opacity=".7" />
      {[[168, 384, 34], [608, 322, 28], [790, 410, 30]].map(([cx, cy, rx]) => <ellipse key={cx} cx={cx} cy={cy} rx={rx} ry="7" fill={T.glassHi} opacity=".22" />)}
      <circle cx={19 * tile + 4} cy={roadTop + 20} r="9" fill={T.roadB} stroke={T.roadC} strokeWidth="2" />
      <circle cx={26 * tile - 6} cy={roadBottom - 20} r="9" fill={T.roadB} stroke={T.roadC} strokeWidth="2" />
      {/* Neon on the wet road: orange and yellow streaks under the hero's letters and the signs. */}
      <path d={pinkRipple} stroke={P.orange} strokeWidth="4" opacity=".45" />
      <path d={yellowRipple} stroke={k.yellow} strokeWidth="4" opacity=".4" />
      {[[doors[0].cx - 10, k.yellow], [doors[1].cx - 6, k.pink], [doors[3].cx - 10, k.yellow]].map(([x, c]) => <rect key={String(x)} x={Number(x)} y={roadTop} width="12" height="34" fill={String(c)} opacity=".18" />)}

      {/* The Hop route along the pavement: one stop per venue door, Terra Kulture to The Place (the finale). */}
      <RouteLine points={[[144, 198], [368, 198], [528, 198], [816, 198]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* Light, drawn over everything: flat low-opacity shapes. Door spill, lamp pools, headlights, taillights. */}
      <g clipPath={`url(#${uid}-play)`}>
      {doors.map((d) => (
        <path key={d.id} d={`M${d.cx - 26} ${5 * tile}H${d.cx + 26}L${d.cx + 58} ${7 * tile + 8}H${d.cx - 58}Z`} fill={d.c} opacity=".13" />
      ))}
      {kind("streetlamp").map((p) => (
        <g key={p.id}>
          <ellipse cx={px(p) + 24} cy={py(p) + 30} rx="58" ry="25" fill={k.yellowCore} opacity=".1" />
          <ellipse cx={px(p) + 24} cy={py(p) + 30} rx="30" ry="12" fill={k.yellowCore} opacity=".1" />
        </g>
      ))}
      {kind("suv").map((p) => {
        const bus = p.id === "suv-4";
        const left = !bus && (p.variant ?? 0) >= 3;
        const hx = left ? px(p) + 4 : px(p) + 92;
        const tx = left ? px(p) + 92 : px(p) + 4;
        const y = py(p) + (bus ? 44 : 31);
        const dir = left ? -1 : 1;
        return (
          <g key={p.id}>
            <path d={`M${hx} ${y - 3}L${hx + dir * 62} ${y - 14}V${y + 18}L${hx} ${y + 3}Z`} fill={k.yellowCore} opacity=".1" />
            <circle cx={tx} cy={y} r="7" fill={bus ? P.orange : P.red} opacity=".35" />
          </g>
        );
      })}
      {signGlows.map((g, i) => <rect key={i} x={g.x - 5} y={g.y - 5} width={g.w + 10} height={g.h + 10} fill={g.c} opacity=".14" />)}
      {hero && <rect x={px(hero) - 8} y={py(hero) + hero.h * tile} width={hero.w * tile + 16} height="30" fill={P.orange} opacity=".12" />}
      {exit && <rect x={px(exit) - 6} y={py(exit) - 6} width={exit.w * tile + 12} height={tile + 10} fill={k.yellowCore} opacity=".12" />}
      <rect x={tile} y={H - tile * 3} width={W - tile * 2} height={tile * 2} fill={T.sky} opacity=".22" />
      </g>
    </svg>
  );
}
