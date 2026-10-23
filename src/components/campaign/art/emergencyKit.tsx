import type { ReactNode } from "react";
import type { CampaignLayout, CampaignProp } from "@/lib/campaign/layout";
import { BrandSign, FONT, P, Shade, Walls } from "./kit";

/**
 * The shared drawing bits of the Emergency Room by SOS room: their colours (one place), display text that always fits, the
 * heartbeat line, the section sign layout, a few furniture pieces (speaker, DJ gear, bench, the way out) and the room shell
 * (light grey floor, ribbed grey walls). The room itself is src/lib/campaign/rooms/emergencyRoom.ts; its sections are drawn
 * in emergencyRaveKit.tsx. Same pixel look as the other rooms: crispEdges, flat fills, 2 px ink outlines, light from the top left.
 * Their brand is dull brick red, bone and charcoal; charcoal is outlines and small type only, never a big fill.
 */
export type Draw = (prop: CampaignProp, tile: number) => ReactNode;

export const ER = {
  red: "#A8402F", redDeep: "#7E2F27", redTint: "#DDB3A9", redPale: "#EBD3CC",
  bone: "#EFE9E1", boneShade: "#D8D0C4", boneDark: "#B9B0A3",
  charcoal: "#2B2B2E", charSoft: "#55555C",
  floor: "#D9DEE6", floorLine: "#C8CED8", floorSpeck: "#E8ECF2",
  wall: "#A3AAB6", wallCap: "#D0D5DD", ground: "#5A606C",
  // Merch: clear but not loud, the clothes rail and stacks (the brand red is one of them).
  merch: ["#A8402F", "#D9A63A", "#5E8FB5", "#4F8A63", "#E9E1D3", "#C7745D", "#7A6AA8"],
  // The logo plate: their near-black red, and a warm lamp light for the lounge.
  logoDark: "#150706", lamp: "#FFF1C9",
} as const;

/** A heartbeat line (ECG) across a w by h box. */
export function Heartbeat({ x, y, w, h, color = ER.red, sw = 2 }: { x: number; y: number; w: number; h: number; color?: string; sw?: number }) {
  const pts: [number, number][] = [[0, 0.55], [0.18, 0.55], [0.24, 0.4], [0.3, 0.55], [0.38, 0.55], [0.42, 0.7], [0.48, 0.05], [0.54, 0.95], [0.58, 0.55], [0.68, 0.55], [0.74, 0.4], [0.82, 0.55], [1, 0.55]];
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${(x + px * w).toFixed(1)} ${(y + py * h).toFixed(1)}`).join("");
  return <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="miter" strokeLinecap="butt" />;
}

/** Display text that always fits `w`: the size steps down for a long line. Anchored at the middle by default. */
export function FitText({ x, y, w, text, max = 14, min = 6, fill = ER.charcoal, anchor = "middle", mono = false, spacing = 0.4, weight = 900 }: { x: number; y: number; w: number; text: string; max?: number; min?: number; fill?: string; anchor?: "start" | "middle" | "end"; mono?: boolean; spacing?: number; weight?: number }) {
  const t = text.toUpperCase();
  const size = Math.max(min, Math.min(max, w / Math.max(1, t.length * (mono ? 0.66 : 0.8))));
  return <text x={x} y={y} textAnchor={anchor} fill={fill} fontFamily={mono ? FONT.mono : FONT.display} fontWeight={mono ? 500 : weight} fontSize={size} letterSpacing={spacing}>{t}</text>;
}

/** How a section sign lays out: one line when the title fits at 10 px or more, otherwise two lines (split at the space nearest the middle). */
export function plateMetrics(w: number, title: string, sub?: string) {
  const tw = w - 12;
  const t = title.toUpperCase();
  const two = t.length * 0.8 * 10 > tw && t.includes(" ");
  let lines = [t];
  if (two) {
    const mid = t.length / 2;
    let best = -1;
    for (let i = 0; i < t.length; i++) if (t[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    lines = [t.slice(0, best), t.slice(best + 1)];
  }
  const hh = lines.length === 2 ? (sub ? 46 : 36) : sub ? 32 : 24;
  return { tw, lines, hh };
}

/** A simple low speaker, bone with a charcoal cone, red strip. */
function ErSpeaker({ w, h }: { w: number; h: number }) {
  const n = Math.max(1, Math.floor(h / 30));
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="2" y="1" width={w - 6} height={h - 3} fill={ER.boneShade} stroke={ER.charcoal} strokeWidth="2" />
      {Array.from({ length: n }, (_, i) => <g key={i}><circle cx={w / 2 - 2} cy={15 + i * 30} r="9" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1.5" /><circle cx={w / 2 - 2} cy={15 + i * 30} r="3.5" fill={ER.boneDark} /></g>)}
      <rect x="5" y={h - 7} width={w - 12} height="3" fill={ER.red} />
    </g>
  );
}

/** The DJ gear on a deck: two platters and a mixer on a bone board. */
function ErBooth({ w }: { w: number }) {
  return (
    <g>
      <rect x="1" y="2" width={w - 2} height="28" fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
      <rect x="3" y="4" width={w - 6} height="16" fill={ER.boneShade} />
      <circle cx={w / 2 - 34} cy="13" r="9" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1.5" /><circle cx={w / 2 - 34} cy="13" r="3" fill={ER.red} />
      <circle cx={w / 2 + 34} cy="13" r="9" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1.5" /><circle cx={w / 2 + 34} cy="13" r="3" fill={ER.red} />
      <rect x={w / 2 - 12} y="5" width="24" height="14" fill={P.white} stroke={ER.charcoal} strokeWidth="1" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={w / 2 - 9 + i * 6} y="8" width="2" height="8" fill={ER.red} opacity={i % 2 ? 0.55 : 1} />)}
      <rect x="3" y="23" width={w - 6} height="4" fill={ER.red} />
    </g>
  );
}

/** Furniture and the way out: kinds erspeaker, erbooth, erbench, ergate (bone posts, a lifted arm, WAY OUT, the Hoppaz wordmark over it). */
export function erProps(): Record<string, Draw> {
  return {
    erspeaker: (p) => <ErSpeaker w={p.w * 32} h={p.h * 32} />,
    erbooth: (p) => <ErBooth w={p.w * 32} />,
    erbench: (p) => {
      const w = p.w * 32;
      return (
        <g>
          <Shade w={w} h={30} />
          <rect x="3" y="7" width={w - 8} height="14" fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
          <rect x="3" y="3" width={w - 8} height="5" fill={ER.redTint} stroke={ER.charcoal} strokeWidth="1.5" />
          <path d={`M8 22v6M${w - 13} 22v6`} stroke={ER.charcoal} strokeWidth="3" />
        </g>
      );
    },
    ergate: (p) => {
      const w = p.w * 32;
      return (
        <g>
          <ellipse cx={w / 2 + 2} cy="29" rx={w / 2 - 2} ry="3" fill={P.shadow} opacity=".25" />
          <rect x="2" y="-6" width="10" height="37" fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" /><rect x="2" y="-6" width="10" height="6" fill={ER.red} stroke={ER.charcoal} strokeWidth="2" />
          <rect x={w - 12} y="-6" width="10" height="37" fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" /><rect x={w - 12} y="-6" width="10" height="6" fill={ER.red} stroke={ER.charcoal} strokeWidth="2" />
          <path d={`M12 8L${w - 14} -8`} stroke={ER.charcoal} strokeWidth="7" /><path d={`M12 8L${w - 14} -8`} stroke={ER.bone} strokeWidth="4" />
          <rect x="12" y="19" width={w - 24} height="9" fill={ER.bone} stroke={ER.charcoal} strokeWidth="1.5" />
          <FitText x={w / 2} y={26.5} w={w - 28} text="WAY OUT" max={7} fill={ER.red} spacing={0.8} />
          <BrandSign x={-18} y={-76} w={84} h={38} wordmark tone="night" />
        </g>
      );
    },
  };
}

/** Light grey floor, ribbed grey walls and the outer ring: the shell of the room. */
export function ErShell({ uid, W, H, tile, children }: { uid: string; W: number; H: number; tile: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <defs>
        <pattern id={`${uid}-slab`} width="64" height="64" patternUnits="userSpaceOnUse">
          <rect width="64" height="64" fill={ER.floor} />
          <path d="M0 0H64M0 0V64" stroke={ER.floorLine} strokeWidth="2" />
          <path d="M9 12h3M40 22h2M22 44h4M52 50h2M48 8h1M6 54h2" stroke={ER.floorSpeck} strokeWidth="2" />
        </pattern>
        <pattern id={`${uid}-rib`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect x="0" width="2" height="12" fill="#FFFFFF" opacity=".25" />
          <rect x="2" width="2" height="12" fill={P.shadow} opacity=".12" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill={ER.ground} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-slab)`} stroke={ER.charcoal} strokeWidth="4" />
      {children}
    </svg>
  );
}

/** The cutaway walls in the greys, with the ribbed cladding laid over them. */
export function ErWalls({ layout, uid, tile }: { layout: CampaignLayout; uid: string; tile: number }) {
  return (
    <g>
      <Walls layout={layout} face={ER.wall} cap={ER.wallCap} />
      {layout.walls.map((w, i) => <rect key={i} x={w.x * tile + 3} y={w.y * tile + 8} width={w.w * tile - 6} height={Math.max(2, w.h * tile - 16)} fill={`url(#${uid}-rib)`} />)}
    </g>
  );
}

/** A flat octagon path in a w by h box with corners cut by `c`. */
export const octagon = (x: number, y: number, w: number, h: number, c: number) => `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + h - c}L${x + w - c} ${y + h}H${x + c}L${x} ${y + h - c}V${y + c}Z`;
