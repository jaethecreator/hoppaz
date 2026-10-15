import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { Defs, Flyer, FONT, Frame, Hedges, Lineup, P, Plate, Props, Walls, type RoomArtProps } from "./kit";

/**
 * Outdoor party: a Lagos compound at dusk. Painted wall and a stage truck with an LED screen at the top, jollof, suya and
 * ice stalls along the sides, canopy tents with plastic chairs, a plank dance floor with string lights on poles, a fire
 * pit, and the compound gate at the front with a danfo and a keke parked outside. Same pixel look as the clubhouse.
 * Everything custom is drawn here, locally, from the shared kit's palette.
 */

const PLASTER = "#E3D3AC";
const PLASTER_SHADE = "#C9B58A";
const PLASTER_LIGHT = "#F4EBD2";

type Pt = [number, number];
type Draw = (prop: CampaignProp, tile: number) => ReactNode;

/** A scalloped valance: a filled band from y - top to y with `depth` tall teeth along the bottom. */
function valance(x0: number, x1: number, y: number, step: number, depth: number, top = 5): string {
  const teeth = Math.max(1, Math.round((x1 - x0) / step));
  const s = (x1 - x0) / teeth;
  let d = `M${x0} ${y - top}H${x1}V${y}`;
  for (let i = 0; i < teeth; i++) d += `l${-s / 2} ${depth}l${-s / 2} ${-depth}`;
  return `${d}Z`;
}

/** Vertical bars (an equaliser) as one path: heights from the base line up. */
const bars = (x0: number, heights: number[], base: number, gap = 10, bw = 6) => heights.map((h, i) => `M${x0 + i * gap} ${base}v${-h}h${bw}v${h}z`).join("");

/** A sagging wire with warm bulbs: one path for the wire and one per colour for the bulbs, however many there are. */
function Lights({ a, b, sag = 12, n = 10, colors = [P.gold, P.paper, P.ember] }: { a: Pt; b: Pt; sag?: number; n?: number; colors?: string[] }) {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2 + sag * 2;
  const at = (t: number): Pt => [
    Math.round((1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0]),
    Math.round((1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1]),
  ];
  const groups = colors.map(() => "");
  for (let i = 0; i < n; i++) {
    const [x, y] = at((i + 0.5) / n);
    groups[i % colors.length] += `M${x - 2} ${y + 1}h4v5h-4z`;
  }
  return (
    <g>
      <path d={`M${a[0]} ${a[1]}Q${cx} ${cy} ${b[0]} ${b[1]}`} fill="none" stroke={P.ink} strokeWidth="1" />
      {groups.map((d, i) => <path key={i} d={d} fill={colors[i]} stroke={P.ink} strokeWidth="1" />)}
    </g>
  );
}

/** Bunting: flat triangles on a sagging line. */
function Bunting({ a, b, sag = 14, n = 9, colors = [P.orange, P.cream, P.ember, P.gold] }: { a: Pt; b: Pt; sag?: number; n?: number; colors?: string[] }) {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2 + sag * 2;
  const at = (t: number): Pt => [
    Math.round((1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0]),
    Math.round((1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1]),
  ];
  const groups = colors.map(() => "");
  for (let i = 0; i < n; i++) {
    const [x, y] = at((i + 0.5) / n);
    groups[i % colors.length] += `M${x - 5} ${y}h10l-5 11z`;
  }
  return (
    <g>
      <path d={`M${a[0]} ${a[1]}Q${cx} ${cy} ${b[0]} ${b[1]}`} fill="none" stroke={P.ink} strokeWidth="1" />
      {groups.map((d, i) => <path key={i} d={d} fill={colors[i]} stroke={P.ink} strokeWidth="1" />)}
    </g>
  );
}

/* ------------------------------------------------------------------ the stage ------------------------------------ */

/** The stage truck: LED screen on a truss behind a deck, DJ desk, subs, mic stands. The screen rises above the box. */
const stageTruck = (uid: string, ticker: string): Draw => (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  return (
    <g>
      <rect x="10" y="40" width={w - 6} height={h - 34} fill={P.shadow} opacity=".25" />
      {/* truss legs, cross brace, top bar and lamps */}
      <rect x="12" y="-66" width="10" height="100" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 22} y="-66" width="10" height="100" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <path d={`M12 -60L22 -46L12 -32L22 -18L12 -4L22 10L12 24M${w - 22} -60L${w - 12} -46L${w - 22} -32L${w - 12} -18L${w - 22} -4L${w - 12} 10L${w - 22} 24`} fill="none" stroke={P.ink} strokeWidth="1" />
      <rect x="8" y="-68" width={w - 16} height="9" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <path d={`M40 -59h10v7H40z M${w / 2 - 30} -59h10v7h-10z M${w / 2 + 20} -59h10v7h-10z M${w - 50} -59h10v7h-10z`} fill={P.gold} stroke={P.ink} strokeWidth="1" />
      {/* the LED screen: dusk sky, a big sun, equaliser bars, LIVE chip and the event line as a ticker */}
      <rect x="28" y="-58" width={w - 56} height="90" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="32" y="-54" width={w - 64} height="34" fill="#1D1511" />
      <rect x="32" y="-20" width={w - 64} height="26" fill="#4A2213" />
      <rect x="32" y="6" width={w - 64} height="22" fill="#8A3A12" />
      <path d={`M${w / 2 - 30} 2h60v4h-60z M${w / 2 - 26} -2h52v4h-52z M${w / 2 - 20} -6h40v4h-40z M${w / 2 - 12} -10h24v4h-24z`} fill={P.orange} />
      <path d={`M${w / 2 - 14} 2h28v4h-28z M${w / 2 - 10} -2h20v4h-20z`} fill={P.gold} />
      <path d={`M${w / 2 - 24} 12h48v3h-48z M${w / 2 - 16} 18h32v3h-32z M${w / 2 - 8} 24h16v3h-16z`} fill={P.orange} opacity=".6" />
      <path d={bars(40, [14, 26, 10, 32, 18, 28, 12, 22], 28)} fill={P.danfo} />
      <path d={bars(w - 112, [22, 12, 28, 18, 32, 10, 26, 14], 28)} fill={P.ember} />
      <rect x="38" y="-50" width="30" height="12" fill={P.red} stroke={P.ink} strokeWidth="1" />
      <text x="53" y="-41" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize="8" letterSpacing=".8">LIVE</text>
      {ticker && <text x={w - 38} y="-41" textAnchor="end" fill={P.paper} fontFamily={FONT.mono} fontSize="7" letterSpacing=".5">{ticker}</text>}
      <path d={`M28 -58H${w - 28}M28 -58V32`} fill="none" stroke={P.paper} strokeWidth="2" opacity=".3" />
      {/* deck, fascia, wheels */}
      <rect x="2" y="30" width={w - 4} height="36" fill={`url(#${uid}-stagewood)`} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="32" width={w - 8} height="2" fill={P.paper} opacity=".35" />
      <rect x="2" y="66" width={w - 4} height="16" fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="72" width={w - 8} height="4" fill={P.orange} />
      <path d={`M44 78h34v18H44z M${w - 78} 78h34v18h-34z`} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d={`M54 84h14v6H54z M${w - 68} 84h14v6h-14z`} fill={P.slateLight} />
      <path d={`M6 82h6v12H6z M${w - 12} 82h6v12h-6z`} fill={P.cap} stroke={P.ink} strokeWidth="1" />
      {/* on the deck: subs, DJ desk, two mic stands */}
      <path d={`M12 38h30v24H12z M${w - 42} 38h30v24h-30z`} fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <circle cx="27" cy="50" r="8" fill={P.wall} stroke={P.shadow} strokeWidth="2" />
      <circle cx={w - 27} cy="50" r="8" fill={P.wall} stroke={P.shadow} strokeWidth="2" />
      <circle cx="27" cy="50" r="3" fill={P.slate} />
      <circle cx={w - 27} cy="50" r="3" fill={P.slate} />
      <rect x={w / 2 - 36} y="36" width="72" height="26" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 34} y="38" width="68" height="10" fill={P.wall} />
      <circle cx={w / 2 - 18} cy="43" r="6" fill={P.ink} stroke={P.slateLight} strokeWidth="2" />
      <circle cx={w / 2 + 18} cy="43" r="6" fill={P.ink} stroke={P.slateLight} strokeWidth="2" />
      <rect x={w / 2 - 9} y="25" width="18" height="12" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 7} y="27" width="14" height="8" fill={P.lagoonLight} />
      <rect x={w / 2 - 7} y="39" width="14" height="8" fill={P.slate} />
      <rect x={w / 2 - 34} y="50" width="68" height="12" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <path d={`M96 40V62M${w - 96} 40V62`} fill="none" stroke={P.ink} strokeWidth="2" />
      <path d={`M93 35h6v6h-6z M${w - 99} 35h6v6h-6z`} fill={P.gold} stroke={P.ink} strokeWidth="1" />
    </g>
  );
};

/** A PA tower: three cabinets with a cone each. */
const tower: Draw = (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  const ch = (h - 6) / 3;
  return (
    <g>
      <rect x="8" y="10" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
      <rect x="4" y="2" width={w - 10} height={h - 6} fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <path d={`M4 ${2 + ch}H${w - 6}M4 ${2 + 2 * ch}H${w - 6}`} stroke={P.shadow} strokeWidth="2" />
      <rect x="6" y="4" width="3" height={h - 10} fill={P.wall} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx={w / 2 + 1} cy={2 + ch * i + ch / 2} r="10" fill={P.wall} stroke={P.shadow} strokeWidth="2" />
          <circle cx={w / 2 + 1} cy={2 + ch * i + ch / 2} r="4" fill={P.slate} />
        </g>
      ))}
      <rect x="10" y={h - 8} width={w - 22} height="2" fill={P.orange} />
    </g>
  );
};

/** A steel crowd barrier. */
const barrier: Draw = (p, t) => {
  const w = p.w * t;
  return (
    <g>
      <rect x="4" y="16" width={w - 4} height="14" fill={P.shadow} opacity=".25" />
      <path d={`M2 8h${w - 6}v5H2z M2 21h${w - 6}v3H2z`} fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <path d={`M4 13v8M${w / 2 - 14} 13v8M${w / 2 + 14} 13v8M${w - 8} 13v8`} stroke={P.ink} strokeWidth="2" />
      <path d={`M0 27h10M${w - 14} 27h10`} stroke={P.ink} strokeWidth="3" />
      <rect x={w / 2 - 8} y="9" width="16" height="10" fill={P.orange} stroke={P.ink} strokeWidth="1" />
    </g>
  );
};

/** The generator that feeds the PA. */
const gen: Draw = (p, t) => {
  const w = p.w * t;
  return (
    <g>
      <rect x="6" y="14" width={w - 4} height="18" fill={P.shadow} opacity=".25" />
      <rect x="9" y="-4" width="5" height="10" fill={P.ink} />
      <rect x="7" y="-10" width="9" height="6" fill={P.paper} opacity=".55" />
      <rect x="3" y="6" width={w - 8} height="22" fill={P.ember} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="8" width={w - 12} height="3" fill={P.paper} opacity=".35" />
      <rect x="10" y="13" width="14" height="8" fill={P.gold} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 26} y="13" width="18" height="10" fill={P.ink} />
      <path d="M5 28v3M47 28v3" stroke={P.ink} strokeWidth="3" />
    </g>
  );
};

/* ------------------------------------------------------------------ food and drink ------------------------------- */

/** Suya grill stall: striped awning, glowing coals, skewers, a plate sign, smoke. */
const suyaStall = (uid: string): Draw => (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  return (
    <g>
      <rect x="8" y="16" width={w - 6} height={h - 14} fill={P.shadow} opacity=".25" />
      <path d="M6 12V30M84 12V30" stroke={P.ink} strokeWidth="3" />
      <rect x="2" y="30" width={w - 6} height="32" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="28" width={w - 6} height="10" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="18" width="62" height="14" fill={P.ink} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="22" width="58" height="5" fill={P.ember} />
      <rect x="12" y="22" width="58" height="2" fill={P.gold} />
      <path d="M16 15h6v6h-6z M26 15h6v6h-6z M36 15h6v6h-6z M46 15h6v6h-6z M56 15h6v6h-6z" fill={P.emberDark} stroke={P.ink} strokeWidth="1" />
      <path d="M13 18h56" stroke={P.cream} strokeWidth="2" />
      <rect x="76" y="19" width="9" height="10" fill={P.red} stroke={P.ink} strokeWidth="1" />
      <rect x="77" y="16" width="7" height="3" fill={P.gold} />
      <Plate x={26} y={42} w={42} h={14} text="Suya" fill={P.orange} color={P.night} />
      <rect x="0" y="-6" width={w - 2} height="14" fill={`url(#${uid}-stripeE)`} stroke={P.ink} strokeWidth="2" />
      <path d={valance(2, w - 4, 13, 12, 5, 5)} fill={P.cream} stroke={P.ink} strokeWidth="1" />
      <rect x="48" y="-14" width="10" height="8" fill={P.paper} opacity=".55" />
      <rect x="53" y="-23" width="8" height="8" fill={P.paper} opacity=".5" />
      <rect x="59" y="-31" width="7" height="7" fill={P.paper} opacity=".45" />
      <rect x="65" y="-38" width="5" height="5" fill={P.paper} opacity=".4" />
    </g>
  );
};

/** Jollof stall: a big pot of party rice under an orange awning. */
const jollofStall = (uid: string): Draw => (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  return (
    <g>
      <rect x="8" y="16" width={w - 6} height={h - 14} fill={P.shadow} opacity=".25" />
      <path d="M6 8V38M84 8V38" stroke={P.ink} strokeWidth="3" />
      <rect x="4" y="42" width={w - 10} height="20" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="56" width={w - 14} height="4" fill={P.brandEmber} />
      <rect x="4" y="36" width={w - 10} height="8" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M15 24h5v4h-5z M64 24h5v4h-5z" fill={P.ink} />
      <rect x="22" y="24" width="40" height="14" fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <rect x="24" y="26" width="3" height="10" fill={P.wall} />
      <rect x="20" y="20" width="44" height="6" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="16" width="36" height="5" fill={P.ember} />
      <path d="M28 17h3v2h-3z M40 18h4v2h-4z M52 17h3v2h-3z" fill={P.emberDark} />
      <path d="M70 31h16v6H70z M71 26h14v5H71z" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <Plate x={26} y={46} w={42} h={12} text="Jollof" fill={P.night} color={P.paper} size={8} />
      <rect x="0" y="-6" width={w - 2} height="14" fill={`url(#${uid}-stripeO)`} stroke={P.ink} strokeWidth="2" />
      <path d={valance(2, w - 4, 13, 12, 5, 5)} fill={P.cream} stroke={P.ink} strokeWidth="1" />
      <rect x="30" y="10" width="6" height="5" fill={P.paper} opacity=".55" />
      <rect x="35" y="4" width="6" height="5" fill={P.paper} opacity=".5" />
      <rect x="40" y="-2" width="5" height="5" fill={P.paper} opacity=".45" />
    </g>
  );
};

/** The ice stall: awning, COLD DRINKS sign, a chest of bottles, a cooler, crates. */
const iceStall = (uid: string): Draw => (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  return (
    <g>
      <rect x="8" y="16" width={w - 6} height={h - 14} fill={P.shadow} opacity=".25" />
      <path d={`M6 8V60M${w - 8} 8V60`} stroke={P.ink} strokeWidth="3" />
      <path d="M16 26h4v9h-4z M36 27h4v8h-4z M56 26h4v9h-4z" fill={P.keke} stroke={P.ink} strokeWidth="1" />
      <path d="M26 24h4v11h-4z M46 25h4v10h-4z" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x="10" y="38" width="60" height="22" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="34" width="60" height="7" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
      <path d="M14 35h6v3h-6z M40 35h8v3h-8z" fill={P.paper} />
      <rect x="58" y="46" width="8" height="3" fill={P.cap} />
      <rect x="78" y="44" width="34" height="18" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <rect x="76" y="38" width="38" height="8" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d="M118 38h4v8h-4z M128 36h4v10h-4z M138 38h4v8h-4z M146 37h4v9h-4z" fill={P.red} stroke={P.ink} strokeWidth="1" />
      <rect x="118" y="46" width="36" height="16" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d="M118 54h36M136 46v16" stroke={P.woodDark} strokeWidth="2" />
      <rect x="0" y="-6" width={w - 2} height="14" fill={`url(#${uid}-stripeB)`} stroke={P.ink} strokeWidth="2" />
      <path d={valance(2, w - 4, 13, 12, 5, 5)} fill={P.cream} stroke={P.ink} strokeWidth="1" />
      <Plate x={w / 2 - 38} y={16} w={76} h={14} text="Cold drinks" fill={P.night} color={P.paper} size={8} />
    </g>
  );
};

/** A blue plastic water drum. */
const drum: Draw = () => (
  <g>
    <rect x="9" y="24" width="20" height="6" fill={P.shadow} opacity=".3" />
    <rect x="7" y="6" width="18" height="22" fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
    <path d="M7 12h18M7 22h18" stroke={P.lagoonDark} strokeWidth="2" />
    <rect x="7" y="3" width="18" height="5" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
    <rect x="23" y="20" width="6" height="3" fill={P.gold} stroke={P.ink} strokeWidth="1" />
  </g>
);

/* ------------------------------------------------------------------ seating --------------------------------------- */

const ROOF = ["stripeO", "stripeW", "stripeE"] as const;

/** A canopy tent roof with a scalloped valance and two front posts; the chairs are separate props under it. */
const tent = (uid: string): Draw => (p, t) => {
  const w = p.w * t;
  const v = (p.variant ?? 0) % ROOF.length;
  return (
    <g>
      <rect x="12" y="34" width={w - 8} height="30" fill={P.shadow} opacity=".22" />
      <path d={`M8 34V62M${w - 8} 34V62`} stroke={P.ink} strokeWidth="3" />
      <path d={`M20 2H${w - 20}L${w - 2} 36H2Z`} fill={`url(#${uid}-${ROOF[v]})`} stroke={P.ink} strokeWidth="2" />
      <path d={`M24 5H${w - 24}`} stroke={P.paper} strokeWidth="2" opacity=".5" />
      <path d="M21 6L6 34" stroke={P.paper} strokeWidth="2" opacity=".3" />
      <rect x={w / 2 - 4} y="-6" width="8" height="8" fill={P.gold} stroke={P.ink} strokeWidth="1" />
      <path d={valance(2, w - 2, 42, 10, 6, 6)} fill={v === 1 ? P.orange : P.cream} stroke={P.ink} strokeWidth="2" />
    </g>
  );
};

const CHAIR = [P.red, P.paper, P.lagoon] as const;

/** A table with two Lagos plastic chairs, one 2 by 1 prop. */
const plasticSet: Draw = (p) => {
  const c = CHAIR[(p.variant ?? 0) % CHAIR.length];
  return (
    <g>
      <rect x="6" y="24" width="58" height="6" fill={P.shadow} opacity=".25" />
      <path d="M6 24v5M14 24v5M50 24v5M58 24v5" stroke={P.ink} strokeWidth="2" />
      <rect x="30" y="20" width="4" height="9" fill={P.ink} />
      <path d="M3 3h14v9H3z M47 3h14v9H47z" fill={c} stroke={P.ink} strokeWidth="2" />
      <path d="M5 12h12v11H5z M47 12h12v11H47z" fill={c} stroke={P.ink} strokeWidth="2" />
      <path d="M5 5h10v2H5z M49 5h10v2H49z" fill={P.paper} opacity=".35" />
      <rect x="19" y="8" width="26" height="13" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="11" width="5" height="5" fill={P.orange} />
      <rect x="36" y="9" width="4" height="9" fill={P.keke} />
    </g>
  );
};

/** A stack of white plastic chairs. */
const chairStack: Draw = () => (
  <g>
    <rect x="8" y="24" width="22" height="6" fill={P.shadow} opacity=".25" />
    <path d="M10 22v6M22 22v6" stroke={P.ink} strokeWidth="2" />
    <rect x="9" y="2" width="14" height="8" fill={P.paper} stroke={P.ink} strokeWidth="2" />
    <path d="M8 10h16v4H8z M8 14h16v4H8z M8 18h16v4H8z" fill={P.cream} stroke={P.ink} strokeWidth="1" />
  </g>
);

/** A log bench round the fire. */
const logSeat: Draw = (p, t) => {
  const w = p.w * t;
  return (
    <g>
      <rect x="6" y="22" width={w - 4} height="8" fill={P.shadow} opacity=".25" />
      <rect x="2" y="10" width={w - 4} height="14" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="12" width={w - 8} height="4" fill={P.woodLight} />
      <path d={`M2 10h6v14H2z M${w - 10} 10h6v14h-6z`} fill={P.wood} stroke={P.ink} strokeWidth="1" />
    </g>
  );
};

/* ------------------------------------------------------------------ the lawn -------------------------------------- */

const firePit: Draw = () => (
  <g>
    <path d="M12 30h40l8 8v16l-8 8H12l-8-8V38z" fill={P.stone} stroke={P.ink} strokeWidth="2" />
    <path d="M16 36h32l4 4v10l-4 4H16l-4-4V40z" fill={P.ink} />
    <path d="M8 40h6v4H8z M26 56h8v4h-8z M50 42h6v4h-6z" fill={P.paper} opacity=".5" />
    <path d="M16 50L46 41l2 5L18 55z" fill={P.woodDark} stroke={P.ink} strokeWidth="1" />
    <path d="M18 41l30 9-2 5-30-9z" fill={P.wood} stroke={P.ink} strokeWidth="1" />
    <path d="M20 44V36h4v-8h4v-10h4v-10h4v10h4v10h4v8h2v8z" fill={P.orange} />
    <path d="M26 44v-6h4v-10h4v-8h4v10h2v8h2v6z" fill={P.danfo} />
    <path d="M31 44v-6h3v-6h3v6h1v6z" fill={P.paper} />
    <path d="M20 8h3v3h-3z M44 14h3v3h-3z M38 2h3v3h-3z" fill={P.gold} />
  </g>
);

const dancefloor = (uid: string): Draw => (p, t) => {
  const w = p.w * t;
  const h = p.h * t;
  return (
    <g>
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-floorchk)`} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w - 8} height={h - 8} fill="none" stroke={P.gold} strokeWidth="2" />
      <rect x="6" y="6" width={w - 12} height="2" fill={P.paper} opacity=".3" />
    </g>
  );
};

/** A string-light pole: concrete foot, wooden pole, lamp head. It rises above its tile. */
const pole: Draw = () => (
  <g>
    <rect x="10" y="24" width="18" height="6" fill={P.shadow} opacity=".3" />
    <rect x="9" y="20" width="14" height="9" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    <rect x="13" y="-40" width="6" height="62" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
    <rect x="14" y="-38" width="2" height="56" fill={P.paper} opacity=".3" />
    <rect x="8" y="-46" width="16" height="7" fill={P.ink} />
    <rect x="11" y="-44" width="10" height="4" fill={P.gold} />
  </g>
);

const bin: Draw = () => (
  <g>
    <rect x="9" y="24" width="18" height="6" fill={P.shadow} opacity=".3" />
    <path d="M8 8h16l-2 20H10z" fill={P.kekeDark} stroke={P.ink} strokeWidth="2" />
    <rect x="6" y="4" width="20" height="5" fill={P.keke} stroke={P.ink} strokeWidth="2" />
    <rect x="12" y="12" width="3" height="12" fill={P.paper} opacity=".25" />
  </g>
);

/* ------------------------------------------------------------------ the gate and the street ---------------------- */

/** The exit: a wristband table with an EXIT plate on two posts. Its right end stays bare for the gate pillar. */
const wristbands: Draw = (p, t) => {
  const w = p.w * t;
  return (
    <g>
      <rect x="6" y="16" width={w - 20} height="16" fill={P.shadow} opacity=".25" />
      <rect x="2" y="14" width={w - 20} height="17" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="25" width={w - 24} height="4" fill={P.orange} />
      <rect x="2" y="9" width={w - 20} height="7" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <path d="M7 6h5v4H7z M15 7h5v3h-5z M23 6h5v4h-5z" fill={P.gold} stroke={P.ink} strokeWidth="1" />
      <rect x="32" y="4" width="9" height="6" fill={P.wall} stroke={P.ink} strokeWidth="1" />
      <path d="M10 -2V9M36 -2V9" stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="-13" width="41" height="12" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <text x="23.5" y="-4" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="8" letterSpacing="1">EXIT</text>
    </g>
  );
};

const guardBooth: Draw = () => (
  <g>
    <rect x="10" y="44" width="56" height="20" fill={P.shadow} opacity=".25" />
    <rect x="6" y="20" width="48" height="40" fill={P.cream} stroke={P.ink} strokeWidth="2" />
    <rect x="42" y="22" width="10" height="36" fill={P.stone} />
    <rect x="2" y="8" width="56" height="14" fill={P.wall} stroke={P.ink} strokeWidth="2" />
    <rect x="4" y="10" width="52" height="3" fill={P.cap} />
    <rect x="28" y="2" width="6" height="6" fill={P.gold} stroke={P.ink} strokeWidth="1" />
    <Plate x={10} y={24} w={30} h={10} text="Security" fill={P.night} color={P.paper} mono size={5} />
    <rect x="12" y="38" width="20" height="12" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
    <path d="M22 38v12" stroke={P.ink} strokeWidth="2" />
    <rect x="36" y="38" width="12" height="22" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
    <rect x="44" y="48" width="2" height="4" fill={P.gold} />
  </g>
);

/** A parked danfo: yellow bus, black stripe, a slogan, a route board. */
const danfo: Draw = (p, t) => {
  const w = p.w * t;
  return (
    <g>
      <rect x="8" y="44" width={w - 4} height="20" fill={P.shadow} opacity=".25" />
      <rect x="2" y="8" width={w - 6} height="44" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="10" width={w - 10} height="3" fill={P.paper} opacity=".4" />
      <rect x="4" y="32" width={w - 10} height="10" fill={P.night} />
      <text x="10" y="40" fill={P.paper} fontFamily={FONT.mono} fontSize="6.5" letterSpacing=".6">ENTER WITH YOUR CHANGE</text>
      <path d="M8 15h22v13H8z M34 15h22v13H34z M60 15h22v13H60z M86 15h22v13H86z M112 15h22v13h-22z M138 15h14v15h-14z" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
      <path d="M11 17h6v2h-6z M37 17h6v2h-6z M63 17h6v2h-6z M89 17h6v2h-6z M115 17h6v2h-6z" fill={P.paper} opacity=".55" />
      <rect x="2" y="44" width="4" height="6" fill={P.red} />
      <rect x={w - 12} y="44" width="7" height="6" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 14} y="50" width="12" height="4" fill={P.ink} />
      <circle cx="36" cy="54" r="10" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <circle cx={w - 36} cy="54" r="10" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <circle cx="36" cy="54" r="4" fill={P.slateLight} />
      <circle cx={w - 36} cy="54" r="4" fill={P.slateLight} />
      <Plate x={w - 44} y={-2} w={34} h={10} text="Yaba" fill={P.night} color={P.danfo} mono size={6} />
    </g>
  );
};

/** A parked keke: green body, cream canopy, three wheels. */
const keke: Draw = () => (
  <g>
    <rect x="10" y="44" width="54" height="18" fill={P.shadow} opacity=".25" />
    <path d="M6 44h10v14H6z M46 44h10v14H46z" fill={P.night} stroke={P.ink} strokeWidth="2" />
    <rect x="8" y="28" width="46" height="24" fill={P.keke} stroke={P.ink} strokeWidth="2" />
    <rect x="10" y="44" width="42" height="6" fill={P.kekeDark} />
    <rect x="4" y="6" width="54" height="16" fill={P.paper} stroke={P.ink} strokeWidth="2" />
    <rect x="4" y="20" width="54" height="4" fill={P.kekeDark} />
    <path d="M10 24V30M52 24V30" stroke={P.ink} strokeWidth="3" />
    <rect x="14" y="26" width="34" height="14" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
    <path d="M16 28h8v3h-8z" fill={P.paper} opacity=".6" />
    <rect x="27" y="41" width="8" height="5" fill={P.gold} stroke={P.ink} strokeWidth="1" />
    <rect x="25" y="50" width="12" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
  </g>
);

/* ------------------------------------------------------------------ the room -------------------------------------- */

export default function OutdoorArt({ layout, uid, brand, content }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const title = (content?.title || brand || "Outdoor party").toUpperCase();
  const ticker = (content?.line ?? "").toUpperCase().slice(0, 26);
  const lineup = content?.lineup?.length ? content.lineup : [{ name: "Warm-up DJ", time: "5PM" }, { name: "Resident DJ", time: "8PM" }, { name: "Headliner", time: "11PM" }];
  const back = layout.walls.filter((b) => b.y === 1);
  const sides = layout.walls.filter((b) => b.y === 4);
  const front = layout.walls.filter((b) => b.y === 16);
  const sideLayout = { ...layout, walls: sides };
  const frontLayout = { ...layout, walls: front };
  const poleTop = (id: string): Pt => {
    const q = layout.props.find((r) => r.id === id);
    return q ? [q.x * tile + tile / 2, q.y * tile - 42] : [W / 2, H / 2];
  };
  const p1 = poleTop("pole-1");
  const p2 = poleTop("pole-2");
  const p3 = poleTop("pole-3");
  const p4 = poleTop("pole-4");
  const bannerSize = Math.max(8, Math.min(14, 266 / Math.max(6, title.length * 0.8)));
  const gapX = 15 * tile; // the gateway: x 15 and 16 on the front wall row
  const gapY = 16 * tile;
  const roadDashes = Array.from({ length: 16 }, (_, i) => `M${20 + i * 60} ${19 * tile + 16}h28`).join("");
  const spikes = (x: number, w: number, y: number) => Array.from({ length: Math.floor((w - 12) / 12) }, (_, i) => `M${x + 8 + i * 12} ${y + 2}l3 -8l3 8z`).join("");
  const panels = (x: number, w: number, y: number, h: number) => Array.from({ length: Math.floor(w / 128) }, (_, i) => `M${x + 128 * (i + 1)} ${y + 8}v${h - 36}`).join("");

  const custom: Record<string, Draw> = {
    "event-flyer": (p) => <Flyer uid={uid} x={0} y={4} w={p.w * tile} h={p.h * tile - 8} url={content?.flyerUrl} title={title} line={content?.line} />,
    "event-lineup": (p) => <Lineup x={0} y={4} w={p.w * tile} h={p.h * tile - 8} items={lineup} />,
    stage: stageTruck(uid, ticker),
    speakerstack: tower,
    barrier,
    gen,
    suya: suyaStall(uid),
    jollof: jollofStall(uid),
    ice: iceStall(uid),
    drum,
    tent: tent(uid),
    plasticset: plasticSet,
    chairstack: chairStack,
    logseat: logSeat,
    firepit: firePit,
    dancefloor: dancefloor(uid),
    pole,
    bin,
    wristbands,
    guardbooth: guardBooth,
    danfo,
    keke,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["grass", "paving", "concrete", "asphalt", "stagewood"]} />
      <defs>
        <pattern id={`${uid}-stripeO`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill={P.cream} /><rect width="16" height="16" fill={P.orange} /></pattern>
        <pattern id={`${uid}-stripeE`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill={P.cream} /><rect width="16" height="16" fill={P.ember} /></pattern>
        <pattern id={`${uid}-stripeB`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill={P.cream} /><rect width="16" height="16" fill={P.lagoon} /></pattern>
        <pattern id={`${uid}-stripeW`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill={P.paper} /><rect width="2" height="16" fill={P.orange} /><rect x="16" width="2" height="16" fill={P.orange} /></pattern>
        <pattern id={`${uid}-floorchk`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#2B2420" /><rect x="16" width="16" height="16" fill="#3A2E27" /><rect y="16" width="16" height="16" fill="#3A2E27" /><rect x="1" y="1" width="14" height="14" fill={P.brandEmber} /><rect x="17" y="17" width="14" height="14" fill={P.danfoDark} /><path d="M3 3h6v2H3z M19 19h6v2h-6z" fill={P.paper} opacity=".4" /></pattern>
      </defs>
      <Frame layout={layout} ground="#222B24" />

      {/* Lawn, then the paving: the stage apron, a food apron each side, the path in from the gate. */}
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-grass)`} />
      {[
        { x: 8, y: 7, w: 14, h: 2 },
        { x: 2, y: 6, w: 6, h: 2 },
        { x: 22, y: 6, w: 6, h: 2 },
        { x: 14, y: 13, w: 4, h: 3 },
        { x: 15, y: 16, w: 2, h: 1 },
      ].map((r, i) => <rect key={i} x={r.x * tile} y={r.y * tile} width={r.w * tile} height={r.h * tile} fill={`url(#${uid}-paving)`} stroke={P.concreteDark} strokeWidth="2" />)}

      {/* The street side of the gate: forecourt, kerb and road. */}
      <rect x={tile} y={17 * tile} width={W - tile * 2} height={tile * 2} fill={`url(#${uid}-concrete)`} />
      <rect x="0" y={19 * tile} width={W} height={tile} fill={`url(#${uid}-asphalt)`} />
      <rect x="0" y={19 * tile - 4} width={W} height="6" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <path d={Array.from({ length: 30 }, (_, i) => `M${i * 32 + 16} ${19 * tile - 3}h16v4h-16z`).join("")} fill={P.danfo} />
      <path d={roadDashes} stroke={P.paper} strokeWidth="3" opacity=".6" />

      {/* The generator's cable, along the front of the barriers to the right PA tower. */}
      <path d={`M${9 * tile + 16} ${8 * tile}v10q0 8 10 8H${21 * tile + 8}q10 0 10 -8V${7 * tile + 6}`} fill="none" stroke={P.ink} strokeWidth="3" />
      <path d={`M${9 * tile + 16} ${8 * tile}v10q0 8 10 8H${21 * tile + 8}q10 0 10 -8V${7 * tile + 6}`} fill="none" stroke={P.danfo} strokeWidth="1" />

      {/* Back wall: painted plaster, an orange line over a dark base band, panel joints, iron spikes on top. */}
      {back.map((b, i) => {
        const x = b.x * tile;
        const y = b.y * tile;
        const w = b.w * tile;
        const h = b.h * tile;
        return (
          <g key={i}>
            <rect x={x + 5} y={y + 7} width={w} height={h} fill={P.shadow} opacity=".25" />
            <rect x={x} y={y} width={w} height={h} fill={P.ink} />
            <rect x={x + 3} y={y + 3} width={w - 6} height={h - 8} fill={PLASTER} />
            <rect x={x + 2} y={y + 2} width={w - 4} height="6" fill={PLASTER_LIGHT} />
            <rect x={x + 3} y={y + h - 26} width={w - 6} height="18" fill={PLASTER_SHADE} />
            <rect x={x + 3} y={y + h - 28} width={w - 6} height="3" fill={P.orange} />
            <path d={panels(x, w, y, h)} stroke={PLASTER_SHADE} strokeWidth="2" />
            <path d={spikes(x, w, y)} fill={P.ink} />
          </g>
        );
      })}
      <g>
        <rect x="188" y="46" width="118" height="34" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <rect x="192" y="50" width="110" height="3" fill={P.red} />
        <text x="247" y="68" textAnchor="middle" fill={P.ink} fontFamily={FONT.mono} fontWeight={700} fontSize="10" letterSpacing=".8">POST NO BILL</text>
        <text x="247" y="76" textAnchor="middle" fill={P.ink} fontFamily={FONT.mono} fontSize="4.5">OFFENDERS WILL BE PROSECUTED</text>
      </g>
      <Hedges layout={sideLayout} />
      <Walls layout={frontLayout} face={PLASTER} cap={PLASTER_LIGHT} />
      {front.map((b, i) => <rect key={i} x={b.x * tile + 3} y={b.y * tile + 16} width={b.w * tile - 6} height="3" fill={P.orange} />)}
      <Plate x={17 * tile + 150} y={16 * tile + 6} w={118} h={14} text="No parking. Gate in use" fill={P.paper} color={P.ink} mono size={6} />

      {/* The party title on a banner above the LED screen. */}
      <g>
        <rect x="341" y="40" width="288" height="26" fill={P.shadow} opacity=".3" />
        <rect x="336" y="34" width="288" height="26" fill={P.orange} stroke={P.ink} strokeWidth="3" />
        <rect x="342" y="38" width="276" height="18" fill={P.night} />
        <text x="480" y="52" textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={bannerSize} letterSpacing="1">{title}</text>
      </g>

      {/* Dusk: a night wash, then warm pools of light under the lamps, the fire and the stage. */}
      <rect width={W} height={H} fill={P.night} opacity=".13" />
      <ellipse cx="480" cy="256" rx="210" ry="34" fill={P.orange} opacity=".1" />
      <circle cx={p1[0]} cy={p1[1] + 52} r="42" fill={P.gold} opacity=".13" />
      <circle cx={p2[0]} cy={p2[1] + 52} r="42" fill={P.gold} opacity=".13" />
      <circle cx={p3[0]} cy={p3[1] + 52} r="42" fill={P.gold} opacity=".13" />
      <circle cx={p4[0]} cy={p4[1] + 52} r="42" fill={P.gold} opacity=".13" />
      <circle cx={5 * tile} cy={10 * tile} r="64" fill={P.gold} opacity=".16" />
      <circle cx="480" cy={14 * tile} r="40" fill={P.gold} opacity=".1" />

      <Props layout={layout} uid={uid} custom={custom} order={(q) => (q.solid === false ? -100 : q.y)} />

      {/* Stage lights spilling onto the crowd. */}
      <path d="M365 160L315 300H395Z M505 160L455 300H535Z" fill={P.gold} opacity=".07" />
      <path d="M455 160L405 300H485Z M595 160L545 300H625Z" fill={P.orange} opacity=".07" />

      {/* Gate pillars and the welcome plate over the gateway. */}
      <path d={`M${gapX - 16} ${gapY - 28}h16v${tile + 28}h-16z M${gapX + 2 * tile} ${gapY - 28}h16v${tile + 28}h-16z`} fill={PLASTER} stroke={P.ink} strokeWidth="2" />
      <path d={`M${gapX - 13} ${gapY - 25}h3v${tile + 22}h-3z M${gapX + 2 * tile + 3} ${gapY - 25}h3v${tile + 22}h-3z`} fill={PLASTER_LIGHT} />
      <path d={`M${gapX - 19} ${gapY - 36}h22v8h-22z M${gapX + 2 * tile - 3} ${gapY - 36}h22v8h-22z`} fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <Plate x={gapX + 2} y={gapY - 20} w={2 * tile - 4} h={13} text="Welcome" fill={P.orange} color={P.night} size={8} />

      {/* Poles on the hedges, then the string lights and the bunting over the lawn. */}
      <path d={`M46 226h4v62h-4z M46 350h4v62h-4z M${W - 50} 226h4v62h-4z M${W - 50} 350h4v62h-4z`} fill={P.woodLight} stroke={P.ink} strokeWidth="1" />
      <path d={`M43 220h10v6H43z M43 344h10v6H43z M${W - 53} 220h10v6H${W - 53}z M${W - 53} 344h10v6H${W - 53}z`} fill={P.gold} stroke={P.ink} strokeWidth="1" />
      <Lights a={p1} b={p2} sag={14} n={14} />
      <Lights a={p3} b={p4} sag={14} n={14} />
      <Lights a={p1} b={[48, 226]} sag={10} n={8} />
      <Lights a={p2} b={[W - 48, 226]} sag={10} n={8} />
      <Lights a={p3} b={[48, 350]} sag={10} n={8} />
      <Lights a={p4} b={[W - 48, 350]} sag={10} n={8} />
      <Bunting a={[gapX - 8, gapY - 36]} b={[48, 350]} sag={16} n={9} />
      <Bunting a={[gapX + 2 * tile + 8, gapY - 36]} b={[W - 48, 350]} sag={16} n={9} />
    </svg>
  );
}
