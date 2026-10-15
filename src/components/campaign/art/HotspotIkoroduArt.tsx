import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, Defs, Frame, HopBay, HopBus, P, PaperScraps, Plate, Props, RouteLine, Scrawl, Stamp, type RoomArtProps } from "./kit";

/**
 * Ikorodu Garage: the motor park at the end of the long road, a bright afternoon turning to evening. The layout is
 * src/lib/campaign/rooms/hotspotIkorodu.ts; the sign, the names and the three colours come from src/lib/rooms/hotspotRooms.ts
 * ("ikorodu"): blue buses and gate, pale blue glass and walls, an amber accent on the oranges.
 *
 * The middle of the room is the garage: a long BRT-style loading island (the `hero`, with the gantry sign), a loading lane
 * each side and a row of buses nose to tail beyond each lane (danfos, BRT and, first in the queue, the orange Hop bus).
 * The compound wall along the top is the hoarding. The four corners are LASUSTECH (a university gate), Dream Park Cinemas,
 * The Place Lounge (a night frontage) and Ikorodu Ferry Terminal (a pier, a ferry and a bit of lagoon); the strips between
 * them are a market. Names only on the venues: no logos, no photos.
 *
 * The Hoppaz layer (brand kit, docs/ROOM-TEMPLATES.md "Look"): the orange Hop bus (the `hop-bus` prop), the route as the
 * queue line (Stop 1 at the campus gate, the finale above the bus), the bounce wordmark on the compound wall, orange and
 * cream vendor umbrellas and kiosk awning, one paper-scrap patch, one scrawl and one stamp. No violet: none in this room.
 */
const PLACE = hotspotRoomData("ikorodu");
const SIGN = PLACE?.sign ?? "IKORODU GARAGE";
const PAL = PLACE?.palette ?? { primary: "#2B59C3", secondary: "#CFE8FF", accent: "#FF9F1C" };
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["LASUSTECH", "The Place Lounge", "Dream Park Cinemas", "Ikorodu Ferry Terminal"];

const BLUE = PAL.primary;
const BLUE_DARK = "#1D3F94";
const BLUE_LIGHT = "#5B84DA";
const PALE = PAL.secondary;
const PALE_DARK = "#9EC6EE";
const AMBER = PAL.accent;
const DANFO_LIGHT = "#FFE066";
const DESTS = ["EPE", "OJOTA", "MILE 12", "TBS", "YABA"];

const nums = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("");
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
/** A right-pointing road arrow centred on (x, y), as path data. */
const arrow = (x: number, y: number) => `M${x - 9} ${y - 3}h10v-4l9 7-9 7v-4h-10Z`;

/** A street palm: base at (0,0), trunk up to about -40, crown about 70 px wide. */
function TallPalm() {
  return (
    <g>
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

/**
 * The garage: a long BRT-style loading island seen from the south. A fascia carries the gantry sign over an orange edge
 * band, the glass shelter stands behind its pillars with conductors' boards hanging in it, and the platform front has a
 * yellow and black kerb and queue rails with gaps where the doors open.
 */
function Garage({ w, h, sign }: { w: number; h: number; sign: string }) {
  const pillars = Array.from({ length: 7 }, (_, i) => 6 + i * 62);
  const spans = pillars.slice(0, 6);
  const rails = [4, 28, 52, 76, 100, 124, 148, 236, 260, 284, 308, 332, 356, 380];
  return (
    <g>
      <rect x="6" y="10" width={w - 2} height={h - 8} fill={P.shadow} opacity=".28" />
      <rect x="0" y="30" width={w} height={h - 30} fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="32" width={w - 4} height="46" fill={P.concrete} />
      <rect x="4" y="34" width={w - 8} height="38" fill={PALE} stroke={P.ink} strokeWidth="2" />
      <path d={spans.map((x) => `M${x + 34} 36V70`).join("")} stroke={P.ink} strokeWidth="2" />
      <path d={spans.map((x) => `M${x + 12} 68l9-12M${x + 20} 68l6-8`).join("")} stroke={P.paper} strokeWidth="2" opacity=".75" />
      <path d={[19, 143, 267].map((x) => `M${x} 61h36v5h-36Z`).join("")} fill={P.woodLight} stroke={P.ink} strokeWidth="1.5" />
      <path d={[19, 143, 267].map((x) => `M${x + 4} 66v5M${x + 32} 66v5`).join("")} stroke={P.ink} strokeWidth="2" />
      {[["EPE", 75], ["MILE 12", 137], ["OJOTA", 199], ["TBS", 261]].map(([text, x]) => (
        <Plate key={text} x={Number(x)} y={35} w={48} h={12} text={String(text)} fill={P.night} color={P.paper} mono size={6} />
      ))}
      <path d={pillars.map((x) => `M${x} 30h6v50h-6Z`).join("")} fill={P.cap} stroke={P.ink} strokeWidth="1.5" />
      <rect x="0" y="0" width={w} height="33" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="3" fill={P.paper} opacity=".3" />
      <rect x="2" y="26" width={w - 4} height="6" fill={P.orange} />
      <Plate x={62} y={4} w={260} h={22} text={sign} fill={P.nightCard} color={P.paper} />
      <rect x="7" y="5" width="46" height="20" fill={BLUE} stroke={P.ink} strokeWidth="1.5" />
      <rect x="331" y="5" width="46" height="20" fill={BLUE} stroke={P.ink} strokeWidth="1.5" />
      <path d="M17 15h26m-8-7 8 7-8 7M367 15h-26m8-7-8 7 8 7" stroke={P.paper} strokeWidth="3" fill="none" />
      <rect x="2" y="78" width={w - 4} height="8" fill="url(#hatch)" stroke={P.ink} strokeWidth="1.5" />
      <path d="M4 72H152M232 72H380" stroke={P.ink} strokeWidth="5" />
      <path d="M4 72H152M232 72H380" stroke={P.cap} strokeWidth="2" />
      <path d={rails.map((x) => `M${x} 64v14`).join("")} stroke={P.ink} strokeWidth="3" />
      <path d={rails.map((x) => `M${x - 2} 62h5v3h-5Z`).join("")} fill={P.danfo} />
    </g>
  );
}

/** LASUSTECH: a university gate. Pale blue buildings behind two pillars, a boom barrier across the drive and a guard hut. */
function Lasu({ w, h, name, uid }: { w: number; h: number; name: string; uid: string }) {
  const windows = [10, 30, 50, 158, 178, 198].flatMap((x) => [44, 62].map((y) => `M${x} ${y}h14v12h-14Z`)).join("");
  const bars = `url(#${uid}-bars)`;
  return (
    <g>
      <rect x="7" y="9" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
      <rect x="2" y="6" width={w - 4} height="80" fill={PALE} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="6" width={w - 4} height="11" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="8" width={w - 8} height="2" fill={BLUE_LIGHT} />
      <Plate x={42} y={19} w={140} h={20} text={name} fill={P.night} color={P.paper} />
      <path d={windows} fill={BLUE_DARK} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="78" width={w - 4} height="8" fill={PALE_DARK} />
      <rect x="96" y="44" width="32" height="80" fill={P.asphalt} />
      <path d="M112 58V116" stroke={P.paper} strokeWidth="2" strokeDasharray="6 6" />
      <rect x="78" y="40" width="18" height="84" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="128" y="40" width="18" height="84" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d="M75 34h24v8h-24ZM125 34h24v8h-24Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M78 64h18v6h-18ZM128 64h18v6h-18Z" fill={BLUE} />
      <rect x="94" y="42" width="36" height="12" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="96" y="45" width="32" height="2" fill={P.paper} opacity=".5" />
      <rect x="96" y="98" width="32" height="5" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d="M102 98v5M110 98v5M118 98v5" stroke={BLUE} strokeWidth="3" />
      <rect x="6" y="100" width="70" height="4" fill={P.night} />
      <rect x="6" y="104" width="70" height="16" fill={bars} />
      <rect x="204" y="100" width="16" height="4" fill={P.night} />
      <rect x="204" y="104" width="16" height="16" fill={bars} />
      <rect x="146" y="78" width="58" height="9" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="150" y="87" width="50" height="35" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="156" y="94" width="18" height="14" fill={BLUE_DARK} stroke={P.ink} strokeWidth="1.5" />
      <rect x="180" y="96" width="12" height="26" fill={P.woodDark} stroke={P.ink} strokeWidth="1.5" />
      <path d="M8 100V94h8V90h12V96h6V100ZM206 100V96h8V92h6V100Z" fill={P.leaf} stroke={P.ink} strokeWidth="1.5" />
      <rect x="0" y="120" width={w} height="8" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** The Place Lounge: a lounge and nightclub frontage on the night ramp, a striped awning over the door and bulbs on a wire. */
function Lounge({ w, h, name }: { w: number; h: number; name: string }) {
  const bulbsA = nums(10, (i) => `M${12 + i * 18} ${47 + Math.round(Math.sin(((i + 0.5) / 10) * Math.PI) * 5)}h4v4h-4Z`);
  const bulbsB = nums(9, (i) => `M${21 + i * 18} ${48 + Math.round(Math.sin(((i + 1) / 10) * Math.PI) * 5)}h4v4h-4Z`);
  return (
    <g>
      <rect x="6" y="8" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height="90" fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="8" fill={P.nightLine} />
      <Plate x={24} y={13} w={144} h={22} text={name} fill={P.nightCard} color={P.paper} />
      <rect x="30" y="38" width="132" height="3" fill={BLUE_LIGHT} />
      <path d="M6 45Q96 58 186 45" fill="none" stroke={P.ink} strokeWidth="1" />
      <path d={bulbsA} fill={P.gold} />
      <path d={bulbsB} fill={P.paper} />
      {[10, 138].map((x) => (
        <g key={x}>
          <rect x={x} y="58" width="44" height="26" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 2} y="60" width="40" height="22" fill={P.gold} opacity=".32" />
          <path d={`M${x + 22} 58v26M${x} 71h44`} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <rect x="68" y="50" width="56" height="10" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <path d="M72 50h8v10h-8ZM88 50h8v10h-8ZM104 50h8v10h-8Z" fill={PALE} />
      <rect x="76" y="60" width="40" height="30" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d="M80 64h14v22h-14ZM98 64h14v22h-14Z" fill={P.nightCard} />
      <path d="M94 74v6M98 74v6" stroke={P.gold} strokeWidth="2" />
      <path d="M62 66h6v22h-6ZM124 66h6v22h-6Z" fill={P.nightLine} stroke={P.ink} strokeWidth="1.5" />
      <path d="M62 70Q46 76 46 88M130 70Q146 76 146 88" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <rect x="0" y="86" width={w} height="8" fill={P.nightLine} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Dream Park Cinemas: a night frontage with a bulb marquee, blank poster frames and a water slide on the roof. */
function Cinema({ w, h, name }: { w: number; h: number; name: string }) {
  const top = nums(16, (i) => `M${18 + i * 12} 26h5v3h-5Z`);
  const bottom = nums(16, (i) => `M${18 + i * 12} 51h5v3h-5Z`);
  const posters = [12, 56, 152, 196];
  return (
    <g>
      <rect x="7" y="9" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
      <path d="M176 14V6M200 14V8" stroke={BLUE} strokeWidth="3" />
      <path d="M156 10Q176 -6 196 2T222 10" fill="none" stroke={P.ink} strokeWidth="9" />
      <path d="M156 10Q176 -6 196 2T222 10" fill="none" stroke={PALE} strokeWidth="5" />
      <rect x="2" y="12" width={w - 4} height="112" fill={P.nightRaised} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="14" width={w - 8} height="8" fill={P.nightLine} />
      <rect x="12" y="22" width="200" height="36" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={top + bottom} fill={P.gold} />
      <Plate x={24} y={31} w={176} h={20} text={name} fill={P.nightCard} color={P.paper} />
      {posters.map((x) => (
        <rect key={x} x={x} y="64" width="36" height="42" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
      ))}
      <path d="M16 68h28v24h-28ZM160 68h28v24h-28Z" fill={BLUE_LIGHT} />
      <path d="M60 68h28v24h-28ZM204 68h28v24h-28Z" fill={PALE_DARK} />
      <path d={circle(30, 80, 6) + circle(174, 80, 6)} fill={P.paper} />
      <path d="M68 90l8-14 8 14ZM212 90l8-14 8 14Z" fill={P.night} />
      <path d="M14 98h32M58 98h32M154 98h32M198 98h32" stroke={P.nightDim} strokeWidth="2" />
      <rect x="84" y="76" width="56" height="9" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <path d="M88 76h8v9h-8ZM104 76h8v9h-8ZM120 76h8v9h-8Z" fill={PALE} />
      <rect x="92" y="85" width="40" height="39" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
      <path d="M96 89h14v31h-14ZM114 89h14v31h-14Z" fill={P.gold} opacity=".4" />
      <path d="M112 89v31" stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="120" width={w} height="8" fill={P.nightLine} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Ikorodu Ferry Terminal: a pale ticket hall under a blue roof on the quay, life rings on the wall. */
function Ferry({ w, h, name }: { w: number; h: number; name: string }) {
  return (
    <g>
      <rect x="6" y="8" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
      <path d="M0 24L22 6H170L192 24Z" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="22" y="8" width="148" height="3" fill={BLUE_LIGHT} />
      <rect x="4" y="24" width={w - 8} height="62" fill={PALE} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="76" width={w - 8} height="10" fill={PALE_DARK} />
      <Plate x={14} y={29} w={164} h={20} text={name} fill={P.night} color={P.paper} />
      <path d="M12 56h26v14h-26ZM44 56h26v14h-26ZM122 56h26v14h-26ZM154 56h26v14h-26Z" fill={BLUE_DARK} stroke={P.ink} strokeWidth="1.5" />
      <rect x="76" y="52" width="40" height="36" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d="M80 56h14v32h-14ZM98 56h14v32h-14Z" fill={P.nightCard} />
      <path d="M180 8V-2" stroke={P.ink} strokeWidth="2" />
      <path d={`${circle(24, 51, 5)}${circle(168, 51, 5)}`} fill={AMBER} stroke={P.ink} strokeWidth="1.5" />
      <rect x="0" y="84" width={w} height="10" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** A danfo seen from the side, facing right: yellow body, a black stripe, the destination on a plate above the cab. */
function Danfo({ w, v }: { w: number; v: number }) {
  const n = Math.floor((w - 28) / 16);
  const wheel = (cx: number) => circle(cx, 27, 5);
  return (
    <g>
      <rect x="7" y="22" width={w - 6} height="11" fill={P.shadow} opacity=".28" />
      <rect x="1" y="3" width={w - 2} height="24" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="4" width={w - 6} height="3" fill={DANFO_LIGHT} />
      <path d={nums(n, (i) => `M${6 + i * 16} 8h13v8h-13Z`)} fill={PALE} stroke={P.ink} strokeWidth="1" />
      <path d={`M${w - 22} 8h16l3 5v3h-19Z`} fill={PALE} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="18" width={w - 4} height="4" fill={P.ink} />
      <path d={wheel(18) + wheel(w - 20)} fill={P.ink} />
      <path d={circle(18, 27, 2) + circle(w - 20, 27, 2)} fill={P.concrete} />
      <rect x={w - 5} y="20" width="3" height="3" fill={P.paper} />
      <rect x="2" y="20" width="3" height="3" fill={P.red} />
      <Plate x={w - 36} y={-4} w={30} h={8} text={DESTS[v % DESTS.length]} fill={P.night} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A BRT bus, facing right: the place's blue with pale glass and a cream stripe, the amber line along the waist. */
function Brt({ w, v }: { w: number; v: number }) {
  const n = Math.floor((w - 50) / 22);
  return (
    <g>
      <rect x="7" y="22" width={w - 6} height="11" fill={P.shadow} opacity=".28" />
      <rect x="28" y="-3" width="40" height="6" fill={P.cap} stroke={P.ink} strokeWidth="1.5" />
      <rect x="1" y="2" width={w - 2} height="26" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="3" width={w - 6} height="3" fill={BLUE_LIGHT} />
      <path d={nums(n, (i) => `M${9 + i * 22} 7h18v11h-18Z`)} fill={PALE} stroke={P.ink} strokeWidth="1" />
      <path d={`M${w - 32} 7h24l3 6v5h-27Z`} fill={PALE} stroke={P.ink} strokeWidth="1" />
      <rect x="2" y="19" width={w - 4} height="2" fill={AMBER} />
      <rect x="2" y="21" width={w - 4} height="4" fill={P.paper} />
      <rect x="2" y="25" width={w - 4} height="3" fill={BLUE_DARK} />
      <path d={circle(24, 27, 5.5) + circle(w - 26, 27, 5.5)} fill={P.ink} />
      <path d={circle(24, 27, 2) + circle(w - 26, 27, 2)} fill={P.concrete} />
      <rect x={w - 5} y="22" width="3" height="3" fill={P.paper} />
      <Plate x={w - 42} y={-5} w={34} h={9} text={DESTS[v % DESTS.length]} fill={P.night} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A keke (tricycle taxi): green body, yellow roof, one wheel in front. Variant 1 faces left. */
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
      <rect x="8" y="14" width="26" height="8" fill={P.night} />
      <path d={`M${w - 18} 12L${w - 8} 15V24H${w - 18}Z`} fill={PALE} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 8} y="19" width="3" height="3" fill={P.paper} />
    </g>
  );
}

/** A market stall: a table of produce under a striped canopy. Variant 0 blue, 1 pale, 2 green. */
function Stall({ w, v }: { w: number; v: number }) {
  const [a, b] = v === 2 ? [P.kekeDark, P.paper] : v === 1 ? [PALE, BLUE] : [BLUE, P.paper];
  const n = Math.floor(w / 8);
  return (
    <g>
      <rect x="6" y="20" width={w - 2} height="12" fill={P.shadow} opacity=".25" />
      <path d={`M5 8V28M${w - 5} 8V28`} stroke={P.ink} strokeWidth="3" />
      <rect x="2" y="17" width={w - 4} height="12" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="18" width={w - 8} height="3" fill={P.woodLight} />
      <path d={nums(Math.floor((w - 12) / 12), (i) => `M${7 + i * 12} 11h7v7h-7Z`)} fill={P.red} stroke={P.ink} strokeWidth="1" />
      <path d={nums(Math.floor((w - 12) / 12), (i) => `M${13 + i * 12} 13h5v5h-5Z`)} fill={v === 2 ? P.leaf : AMBER} stroke={P.ink} strokeWidth="1" />
      <rect x="0" y="-3" width={w} height="12" fill={b} />
      <path d={nums(Math.ceil(n / 2), (i) => `M${i * 16} -3h8v12h-8Z`)} fill={a} />
      <rect x="0" y="-3" width={w} height="12" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={nums(n, (i) => `M${i * 8} 9l4 4 4-4Z`)} fill={a} opacity=".9" />
    </g>
  );
}

/** A hawker with oranges: a cart with a pyramid of fruit under a Hoppaz orange and cream umbrella. */
function OrangeSeller({ w }: { w: number }) {
  const apex = { x: w / 2, y: -34 };
  const wedge = (i: number) => `M${apex.x} ${apex.y}L${-6 + i * 14} -12H${8 + i * 14}Z`;
  const orangeWedges = nums(5, (i) => (i % 2 === 0 ? wedge(i) : ""));
  const creamWedges = nums(5, (i) => (i % 2 === 1 ? wedge(i) : ""));
  const fruit = [[14, 12], [22, 12], [30, 12], [38, 12], [46, 12], [18, 6], [26, 6], [34, 6], [42, 6], [26, 0], [34, 0]];
  return (
    <g>
      <rect x="8" y="24" width={w - 4} height="8" fill={P.shadow} opacity=".25" />
      <path d={`M${apex.x} ${apex.y}V16`} stroke={P.ink} strokeWidth="3" />
      <path d={circle(14, 28, 5) + circle(w - 14, 28, 5)} fill={P.ink} />
      <rect x="6" y="14" width={w - 12} height="12" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="16" width={w - 16} height="3" fill={P.paper} opacity=".5" />
      <path d={fruit.map(([x, y]) => circle(x, y, 4)).join("")} fill={AMBER} stroke={P.ink} strokeWidth="1" />
      <path d="M30 -4h4v3h-4ZM10 8h4v3h-4Z" fill={P.leaf} />
      <path d={orangeWedges} fill={P.orange} />
      <path d={creamWedges} fill={P.paper} />
      <path d={`M-6 -12L${apex.x} ${apex.y}L${w + 6} -12Z`} fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={`M-6 -12H${w + 6}`} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** A vendor umbrella over a small table: the Hoppaz way of being on the street (orange and cream, no text). */
function Umbrella({ v }: { v: number }) {
  const [a, b] = v === 1 ? [P.paper, P.orange] : [P.orange, P.paper];
  return (
    <g>
      <ellipse cx="19" cy="28" rx="13" ry="3" fill={P.shadow} opacity=".25" />
      <rect x="15" y="-12" width="3" height="32" fill={P.ink} />
      <path d="M8 24h16" stroke={P.ink} strokeWidth="3" />
      <rect x="6" y="18" width="20" height="7" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <path d="M16 -20L-10 2H3ZM16 -20L16 2H29Z" fill={a} />
      <path d="M16 -20L3 2H16ZM16 -20L29 2H42Z" fill={b} />
      <path d="M16 -20L-10 2H42Z" fill="none" stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** A conductor's board: an A-frame with the destination on a night plate over a blue board with route lines. */
function Board({ v }: { v: number }) {
  return (
    <g>
      <rect x="6" y="26" width="22" height="4" fill={P.shadow} opacity=".28" />
      <path d="M9 29L12 12M25 29L22 12" stroke={P.ink} strokeWidth="3" />
      <rect x="5" y="-4" width="24" height="18" fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <path d="M9 1h16M9 6h16M9 11h9" stroke={P.paper} strokeWidth="2" />
      <Plate x={2} y={-14} w={30} h={9} text={DESTS[(v + 2) % DESTS.length]} fill={P.night} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A queue pen seen from the south: steel rails in a serpentine, posts with yellow caps, the way in at the bottom left. */
function QueuePen({ w, h }: { w: number; h: number }) {
  const rails = `M4 12H${w - 4}M4 12V${h - 16}M${w - 4} 12V${h - 16}M4 26H${w - 28}M28 40H${w - 4}M${w - 4} ${h - 16}H32`;
  const posts = [4, 24, 44, 64, 84, 104, w - 4].flatMap((x) => [`M${x} 4v10`, `M${x} ${h - 24}v10`]).join("");
  return (
    <g>
      <rect x="8" y="14" width={w - 4} height={h - 12} fill={P.shadow} opacity=".22" />
      <path d={`M24 ${h - 8}h${w - 48}`} stroke={P.paper} strokeWidth="2" strokeDasharray="8 6" opacity=".7" />
      <path d={rails} stroke={P.ink} strokeWidth="5" fill="none" />
      <path d={rails} stroke={P.cap} strokeWidth="2" fill="none" />
      <path d={posts} stroke={P.ink} strokeWidth="3" />
      <path d={[4, 24, 44, 64, 84, 104, w - 4].map((x) => `M${x - 2} 2h5v3h-5Z`).join("")} fill={P.danfo} />
    </g>
  );
}

/** The ticket booth: a pale kiosk under an orange and cream awning, a night window and a blue door. */
function Booth({ w }: { w: number }) {
  return (
    <g>
      <rect x="6" y="14" width={w - 2} height="16" fill={P.shadow} opacity=".25" />
      <rect x="4" y="6" width={w - 8} height="22" fill={PALE} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="13" width="24" height="11" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
      <rect x="9" y="24" width="26" height="3" fill={P.woodLight} stroke={P.ink} strokeWidth="1" />
      <rect x="42" y="13" width="14" height="15" fill={BLUE_DARK} stroke={P.ink} strokeWidth="1.5" />
      <rect x="0" y="-2" width={w} height="10" fill={P.orange} />
      <path d={nums(Math.floor(w / 16), (i) => `M${8 + i * 16} -2h8v10h-8Z`)} fill={P.paper} />
      <rect x="0" y="-2" width={w} height="10" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={nums(Math.floor(w / 8), (i) => `M${i * 8} 8l4 4 4-4Z`)} fill={P.brandEmber} />
    </g>
  );
}

/** A stack of tyres: two side by side and one on top. */
function Tyres() {
  return (
    <g>
      <ellipse cx="18" cy="29" rx="14" ry="3" fill={P.shadow} opacity=".28" />
      <ellipse cx="10" cy="22" rx="8" ry="6" fill={P.ink} />
      <ellipse cx="25" cy="22" rx="8" ry="6" fill={P.ink} />
      <ellipse cx="17" cy="12" rx="8" ry="6" fill={P.ink} />
      <path d="M10 22h0M25 22h0M17 12h0" stroke={P.concrete} strokeWidth="5" strokeLinecap="square" />
    </g>
  );
}

/** An oil drum in the place's blue, with two ink hoops. */
function Bin() {
  return (
    <g>
      <ellipse cx="18" cy="28" rx="10" ry="3" fill={P.shadow} opacity=".28" />
      <rect x="9" y="8" width="18" height="20" fill={BLUE_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="11" y="9" width="4" height="18" fill={BLUE_LIGHT} />
      <path d="M9 14h18M9 21h18" stroke={P.ink} strokeWidth="2" />
      <ellipse cx="18" cy="8" rx="9" ry="3" fill={P.cap} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** The ferry moored along the pier, facing right: a blue hull, two pale cabins, an amber funnel band, life rings. */
function Boat({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="6" y={h - 12} width={w - 10} height="6" fill={P.lagoonDark} opacity=".5" />
      <path d={`M0 ${h - 6}h12M${w - 40} ${h - 5}h18M16 ${h - 2}h22M${w - 90} ${h - 2}h18`} stroke={P.lagoonLight} strokeWidth="2" />
      <rect x="112" y="2" width="14" height="14" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="112" y="6" width="14" height="4" fill={AMBER} />
      <rect x="20" y="18" width="116" height="15" fill={PALE} stroke={P.ink} strokeWidth="2" />
      <rect x="40" y="6" width="68" height="13" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d={nums(11, (i) => `M${26 + i * 10} 22h6v6h-6Z`)} fill={BLUE_DARK} />
      <path d={nums(6, (i) => `M${46 + i * 10} 9h6v6h-6Z`)} fill={BLUE_DARK} />
      <path d={`M2 32H${w - 2}L${w - 10} 38L${w - 20} ${h - 12}H14Z`} fill={BLUE} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="39" width={w - 30} height="4" fill={P.paper} />
      <rect x="16" y={h - 17} width={w - 38} height="4" fill={BLUE_DARK} />
      <path d={`${circle(30, 36, 4)}${circle(70, 36, 4)}${circle(110, 36, 4)}`} fill={AMBER} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${w - 16} 33V12`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w - 16} 12h-12l4 4-4 4h12Z`} fill={P.orange} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The pier: planked deck on the water's edge, a fender beam, bollards and a mooring rope to the boat. */
function Pier({ w, h, uid }: { w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-deck)`} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y={h - 10} width={w} height="10" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y={h - 8} width={w - 4} height="2" fill={P.woodLight} />
      <path d={`${circle(34, h - 16, 4)}${circle(104, h - 16, 4)}${circle(170, h - 16, 4)}`} fill={P.ink} />
      <path d={`${circle(34, h - 17, 2)}${circle(104, h - 17, 2)}${circle(170, h - 17, 2)}`} fill={P.cap} />
      <path d={`M34 ${h - 16}Q56 ${h - 4} 80 ${h - 14}`} fill="none" stroke={P.woodLight} strokeWidth="2" />
    </g>
  );
}

/** The lagoon by the pier: water, a darker lip under the quay, a few ripples and the pier's piles. */
function Lagoon({ x, y, w, h, uid }: { x: number; y: number; w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${uid}-water)`} stroke={P.ink} strokeWidth="2" />
      <rect x={x + 2} y={y + 2} width={w - 4} height="10" fill={P.lagoonDark} opacity=".4" />
      <path d={`M${x + 130} ${y + 40}h16M${x + 24} ${y + 78}h18M${x + 150} ${y + 70}h14`} stroke={P.lagoonLight} strokeWidth="2" />
      <path d={`M${x + 24} ${y + 2}v12M${x + 90} ${y + 2}v12M${x + 158} ${y + 2}v12`} stroke={P.woodDark} strokeWidth="4" />
    </g>
  );
}

/** The compound wall along the top of the yard: pale blue plaster, a blue cap and dado, pilasters. The hoarding sits on it. */
function CompoundWall({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const pilasters = nums(Math.floor(w / 56) - 1, (i) => `M${x + 56 * (i + 1)} ${y + 8}V${y + h - 20}`);
  return (
    <g>
      <rect x={x + 5} y={y + 7} width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x={x} y={y} width={w} height={h} fill={P.ink} />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 8} fill={PALE} />
      <rect x={x + 2} y={y + 2} width={w - 4} height="6" fill={BLUE} />
      <rect x={x + 3} y={y + h - 20} width={w - 6} height="12" fill={BLUE_DARK} />
      <path d={pilasters} stroke={PALE_DARK} strokeWidth="3" />
    </g>
  );
}

export default function HotspotIkoroduArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const t = (n: number) => n * tile;
  const fill = (name: string) => `url(#${uid}-${name})`;
  const wallTop = layout.walls.find((b) => b.y < 5);
  const lagoon = layout.walls.find((b) => b.y >= 5);

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    garage: (p, tl) => <Garage w={p.w * tl} h={p.h * tl} sign={SIGN} />,
    lasu: (p, tl) => <Lasu w={p.w * tl} h={p.h * tl} name={NAMES[0]} uid={uid} />,
    lounge: (p, tl) => <Lounge w={p.w * tl} h={p.h * tl} name={NAMES[1]} />,
    cinema: (p, tl) => <Cinema w={p.w * tl} h={p.h * tl} name={NAMES[2]} />,
    ferry: (p, tl) => <Ferry w={p.w * tl} h={p.h * tl} name={NAMES[3]} />,
    hopbus: (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} />,
    danfo: (p, tl) => <Danfo w={p.w * tl} v={p.variant ?? 0} />,
    brt: (p, tl) => <Brt w={p.w * tl} v={p.variant ?? 0} />,
    keke: (p, tl) => <Keke w={p.w * tl} flip={(p.variant ?? 0) === 1} />,
    stall: (p, tl) => <Stall w={p.w * tl} v={p.variant ?? 0} />,
    orangeseller: (p, tl) => <OrangeSeller w={p.w * tl} />,
    umbrella: (p) => <Umbrella v={p.variant ?? 0} />,
    board: (p) => <Board v={p.variant ?? 0} />,
    queuepen: (p, tl) => <QueuePen w={p.w * tl} h={p.h * tl} />,
    booth: (p, tl) => <Booth w={p.w * tl} />,
    tyres: () => <Tyres />,
    bin: () => <Bin />,
    palm: () => <g transform="translate(16,30)"><TallPalm /></g>,
    streetlamp: () => <StreetLamp />,
    boat: (p, tl) => <Boat w={p.w * tl} h={p.h * tl} />,
    pier: (p, tl) => <Pier w={p.w * tl} h={p.h * tl} uid={uid} />,
  };

  // The Hop route is the queue line: Stop 1 at the campus gate, down the west walkway beside the garage, then along
  // loading lane B to the finale above the Hop bus. Every stop and bend is on a walkable tile.
  const route: ([number, number] | [number, number, 0])[] = [
    [t(4) + 16, t(5) + 16],
    [t(7) + 16, t(5) + 16, 0],
    [t(7) + 16, t(9) + 16],
    [t(7) + 16, t(12) + 16, 0],
    [t(12) + 16, t(12) + 16],
    [t(19) + 16, t(12) + 16],
  ];
  const bay = layout.props.find((p) => p.id === "hop-bus");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["paving", "asphalt", "concrete", "deck", "water"]} />
      <defs>
        <pattern id={`${uid}-hedge`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={P.leafDark} />
          <path d="M2 3h5v3H2ZM10 9h5v3h-5ZM5 12h3v2H5Z" fill={P.leaf} />
          <path d="M3 3h2M11 9h2" stroke={P.mint} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-bars`} width="6" height="16" patternUnits="userSpaceOnUse"><rect x="2" width="2" height="16" fill={P.night} /></pattern>
        <pattern id="hatch" width="16" height="8" patternUnits="userSpaceOnUse"><rect width="16" height="8" fill={P.danfo} /><rect width="8" height="8" fill={P.ink} /></pattern>
      </defs>

      {/* The ground: a hedge ring, paving, the asphalt yard, the plaza and the lounge patio. */}
      <Frame layout={layout} ground="#2F3A2C" />
      <rect width={W} height={H} fill={fill("hedge")} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={fill("paving")} stroke={P.ink} strokeWidth="4" />
      <rect x={t(7)} y={t(4)} width={t(16)} height={t(11)} fill={fill("asphalt")} stroke={P.ink} strokeWidth="2" />
      <rect x={t(7)} y={t(15)} width={t(16)} height={t(4)} fill={fill("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x={t(1)} y={t(14)} width={t(6)} height={t(5)} fill={fill("deck")} stroke={P.ink} strokeWidth="2" />
      <rect x={t(7)} y={t(15) - 3} width={t(16)} height="6" fill={P.stone} stroke={P.ink} strokeWidth="2" />

      {/* The compound wall with the hoarding, and the lagoon. */}
      {wallTop && <CompoundWall x={t(wallTop.x)} y={t(wallTop.y)} w={t(wallTop.w)} h={t(wallTop.h)} />}
      {lagoon && <Lagoon x={t(lagoon.x)} y={t(lagoon.y)} w={t(lagoon.w)} h={t(lagoon.h)} uid={uid} />}
      <BrandSign x={372} y={40} w={216} h={70} wordmark tone="orange" />
      <PaperScraps x={268} y={42} w={88} h={64} seed={1} text={BRAND_LINES.wait} />
      <Plate x={614} y={46} w={76} h={16} text="Post no bill" fill={P.paper} color={P.night} mono size={6.5} />
      <Scrawl x={622} y={104} text="oya" size={20} color={P.night} rotate={-6} />

      {/* Road paint: bay dividers round the gaps, the lane line, arrows, and the Hop bus's bay. */}
      <path d={[8, 11, 12, 15, 16, 21].map((x) => `M${t(x)} ${t(6)}v${tile}`).join("") + [8, 13, 14, 17, 18, 22].map((x) => `M${t(x)} ${t(14)}v${tile}`).join("")} stroke={P.paper} strokeWidth="2" opacity=".8" />
      <path d={`M${t(8)} ${t(8)}H${t(22)}`} stroke={P.paper} strokeWidth="2" strokeDasharray="14 10" opacity=".7" />
      <path d={[300, 440, 580].map((x) => arrow(x, 240)).join("") + [372, 512, 652].map((x) => arrow(x, 272)).join("") + [300, 540].map((x) => arrow(x, 424)).join("")} fill={P.paper} opacity=".8" />
      {bay && <HopBay x={t(bay.x) - 10} y={t(bay.y) - 34} w={t(bay.w) + 20} h={72} />}

      {/* The route, the queue line: Stop 1 at the campus gate, the finale above the Hop bus. */}
      <RouteLine points={route} />
      <Stamp x={t(19) + 16} y={t(17) + 16} text={BRAND_LINES.hop} size={8} rotate={-5} />

      <Props layout={layout} uid={uid} custom={custom} order={(p) => (p.kind === "pier" ? -100 : p.y)} />

      {/* Late sun: a warm wash over everything. */}
      <rect width={W} height={H} fill={P.orange} opacity=".06" />
    </svg>
  );
}
