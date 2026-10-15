/**
 * The shared art kit for event and hotspot rooms. Same pixel look as the 360Playlist clubhouse (ClubhouseArt.tsx): a
 * top-left light, a hard lower-right shadow, 2 px ink outlines, three tones per material, `crispEdges`. The clubhouse
 * palette is kept and the Hoppaz brand colours and a few Lagos street colours (danfo yellow, keke green, lagoon blue)
 * are added next to it, so a room reads as the same game and as Hoppaz.
 *
 * Everything draws in scene pixels (a tile is 32 px). A prop is drawn in its own local box: (0,0) is the top-left of the
 * box and the box is `w` by `h` px. Rooms import what they need and draw the rest themselves (hero landmarks, custom
 * props): see the room files next to this one.
 */
import type { ReactNode } from "react";
import type { Block } from "@/lib/campaign/geometry";
import type { CampaignLayout, CampaignProp } from "@/lib/campaign/layout";

/** What a room's art may show that comes from outside: an event's flyer and line-up, or a place's sign. */
export type RoomArtContent = {
  /** The event's name, or the place's sign. Upper-cased where it is drawn. */
  title: string;
  /** A second line: venue and date for an event, the welcome line for a place. */
  line?: string;
  /** The event flyer (a poster image). The art draws a branded placeholder when there is none. */
  flyerUrl?: string | null;
  /** The line-up, in order. At most six show. */
  lineup?: { name: string; time?: string }[];
};

export type RoomArtProps = { layout: CampaignLayout; uid: string; brand: string; content?: RoomArtContent };

/** Shared materials. The clubhouse tones first, then the brand and the street. */
export const P = {
  ink: "#282A31", shadow: "#181B21", wall: "#4C4F58", cap: "#75777C", cream: "#EADFC4", paper: "#F5EBDD",
  wood: "#9A7150", woodLight: "#BF9570", woodDark: "#6D4E37", mint: "#7F9C79", leaf: "#597855", leafDark: "#3E5840",
  slate: "#556E79", slateLight: "#839EA6", ember: "#F47945", emberDark: "#B34B28", gold: "#D8B468", goldDark: "#8C713D", stone: "#C4BDA7",
  // Hoppaz brand, used for signs, doors and the flyer only (orange stays the loudest thing on a wall).
  orange: "#FF4D00", brandEmber: "#B83600", night: "#0E0B0A", violet: "#5B2EFF", violetLight: "#8C73FF", violetDark: "#3A1CB0",
  // Lagos street.
  danfo: "#F2B705", danfoDark: "#B58500", keke: "#2FA84F", kekeDark: "#1F7A38", lagoon: "#3E8FB8", lagoonLight: "#8CCBE0", lagoonDark: "#2A6685",
  asphalt: "#3A3D44", asphaltLight: "#4A4E57", concrete: "#C9C3B3", concreteDark: "#A39D8C", red: "#C94A3E", white: "#F2EEE3",
} as const;

export const FONT = { display: "var(--font-poppins),sans-serif", mono: "var(--font-mono),monospace" } as const;

export const px = (tiles: number, tile = 32) => tiles * tile;

/** One drop shadow under a box: lower right, soft ink. */
export function Shade({ w, h, dx = 4, dy = 6, o = 0.25 }: { w: number; h: number; dx?: number; dy?: number; o?: number }) {
  return <rect x={dx} y={dy} width={w - 2} height={h - 2} fill={P.shadow} opacity={o} />;
}

/**
 * A box seen from slightly above: a front face under a top face, ink outline, light on the top-left edge. The workhorse for
 * counters, stages, loungers, crates, stalls.
 */
export function Box({ x = 0, y = 0, w, h, top, front, depth = 8, edge = P.ink, shade = true }: { x?: number; y?: number; w: number; h: number; top: string; front: string; depth?: number; edge?: string; shade?: boolean }) {
  return (
    <g>
      {shade && <Shade w={w} h={h} />}
      <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} fill={front} stroke={edge} strokeWidth="2" />
      <rect x={x + 2} y={y + 2} width={w - 4} height={h - depth - 3} fill={top} />
      <rect x={x + 2} y={y + 2} width={w - 4} height="2" fill={P.paper} opacity=".35" />
    </g>
  );
}

/** A text plate: ink plate, cream text, text size steps down so a long name always fits. */
export function Plate({ x, y, w, h = 16, text, fill = P.ink, color = P.paper, size, mono = false, weight = 900, spacing = 0.6 }: { x: number; y: number; w: number; h?: number; text: string; fill?: string; color?: string; size?: number; mono?: boolean; weight?: number; spacing?: number }) {
  const t = text.toUpperCase();
  const fit = Math.max(5, Math.min(size ?? h - 6, (w - 8) / Math.max(1, t.length * (mono ? 0.62 : 0.7))));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke={P.ink} strokeWidth="2" />
      <text x={x + w / 2} y={y + h / 2 + fit * 0.36} fill={color} fontFamily={mono ? FONT.mono : FONT.display} fontWeight={weight} fontSize={fit} textAnchor="middle" letterSpacing={spacing}>{t}</text>
    </g>
  );
}

/** Patterns every room can use, by name: `url(#${uid}-${name})`. Add only the ones the room needs through `names`. */
export function Defs({ uid, names }: { uid: string; names: string[] }) {
  const want = new Set(names);
  const fill = (id: string, node: ReactNode, w = 32, h = 32) => (want.has(id) ? <pattern key={id} id={`${uid}-${id}`} width={w} height={h} patternUnits="userSpaceOnUse">{node}</pattern> : null);
  return (
    <defs>
      {fill("concrete", <><rect width="32" height="32" fill={P.concrete} /><path d="M0 0H32V32" fill="none" stroke="#B9B3A2" strokeWidth="1" /><path d="M5 6h2M22 20h3M13 26h1M27 4h2" stroke="#D6D0C0" strokeWidth="1" /></>)}
      {fill("paving", <><rect width="32" height="16" fill="#D8C9A8" /><path d="M0 0H32M0 8H32M0 16H32M8 0V8M24 0V8M16 8V16M0 8V16" stroke="#BFAE8A" strokeWidth="1" /><path d="M3 3h2M20 12h2" stroke="#E6D9BC" strokeWidth="1" /></>, 32, 16)}
      {fill("asphalt", <><rect width="32" height="32" fill={P.asphalt} /><path d="M4 5h2M20 14h3M11 25h2M27 8h1M6 19h1" stroke={P.asphaltLight} strokeWidth="1" /><path d="M15 3h1M25 27h2" stroke="#2E3037" strokeWidth="1" /></>)}
      {fill("grass", <><rect width="32" height="32" fill={P.mint} /><path d="M4 6h3v2M20 22h3v2M12 17h2M28 3h2" stroke={P.leaf} strokeWidth="1" /><path d="M5 25h3M24 12h2" stroke="#9BB38A" strokeWidth="1" /></>)}
      {fill("sand", <><rect width="32" height="32" fill="#DBC896" /><path d="M3 5h3M19 14h2M9 24h4M26 27h2" stroke="#C9B37C" strokeWidth="1" /><path d="M14 8h1M24 20h1" stroke="#EBDDB1" strokeWidth="1" /></>)}
      {fill("deck", <><rect width="32" height="16" fill="#B98A5E" /><path d="M0 0H32M0 8H32M0 15H32" stroke="#8C6542" strokeWidth="1" /><path d="M6 4h8M20 12h8" stroke="#CFA479" strokeWidth="1" /></>, 32, 16)}
      {fill("water", <><rect width="32" height="16" fill={P.lagoon} /><path d="M2 4h6M18 4h6M10 11h6M26 11h4" stroke={P.lagoonLight} strokeWidth="2" /><path d="M0 15H32" stroke={P.lagoonDark} strokeWidth="1" opacity=".5" /></>, 32, 16)}
      {fill("pooltile", <><rect width="16" height="16" fill="#58B6D8" /><path d="M0 0H16V16" fill="none" stroke="#7FD0EA" strokeWidth="1" /><path d="M3 5h4M9 11h4" stroke="#BDEAF6" strokeWidth="1" opacity=".8" /></>, 16, 16)}
      {fill("checker", <><rect width="32" height="32" fill="#2A2C34" /><rect width="16" height="16" fill="#343740" /><rect x="16" y="16" width="16" height="16" fill="#343740" /></>)}
      {fill("dance", <><rect width="64" height="64" fill={P.night} />{[0, 1, 2, 3].flatMap((cy) => [0, 1, 2, 3].map((cx) => <rect key={`${cx}${cy}`} x={cx * 16 + 1} y={cy * 16 + 1} width="14" height="14" fill={(cx + cy) % 2 ? "#2A1F52" : "#44201A"} />))}<rect x="17" y="1" width="14" height="14" fill={P.violet} /><rect x="49" y="17" width="14" height="14" fill={P.orange} /><rect x="1" y="33" width="14" height="14" fill={P.orange} opacity=".85" /><rect x="33" y="49" width="14" height="14" fill={P.violet} opacity=".85" /><rect x="19" y="3" width="6" height="2" fill={P.paper} opacity=".5" /><rect x="51" y="19" width="6" height="2" fill={P.paper} opacity=".5" /></>, 64, 64)}
      {fill("carpet", <><rect width="32" height="32" fill="#3E2E52" /><path d="M0 0H32V32" fill="none" stroke="#33264A" strokeWidth="1" /><path d="M4 4h2M20 12h2M10 24h2M26 28h2" stroke="#59456F" strokeWidth="1" /></>)}
      {fill("wood", <><rect width="64" height="16" fill={P.woodLight} /><path d="M0 0H64M0 8H64M32 0V8M10 8V16" stroke={P.wood} strokeWidth="1" /><path d="M4 3h20M36 11h18" stroke="#CDA481" strokeWidth="1" /></>, 64, 16)}
      {fill("stagewood", <><rect width="32" height="16" fill="#8E6D53" /><path d="M0 0H32M16 0V16" stroke={P.woodDark} strokeWidth="1" /><path d="M3 7h8M20 12h5" stroke={P.woodLight} strokeWidth="1" /></>, 32, 16)}
      {fill("floortile", <><rect width="32" height="32" fill="#E4DCC8" /><path d="M0 0H32V32" fill="none" stroke="#CFC6AD" strokeWidth="1" /><path d="M4 7h3M20 22h4" stroke="#EFE9D8" strokeWidth="1" /></>)}
      {fill("redcarpet", <><rect width="32" height="32" fill="#8E2B2B" /><path d="M0 0H32V32" fill="none" stroke="#762222" strokeWidth="1" /><path d="M4 4h2M20 12h2M10 24h2" stroke="#A64040" strokeWidth="1" /></>)}
      {fill("acoustic", <><rect width="16" height="16" fill={P.slate} /><path d="M0 0H16V16" fill="none" stroke="#475D66" strokeWidth="1" /><path d="M3 4h2M10 11h2" stroke="#68838A" strokeWidth="1" /></>, 16, 16)}
    </defs>
  );
}

/** Fill a tile rectangle with one named pattern (see Defs). */
export function Floor({ uid, rect, material, tile = 32, border }: { uid: string; rect: Block; material: string; tile?: number; border?: string }) {
  return (
    <g>
      <rect x={rect.x * tile} y={rect.y * tile} width={rect.w * tile} height={rect.h * tile} fill={`url(#${uid}-${material})`} />
      {border && <rect x={rect.x * tile + 1} y={rect.y * tile + 1} width={rect.w * tile - 2} height={rect.h * tile - 2} fill="none" stroke={border} strokeWidth="2" />}
    </g>
  );
}

/** The cutaway wall faces of a layout (same single light as the clubhouse). `face` and `cap` recolour them. */
export function Walls({ layout, face = P.wall, cap = P.cap, edge = P.ink, tile = 32 }: { layout: CampaignLayout; face?: string; cap?: string; edge?: string; tile?: number }) {
  return (
    <g>
      {layout.walls.map((wall, i) => (
        <g key={i}>
          <rect x={wall.x * tile + 5} y={wall.y * tile + 7} width={wall.w * tile} height={wall.h * tile} fill={P.shadow} opacity=".25" />
          <rect x={wall.x * tile} y={wall.y * tile} width={wall.w * tile} height={wall.h * tile} fill={edge} />
          <rect x={wall.x * tile + 3} y={wall.y * tile + 3} width={wall.w * tile - 6} height={Math.max(2, wall.h * tile - 10)} fill={face} />
          <rect x={wall.x * tile + 2} y={wall.y * tile + 2} width={wall.w * tile - 4} height="5" fill={cap} />
        </g>
      ))}
    </g>
  );
}

/** A hedge or fence line instead of a plaster wall (outdoor rooms). */
export function Hedges({ layout, tile = 32 }: { layout: CampaignLayout; tile?: number }) {
  return (
    <g>
      {layout.walls.map((wall, i) => {
        const x = wall.x * tile;
        const y = wall.y * tile;
        const w = wall.w * tile;
        const h = wall.h * tile;
        return (
          <g key={i}>
            <rect x={x + 4} y={y + 6} width={w} height={h} fill={P.shadow} opacity=".25" />
            <rect x={x} y={y} width={w} height={h} fill={P.leafDark} stroke={P.ink} strokeWidth="2" />
            <rect x={x + 2} y={y + 2} width={w - 4} height={Math.max(4, h - 8)} fill={P.leaf} />
            <path d={`M${x + 5} ${y + 5}h${Math.max(2, w - 10)}`} stroke={P.mint} strokeWidth="2" />
            {Array.from({ length: Math.floor(w / 12) }, (_, k) => <rect key={k} x={x + 4 + k * 12} y={y + 8 + ((k * 7) % Math.max(4, h - 14))} width="4" height="3" fill={P.mint} />)}
          </g>
        );
      })}
    </g>
  );
}

/** A row of string lights between two x positions at height y: a sagging line with warm bulbs. */
export function StringLights({ x1, x2, y, sag = 8, bulbs = 10, colors = [P.gold, P.paper, P.ember] }: { x1: number; x2: number; y: number; sag?: number; bulbs?: number; colors?: string[] }) {
  const pts = Array.from({ length: bulbs }, (_, i) => {
    const t = (i + 0.5) / bulbs;
    return { x: x1 + (x2 - x1) * t, y: y + Math.sin(t * Math.PI) * sag };
  });
  return (
    <g>
      <path d={`M${x1} ${y}Q${(x1 + x2) / 2} ${y + sag * 2} ${x2} ${y}`} fill="none" stroke={P.ink} strokeWidth="1" />
      {pts.map((p, i) => <g key={i}><path d={`M${p.x} ${p.y}v3`} stroke={P.ink} strokeWidth="1" /><rect x={p.x - 2} y={p.y + 3} width="4" height="5" fill={colors[i % colors.length]} stroke={P.ink} strokeWidth="1" /></g>)}
    </g>
  );
}

/** The event flyer in a frame: the image when there is one, otherwise a branded placeholder in the Hoppaz colours. */
export function Flyer({ x, y, w, h, url, title, line, uid }: { x: number; y: number; w: number; h: number; url?: string | null; title: string; line?: string; uid: string }) {
  const clip = `${uid}-flyer`;
  return (
    <g>
      <rect x={x + 4} y={y + 5} width={w} height={h} fill={P.shadow} opacity=".3" />
      <rect x={x} y={y} width={w} height={h} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <clipPath id={clip}><rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} /></clipPath>
      {url ? (
        <image href={url} x={x + 4} y={y + 4} width={w - 8} height={h - 8} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
      ) : (
        <g clipPath={`url(#${clip})`}>
          <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} fill={P.orange} />
          <circle cx={x + w * 0.7} cy={y + h * 0.3} r={w * 0.22} fill={P.violet} />
          <rect x={x + 4} y={y + h * 0.58} width={w - 8} height={h * 0.42} fill={P.night} />
          <text x={x + w / 2} y={y + h * 0.75} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={Math.max(6, Math.min(w * 0.16, (w - 14) / Math.max(4, title.length * 0.62)))}>{title.toUpperCase().slice(0, 18)}</text>
          {line && <text x={x + w / 2} y={y + h * 0.88} textAnchor="middle" fill={P.cream} fontFamily={FONT.mono} fontSize={Math.max(4, w * 0.075)} letterSpacing="1">{line.toUpperCase().slice(0, 22)}</text>}
        </g>
      )}
    </g>
  );
}

/** The line-up on a board: a heading and up to six rows, time on the right. */
export function Lineup({ x, y, w, h, items, title = "LINE-UP" }: { x: number; y: number; w: number; h: number; items: { name: string; time?: string }[]; title?: string }) {
  const rows = items.slice(0, 6);
  const head = Math.min(14, h * 0.2);
  const rowH = Math.min(12, (h - head - 8) / Math.max(1, rows.length));
  return (
    <g>
      <rect x={x + 4} y={y + 5} width={w} height={h} fill={P.shadow} opacity=".3" />
      <rect x={x} y={y} width={w} height={h} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x={x + 2} y={y + 2} width={w - 4} height={head} fill={P.orange} />
      <text x={x + w / 2} y={y + 2 + head * 0.72} textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize={Math.max(6, head * 0.62)} letterSpacing="1">{title}</text>
      {rows.map((row, i) => {
        const ry = y + head + 8 + i * rowH;
        const size = Math.max(5, Math.min(9, rowH * 0.78));
        return (
          <g key={i}>
            <text x={x + 6} y={ry + size * 0.8} fill={i === rows.length - 1 ? P.danfo : P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size}>{row.name.toUpperCase().slice(0, Math.max(6, Math.floor((w - 34) / (size * 0.66))))}</text>
            {row.time && <text x={x + w - 6} y={ry + size * 0.8} textAnchor="end" fill={P.cream} fontFamily={FONT.mono} fontSize={Math.max(5, size - 1)}>{row.time}</text>}
          </g>
        );
      })}
    </g>
  );
}

/** Rows of cheap seats: `n` chairs side by side, tone by variant. */
export function Chairs({ n, w, h, tone = P.emberDark, light = P.ember }: { n: number; w: number; h: number; tone?: string; light?: string }) {
  const cw = w / n;
  return (
    <g>
      <Shade w={w} h={h} dy={4} o={0.2} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i} transform={`translate(${i * cw},0)`}>
          <rect x="3" y="2" width={cw - 6} height={h - 6} fill={tone} stroke={P.ink} strokeWidth="2" />
          <rect x="5" y="4" width={cw - 10} height={Math.max(4, (h - 6) * 0.4)} fill={light} />
          <rect x="5" y={h * 0.5} width={cw - 10} height={Math.max(3, h * 0.28)} fill={light} opacity=".7" />
        </g>
      ))}
    </g>
  );
}

/** Door out to the map: a double door in the wall with an EXIT plate (events). */
export function ExitDoorArt({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="4" width={w / 2 - 5} height={h - 8} fill={P.wood} stroke={P.ink} strokeWidth="1" />
      <rect x={w / 2 + 1} y="4" width={w / 2 - 5} height={h - 8} fill={P.wood} stroke={P.ink} strokeWidth="1" />
      <rect x={w / 2 - 6} y={h / 2 - 1} width="3" height="5" fill={P.gold} /><rect x={w / 2 + 3} y={h / 2 - 1} width="3" height="5" fill={P.gold} />
      <rect x={w / 2 - 14} y="-6" width="28" height="9" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <text x={w / 2} y="1.5" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".8">EXIT</text>
    </g>
  );
}

/** A signpost with the city map on it, for street rooms (the way out to the map). */
export function MapBoardArt({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="4" y="2" width={w - 8} height={h - 8} fill={P.wall} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="5" width={w - 14} height={h - 14} fill={P.paper} />
      <path d={`M9 ${h - 14}l10-8 8 4 10-7 ${Math.max(0, w - 54)} 2`} fill="none" stroke={P.lagoon} strokeWidth="3" />
      <rect x="10" y="8" width="8" height="5" fill={P.keke} /><rect x={w - 24} y="12" width="8" height="5" fill={P.danfo} />
      <path d={`M${w / 2 + 2} 8h6v7l-3 4-3-4Z`} fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x={w / 2 - 14} y={h - 7} width="28" height="7" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <text x={w / 2} y={h - 1.5} textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="5.5">MAP</text>
    </g>
  );
}

/** Generic props every room can use. Returns null for a kind it does not know, so a room draws its own. */
export function KitProp({ prop, tile, uid }: { prop: CampaignProp; tile: number; uid: string }): ReactNode {
  void uid;
  const w = prop.w * tile;
  const h = prop.h * tile;
  const v = prop.variant ?? 0;
  switch (prop.kind) {
    case "plant":
      return (
        <g>
          <path d="M8 25H30V32H8Z" fill={P.shadow} opacity=".25" /><path d="M7 19H25L23 31H10Z" fill={P.wood} stroke={P.ink} strokeWidth="2" /><path d="M8 19H24V23H8Z" fill={P.woodLight} />
          <path d="M14 19V3H20V19M14 14H6V5H11V10H14M19 13H27V4H23V9H19" fill={P.leafDark} stroke={P.ink} strokeWidth="2" /><path d="M14 3H18V10H14M7 6H10V10H7M24 5H26V10H24" fill={P.mint} /><path d="M11 17H3V11H8V14H12M20 17H29V12H25V14H20" fill={P.leaf} />
        </g>
      );
    case "palm":
      return (
        <g>
          <ellipse cx={w / 2 + 2} cy={h - 5} rx="11" ry="4" fill={P.shadow} opacity=".25" />
          <path d={`M${w / 2 - 2} ${h - 6}L${w / 2} ${h * 0.35}h5L${w / 2 + 6} ${h - 6}Z`} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <path d={`M${w / 2 + 1} ${h * 0.35}c-12-12-24-8-28 2c9-5 17-3 24 3ZM${w / 2 + 1} ${h * 0.35}c12-12 24-8 28 2c-9-5-17-3-24 3ZM${w / 2 + 1} ${h * 0.35}c-4-15-1-24 7-26c-3 9-3 17-1 26ZM${w / 2 + 1} ${h * 0.35}c-14-2-20 5-20 12c6-6 12-8 20-8Z`} fill={P.leaf} stroke={P.ink} strokeWidth="2" />
          <circle cx={w / 2 + 1} cy={h * 0.36} r="3" fill={P.goldDark} />
        </g>
      );
    case "tree":
      return (
        <g>
          <path d="M-3 20H34V32H-3Z" fill={P.shadow} opacity=".25" /><path d="M12 12H21V34H12Z" fill={P.woodDark} /><path d="M12 16H16V31H12Z" fill={P.woodLight} />
          <path d="M2-10H26V-4H34V16H27V24H3V18H-5V-2H2Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" /><path d="M2-7H24V-1H31V12H23V19H1V13H-2V0H2Z" fill={P.leaf} /><path d="M5-4H19V2H24V7H11V4H1V1H5Z" fill={P.mint} />
        </g>
      );
    case "speaker":
    case "speakerstack":
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="3" y="1" width={w - 8} height={h - 4} fill={P.ink} stroke={P.shadow} strokeWidth="2" /><rect x="5" y="3" width="3" height={h - 8} fill={P.wall} />
          {Array.from({ length: Math.max(1, Math.floor(h / 22)) }, (_, i) => <g key={i}><circle cx={w / 2} cy={14 + i * 22} r="8" fill={P.wall} stroke={P.shadow} strokeWidth="2" /><circle cx={w / 2} cy={14 + i * 22} r="4" fill={P.slate} /></g>)}
          <rect x="9" y={h - 8} width={Math.max(6, w - 20)} height="2" fill={P.orange} />
        </g>
      );
    case "stage":
      return (
        <g>
          <rect x="4" y="6" width={w} height={h} fill={P.shadow} opacity=".25" />
          <rect x="0" y="0" width={w} height={h} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="2" y="2" width={w - 4} height={h - 12} fill={`url(#${uid}-stagewood)`} />
          <rect x="2" y={h - 10} width={w - 4} height="8" fill={P.woodDark} />
          <path d={`M4 ${h - 6}H${w - 4}`} stroke={P.orange} strokeWidth="2" />
        </g>
      );
    case "bar":
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="2" y="2" width={w - 4} height={Math.min(14, h - 8)} fill={P.ink} />
          {Array.from({ length: Math.floor((w - 12) / 10) }, (_, i) => <g key={i} transform={`translate(${8 + i * 10},4)`}><rect width="4" height="8" fill={[P.mint, P.gold, P.orange, P.violetLight][i % 4]} stroke={P.shadow} strokeWidth="1" /></g>)}
          <rect x="2" y={Math.min(16, h - 14)} width={w - 4} height="6" fill={P.woodLight} />
          <rect x="2" y={h - 7} width={w - 4} height="3" fill={P.orange} />
        </g>
      );
    case "djbooth":
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.ink} stroke={P.shadow} strokeWidth="2" />
          <rect x="3" y="3" width={w - 6} height={h - 12} fill={P.wall} />
          <circle cx={w / 2 - 14} cy={h / 2 - 3} r="9" fill={P.ink} stroke={P.slateLight} strokeWidth="2" /><circle cx={w / 2 - 14} cy={h / 2 - 3} r="2" fill={P.orange} />
          <circle cx={w / 2 + 14} cy={h / 2 - 3} r="9" fill={P.ink} stroke={P.slateLight} strokeWidth="2" /><circle cx={w / 2 + 14} cy={h / 2 - 3} r="2" fill={P.violetLight} />
          <rect x={w / 2 - 5} y="6" width="10" height={h - 20} fill={P.slate} /><rect x={w / 2 - 3} y="9" width="2" height="5" fill={P.paper} /><rect x={w / 2 + 1} y="12" width="2" height="5" fill={P.paper} />
          <rect x="3" y={h - 8} width={w - 6} height="3" fill={P.orange} />
        </g>
      );
    case "table":
    case "cocktail":
      return (
        <g>
          <ellipse cx={w / 2 + 3} cy={h - 6} rx={w / 2 - 6} ry="6" fill={P.shadow} opacity=".25" />
          <path d={`M${w / 2 - 2} ${h / 2}h4v${h / 2 - 6}h-4Z`} fill={P.ink} />
          <ellipse cx={w / 2} cy={h / 2 - 2} rx={w / 2 - 6} ry={Math.max(7, h / 2 - 8)} fill={v ? P.woodLight : P.paper} stroke={P.ink} strokeWidth="2" />
          <circle cx={w / 2 - 4} cy={h / 2 - 3} r="2" fill={P.orange} /><circle cx={w / 2 + 5} cy={h / 2 - 1} r="2" fill={P.slateLight} />
        </g>
      );
    case "sofa":
    case "booth":
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="2" width={w - 4} height={h - 5} fill={v ? P.violetDark : P.emberDark} stroke={P.ink} strokeWidth="2" />
          <rect x="3" y="3" width={w - 8} height={Math.min(10, h / 3)} fill={v ? P.violet : P.ember} />
          <rect x="3" y={Math.min(13, h / 3 + 4)} width={w - 8} height={h - Math.min(13, h / 3 + 4) - 6} fill={v ? P.violetLight : "#CC7752"} opacity=".9" />
          <path d={`M${w / 2 - 1} ${Math.min(13, h / 3 + 4)}v${h / 3}`} stroke={P.ink} strokeWidth="2" />
        </g>
      );
    case "lamp":
      return (
        <g>
          <rect x="12" y="25" width="17" height="6" fill={P.shadow} opacity=".25" /><path d="M16 9V27M9 27H23" stroke={P.ink} strokeWidth="3" /><path d="M10 3H22L27 15H5Z" fill={P.gold} stroke={P.ink} strokeWidth="2" /><path d="M11 5H16L14 12H8Z" fill={P.cream} />
        </g>
      );
    case "bench":
      return (
        <g>
          <Shade w={w} h={h} />
          <path d={`M3 7H${w - 4}V25H3Z`} fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><path d={`M3 4H${w - 4}V8H3ZM3 11H${w - 4}V15H3ZM3 18H${w - 4}V22H3Z`} fill={P.woodLight} /><path d={`M8 26v4M${w - 11} 26v4`} stroke={P.ink} strokeWidth="3" />
        </g>
      );
    case "crate":
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="2" y="3" width={w - 6} height={h - 7} fill={P.wood} stroke={P.ink} strokeWidth="2" /><path d={`M4 ${h / 2}H${w - 6}M${w / 2 - 1} 5V${h - 6}`} stroke={P.woodDark} strokeWidth="2" /><rect x="4" y="5" width={w - 10} height="3" fill={P.woodLight} />
        </g>
      );
    case "door":
      return <ExitDoorArt w={w} h={h} />;
    case "gate":
      return (
        <g>
          <rect x="2" y={h - 8} width={w - 4} height="7" fill={P.shadow} opacity=".3" />
          <rect x="6" y="6" width={w - 12} height={h - 8} fill={P.cream} opacity=".18" />
          <rect x="4" y="2" width="6" height={h - 3} fill={P.ink} /><rect x="5" y="3" width="2" height={h - 6} fill={P.cap} />
          <rect x={w - 10} y="2" width="6" height={h - 3} fill={P.ink} /><rect x={w - 9} y="3" width="2" height={h - 6} fill={P.cap} />
          <rect x="2" y="0" width="8" height="5" fill={P.gold} stroke={P.ink} strokeWidth="1" /><rect x={w - 12} y="0" width="8" height="5" fill={P.gold} stroke={P.ink} strokeWidth="1" />
          <path d={`M10 10Q${w / 2} ${h - 4} ${w - 10} 10`} fill="none" stroke={P.red} strokeWidth="3" />
          <rect x={w / 2 - 15} y="-4" width="30" height="9" fill={P.orange} stroke={P.ink} strokeWidth="2" />
          <text x={w / 2} y="3" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".6">EXIT</text>
        </g>
      );
    case "stool":
      return (
        <g>
          <ellipse cx="17" cy="27" rx="8" ry="3" fill={P.shadow} opacity=".3" />
          <path d="M12 16L10 28M20 16L22 28" stroke={P.ink} strokeWidth="3" />
          <ellipse cx="16" cy="14" rx="9" ry="5" fill={P.orange} stroke={P.ink} strokeWidth="2" /><ellipse cx="14" cy="12.5" rx="4" ry="1.5" fill={P.paper} opacity=".45" />
        </g>
      );
    case "dancefloor":
      return (
        <g>
          <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-dance)`} stroke={P.ink} strokeWidth="2" />
          <rect x="3" y="3" width={w - 6} height={h - 6} fill="none" stroke={P.violetLight} strokeWidth="2" opacity=".7" />
        </g>
      );
    case "mapboard":
      return <MapBoardArt w={w} h={h} />;
    default:
      return null;
  }
}

/** Everything a room's props need: the kit's own, or a room's (`custom`, by prop id first and then by kind). */
export function Props({ layout, uid, custom = {}, order }: { layout: CampaignLayout; uid: string; custom?: Record<string, (prop: CampaignProp, tile: number) => ReactNode>; order?: (prop: CampaignProp) => number }) {
  const tile = layout.grid.tile;
  const sorted = [...layout.props].sort((a, b) => (order ? order(a) - order(b) : (a.kind === "rug" ? -100 : a.y) - (b.kind === "rug" ? -100 : b.y)));
  return (
    <>
      {sorted.map((prop) => {
        const art = custom[prop.id]?.(prop, tile) ?? custom[prop.kind]?.(prop, tile) ?? KitProp({ prop, tile, uid });
        return <g key={prop.id} transform={`translate(${prop.x * tile},${prop.y * tile})`} data-prop={prop.id}>{art}</g>;
      })}
    </>
  );
}

/** Dark surround + room frame shared by every scene. */
export function Frame({ layout, ground = "#2E3431" }: { layout: CampaignLayout; ground?: string }) {
  const w = layout.grid.width * layout.grid.tile;
  const h = layout.grid.height * layout.grid.tile;
  return <rect width={w} height={h} fill={ground} />;
}
