import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { BRAND_LINES, Defs, Floor, FONT, HopFlyer, HoppazWordmark, Lineup, P, Props, RouteLine, Shade, Stamp, type RoomArtProps } from "./kit";

/**
 * Pool party: a hotel or villa pool in the afternoon sun. Daytime and loud next to the night rooms: turquoise water, white
 * tile and wall, wood deck, bright palm greens, orange and night. Same pixel look as the clubhouse (2 px ink outlines, top
 * left light, lower right hard shadow, flat colour, crispEdges). The flyer and the line-up hang on the white back wall.
 * Hoppaz owns the designed surfaces (orange first, night and cream); the water, deck, lawn and palms stay natural, and the
 * flamingo and the danfo yellow are the two colour punches.
 */

/** Day colours the clubhouse kit does not have: pool turquoise, silver chrome and straw. */
const T = { turq: "#35C2D4", turqDark: "#1A9DB8", turqLight: "#8FF0F0", aqua: "#58B6D8", silver: "#DDE6EA", straw: "#D9B45E", strawDark: "#A9823A", strawLight: "#EBD088", pink: "#FF8E8E", pinkLight: "#FFC2B8" } as const;
/** Float, lounger and parasol accents by variant: orange, night, and the danfo yellow punch. */
const ACCENT = [P.orange, P.night, P.danfo] as const;

/** A pie wedge from angle a0 to a1 (degrees) of a circle: parasol segments and the beach ball. */
const wedge = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const pt = (a: number) => `${(cx + r * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(cy + r * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
  return `M${cx} ${cy}L${pt(a0)}A${r} ${r} 0 0 1 ${pt(a1)}Z`;
};

/** Bunting flags hung from a sagging line, as three paths (one per colour) so the whole garland is a handful of nodes. */
function buntingPaths(x1: number, x2: number, y: number, sag: number, step: number) {
  const out = ["", "", ""];
  const n = Math.floor((x2 - x1) / step);
  for (let i = 0; i < n; i++) {
    const xa = x1 + i * step;
    const xb = xa + step - 4;
    const t = (xa + step / 2 - x1) / (x2 - x1);
    const yy = y + Math.sin(t * Math.PI) * sag;
    out[i % 3] += `M${xa} ${yy.toFixed(1)}H${xb}L${(xa + xb) / 2} ${(yy + 12).toFixed(1)}Z`;
  }
  return out;
}

/** The pool: coping, tiled waterline, water, a deep end with a lane rope, steps, two ladders and a few floats. */
function Pool({ w, h, uid }: { w: number; h: number; uid: string }) {
  const u = (n: string) => `url(#${uid}-${n})`;
  const wx = 15;
  const wy = 15;
  const ww = w - 30;
  const wh = h - 30;
  const deep = wx + Math.round(ww * 0.58);
  return (
    <g>
      <rect x="6" y="8" width={w - 2} height={h - 2} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height={h} fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height="3" fill={P.paper} />
      <rect x="9" y="9" width={w - 18} height={h - 18} fill={u("pooltile")} stroke={P.ink} strokeWidth="2" />
      <rect x={wx} y={wy} width={ww} height={wh} fill={T.turq} />
      <rect x={wx} y={wy} width={ww} height={wh} fill={u("water")} opacity=".4" />
      <rect x={deep} y={wy} width={wx + ww - deep} height={wh} fill={T.turqDark} opacity=".35" />
      {/* The room's wordmark, painted on the pool floor under the water: it always shows. */}
      <g opacity=".5"><HoppazWordmark x={200} y={52} h={20} fill={P.paper} anchor="middle" /></g>
      {/* Steps in the shallow corner, a lane rope where the deep end starts. */}
      <rect x={wx} y={wy} width="46" height="38" fill="#9FE3F0" stroke={P.ink} strokeWidth="1" />
      <rect x={wx} y={wy} width="31" height="38" fill="#C7F0F7" stroke={P.ink} strokeWidth="1" />
      <rect x={wx} y={wy} width="16" height="38" fill="#EAFBFD" stroke={P.ink} strokeWidth="1" />
      <path d={`M${deep} ${wy}V${wy + wh}`} stroke={P.paper} strokeWidth="4" />
      <path d={`M${deep} ${wy}V${wy + wh}`} stroke={P.red} strokeWidth="4" strokeDasharray="8 8" />
      <text x="26" y="7.5" fill={P.ink} fontFamily={FONT.mono} fontSize="6" fontWeight="700">1.0M</text>
      <text x={w - 46} y="7.5" fill={P.ink} fontFamily={FONT.mono} fontSize="6" fontWeight="700">2.4M</text>
      {/* Two chrome ladders, one on the top edge and one on the bottom edge. */}
      {[{ x: 300, y: 0, s: 1 }, { x: 84, y: h, s: -1 }].map((l) => (
        <g key={l.x} transform={`translate(${l.x},${l.y}) scale(1,${l.s})`}>
          <rect x="0" y="-8" width="4" height="34" fill={T.silver} stroke={P.ink} strokeWidth="1" />
          <rect x="14" y="-8" width="4" height="34" fill={T.silver} stroke={P.ink} strokeWidth="1" />
          <rect x="4" y="8" width="10" height="3" fill={T.silver} stroke={P.ink} strokeWidth="1" />
          <rect x="4" y="18" width="10" height="3" fill={T.silver} stroke={P.ink} strokeWidth="1" />
        </g>
      ))}
      {/* Floats: a yellow lilo, a flamingo, a striped ring, a beach ball. */}
      <g transform="translate(78,50)">
        <rect x="3" y="4" width="46" height="20" fill={T.turqDark} opacity=".5" />
        <rect x="0" y="0" width="46" height="20" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
        <rect x="4" y="3" width="38" height="3" fill={P.paper} opacity=".7" />
        <rect x="0" y="9" width="46" height="3" fill={P.paper} />
        <rect x="36" y="3" width="8" height="14" fill={P.orange} />
      </g>
      <g transform="translate(102,128)">
        <ellipse cx="3" cy="6" rx="28" ry="15" fill={T.turqDark} opacity=".5" />
        <path d="M14 -4C28 -6 30 -22 22 -28" fill="none" stroke={P.ink} strokeWidth="10" />
        <ellipse cx="0" cy="0" rx="25" ry="15" fill={T.pink} stroke={P.ink} strokeWidth="2" />
        <path d="M14 -4C28 -6 30 -22 22 -28" fill="none" stroke={T.pink} strokeWidth="6" />
        <ellipse cx="-6" cy="-5" rx="11" ry="4" fill={T.pinkLight} />
        <path d="M-22 -2h-8M-22 3h-9" stroke={P.ink} strokeWidth="3" />
        <rect x="16" y="-37" width="13" height="11" fill={T.pink} stroke={P.ink} strokeWidth="2" />
        <rect x="29" y="-35" width="9" height="4" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
        <rect x="21" y="-34" width="3" height="3" fill={P.ink} />
      </g>
      <g transform="translate(290,92)">
        <circle cx="3" cy="5" r="17" fill="none" stroke={T.turqDark} strokeWidth="14" opacity=".5" />
        <circle cx="0" cy="0" r="16" fill="none" stroke={P.ink} strokeWidth="14" />
        <circle cx="0" cy="0" r="16" fill="none" stroke={P.orange} strokeWidth="10" />
        <circle cx="0" cy="0" r="16" fill="none" stroke={P.paper} strokeWidth="10" strokeDasharray="8 17" />
      </g>
      <g transform="translate(246,142)">
        <ellipse cx="3" cy="5" rx="11" ry="5" fill={T.turqDark} opacity=".5" />
        <circle r="10" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d={wedge(0, 0, 9, -90, -10)} fill={P.orange} />
        <path d={wedge(0, 0, 9, 110, 190)} fill={P.night} />
        <path d={wedge(0, 0, 9, 190, 270)} fill={P.danfo} />
      </g>
      <path d="M180 46h10M196 52h8M232 112h10M70 92h9M330 150h12M150 160h10" stroke={T.turqLight} strokeWidth="2" />
    </g>
  );
}

/** The cabana bar: thatched roof, striped valance, a shelf of bottles, a menu board and a counter. 6 by 3 tiles. */
function Cabana({ w, h, uid }: { w: number; h: number; uid: string }) {
  const u = (n: string) => `url(#${uid}-${n})`;
  const units = Math.ceil((w + 16) / 16);
  const fringe = `M-8 22${"l8 8l8 -8".repeat(units)}Z`;
  const bottles = [T.aqua, P.danfo, P.ember, P.paper, P.keke, P.orange, T.turqLight, P.danfo];
  return (
    <g>
      <rect x="6" y="12" width={w - 4} height={h - 8} fill={P.shadow} opacity=".25" />
      <rect x="2" y="14" width={w - 4} height={h - 16} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="52" width={w - 12} height="4" fill={P.woodLight} />
      {bottles.map((c, i) => <rect key={i} x={14 + i * 16} y={40 + (i % 3) * 2} width="7" height={12 - (i % 3) * 2} fill={c} stroke={P.ink} strokeWidth="1" />)}
      <rect x={w - 46} y="36" width="38" height="17" fill={P.ink} stroke={P.woodLight} strokeWidth="2" />
      <path d={`M${w - 41} 41h20M${w - 41} 46h14`} stroke={P.paper} strokeWidth="2" />
      <rect x={w - 18} y="41" width="5" height="5" fill={P.danfo} />
      <rect x="0" y="22" width="7" height="64" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 7} y="22" width="7" height="64" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="58" width={w} height={h - 58} fill={u("wood")} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="60" width={w - 4} height="10" fill={P.white} />
      <rect x="2" y="60" width={w - 4} height="2" fill={P.paper} />
      <rect x="2" y="72" width={w - 4} height="2" fill={P.woodDark} opacity=".5" />
      <rect x="2" y={h - 8} width={w - 4} height="4" fill={P.orange} />
      <circle cx="40" cy="62" r="6" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="45" y="48" width="2" height="12" fill={P.orange} />
      <rect x="86" y="50" width="8" height="14" fill={T.turqLight} stroke={P.ink} strokeWidth="1" />
      <rect x="90" y="46" width="2" height="8" fill={P.orange} />
      <rect x="108" y="52" width="8" height="12" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x="146" y="54" width="26" height="9" fill={P.slate} stroke={P.ink} strokeWidth="1" />
      {/* Thatched roof with a straw fringe, a ridge, and a striped valance under it. */}
      <path d={`M-8 24L10 -6H${w - 10}L${w + 8} 24Z`} fill={u("thatch")} stroke={P.ink} strokeWidth="2" />
      <path d={fringe} fill={T.strawDark} stroke={P.ink} strokeWidth="1" />
      <rect x="8" y="-10" width={w - 16} height="6" fill={T.strawDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="26" width={w - 4} height="10" fill={u("awn")} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** A sun lounger, 2 by 1: white cushion, a coloured headrest and stripes. */
function Lounger({ w, h, v }: { w: number; h: number; v: number }) {
  const c = ACCENT[v % 3];
  return (
    <g>
      <rect x="5" y="9" width={w - 6} height={h - 10} fill={P.shadow} opacity=".25" />
      <rect x="1" y="5" width={w - 4} height="22" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="7" width="16" height="18" fill={c} />
      <rect x="3" y="7" width="16" height="3" fill={P.paper} opacity=".45" />
      <rect x={w - 24} y="7" width="4" height="18" fill={c} />
      <rect x={w - 14} y="7" width="4" height="18" fill={c} />
      <path d={`M6 27v4M${w - 10} 27v4`} stroke={P.ink} strokeWidth="3" />
    </g>
  );
}

/** A beach parasol on a leaning pole: a round striped canopy that overhangs the lounger beside it. */
function Parasol({ v }: { v: number }) {
  const c = ACCENT[v % 3];
  const cx = 10;
  const cy = -2;
  const r = 25;
  return (
    <g>
      <ellipse cx="23" cy="30" rx="12" ry="3" fill={P.shadow} opacity=".25" />
      <path d={`M19 30L${cx} ${cy}`} stroke={P.ink} strokeWidth="3" />
      <circle cx={cx} cy={cy} r={r} fill={P.paper} stroke={P.ink} strokeWidth="2" />
      {[0, 90, 180, 270].map((a) => <path key={a} d={wedge(cx, cy, r - 1, a, a + 45)} fill={c} />)}
      <circle cx={cx} cy={cy} r="2.5" fill={P.ink} />
    </g>
  );
}

/** A palm: a leaning trunk, a crown of bright fronds, two coconuts. `v` flips the lean. */
function Palm({ v }: { v: number }) {
  const lean = v % 2 ? -1 : 1;
  const cx = 22;
  const cy = -30;
  const fronds: [string, string][] = [
    ["M0 0c-12-22-40-18-50 2c18-10 34-8 50-2Z", P.kekeDark],
    ["M0 0c12-22 40-18 50 2c-18-10-34-8-50-2Z", P.keke],
    ["M0 0c-22-2-38 8-40 24c12-14 24-20 40-24Z", P.keke],
    ["M0 0c22-2 38 8 40 24c-12-14-24-20-40-24Z", P.kekeDark],
    ["M0 0c-8-18-4-32 8-38c2 14 2 26-2 38Z", P.keke],
  ];
  return (
    <g transform={lean === 1 ? undefined : "translate(32,0) scale(-1,1)"}>
      <ellipse cx="26" cy="30" rx="22" ry="5" fill={P.shadow} opacity=".25" />
      <path d={`M12 31Q14 0 ${cx - 4} ${cy + 3}L${cx + 3} ${cy + 3}Q23 2 21 31Z`} fill="#A8794E" stroke={P.ink} strokeWidth="2" />
      <path d="M15 28Q16 2 19 -22" fill="none" stroke="#CFA479" strokeWidth="2" />
      <path d="M13 22h8M14 12h8M16 2h7M18 -8h6M20 -18h5" stroke={P.woodDark} strokeWidth="2" />
      <g transform={`translate(${cx},${cy})`}>
        {fronds.map(([d, c], i) => <path key={i} d={d} fill={c} stroke={P.ink} strokeWidth="2" />)}
        <circle cx="-3" cy="5" r="4" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
        <circle cx="4" cy="6" r="4" fill={P.woodDark} stroke={P.ink} strokeWidth="1" />
      </g>
    </g>
  );
}

/** A potted tropical plant by the towel desk: white pot with an orange band, broad bright leaves and one flower. */
function Planter() {
  return (
    <g>
      <rect x="7" y="26" width="24" height="5" fill={P.shadow} opacity=".25" />
      <path d="M16 18C11 10 4 8 2 0C11 1 15 8 16 18Z" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
      <path d="M16 18C21 10 28 8 30 0C21 1 17 8 16 18Z" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <path d="M16 18C12 8 12 -2 16 -8C20 -2 20 8 16 18Z" fill={P.keke} stroke={P.ink} strokeWidth="2" />
      <circle cx="24" cy="6" r="3" fill={P.ember} stroke={P.ink} strokeWidth="1" />
      <path d="M8 18H24L22 30H10Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="9" y="21" width="14" height="3" fill={P.orange} />
    </g>
  );
}

/** A round cocktail table with a drink, a straw and a lime. Variants 1 and 2 stand under a small striped umbrella. */
function Cocktail({ v }: { v: number }) {
  const c = ACCENT[v % 3];
  return (
    <g>
      <ellipse cx="19" cy="28" rx="10" ry="3.5" fill={P.shadow} opacity=".25" />
      <path d="M14 14h4v14h-4Z" fill={P.ink} />
      <ellipse cx="16" cy="12" rx="13" ry="7" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="3" width="6" height="9" fill={T.turqLight} stroke={P.ink} strokeWidth="1" />
      <rect x="14" y="0" width="2" height="6" fill={P.orange} />
      <circle cx="21" cy="11" r="3" fill={P.keke} stroke={P.ink} strokeWidth="1" />
      {v > 0 && (
        <g>
          <path d="M16 -4V10" stroke={P.ink} strokeWidth="2" />
          <path d="M-6 -2Q16 -22 38 -2Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
          <path d="M-6 -2Q4 -14 16 -17V-2ZM27 -9Q34 -6 38 -2H27Z" fill={c} />
        </g>
      )}
    </g>
  );
}

/** A tall lifeguard chair with a striped canopy, a ladder and a rescue ring. 1 by 2 tiles. */
function Lifeguard() {
  return (
    <g>
      <ellipse cx="18" cy="61" rx="13" ry="3.5" fill={P.shadow} opacity=".25" />
      <path d="M7 32L4 60M25 32L28 60" stroke={P.ink} strokeWidth="3" />
      <path d="M10 42h12M8 51h16M6 58h20" stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="22" width="24" height="10" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="12" width="24" height="12" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="14" width="20" height="4" fill={P.orange} />
      <path d="M-2 11L16-5L34 11Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M16 -5L-2 11H16Z" fill={P.orange} />
      <circle cx="29" cy="40" r="5" fill="none" stroke={P.ink} strokeWidth="6" />
      <circle cx="29" cy="40" r="5" fill="none" stroke={P.paper} strokeWidth="3" />
    </g>
  );
}

/** An outdoor shower: chrome pole and head, drops, a slab and a puddle. 1 by 2 tiles. */
function Shower() {
  return (
    <g>
      <ellipse cx="19" cy="61" rx="12" ry="3.5" fill={P.shadow} opacity=".25" />
      <rect x="7" y="52" width="20" height="8" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="10" width="4" height="43" fill={T.silver} stroke={P.ink} strokeWidth="1" />
      <path d="M16 10V6H24" fill="none" stroke={P.ink} strokeWidth="4" />
      <rect x="20" y="5" width="10" height="5" fill={T.silver} stroke={P.ink} strokeWidth="2" />
      <path d="M22 13v6M26 13v9M30 13v5" stroke={T.turq} strokeWidth="2" />
      <ellipse cx="25" cy="57" rx="6" ry="2" fill={T.turq} />
    </g>
  );
}

/** A cool box of drinks: white body, orange lid. */
function Cooler() {
  return (
    <g>
      <rect x="6" y="12" width="26" height="19" fill={P.shadow} opacity=".25" />
      <rect x="3" y="12" width="26" height="17" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="19" width="22" height="3" fill={P.night} />
      <rect x="2" y="7" width="28" height="7" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="11" y="4" width="10" height="3" fill={P.ink} />
    </g>
  );
}

/** The DJ booth: a white desk with two decks, a mixer and a palm sticker on the front. 4 by 1 tiles. */
function Booth({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="2" width={w - 2} height={h - 4} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="4" width={w - 6} height="15" fill={P.white} />
      <rect x="3" y="4" width={w - 6} height="2" fill={P.paper} />
      <circle cx="30" cy="12" r="8" fill={P.ink} stroke={P.slateLight} strokeWidth="1" />
      <circle cx="30" cy="12" r="2.5" fill={P.orange} />
      <path d="M40 6l-8 6" stroke={P.slateLight} strokeWidth="2" />
      <circle cx={w - 30} cy="12" r="8" fill={P.ink} stroke={P.slateLight} strokeWidth="1" />
      <circle cx={w - 30} cy="12" r="2.5" fill={P.paper} />
      <path d={`M${w - 40} 6l-8 6`} stroke={P.slateLight} strokeWidth="2" />
      <rect x={w / 2 - 14} y="5" width="28" height="13" fill={P.ink} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={w / 2 - 11 + i * 6} y="7" width="3" height="3" fill={[P.orange, P.paper, P.danfo, P.paper][i]} />)}
      <rect x={w / 2 - 10} y="13" width="20" height="2" fill={P.slateLight} />
      <path d={`M10 21c4-8 10-8 12 0c-4-3-8-3-12 0ZM${w - 24} 21c4-8 10-8 12 0c-4-3-8-3-12 0Z`} fill={P.keke} />
      <rect x="3" y={h - 7} width={w - 6} height="3" fill={P.orange} />
    </g>
  );
}

/** The raised DJ platform: wood top, a striped front lip and a step in the middle. 8 by 3 tiles. */
function Platform({ w, h, uid }: { w: number; h: number; uid: string }) {
  const u = (n: string) => `url(#${uid}-${n})`;
  return (
    <g>
      <rect x="5" y="8" width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height={h} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height={h - 16} fill={u("wood")} />
      <rect x="2" y="2" width={w - 4} height="2" fill={P.paper} opacity=".4" />
      <rect x="2" y={h - 12} width={w - 4} height="10" fill={P.woodDark} />
      <rect x="2" y={h - 9} width={w - 4} height="3" fill={P.orange} />
      <rect x={w / 2 - 24} y={h} width="48" height="8" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 16} y={h + 8} width="32" height="6" fill={P.wood} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** A daybed: a wide white mattress with cushions under an orange canopy with a scalloped hem. 3 by 2 tiles. */
function Daybed({ w, h }: { w: number; h: number }) {
  const hem = `M1 12${"l8 7l8 -7".repeat(Math.floor((w - 2) / 16))}Z`;
  return (
    <g>
      <rect x="6" y="14" width={w - 4} height={h - 12} fill={P.shadow} opacity=".25" />
      <rect x="4" y="10" width="4" height="26" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 8} y="10" width="4" height="26" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <path d={hem} fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x="1" y="0" width={w - 2} height="13" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="2" width={w - 6} height="3" fill={P.paper} opacity=".4" />
      <rect x="2" y="24" width={w - 4} height={h - 26} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="26" width={w - 10} height={h - 34} fill={P.white} stroke={P.ink} strokeWidth="1" />
      <rect x="9" y="28" width="18" height="12" fill={P.night} stroke={P.ink} strokeWidth="1" />
      <rect x="29" y="28" width="18" height="12" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 40} y="27" width="31" height={h - 36} fill={P.orange} />
      <rect x={w - 33} y="27" width="4" height={h - 36} fill={P.paper} />
      <rect x={w - 21} y="27" width="4" height={h - 36} fill={P.paper} />
      <path d={`M8 ${h - 14}H${w - 8}`} stroke={P.orange} strokeWidth="2" />
    </g>
  );
}

/** A rack of pool floats: a ring, a flamingo and a rolled lilo leaning on a wooden frame. 2 by 1 tiles. */
function FloatRack({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="2" y="3" width="5" height={h - 4} fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 7} y="3" width="5" height={h - 4} fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="5" width={w - 4} height="4" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <circle cx="20" cy="20" r="8" fill="none" stroke={P.ink} strokeWidth="8" />
      <circle cx="20" cy="20" r="8" fill="none" stroke={P.orange} strokeWidth="4" />
      <circle cx="20" cy="20" r="8" fill="none" stroke={P.paper} strokeWidth="4" strokeDasharray="5 10" />
      <ellipse cx="38" cy="21" rx="8" ry="6" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="42" y="10" width="6" height="8" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="47" y="11" width="5" height="3" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
      <rect x="9" y="12" width="4" height="14" fill={P.danfo} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The exit: a towel and key desk with stacked towels and an EXIT plate. 2 by 1 tiles. */
function TowelDesk({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="2" y="2" width="14" height="10" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="18" y="0" width="14" height="12" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="34" y="3" width="13" height="9" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="9" width={w - 6} height={h - 11} fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="11" width={w - 10} height="4" fill={P.paper} />
      <rect x="4" y={h - 11} width={w - 10} height="5" fill={P.orange} />
      <rect x={w - 14} y="2" width="3" height="8" fill={P.goldDark} />
      <rect x={w / 2 - 14} y="-8" width="28" height="9" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <text x={w / 2} y="-0.5" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".8">EXIT</text>
    </g>
  );
}

export default function PoolArt({ layout, uid, brand, content }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const u = (n: string) => `url(#${uid}-${n})`;
  const title = (content?.title || brand || "Pool party").toUpperCase();
  const line = content?.line ? content.line.toUpperCase().slice(0, 34) : "";
  const lineup = content?.lineup?.length ? content.lineup : [{ name: "Warm-up DJ", time: "2PM" }, { name: "Resident DJ", time: "4PM" }, { name: "Headliner", time: "6PM" }];
  const pool = layout.props.find((p) => p.id === "pool");
  const bar = layout.props.find((p) => p.id === "cabana-bar");
  const apron = pool ? { x: pool.x - 2, y: pool.y - 2, w: pool.w + 4, h: pool.h + 3 } : { x: 7, y: 7, w: 16, h: 9 };

  // The wall: 28 by 3 tiles across the top.
  const wx = tile;
  const wy = tile;
  const ww = W - tile * 2;
  const wh = 3 * tile;
  // The banner over the DJ, centred on the room.
  const bw = 300;
  const bh = 44;
  const bx = W / 2 - bw / 2;
  const by = wy + 14;
  const titleSize = Math.max(9, Math.min(line ? 20 : 22, 262 / Math.max(5, title.length * 0.72)));
  const flags = buntingPaths(wx + 8, W - wx - 8, wy + 10, 6, 24);
  const flagColors = [P.orange, P.paper, P.night];

  const custom: Record<string, (p: CampaignProp, t: number) => ReactNode> = {
    "event-flyer": (p, t) => <HopFlyer uid={uid} x={0} y={4} w={p.w * t} h={p.h * t - 8} url={content?.flyerUrl} title={title} line={content?.line} />,
    "event-lineup": (p, t) => (
      <g>
        <rect x="-3" y="1" width={p.w * t + 6} height={p.h * t - 6} fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
        <Lineup x={2} y={6} w={p.w * t - 4} h={p.h * t - 16} items={lineup} />
      </g>
    ),
    platform: (p, t) => <Platform uid={uid} w={p.w * t} h={p.h * t} />,
    djbooth: (p, t) => <Booth w={p.w * t} h={p.h * t} />,
    pool: (p, t) => <Pool uid={uid} w={p.w * t} h={p.h * t} />,
    cabana: (p, t) => <Cabana uid={uid} w={p.w * t} h={p.h * t} />,
    lounger: (p, t) => <Lounger w={p.w * t} h={p.h * t} v={p.variant ?? 0} />,
    parasol: (p) => <Parasol v={p.variant ?? 0} />,
    mat: (p, t) => (
      <g>
        <rect x="2" y="2" width={p.w * t - 4} height={p.h * t - 4} fill={u("stripe")} stroke={P.ink} strokeWidth="2" />
        <rect x="5" y="5" width={p.w * t - 10} height={p.h * t - 10} fill="none" stroke={P.paper} strokeWidth="2" opacity=".7" />
      </g>
    ),
    towel: (p) => {
      const c = ACCENT[(p.variant ?? 0) % 3];
      return (
        <g>
          <rect x="6" y="11" width="24" height="16" fill={P.shadow} opacity=".2" />
          <rect x="4" y="8" width="24" height="16" fill={c} stroke={P.ink} strokeWidth="2" />
          <rect x="4" y="14" width="24" height="3" fill={P.paper} />
          <rect x="7" y="10" width="7" height="2" fill={P.paper} opacity=".6" />
        </g>
      );
    },
    daybed: (p, t) => <Daybed w={p.w * t} h={p.h * t} />,
    floatrack: (p, t) => <FloatRack w={p.w * t} h={p.h * t} />,
    palm: (p) => <Palm v={p.variant ?? 0} />,
    planter: () => <Planter />,
    cocktail: (p) => <Cocktail v={p.variant ?? 0} />,
    lifeguard: () => <Lifeguard />,
    shower: () => <Shower />,
    cooler: () => <Cooler />,
    toweldesk: (p, t) => <TowelDesk w={p.w * t} h={p.h * t} />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["deck", "paving", "water", "pooltile", "wood", "grass"]} />
      <defs>
        <pattern id={`${uid}-apron`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#F4F1E7" />
          <path d="M0 0H32V32" fill="none" stroke="#D3CDB9" strokeWidth="1" />
          <path d="M5 6h3M20 21h4M12 27h1M26 9h2" stroke="#CFE9EE" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-hedge`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill={P.kekeDark} />
          <path d="M2 4h10v6H2ZM18 14h12v8H18ZM6 22h8v6H6Z" fill={P.keke} />
          <path d="M4 5h6v2H4ZM20 15h8v2h-8Z" fill="#7BD27A" />
          <circle cx="24" cy="6" r="2.5" fill={P.ember} />
          <circle cx="9" cy="17" r="2.5" fill={P.paper} />
          <circle cx="26" cy="27" r="2" fill={P.danfo} />
        </pattern>
        <pattern id={`${uid}-thatch`} width="12" height="8" patternUnits="userSpaceOnUse">
          <rect width="12" height="8" fill={T.straw} />
          <path d="M0 8L8 0M6 8L12 2" stroke={T.strawDark} strokeWidth="1" />
          <path d="M2 3h2M9 6h2" stroke={T.strawLight} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-stripe`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill={P.paper} />
          <rect width="8" height="32" fill={P.orange} />
          <rect x="16" width="8" height="32" fill={P.orange} />
        </pattern>
        <pattern id={`${uid}-awn`} width="16" height="12" patternUnits="userSpaceOnUse">
          <rect width="16" height="12" fill={P.paper} />
          <rect width="8" height="12" fill={P.orange} />
        </pattern>
        <pattern id={`${uid}-mural`} width="64" height="24" patternUnits="userSpaceOnUse">
          <rect width="64" height="24" fill={P.night} />
          <path d="M2 24C4 10 18 2 34 4C26 8 20 14 16 24Z" fill={P.kekeDark} />
          <path d="M30 24C34 12 48 4 64 8C54 10 46 16 42 24Z" fill={P.keke} />
          <path d="M12 24C14 16 22 10 30 10C24 14 22 18 22 24Z" fill={P.keke} />
          <circle cx="50" cy="8" r="4" fill={P.orange} />
          <circle cx="8" cy="9" r="3" fill={P.paper} />
          <path d="M0 0H64" stroke={P.nightLine} strokeWidth="1" />
        </pattern>
      </defs>

      {/* The lawn around the villa, then the deck. */}
      <rect width={W} height={H} fill={u("grass")} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={u("deck")} stroke={P.ink} strokeWidth="4" />

      {/* White tile round the pool, sandy paving under the cabana and the poolside tables, a path to the gate. */}
      <Floor uid={uid} rect={apron} material="apron" tile={tile} border="#CBC4AE" />
      {bar && <Floor uid={uid} rect={{ x: bar.x - 1, y: bar.y, w: bar.w + 1, h: bar.h + 2 }} material="paving" tile={tile} />}
      <Floor uid={uid} rect={{ x: 21, y: 9, w: 7, h: 7 }} material="paving" tile={tile} border={P.woodDark} />
      <Floor uid={uid} rect={{ x: 13, y: 17, w: 4, h: 3 }} material="paving" tile={tile} />

      {/* Afternoon sun: one soft diagonal band of light across the deck. */}
      <path d={`M${tile * 3} ${H - tile}L${tile * 9} ${tile * 4}H${tile * 14}L${tile * 8} ${H - tile}Z`} fill={P.paper} opacity=".1" />

      {/* Garden hedges down both sides, with hibiscus. */}
      {layout.walls.filter((wl) => wl.h > 3).map((wl, i) => (
        <g key={i}>
          <rect x={wl.x * tile + 4} y={wl.y * tile + 6} width={wl.w * tile} height={wl.h * tile} fill={P.shadow} opacity=".25" />
          <rect x={wl.x * tile} y={wl.y * tile} width={wl.w * tile} height={wl.h * tile} fill={u("hedge")} stroke={P.ink} strokeWidth="2" />
          <rect x={wl.x * tile + 2} y={wl.y * tile + 2} width={wl.w * tile - 4} height="3" fill="#7BD27A" opacity=".7" />
        </g>
      ))}

      {/* The back wall: white plaster, an orange trim, a tropical mural strip on night and bunting. */}
      <rect x={wx + 5} y={wy + 7} width={ww} height={wh} fill={P.shadow} opacity=".25" />
      <rect x={wx} y={wy} width={ww} height={wh} fill={P.ink} />
      <rect x={wx + 3} y={wy + 3} width={ww - 6} height={wh - 10} fill={P.white} />
      <rect x={wx + 2} y={wy + 2} width={ww - 4} height="5" fill={P.paper} />
      <rect x={wx + 3} y={wy + 7} width={ww - 6} height="3" fill={P.orange} />
      <rect x={wx + 3} y={wy + 62} width={ww - 6} height="24" fill={u("mural")} stroke={P.ink} strokeWidth="2" />
      <path d={`M${wx + 8} ${wy + 10}Q${W / 2} ${wy + 22} ${W - wx - 8} ${wy + 10}`} fill="none" stroke={P.ink} strokeWidth="1" />
      {flags.map((d, i) => <path key={i} d={d} fill={flagColors[i]} stroke={P.ink} strokeWidth="1" />)}
      {/* One rubber stamp on the plaster, right of the line-up. */}
      <Stamp x={850} y={76} text={BRAND_LINES.hop} size={8} />

      {/* The banner over the DJ: the party's name, and its date and place under it. */}
      <path d={`M${bx + 30} ${wy + 8}V${by}M${bx + bw - 30} ${wy + 8}V${by}`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${bx + 4} ${by + 6}h-14l6 16l-6 16h14ZM${bx + bw - 4} ${by + 6}h14l-6 16l6 16h-14Z`} fill={P.brandEmber} stroke={P.ink} strokeWidth="2" />
      <rect x={bx + 4} y={by + 5} width={bw} height={bh} fill={P.shadow} opacity=".3" />
      <rect x={bx} y={by} width={bw} height={bh} fill={P.orange} stroke={P.ink} strokeWidth="3" />
      <rect x={bx + 6} y={by + 6} width={bw - 12} height={bh - 12} fill="none" stroke={P.paper} strokeWidth="2" strokeDasharray="6 4" opacity=".8" />
      <text x={W / 2 + 1.5} y={by + (line ? 25 : 28) + 1.5} textAnchor="middle" fill={P.ink} fontFamily={FONT.display} fontWeight={900} fontSize={titleSize} letterSpacing="1.5">{title}</text>
      <text x={W / 2} y={by + (line ? 25 : 28)} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={titleSize} letterSpacing="1.5">{title}</text>
      {line && <text x={W / 2} y={by + 37} textAnchor="middle" fill={P.night} fontFamily={FONT.mono} fontWeight={700} fontSize="8" letterSpacing="1">{line}</text>}

      {/* The route round the pool: in at the gate, past the pool's two ends, finale in front of the DJ deck. */}
      <RouteLine points={[[496, 604], [496, 496], [704, 496, 0], [704, 392], [704, 262, 0], [496, 262]]} />

      <Props layout={layout} uid={uid} custom={custom} order={(p) => (p.solid === false ? -1000 + p.y : p.y + p.h)} />

      {/* The low front wall along the bottom, open where the path comes in to the gate. */}
      <g>
        <rect x={wx} y={H - 26} width={13 * tile - wx - 8} height="16" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <rect x={wx} y={H - 26} width={13 * tile - wx - 8} height="4" fill={P.orange} />
        <rect x={17 * tile + 8} y={H - 26} width={W - wx - 17 * tile - 8} height="16" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <rect x={17 * tile + 8} y={H - 26} width={W - wx - 17 * tile - 8} height="4" fill={P.orange} />
        <rect x={13 * tile - 10} y={H - 38} width="14" height="36" fill={P.white} stroke={P.ink} strokeWidth="2" />
        <rect x={17 * tile - 4} y={H - 38} width="14" height="36" fill={P.white} stroke={P.ink} strokeWidth="2" />
        <rect x={13 * tile - 12} y={H - 42} width="18" height="6" fill={P.orange} stroke={P.ink} strokeWidth="2" />
        <rect x={17 * tile - 6} y={H - 42} width="18" height="6" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      </g>
    </svg>
  );
}
