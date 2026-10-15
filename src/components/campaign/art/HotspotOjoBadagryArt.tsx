import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, Defs, FONT, Frame, HopBay, HopBus, P, Plate, Props, RouteLine, Shade, Stamp, StringLights, type RoomArtProps } from "./kit";

/**
 * Iyana Iba, the Ojo and Badagry hotspot: the Lasu-Isheri Road running into the Lagos-Badagry Expressway on a hot, bright
 * midday. A T seen from the south. Along the top: LASU Ojo's gate and lawn, the road going up, the Alaba International Market
 * (a long block of shops under one big orange gate sign, TVs, speakers and fridges stacked out front) and the Trade Fair
 * Complex with its hall and flags. Across the middle the expressway: a container trailer, a goods lorry, danfos, a keke and
 * the orange Hop bus in its bay. Along the bottom: Macaulay's Lounge, the plaza with the map signpost, and the Badagry
 * Heritage Museum beside a bit of creek with a boat. Names, sign and palette come from the place data
 * (src/lib/rooms/hotspotRooms.ts): brown, gold and teal own the facades and the trucks, never the room's big sign.
 *
 * The Hoppaz layer (brand kit, docs/ROOM-TEMPLATES.md "Look"): the market's gate sign is orange; the Hop bus (`hop-bus`)
 * in its bay; the route past the four venue doors in order, the finale at the museum with the bus beside it; the bounce
 * wordmark on the billboard; orange and cream umbrellas over the pure water sellers; one stamp on the plaza. No violet.
 * Same pixel look as the clubhouse: 2 px ink, top-left light, hard shadow to the lower right, flat colour.
 */
const PLACE = hotspotRoomData("ojo-badagry");
const SIGN = PLACE?.sign ?? "IYANA IBA";
const MARKET = PLACE?.hero.name ?? "Alaba International Market";
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["LASU Ojo", "Macaulay's Lounge", "Trade Fair Complex", "Badagry Heritage Museum"];
const PAL = PLACE?.palette ?? { primary: "#4A2C2A", secondary: "#E9C46A", accent: "#2A9D8F" };

const BROWN = PAL.primary;
const BROWN_MID = "#6B4538";
const BROWN_LIGHT = "#8C6552";
const GOLD = PAL.secondary;
const GOLD_DARK = "#B99347";
const GOLD_LIGHT = "#F4DC9C";
const TEAL = PAL.accent;
const TEAL_DARK = "#1E6F65";
const TEAL_LIGHT = "#6CC7BA";

/** Subpaths for a row of identical rectangles: one SVG node instead of one per rectangle. */
const rects = (xs: number[], y: number, w: number, h: number) => xs.map((x) => `M${x} ${y}h${w}v${h}h${-w}Z`).join("");

// ---- The venues and the hero (each drawn in its own box, (0,0) is the box's top-left) ----------------------------------

const SHOP_SIGNS = ["TVS", "SOUND", "FRIDGES", "CABLES", "FANS"];

/** Alaba International Market: five shops under a teal and cream awning, a signboard over each, between two gate pillars carrying the big orange sign. 11 by 5 tiles. */
function Market({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const uw = 58;
  const xs = Array.from({ length: 5 }, (_, i) => 31 + i * uw);
  const size = Math.min(15, (w - 60) / Math.max(1, name.length * 0.72));
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="10" y="30" width={w - 20} height={h - 32} fill={BROWN} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="32" width={w - 24} height="3" fill={BROWN_LIGHT} />
      {/* the upper storey: a signboard over each shop, balconies and air conditioners */}
      <rect x="30" y="36" width="292" height="44" fill={BROWN_MID} />
      <path d={xs.map((x) => `M${x + uw} 36v44`).join("")} stroke={P.ink} strokeWidth="2" />
      <path d={rects(xs.map((x) => x + 6), 58, uw - 12, 18)} fill={P.nightCard} />
      <path d={rects(xs.map((x) => x + 10), 62, 14, 9)} fill={P.paper} />
      <path d={rects(xs.map((x) => x + 32), 62, 14, 9)} fill={P.concrete} />
      {xs.map((x, i) => <Plate key={x} x={x + 4} y={39} w={uw - 8} h={14} text={SHOP_SIGNS[i]} fill={P.night} color={P.paper} size={7.5} />)}
      {/* the ground floor: a long awning and the stalls under it, shutters half down on every other one */}
      <rect x="30" y="82" width="292" height="12" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="94" width="292" height="48" fill={P.nightCard} />
      <path d={xs.map((x) => `M${x + uw} 94v48`).join("")} stroke={P.ink} strokeWidth="2" />
      <path d={rects(xs.map((x) => x + 8), 112, 20, 16)} fill={P.nightDim} />
      <path d={rects(xs.map((x) => x + 10), 114, 16, 10)} fill={P.slate} />
      <path d={rects(xs.map((x) => x + 34), 102, 16, 28)} fill={P.nightLine} />
      <path d={rects(xs.map((x) => x + 38), 106, 8, 8).concat(rects(xs.map((x) => x + 38), 118, 8, 8))} fill={P.nightDim} />
      <path d={rects(xs.map((x) => x + 8), 130, 24, 10)} fill={P.woodLight} />
      {[1, 3].map((i) => <rect key={i} x={xs[i] + 2} y="95" width={uw - 4} height="26" fill={`url(#${uid}-shut)`} stroke={P.ink} strokeWidth="1.5" />)}
      <rect x="30" y="142" width="292" height="14" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="32" y="144" width="288" height="3" fill={P.woodLight} />
      {/* the gate: two pillars and the big sign across the top, orange with an ember lip */}
      {[12, w - 28].map((x) => (
        <g key={x}>
          <rect x={x} y="10" width="16" height={h - 14} fill={BROWN_LIGHT} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="16" width="3" height={h - 26} fill={BROWN_MID} />
          <rect x={x - 2} y="8" width="20" height="8" fill={GOLD} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <rect x="24" y="9" width={w - 48} height="30" fill={P.brandEmber} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="5" width={w - 48} height="30" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="27.5" y="8.5" width={w - 55} height="23" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <text x={w / 2} y={20 + size * 0.36} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing=".6">{name.toUpperCase()}</text>
    </g>
  );
}

/** LASU Ojo: a campus gate: two pillars with the name across them, brick wall either side, the lawn and an admin block behind. 7 by 5 tiles. */
function Lasu({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="2" y="2" width={w - 4} height="102" fill={`url(#${uid}-grass)`} stroke={P.ink} strokeWidth="2" />
      <rect x="94" y="62" width="36" height="44" fill={`url(#${uid}-paving)`} />
      {/* the admin block, a flag on its roof */}
      <rect x="38" y="14" width="148" height="52" fill={BROWN_LIGHT} stroke={P.ink} strokeWidth="2" />
      <rect x="38" y="14" width="148" height="10" fill={BROWN} stroke={P.ink} strokeWidth="2" />
      <rect x="40" y="15" width="144" height="3" fill={BROWN_MID} />
      <path d={rects([48, 68, 88, 130, 150, 170].filter((x) => x !== 170), 32, 14, 20)} fill={P.nightCard} />
      <path d={rects([50, 70, 90, 132, 152], 34, 10, 7)} fill={GOLD_LIGHT} />
      <rect x="100" y="30" width="24" height="36" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="106" y="40" width="12" height="26" fill={P.nightCard} />
      <rect x="111" y="0" width="2" height="16" fill={P.ink} />
      <rect x="113" y="1" width="14" height="8" fill={TEAL} stroke={P.ink} strokeWidth="1" />
      {/* two trees on the lawn */}
      {[16, 186].map((x) => (
        <g key={x}>
          <rect x={x + 8} y="52" width="6" height="14" fill={P.woodDark} />
          <rect x={x} y="26" width="22" height="28" fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="29" width="14" height="12" fill={P.leaf} />
          <rect x={x + 5} y="31" width="6" height="4" fill={P.mint} />
        </g>
      ))}
      {/* the boundary wall and the gate */}
      {[2, 154].map((x) => (
        <g key={x}>
          <rect x={x} y="110" width="68" height="44" fill={BROWN_MID} stroke={P.ink} strokeWidth="2" />
          <rect x={x - 2} y="104" width="72" height="8" fill={GOLD_LIGHT} stroke={P.ink} strokeWidth="2" />
          <path d={`M${x + 2} 122H${x + 66}M${x + 2} 134H${x + 66}M${x + 18} 112V122M${x + 46} 124V134M${x + 24} 136V152`} stroke={BROWN} strokeWidth="2" />
        </g>
      ))}
      <rect x="96" y="108" width="32" height="46" fill={P.nightCard} />
      <rect x="96" y="110" width="32" height="44" fill={`url(#${uid}-bars)`} />
      <rect x="96" y="148" width="32" height="8" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      {[68, 128].map((x) => (
        <g key={x}>
          <rect x={x} y="84" width="28" height="70" fill={BROWN} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 4} y="90" width="4" height="60" fill={BROWN_LIGHT} />
          <rect x={x - 2} y="80" width="32" height="8" fill={GOLD} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <Plate x={64} y={88} w={96} h={20} text={name} fill={P.night} color={P.paper} />
    </g>
  );
}

/** Trade Fair Complex: a big hall under a stepped teal roof, bunting along its front and a glass entrance. 7 by 5 tiles. */
function TradeFair({ w, h, name }: { w: number; h: number; name: string }) {
  const bunt = (offset: number) => Array.from({ length: 4 }, (_, k) => `M${16 + (k * 4 + offset) * 12} 78h12l-6 10Z`).join("");
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="10" y="30" width={w - 20} height="16" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="20" width={w - 60} height="12" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="58" y="8" width={w - 116} height="14" fill={TEAL_DARK} stroke={P.ink} strokeWidth="2" />
      <path d={`M12 32h${w - 24}M32 22h${w - 64}M60 10h${w - 120}`} stroke={TEAL_LIGHT} strokeWidth="3" />
      <rect x="6" y="46" width={w - 12} height="106" fill={GOLD} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="48" width="4" height="102" fill={GOLD_LIGHT} />
      <rect x="6" y="140" width={w - 12} height="12" fill={BROWN_MID} stroke={P.ink} strokeWidth="2" />
      <Plate x={34} y={52} w={w - 68} h={20} text={name} fill={P.night} color={P.paper} />
      {/* bunting along the hall, four colours of the place */}
      <path d={`M10 76Q${w / 2} 90 ${w - 10} 76`} fill="none" stroke={P.ink} strokeWidth="1" />
      <path d={bunt(0)} fill={TEAL} />
      <path d={bunt(1)} fill={P.paper} />
      <path d={bunt(2)} fill={BROWN} />
      <path d={bunt(3)} fill={GOLD_LIGHT} />
      {/* wings: tall windows */}
      <path d={rects([16, 36, 168, 188], 100, 16, 30)} fill={P.nightCard} stroke={P.ink} strokeWidth="1.5" />
      <path d={rects([19, 39, 171, 191], 103, 5, 12)} fill={GOLD_LIGHT} />
      {/* the entrance: a canopy, glass doors and steps */}
      <rect x="62" y="92" width="100" height="10" fill={BROWN} stroke={P.ink} strokeWidth="2" />
      <rect x="70" y="102" width="84" height="40" fill={P.nightCard} stroke={P.ink} strokeWidth="2" />
      <path d="M98 102V142M126 102V142" stroke={P.ink} strokeWidth="2" />
      <path d={rects([74, 102, 130], 106, 20, 14)} fill={P.paper} opacity=".35" />
      <rect x="62" y="142" width="100" height="10" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Macaulay's Lounge: a dark brown frontage, the name on a night plate, warm windows, string lights and a striped door awning. 6 by 4 tiles. */
function Lounge({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="2" y="12" width={w - 4} height={h - 14} fill={BROWN} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="2" width={w} height="14" fill={BROWN_MID} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="4" width={w - 4} height="3" fill={BROWN_LIGHT} />
      <Plate x={18} y={20} w={w - 36} h={20} text={name} fill={P.night} color={P.paper} />
      <StringLights x1={6} x2={w - 6} y={44} sag={4} bulbs={8} colors={[GOLD_LIGHT, P.paper, GOLD]} />
      {[10, w - 62].map((x) => (
        <g key={x}>
          <rect x={x} y="60" width="52" height="46" fill={GOLD} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="63" width="46" height="4" fill={GOLD_LIGHT} />
          <path d={`M${x + 3} 80H${x + 49}M${x + 3} 94H${x + 49}`} stroke={GOLD_DARK} strokeWidth="2" />
          <path d={rects([x + 8, x + 16, x + 24, x + 36], 70, 4, 10).concat(rects([x + 10, x + 20, x + 30, x + 40], 84, 4, 10))} fill={BROWN} />
          <path d={`M${x + 26} 61V105`} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <rect x={w / 2 - 26} y="54" width="52" height="12" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 16} y="66" width="32" height="46" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 12} y="70" width="24" height="42" fill={BROWN_MID} />
      <rect x={w / 2 + 6} y="88" width="3" height="6" fill={P.paper} />
      <rect x="0" y={h - 12} width={w} height="10" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Badagry Heritage Museum: a whitewashed colonial front under a tiled hip roof, a columned veranda with shuttered bays and steps. 7 by 4 tiles. */
function Museum({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const cols = Array.from({ length: 6 }, (_, i) => 12 + i * 40);
  const bays = [0, 1, 3, 4].map((i) => 22 + i * 40);
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <path d={`M2 34L26 4H${w - 26}L${w - 2} 34Z`} fill={`url(#${uid}-tile)`} stroke={P.ink} strokeWidth="2" />
      <rect x="26" y="4" width={w - 52} height="4" fill={BROWN} />
      <rect x="2" y="31" width={w - 4} height="4" fill={BROWN} />
      <rect x="6" y="35" width={w - 12} height={h - 37} fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <Plate x={17} y={39} w={w - 34} h={18} text={name} fill={P.night} color={P.paper} />
      <rect x="6" y="60" width={w - 12} height="5" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <rect x="22" y="65" width={w - 44} height={h - 75} fill={P.nightCard} />
      {bays.map((x) => <rect key={x} x={x + 4} y="71" width="22" height="34" fill={`url(#${uid}-shut)`} stroke={P.ink} strokeWidth="1.5" />)}
      <rect x="102" y="73" width="30" height="42" fill={TEAL_DARK} stroke={P.ink} strokeWidth="2" />
      <rect x="107" y="78" width="9" height="14" fill={P.nightCard} /><rect x="118" y="78" width="9" height="14" fill={P.nightCard} />
      {cols.map((x) => (
        <g key={x}>
          <rect x={x} y="62" width="10" height="54" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
          <rect x={x + 2} y="64" width="2" height="50" fill={P.cream} />
        </g>
      ))}
      <path d={cols.map((x) => `M${x - 2} 60h14v4h-14ZM${x - 2} 114h14v4h-14Z`).join("")} fill={P.stone} stroke={P.ink} strokeWidth="1" />
      <rect x="92" y="116" width="48" height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="84" y="122" width="64" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

// ---- Street objects -------------------------------------------------------------------------------------------------------

const DESTINATIONS = ["BADAGRY", "OJO", "IBA", "SEME"];

/** A danfo: yellow, the black stripe, a roof rack. Faces right; odd variants face left. 3 by 1 tiles. */
function Danfo({ w, h, v }: { w: number; h: number; v: number }) {
  const left = v % 2 === 1;
  return (
    <g>
      <g transform={left ? `translate(${w},0) scale(-1,1)` : undefined}>
        <rect x="6" y="21" width={w - 6} height="12" fill={P.shadow} opacity=".25" />
        <path d={`M12 3H${w - 34}M16 3v4M${w - 38} 3v4`} stroke={P.ink} strokeWidth="2" />
        <rect x="1" y="4" width={w - 2} height={h - 10} fill={P.danfo} stroke={P.ink} strokeWidth="2" />
        <rect x="3" y="5" width={w - 6} height="3" fill={P.paper} opacity=".45" />
        <path d={rects([6, 23, 40, 57], 9, 14, 8)} fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
        <rect x={w - 24} y="9" width="18" height="8" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
        <rect x="2" y="18" width={w - 4} height="4" fill={P.ink} />
        <rect x="2" y="22" width={w - 4} height="3" fill={P.danfoDark} />
        <rect x={w - 5} y="19" width="3" height="3" fill={P.paper} />
        <circle cx="20" cy="27" r="5" fill={P.ink} /><circle cx="20" cy="27" r="2" fill={P.concrete} />
        <circle cx={w - 22} cy="27" r="5" fill={P.ink} /><circle cx={w - 22} cy="27" r="2" fill={P.concrete} />
      </g>
      <Plate x={left ? 6 : w - 38} y={-4} w={32} h={9} text={DESTINATIONS[v % DESTINATIONS.length]} fill={P.night} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A keke: a yellow body, a black canopy, one wheel in front. Faces right (variant 1 left). 2 by 1 tiles. */
function Keke({ w, flip }: { w: number; flip: boolean }) {
  return (
    <g transform={flip ? `translate(${w},0) scale(-1,1)` : undefined}>
      <rect x="6" y="21" width={w - 6} height="10" fill={P.shadow} opacity=".25" />
      <rect x="4" y="12" width={w - 10} height="13" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 20} height="10" fill={P.ink} />
      <rect x="4" y="3" width={w - 24} height="2" fill={P.cap} />
      <rect x="8" y="14" width="24" height="8" fill={P.nightCard} />
      <path d={`M${w - 18} 12L${w - 8} 15V24H${w - 18}Z`} fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <circle cx="16" cy="26" r="5" fill={P.ink} /><circle cx="16" cy="26" r="2" fill={P.concrete} />
      <circle cx={w - 12} cy="27" r="4" fill={P.ink} />
    </g>
  );
}

/** A container trailer: a teal corrugated box on a long chassis behind a gold cab. 6 by 2 tiles. */
function Trailer({ w, uid }: { w: number; uid: string }) {
  const cab = w - 54;
  return (
    <g>
      <rect x="8" y="46" width={w - 8} height="14" fill={P.shadow} opacity=".28" />
      <rect x="4" y="48" width={w - 10} height="6" fill={P.ink} />
      <rect x="4" y="4" width={cab - 8} height="46" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="6" width={cab - 12} height="42" fill={`url(#${uid}-rib)`} />
      <rect x="6" y="6" width={cab - 12} height="3" fill={TEAL_LIGHT} />
      <rect x="6" y="42" width={cab - 12} height="6" fill={TEAL_DARK} />
      <path d="M9 8V46M13 8V46" stroke={TEAL_DARK} strokeWidth="1.5" />
      <rect x={cab - 6} y="-6" width="5" height="36" fill={P.ink} />
      <path d={`M${cab} 52V22L${cab + 10} 14H${w - 14}L${w - 4} 30V52Z`} fill={GOLD} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cab + 12} 18H${w - 17}L${w - 9} 30H${cab + 12}Z`} fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
      <rect x={cab + 2} y="14" width="8" height="3" fill={GOLD_LIGHT} />
      <rect x={cab} y="46" width={w - cab - 2} height="6" fill={P.ink} />
      {[24, 44, cab + 12, w - 20].map((x) => (
        <g key={x}>
          <circle cx={x} cy="55" r="7" fill={P.ink} />
          <circle cx={x} cy="55" r="3" fill={P.concrete} />
        </g>
      ))}
    </g>
  );
}

/** A goods lorry: a flatbed with cartons strapped on and a brown cab, faces right. 5 by 1 tiles. */
function Lorry({ w }: { w: number }) {
  return (
    <g>
      <rect x="8" y="22" width={w - 8} height="10" fill={P.shadow} opacity=".28" />
      <rect x="2" y="20" width={w - 40} height="6" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="-4" width="34" height="24" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="44" y="4" width="30" height="16" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="78" y="-10" width="34" height="30" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M23 -4V20M59 4V20M95 -10V20M6 8H40M78 4H112" stroke={P.woodDark} strokeWidth="2" />
      <rect x="10" y="0" width="10" height="6" fill={P.paper} />
      <rect x="82" y="-6" width="10" height="6" fill={P.paper} />
      <path d={`M${w - 38} 26V6L${w - 30} 0H${w - 8}L${w - 2} 14V26Z`} fill={BROWN_LIGHT} stroke={P.ink} strokeWidth="2" />
      <path d={`M${w - 28} 4H${w - 11}L${w - 6} 14H${w - 28}Z`} fill={P.slateLight} stroke={P.ink} strokeWidth="1.5" />
      <circle cx="26" cy="27" r="5" fill={P.ink} /><circle cx="26" cy="27" r="2" fill={P.concrete} />
      <circle cx="94" cy="27" r="5" fill={P.ink} /><circle cx="94" cy="27" r="2" fill={P.concrete} />
      <circle cx={w - 18} cy="27" r="5" fill={P.ink} /><circle cx={w - 18} cy="27" r="2" fill={P.concrete} />
    </g>
  );
}

/** Televisions stacked on the pavement, two and one. 2 by 1 tiles. */
function TvStack() {
  const tvs = [[4, 12], [34, 12], [18, -6]];
  return (
    <g>
      <rect x="6" y="28" width="58" height="4" fill={P.shadow} opacity=".28" />
      <path d={tvs.map(([x, y]) => `M${x} ${y}h26v18h-26Z`).join("")} fill={P.ink} stroke={P.shadow} strokeWidth="1" />
      <path d={tvs.map(([x, y]) => `M${x + 3} ${y + 3}h20v10h-20Z`).join("")} fill={P.slate} />
      <path d={tvs.map(([x, y]) => `M${x + 4} ${y + 4}h6v2h-6Z`).join("")} fill={P.slateLight} />
      <path d={tvs.map(([x, y]) => `M${x + 8} ${y + 15}h10v2h-10Z`).join("")} fill={P.cap} />
    </g>
  );
}

/** A stack of speaker cabinets, three high. 1 by 1 tile. */
function SpeakerStack() {
  return (
    <g>
      <rect x="5" y="27" width="26" height="5" fill={P.shadow} opacity=".28" />
      {[12, -6, -24].map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="24" height="18" fill={P.ink} stroke={P.shadow} strokeWidth="1.5" />
          <rect x="6" y={y + 2} width="3" height="14" fill={P.cap} />
          <circle cx="18" cy={y + 9} r="6" fill={P.wall} stroke={P.shadow} strokeWidth="1.5" />
          <circle cx="18" cy={y + 9} r="2.5" fill={P.slate} />
        </g>
      ))}
    </g>
  );
}

/** Two fridges on the pavement, one taller. 2 by 1 tiles. */
function FridgeRow() {
  return (
    <g>
      <rect x="6" y="28" width="58" height="4" fill={P.shadow} opacity=".28" />
      {[[4, -18, 28, 48], [36, -8, 26, 38]].map(([x, y, fw, fh]) => (
        <g key={x}>
          <rect x={x} y={y} width={fw} height={fh} fill={P.paper} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 2} y={y + 2} width="4" height={fh - 4} fill={P.cream} />
          <path d={`M${x} ${y + fh * 0.36}H${x + fw}`} stroke={P.ink} strokeWidth="2" />
          <rect x={x + fw - 8} y={y + 5} width="3" height="10" fill={P.cap} />
          <rect x={x + fw - 8} y={y + fh * 0.36 + 5} width="3" height="12" fill={P.cap} />
        </g>
      ))}
    </g>
  );
}

/** A handcart loaded with cartons. 2 by 1 tiles (the handle sticks out). */
function Handcart() {
  return (
    <g>
      <rect x="6" y="26" width="58" height="6" fill={P.shadow} opacity=".28" />
      <rect x="6" y="0" width="22" height="16" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="5" width="24" height="11" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M17 0V16M42 5V16M6 8H28" stroke={P.woodDark} strokeWidth="2" />
      <rect x="4" y="16" width="52" height="6" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M56 19L70 10" stroke={P.ink} strokeWidth="3" />
      <circle cx="16" cy="26" r="5" fill={P.ink} /><circle cx="16" cy="26" r="2" fill={P.concrete} />
      <circle cx="44" cy="26" r="5" fill={P.ink} /><circle cx="44" cy="26" r="2" fill={P.concrete} />
    </g>
  );
}

/** A pure water seller's table under an orange and cream umbrella: sachets stacked in trays. 2 by 1 tiles. */
function WaterUmbrella({ w, v }: { w: number; v: number }) {
  const cx = w / 2;
  const r = cx - 3;
  return (
    <g>
      <ellipse cx={cx + 4} cy="29" rx={cx - 8} ry="3" fill={P.shadow} opacity=".25" />
      <rect x={cx - 1} y="4" width="3" height="18" fill={P.ink} />
      <rect x={cx - 14} y="17" width="28" height="10" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 12} y="18" width="24" height="3" fill={P.paper} />
      <path d={rects([cx - 11, cx - 3, cx + 5], 12, 7, 5)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <path d={`M${cx - r} 12C${cx - r} -6 ${cx + r} -6 ${cx + r} 12Z`} fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <path d={`M${cx - r * 0.62} 11L${cx - r * 0.3} -2H${cx - r * 0.05}L${cx - r * 0.25} 11ZM${cx + r * 0.3} 11L${cx + r * 0.1} -2H${cx + r * 0.36}L${cx + r * 0.66} 11Z`} fill={P.paper} transform={v ? `translate(${-r * 0.08} 0)` : undefined} />
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
      <rect x="26" y="-30" width="10" height="3" fill={GOLD_LIGHT} />
    </g>
  );
}

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

/** A pole with a flag at the top: three vertical bands, the place's green-white-green in teal and cream. */
function Flagpole() {
  return (
    <g>
      <rect x="8" y="27" width="20" height="5" fill={P.shadow} opacity=".28" />
      <rect x="10" y="24" width="12" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="15" y="-52" width="3" height="76" fill={P.ink} />
      <rect x="18" y="-52" width="30" height="18" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <rect x="18" y="-52" width="10" height="18" fill={TEAL} />
      <rect x="38" y="-52" width="10" height="18" fill={TEAL} />
      <circle cx="16.5" cy="-54" r="3" fill={GOLD} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A generator humming on the pavement: a gold housing, a black exhaust and a puff. */
function Generator() {
  return (
    <g>
      <rect x="6" y="26" width="26" height="5" fill={P.shadow} opacity=".28" />
      <rect x="2" y="26" width="28" height="4" fill={P.ink} />
      <rect x="3" y="10" width="26" height="17" fill={GOLD} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="12" width="22" height="4" fill={GOLD_LIGHT} />
      <rect x="7" y="19" width="10" height="6" fill={P.ink} />
      <circle cx="23" cy="21" r="3" fill={P.ink} />
      <rect x="22" y="-4" width="4" height="14" fill={P.ink} />
      <rect x="20" y="-12" width="8" height="6" fill={P.paper} opacity=".5" />
    </g>
  );
}

/** The bus stop by the bay: a teal disc sign on a pole and the stop's name on a night plate. 1 by 2 tiles. */
function BusStop({ h }: { h: number }) {
  return (
    <g>
      <rect x="14" y="30" width="14" height={h - 32} fill={P.shadow} opacity=".25" />
      <rect x="9" y={h - 8} width="14" height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="14" width="4" height={h - 22} fill={P.cap} stroke={P.ink} strokeWidth="1" />
      <rect x="3" y="0" width="26" height="15" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <text x="16" y="11.5" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="8">BUS</text>
      <Plate x={-6} y={18} w={44} h={9} text="Apple Bite" fill={P.night} color={P.paper} mono size={5} />
    </g>
  );
}

/** The direction sign at the top of the Lasu-Isheri Road: the room's sign on a teal board between two posts. 3 by 1 tiles. */
function RoadSign({ w, sign }: { w: number; sign: string }) {
  return (
    <g>
      <rect x="10" y="12" width={w - 8} height="20" fill={P.shadow} opacity=".25" />
      <rect x="8" y="10" width="6" height="22" fill={P.ink} />
      <rect x={w - 14} y="10" width="6" height="22" fill={P.ink} />
      <rect x="2" y="-18" width={w - 4} height="34" fill={TEAL} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="-15" width={w - 10} height="28" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <text x={w / 2} y="-3" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="13" letterSpacing="1">{sign}</text>
      <text x={w / 2} y="9" textAnchor="middle" fill={P.paper} fontFamily={FONT.mono} fontSize="6" letterSpacing=".8">LASU-ISHERI RD</text>
    </g>
  );
}

/** A fishing boat on the creek: a brown hull with a teal strake, a low cabin and a pole. 3 by 1 tiles. */
function Boat({ w }: { w: number }) {
  return (
    <g>
      <rect x="8" y="22" width={w - 14} height="8" fill={P.lagoonDark} opacity=".5" />
      <path d={`M4 12H${w - 6}L${w - 18} 26H16Z`} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d={`M7 15H${w - 9}`} stroke={TEAL} strokeWidth="3" />
      <rect x="30" y="2" width="22" height="11" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="34" y="5" width="14" height="4" fill={P.slate} />
      <rect x="62" y="-12" width="2" height="25" fill={P.ink} />
      <path d="M64 -12h14l-4 6 4 6H64Z" fill={P.paper} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The Hoppaz billboard: the bounce wordmark on night, one brand line on the strip, on two legs. 4 by 2 tiles. */
function Billboard({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="8" y="30" width={w - 6} height={h - 30} fill={P.shadow} opacity=".25" />
      <rect x="16" y="40" width="5" height={h - 42} fill={P.ink} />
      <rect x={w - 21} y="40" width="5" height={h - 42} fill={P.ink} />
      <BrandSign x={2} y={0} w={w - 4} h={46} wordmark tone="night" sub={BRAND_LINES.hop} />
    </g>
  );
}

// ---- The room --------------------------------------------------------------------------------------------------------------

export default function HotspotOjoBadagryArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const fill = (name: string) => `url(#${uid}-${name})`;
  const t = (n: number) => n * tile;
  const stem = { x: t(8), w: t(3) };

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    hero: (p, tl) => <Market w={p.w * tl} h={p.h * tl} uid={uid} name={MARKET} />,
    "venue-1": (p, tl) => <Lasu w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[0]} />,
    "venue-2": (p, tl) => <Lounge w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[1]} />,
    "venue-3": (p, tl) => <TradeFair w={p.w * tl} h={p.h * tl} name={NAMES[2]} />,
    "venue-4": (p, tl) => <Museum w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[3]} />,
    hopbus: (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} />,
    billboard: (p, tl) => <Billboard w={p.w * tl} h={p.h * tl} />,
    roadsign: (p, tl) => <RoadSign w={p.w * tl} sign={SIGN} />,
    danfo: (p, tl) => <Danfo w={p.w * tl} h={p.h * tl} v={p.variant ?? 0} />,
    keke: (p, tl) => <Keke w={p.w * tl} flip={(p.variant ?? 0) === 1} />,
    trailer: (p, tl) => <Trailer w={p.w * tl} uid={uid} />,
    lorry: (p, tl) => <Lorry w={p.w * tl} />,
    tvstack: () => <TvStack />,
    speakerstack: () => <SpeakerStack />,
    fridgerow: () => <FridgeRow />,
    handcart: () => <Handcart />,
    umbrella: (p, tl) => <WaterUmbrella w={p.w * tl} v={p.variant ?? 0} />,
    streetlamp: () => <StreetLamp />,
    palm: () => <g transform="translate(16,30)"><TallPalm /></g>,
    flagpole: () => <Flagpole />,
    generator: () => <Generator />,
    busstop: (p, tl) => <BusStop h={p.h * tl} />,
    boat: (p, tl) => <Boat w={p.w * tl} />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["paving", "asphalt", "concrete", "grass", "deck", "water"]} />
      <defs>
        <pattern id={`${uid}-awn`} width="16" height="12" patternUnits="userSpaceOnUse"><rect width="8" height="12" fill={TEAL} /><rect x="8" width="8" height="12" fill={P.paper} /></pattern>
        <pattern id={`${uid}-shut`} width="6" height="4" patternUnits="userSpaceOnUse"><rect width="6" height="4" fill={TEAL} /><rect y="2" width="6" height="1" fill={TEAL_DARK} /></pattern>
        <pattern id={`${uid}-rib`} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={TEAL} /><rect x="5" width="2" height="8" fill={TEAL_DARK} /><rect x="1" width="1" height="8" fill={TEAL_LIGHT} /></pattern>
        <pattern id={`${uid}-bars`} width="6" height="16" patternUnits="userSpaceOnUse"><rect x="2" width="2" height="16" fill={P.night} /></pattern>
        <pattern id={`${uid}-tile`} width="12" height="8" patternUnits="userSpaceOnUse"><rect width="12" height="8" fill={BROWN_MID} /><path d="M0 4H12M6 0V4M0 4V8" stroke={BROWN} strokeWidth="1" /></pattern>
      </defs>

      {/* The ground: a dark frame, pale pavement inside it, the plaza, the expressway and the road going up between LASU and the market. */}
      <Frame layout={layout} ground={P.nightCard} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={fill("paving")} stroke={P.ink} strokeWidth="4" />
      <rect x={t(7)} y={t(15)} width={t(12)} height={t(4)} fill={fill("concrete")} stroke={P.ink} strokeWidth="2" />
      <rect x={tile} y={t(9) - 6} width={W - tile * 2} height={t(5) + 12} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x={tile} y={t(9)} width={W - tile * 2} height={t(5)} fill={fill("asphalt")} />
      <rect x={stem.x - 6} y={tile} width={stem.w + 12} height={t(8)} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x={stem.x} y={tile} width={stem.w} height={t(8) + 8} fill={fill("asphalt")} />
      {/* Road paint: lane dashes, the centre line, the stem's centre line. */}
      <path d={`M${tile} ${t(10)}H${W - tile}M${tile} ${t(13) - 0}H${W - tile}`} stroke={P.paper} strokeWidth="2" strokeDasharray="14 10" opacity=".7" />
      <path d={`M${tile} ${t(11) + 14}H${W - tile}M${tile} ${t(11) + 20}H${W - tile}`} stroke={P.paper} strokeWidth="2" opacity=".75" />
      <path d={`M${stem.x + stem.w / 2} ${tile + 8}V${t(9) - 12}`} stroke={P.paper} strokeWidth="2" strokeDasharray="14 10" opacity=".7" />
      <HopBay x={t(17)} y={t(12)} w={t(5)} h={t(2)} />

      {/* The Badagry creek beside the museum, and the dock on the kerb above it. */}
      {layout.walls.map((b, i) => (
        <g key={i}>
          <rect x={t(b.x) - 5} y={t(b.y) - 5} width={t(b.w) + 5} height={t(b.h) + 10} fill={P.stone} stroke={P.ink} strokeWidth="2" />
          <rect x={t(b.x)} y={t(b.y)} width={t(b.w)} height={t(b.h)} fill={fill("water")} stroke={P.ink} strokeWidth="2" />
          <rect x={t(b.x) + 2} y={t(b.y) + 2} width={t(b.w) - 4} height="8" fill={P.lagoonDark} opacity=".35" />
        </g>
      ))}
      <rect x={t(26)} y={t(14)} width={t(3)} height={tile - 4} fill={fill("deck")} stroke={P.ink} strokeWidth="2" />

      {/* The Hop's route: LASU's gate, Macaulay's door, up the road and along the shops to the Trade Fair, then down to the museum and the bus. */}
      <RouteLine points={[[144, 240], [144, 464], [304, 464, 0], [304, 240, 0], [816, 240], [816, 464, 0], [720, 464]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* A rubber stamp on the plaza, under the spawn. */}
      <Stamp x={t(12) + 16} y={t(18) + 12} text={BRAND_LINES.wait} size={6.5} rotate={-4} />
    </svg>
  );
}
