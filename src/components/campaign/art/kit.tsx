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
  // Brand kit (15 Oct 2026): brand cream by name (same as paper: use it, never `white` or `cream`, on a Hoppaz surface),
  // and the app's night ramp from globals.css, for the walls and floors of a dark room instead of a blue or purple grey.
  brandCream: "#F5EBDD", nightRaised: "#171210", nightCard: "#221A17", nightLine: "#2E2320", nightDim: "#9C9087",
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

/* =====================================================================================================================
 * THE HOPPAZ BRAND KIT (15 Oct 2026). Append-only: nothing above this block changed.
 *
 * The brand's own objects, in the same pixel look as everything above: crispEdges, flat fills, 2 px ink outlines, light
 * from the top left, a hard shadow to the lower right, no gradients. The rules they serve are the "Look" section of
 * docs/ROOM-TEMPLATES.md: orange is the loudest designed colour in a room, one violet shape per room (HopFlyer's sun is
 * it in an event room), brand cream (P.paper / P.brandCream) and night on every Hoppaz surface, Poppins 900 for signs and
 * DM Mono caps for captions, brand lines only (BRAND_LINES). Each component is drawn at (x, y) in the caller's space, or
 * in a prop's own box where it says so.
 * ===================================================================================================================== */

/** The five Hoppaz colours, and nothing else on a Hoppaz surface. Night 60 / orange 25 / cream 10 / violet 5 (one shape). Ember is shadows and pressed lips only. */
export const BRAND = { orange: "#FF4D00", night: "#0E0B0A", cream: "#F5EBDD", violet: "#5B2EFF", ember: "#B83600" } as const;

/** The lines a room may print on a Hoppaz surface: the conductor's voice. A time (`leaves`, `board`) only where the room is a Hop. */
export const BRAND_LINES = {
  hop: "HOP OR STAY",
  wait: "THE BUS NEVER WAITS",
  friends: "COME ALONE. LEAVE WITH FRIENDS.",
  fifth: "THE BUS IS THE FIFTH PARTY",
  leaves: "BUS LEAVES AT 7. HOP OR STAY.",
  board: "BOARD 6PM",
} as const;

/**
 * Wordmark letter slots in cap heights (H O P P A Z): each glyph's ink width in Poppins Black (cap height 708 of 1000)
 * plus an even 0.07 h gap, wide enough that the opposite tilts never touch. WM_DX centres P's ink (its side bearings differ).
 */
const WM_SLOTS = [0.995, 1.1, 0.888, 0.888, 1.162, 0.819];
const WM_DX = [0, 0, -0.021, -0.021, 0, 0];
/** The wordmark's width at cap height `h` (about 5.85 h). The ears rise 0.8 h above the letters: leave that much headroom. */
export const wordmarkWidth = (h: number) => WM_SLOTS.reduce((a, b) => a + b, 0) * h;

/**
 * The two block ears out of the A, as on public/brand/wordmark-*.png (left upright, right folded over), on a grid of
 * 0.07 h pixels: [column, row, width, height] rects for the outline, the gap inside it and the inner ear (even-odd fill).
 */
const EARS = [
  { x: -0.4, out: [[1, 0, 4, 1], [0, 1, 6, 12]], cut: [[1, 2, 4, 11], [2, 4, 2, 9]] },
  { x: 0.06, out: [[1, 0, 7, 1], [0, 1, 9, 1], [0, 2, 10, 3], [0, 5, 6, 8], [7, 5, 3, 3]], cut: [[1, 2, 4, 11], [2, 5, 2, 8]] },
];
/** The ears as one path about the A's top centre (cx, top). Below a 22 px cap height they are solid blocks (the gap would not read). */
const earPath = (cx: number, top: number, h: number) => {
  const u = 0.07 * h;
  const solid = h < 22;
  return EARS.map((e) => [...e.out, ...(solid ? [] : e.cut)].map(([c, r, w, hh]) => `M${(cx + e.x * h + c * u).toFixed(2)} ${(top - 0.8 * h + r * u).toFixed(2)}h${(w * u).toFixed(2)}v${(hh * u).toFixed(2)}h${(-w * u).toFixed(2)}Z`).join("")).join("");
};

/**
 * HOPPAZ with the bounce: Poppins 900 caps, odd letters -4deg and even +4deg about 50% 60% of each letter, one flat
 * baseline, even slots (no overlaps, no vertical nudging), and the bunny ears rising out of the A in blocks. Never a face.
 * Pairs: cream on orange (primary), night on cream, orange on night. About 22 nodes with a shadow.
 *   x, y     top-left of the letters (the cap top); anchor "middle" makes x the centre
 *   h        cap height in px (default 14); the mark is wordmarkWidth(h) wide and the ears rise 0.8 h above y
 *   fill     letter colour (default cream)
 *   keyline  optional colour of a thin outline round letters and ears: the separation device on a busy ground
 *   shadow   optional colour of a hard copy to the lower right (ember on orange, night on cream)
 *   ears     default true
 */
export function HoppazWordmark({ x, y, h = 14, fill = P.paper, keyline, shadow, ears = true, anchor = "start" }: { x: number; y: number; h?: number; fill?: string; keyline?: string; shadow?: string; ears?: boolean; anchor?: "start" | "middle" }) {
  const left = anchor === "middle" ? x - wordmarkWidth(h) / 2 : x;
  const base = y + h;
  const pivot = base - 0.353 * h;
  const k = keyline ? Math.max(1.5, h * 0.08) : 0;
  const centres = WM_SLOTS.map((s, i) => left + (WM_SLOTS.slice(0, i).reduce((a, b) => a + b, 0) + s / 2) * h);
  const ear = ears ? earPath(centres[4], y, h) : "";
  const copy = (color: string, line: string | undefined, dx: number, dy: number) => (
    <g transform={dx || dy ? `translate(${dx} ${dy})` : undefined}>
      {"HOPPAZ".split("").map((ch, i) => (
        <text key={i} x={centres[i] + WM_DX[i] * h} y={base} transform={`rotate(${i % 2 ? 4 : -4} ${centres[i]} ${pivot})`} textAnchor="middle" fill={color} fontFamily={FONT.display} fontWeight={900} fontSize={h / 0.708} stroke={line} strokeWidth={line ? k * 2 : undefined} strokeLinejoin="miter" paintOrder="stroke">{ch}</text>
      ))}
      {ear && <path d={ear} transform={`rotate(-4 ${centres[4]} ${pivot})`} fill={color} fillRule="evenodd" stroke={line} strokeWidth={line ? k * 2 : undefined} paintOrder="stroke" />}
    </g>
  );
  return (
    <g>
      {shadow && copy(shadow, keyline ? shadow : undefined, h * 0.07, h * 0.09)}
      {copy(fill, keyline, 0, 0)}
    </g>
  );
}

/**
 * The Hoppaz bus, parked: the brand's hero object. Drawn like the rooms' danfos (side on, the body rising above its box)
 * but orange, with cream windows, a night band carrying the route motif (three stops and the finale), an ember skirt on
 * the shadow side and a HOP board on the roof. A solid prop: give it a box of its own. About 22 nodes.
 *   w, h    the prop box in px. dir "h": w 96 to 192 (4 or 5 tiles reads best), h 32 (in a 64 box it parks on the lower
 *           tile). dir "v": w 48 to 64, h 96 to 160
 *   dir     "h" side on (default), or "v" seen from above with the nose to the camera
 *   flip    "h": faces left instead of right. "v": nose away (the rear to the camera)
 *   slogan  optional, dir "h" with w >= 160: a BRAND_LINES line in mono caps on the band instead of the route dots
 */
export function HopBus({ w, h, dir = "h", flip = false, slogan }: { w: number; h: number; dir?: "h" | "v"; flip?: boolean; slogan?: string }) {
  if (dir === "v") return <HopBusTop w={w} h={h} rear={flip} />;
  const oy = Math.max(0, h - 32);
  const front = w - 4;
  const n = Math.max(2, Math.floor((w - 48) / 20));
  const windows = Array.from({ length: n }, (_, i) => `M${10 + i * 20} -8h16v13h-16Z`).join("");
  const wheel = (cx: number, r: number) => `M${cx - r} 25a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  const band = Boolean(slogan) && w >= 160;
  const mx = (x: number) => (flip ? w - x : x);
  const words = (slogan ?? "").toUpperCase().slice(0, Math.floor((w - 50) / 4.1));
  return (
    <g transform={oy ? `translate(0 ${oy})` : undefined}>
      <rect x="8" y="20" width={w - 6} height="12" fill={P.shadow} opacity=".3" />
      <g transform={flip ? `translate(${w} 0) scale(-1 1)` : undefined}>
        <path d={`M${front - 38} -15v-3M${front - 16} -15v-3`} stroke={P.ink} strokeWidth="2" />
        <rect x="2" y="-16" width={w - 6} height="40" fill={P.orange} stroke={P.ink} strokeWidth="2" />
        <rect x="3" y="-15" width={w - 8} height="4" fill={P.paper} opacity=".35" />
        <path d={windows} fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
        <rect x={front - 34} y="-9" width="11" height="29" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
        <path d={`M${front - 32} -7h7v9h-7ZM${front - 32} 5h7v9h-7Z`} fill={P.nightLine} />
        <path d={`M${front - 20} -10h14l4 6v12h-18Z`} fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
        <rect x="3" y="8" width={front - 38} height="8" fill={P.night} />
        {!band && <path d={`M12 11.5H${front - 46}`} stroke={P.paper} strokeWidth="1.5" strokeDasharray="4 3" />}
        {!band && <path d={[0, 1, 2].map((i) => `M${Math.round(12 + ((front - 62) * i) / 3)} 10h3v3h-3Z`).join("")} fill={P.paper} />}
        {!band && <rect x={front - 50} y="9" width="6" height="6" fill={P.orange} stroke={P.paper} strokeWidth="1" />}
        <rect x="3" y="17" width={w - 8} height="6" fill={P.brandEmber} />
        <path d={wheel(24, 7) + wheel(front - 24, 7)} fill={P.ink} />
        <path d={wheel(24, 2.5) + wheel(front - 24, 2.5)} fill={P.paper} />
        <rect x={front - 3} y="10" width="3" height="5" fill={P.paper} />
        <rect x="2" y="9" width="3" height="6" fill={P.brandEmber} stroke={P.ink} strokeWidth="1" />
        <rect x={front - 42} y="-28" width="30" height="12" fill={P.night} stroke={P.ink} strokeWidth="2" />
      </g>
      <text x={mx(front - 27)} y="-19" textAnchor="middle" fill={P.orange} fontFamily={FONT.display} fontWeight={900} fontSize="8" letterSpacing=".8">HOP</text>
      {band && <text x={flip ? 42 : 7} y="14.5" fill={P.paper} fontFamily={FONT.mono} fontSize="6" letterSpacing=".5">{words}</text>}
    </g>
  );
}

/** HopBus seen from above (dir "v"): the long orange roof with the route painted down it, the front (or rear) face to the camera. */
function HopBusTop({ w, h, rear }: { w: number; h: number; rear: boolean }) {
  const bw = w - 14;
  const mid = 6 + bw / 2;
  const roofEnd = h - 26;
  const dots = [14, 28, 42].filter((y) => y < roofEnd - 24).map((y) => `M${mid - 1.5} ${y}h3v3h-3Z`).join("");
  return (
    <g>
      <rect x="11" y="8" width={w - 12} height={h - 8} fill={P.shadow} opacity=".3" />
      <path d={`M3 12h4v12h-4ZM${w - 9} 12h4v12h-4ZM3 ${roofEnd - 8}h4v12h-4ZM${w - 9} ${roofEnd - 8}h4v12h-4Z`} fill={P.ink} />
      <rect x="6" y="2" width={bw} height={roofEnd - 2} fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="4" width="3" height={roofEnd - 6} fill={P.paper} opacity=".35" />
      <path d={`M12 10h3v${roofEnd - 18}h-3ZM${w - 16} 10h3v${roofEnd - 18}h-3Z`} fill={P.paper} />
      <rect x={mid - 6} y="8" width="12" height={roofEnd - 14} fill={P.night} />
      <path d={`M${mid} 12V${roofEnd - 16}`} stroke={P.paper} strokeWidth="1.5" strokeDasharray="4 3" />
      {dots && <path d={dots} fill={P.paper} />}
      <rect x={mid - 4} y={roofEnd - 17} width="8" height="8" fill={P.orange} stroke={P.paper} strokeWidth="1" />
      <rect x="6" y={roofEnd} width={bw} height="20" fill={P.brandEmber} stroke={P.ink} strokeWidth="2" />
      <rect x="9" y={roofEnd + 3} width={bw - 6} height="7" fill={rear ? P.night : P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x={mid - 11} y={roofEnd + 11} width="22" height="8" fill={P.night} />
      <text x={mid} y={roofEnd + 17.5} textAnchor="middle" fill={P.orange} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".6">HOP</text>
      <path d={`M8 ${roofEnd + 12}h3v4h-3ZM${w - 11} ${roofEnd + 12}h3v4h-3Z`} fill={rear ? P.orange : P.paper} />
      <rect x="6" y={h - 7} width={bw} height="3" fill={P.ink} />
    </g>
  );
}

/**
 * The route motif, the brand's signature: four stops on one line, ending at the finale. A floor decoration: lay it on the
 * pavement before <Props> so props stand on it, from the way in towards the room's main thing. About 30 nodes with labels.
 *   points   in scene px, in order. [x, y] is a stop (a numbered disc); [x, y, 0] is a bend the line turns at, with no disc.
 *            Usually four stops
 *   start    number of the first stop (default 1), for a room that shows part of the route (Stop 1 only, say)
 *   finale   default true: the last stop is the finale, a bigger disc with a cream ring
 *   elbow    default false; true runs each leg across then down, so the line stays orthogonal (pixel style)
 *   labels   optional DM Mono caps tag under each stop, short ("BOARD", "FINALE")
 *   color    default orange; cream on an orange ground is the only other choice
 */
export function RouteLine({ points, start = 1, finale = true, elbow = false, labels, color = P.orange }: { points: ([number, number] | [number, number, 0])[]; start?: number; finale?: boolean; elbow?: boolean; labels?: string[]; color?: string }) {
  const stops = points.filter((p) => p.length === 2) as [number, number][];
  const last = stops.length - 1;
  const d = points.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : elbow ? `H${x}V${y}` : `L${x} ${y}`)).join("");
  const mark = color === P.paper ? P.night : P.paper;
  return (
    <g>
      {points.length > 1 && <path d={d} fill="none" stroke={P.ink} strokeWidth="7" strokeDasharray="12 6" />}
      {points.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth="4" strokeDasharray="12 6" />}
      {stops.map(([x, y], i) => {
        const big = finale && i === last;
        const r = big ? 13 : 9;
        const size = big ? 13 : 10;
        const label = labels?.[i]?.toUpperCase();
        return (
          <g key={i}>
            <circle cx={x + 3} cy={y + 4} r={r} fill={P.shadow} opacity=".3" />
            <circle cx={x} cy={y} r={r} fill={color} stroke={P.ink} strokeWidth="2" />
            {big && <circle cx={x} cy={y} r={r - 4} fill="none" stroke={mark} strokeWidth="2" />}
            <text x={x} y={y + size * 0.36} textAnchor="middle" fill={mark} fontFamily={FONT.display} fontWeight={900} fontSize={size}>{start + i}</text>
            {label && <rect x={x - label.length * 2.1 - 4} y={y + r + 3} width={label.length * 4.2 + 8} height="9" fill={P.night} stroke={P.ink} strokeWidth="1" />}
            {label && <text x={x} y={y + r + 9.8} textAnchor="middle" fill={P.paper} fontFamily={FONT.mono} fontSize="5.5" letterSpacing=".6">{label}</text>}
          </g>
        );
      })}
    </g>
  );
}

/**
 * A rough rubber stamp (ROUGH CUT): a worn double border round Poppins 900 caps, a few degrees off square, the ink a
 * little thin. On walls, floors, a ticket desk, a bus door. Six nodes.
 *   x, y     centre
 *   text     a BRAND_LINES line (short)
 *   sub      optional DM Mono caps line under it (a date, "LAGOS", "STOP 4")
 *   shape    "box" (default) or "circle" (circle for 8 characters or fewer)
 *   color    the ink: orange on night or concrete, night or ember on cream (default orange)
 *   size     cap size of the main line in px (default 9)
 *   rotate   degrees, -10 to 10 (default -6)
 */
export function Stamp({ x, y, text, sub, shape = "box", color = P.orange, size = 9, rotate = -6 }: { x: number; y: number; text: string; sub?: string; shape?: "box" | "circle"; color?: string; size?: number; rotate?: number }) {
  const t = text.toUpperCase();
  const s = sub?.toUpperCase();
  const tw = t.length * size * 0.74;
  const sw = s ? s.length * size * 0.42 : 0;
  const worn = "17 2 6 1.5 25 3 4 1";
  const main = <text y={s ? -size * 0.12 : size * 0.36} textAnchor="middle" fill={color} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing=".6">{t}</text>;
  const small = s && <text y={size * 0.95} textAnchor="middle" fill={color} fontFamily={FONT.mono} fontSize={size * 0.6} letterSpacing="1">{s}</text>;
  if (shape === "circle") {
    const r = Math.max(tw, sw) / 2 + 8;
    return (
      <g transform={`translate(${x} ${y}) rotate(${rotate})`} opacity=".88">
        <circle r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={worn} />
        <circle r={r - 4} fill="none" stroke={color} strokeWidth="1" />
        {main}
        {small}
      </g>
    );
  }
  const bw = Math.max(tw, sw) + 16;
  const bh = size * (s ? 2.9 : 1.9);
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} opacity=".88">
      <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={worn} />
      <rect x={-bw / 2 + 3.5} y={-bh / 2 + 3.5} width={bw - 7} height={bh - 7} fill="none" stroke={color} strokeWidth="1" />
      {main}
      {small}
    </g>
  );
}

/**
 * Hoppaz signage in the three-colour ratio: a flat face with a cream keyline (night on a cream face), a hard ember lip
 * under it like the app's lip button, Poppins 900 caps or the bounce wordmark, and an optional strip with a DM Mono caps
 * line. For anything Hoppaz says in a room: the welcome wall, a billboard, a bus stop plate. 7 to 28 nodes.
 *   x, y, w, h   the plate (the lip hangs 3 px below h)
 *   text         the main line, sized to fit (ignored when `wordmark`)
 *   sub          optional strip line (a BRAND_LINES line, a place name)
 *   tone         "night" (default: night face, orange type, orange strip), "orange" (cream type, night strip),
 *                "cream" (night type, night keyline, orange strip)
 *   wordmark     true draws HoppazWordmark instead of `text` (give it h >= 30 for the ears)
 */
export function BrandSign({ x, y, w, h, text, sub, tone = "night", wordmark = false }: { x: number; y: number; w: number; h: number; text?: string; sub?: string; tone?: "night" | "orange" | "cream"; wordmark?: boolean }) {
  const face = tone === "orange" ? P.orange : tone === "cream" ? P.paper : P.night;
  const ink = tone === "night" ? P.orange : tone === "orange" ? P.paper : P.night;
  const key = tone === "cream" ? P.night : P.paper;
  const strip = tone === "orange" ? P.night : P.orange;
  const stripInk = tone === "orange" ? P.paper : P.night;
  const sh = sub ? Math.max(8, Math.round(h * 0.26)) : 0;
  const body = h - sh;
  const t = (text ?? "").toUpperCase();
  const s = (sub ?? "").toUpperCase();
  const size = Math.max(5, Math.min(body * 0.5, (w - 14) / Math.max(1, t.length * 0.72)));
  const subSize = Math.max(4, Math.min(sh * 0.6, (w - 16 - s.length * 0.8) / Math.max(1, s.length * 0.62)));
  const wmH = Math.min(body * 0.42, (w - 16) / 5.9);
  return (
    <g>
      <rect x={x + 4} y={y + 6} width={w} height={h} fill={P.shadow} opacity=".3" />
      <rect x={x} y={y + 3} width={w} height={h} fill={P.brandEmber} stroke={P.ink} strokeWidth="2" />
      <rect x={x} y={y} width={w} height={h} fill={face} stroke={P.ink} strokeWidth="2" />
      {sub && <rect x={x + 1} y={y + body - 1} width={w - 2} height={sh} fill={strip} />}
      <rect x={x + 3.5} y={y + 3.5} width={w - 7} height={h - 7} fill="none" stroke={key} strokeWidth="1.5" />
      {wordmark ? (
        <HoppazWordmark x={x + w / 2} y={y + (body - 1.76 * wmH) / 2 + 0.76 * wmH} h={wmH} fill={ink} anchor="middle" />
      ) : (
        <text x={x + w / 2} y={y + body / 2 + size * 0.36} textAnchor="middle" fill={ink} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing=".6">{t}</text>
      )}
      {sub && <text x={x + w / 2} y={y + body - 1 + sh / 2 + subSize * 0.36} textAnchor="middle" fill={stripInk} fontFamily={FONT.mono} fontWeight={500} fontSize={subSize} letterSpacing=".8">{s}</text>}
    </g>
  );
}

/** A paper scrap's outline at (0, 0), w by h, with stepped (pixel) tears along the top and the bottom. */
const torn = (w: number, h: number, step = 6) => {
  const n = Math.max(1, Math.floor(w / step));
  const s = (w / n).toFixed(1);
  let d = "M0 2";
  for (let i = 0; i < n; i++) d += `h${s}V${i % 2 ? 2 : 0}`;
  d += `V${h - 2}`;
  for (let i = 0; i < n; i++) d += `h-${s}V${i % 2 ? h - 2 : h}`;
  return `${d}Z`;
};

/**
 * The event flyer in the ROUGH CUT recipe, the drop-in for `Flyer` (same props, plus `id`): night frame, cream keyline,
 * orange ground, the violet disc as the sun (the room's one violet shape), the route running into the sun (three stops and
 * the finale), the bounce wordmark top left, the title in Poppins 900 cream on a torn night plate, the line in DM Mono
 * caps. With a `url` it shows the image inside the same frame and keyline. About 25 nodes.
 *   id   optional suffix for the clip id when a room hangs two
 */
export function HopFlyer({ x, y, w, h, url, title, line, uid, id }: { x: number; y: number; w: number; h: number; url?: string | null; title: string; line?: string; uid: string; id?: string }) {
  const clip = `${uid}-hopflyer${id ? `-${id}` : ""}`;
  const ix = x + 4;
  const iy = y + 4;
  const iw = w - 8;
  const ih = h - 8;
  const sun = { x: ix + iw * 0.7, y: iy + ih * 0.3, r: iw * 0.2 };
  const stops = [[0.12, 0.54], [0.3, 0.46], [0.47, 0.5]].map(([a, b]): [number, number] => [ix + iw * a, iy + ih * b]);
  const t = title.toUpperCase().slice(0, 18);
  const size = Math.max(6, Math.min(iw * 0.16, (iw - 10) / Math.max(4, t.length * 0.66)));
  const wm = Math.max(4.5, iw * 0.085);
  return (
    <g>
      <rect x={x + 4} y={y + 5} width={w} height={h} fill={P.shadow} opacity=".3" />
      <rect x={x} y={y} width={w} height={h} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <clipPath id={clip}><rect x={ix} y={iy} width={iw} height={ih} /></clipPath>
      {url ? (
        <image href={url} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
      ) : (
        <g clipPath={`url(#${clip})`}>
          <rect x={ix} y={iy} width={iw} height={ih} fill={P.orange} />
          <circle cx={sun.x} cy={sun.y} r={sun.r} fill={P.violet} />
          <path d={`M${stops.map(([a, b]) => `${a} ${b}`).join("L")}L${sun.x - sun.r * 0.7} ${sun.y + sun.r * 0.7}`} fill="none" stroke={P.paper} strokeWidth="1.5" strokeDasharray="3 2" />
          <path d={stops.map(([a, b]) => `M${a - 1.5} ${b - 1.5}h3v3h-3Z`).join("")} fill={P.paper} />
          <path d={torn(iw, ih * 0.42)} transform={`translate(${ix} ${iy + ih * 0.6})`} fill={P.night} />
          <HoppazWordmark x={ix + 4} y={iy + 3 + wm * 0.8} h={wm} fill={P.paper} />
          <text x={ix + 5} y={iy + ih * 0.8} fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size}>{t}</text>
          {line && <text x={ix + 5} y={iy + ih * 0.91} fill={P.paper} fontFamily={FONT.mono} fontSize={Math.max(4, iw * 0.07)} letterSpacing=".6">{line.toUpperCase().slice(0, 24)}</text>}
        </g>
      )}
      <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} fill="none" stroke={P.paper} strokeWidth="1.5" />
    </g>
  );
}

/**
 * Paper scraps pasted on a wall (ROUGH CUT texture from Lagos itself): a newsprint scrap, an orange poster with a brand
 * line, a night ticket stub, tape. Torn pixel edges, each scrap a few degrees off square with a hard shadow. Use one or two
 * per room, on a wall or a hoarding, never over a venue name. About 20 nodes.
 *   x, y, w, h   the patch of wall it covers (works from about 64 by 48)
 *   text         the orange poster's line (default "HOP OR STAY"): BRAND_LINES only
 *   seed         0 or 1: mirrors the tilt so two patches in a room differ
 */
export function PaperScraps({ x, y, w, h, text = BRAND_LINES.hop, seed = 0 }: { x: number; y: number; w: number; h: number; text?: string; seed?: number }) {
  const f = seed % 2 ? -1 : 1;
  const news = { x: w * 0.02, y: h * 0.08, w: w * 0.56, h: h * 0.84, r: -4 * f };
  const poster = { x: w * 0.4, y: 0, w: w * 0.56, h: h * 0.64, r: 5 * f };
  const stub = { x: w * 0.2, y: h * 0.64, w: w * 0.42, h: h * 0.3, r: 2 * f };
  const t = text.toUpperCase();
  const size = Math.max(5, Math.min(poster.h * 0.3, (poster.w - 8) / Math.max(1, t.length * 0.7)));
  const rows = Array.from({ length: Math.max(1, Math.floor((news.h - 20) / 4)) }, (_, i) => `M4 ${16 + i * 4}h${news.w / 2 - 6}M${news.w / 2 + 2} ${16 + i * 4}h${news.w / 2 - 6}`).join("");
  const scrap = (s: { x: number; y: number; w: number; h: number; r: number }, fill: string, inner: ReactNode) => (
    <g transform={`translate(${s.x} ${s.y}) rotate(${s.r} ${s.w / 2} ${s.h / 2})`}>
      <path d={torn(s.w, s.h)} transform="translate(3 4)" fill={P.shadow} opacity=".3" />
      <path d={torn(s.w, s.h)} fill={fill} stroke={P.ink} strokeWidth="1.5" />
      {inner}
      <rect x={s.w / 2 - 7} y="-3" width="14" height="6" fill={P.paper} opacity=".7" />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      {scrap(news, P.paper, <><rect x="4" y="6" width={news.w - 8} height="5" fill={P.night} /><path d={rows} stroke={P.night} strokeWidth="1" opacity=".3" /></>)}
      {scrap(poster, P.orange, <text x={poster.w / 2} y={poster.h / 2 + size * 0.36} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size}>{t}</text>)}
      {scrap(stub, P.night, <><path d={`M${stub.w * 0.7} 3V${stub.h - 3}`} stroke={P.paper} strokeWidth="1" strokeDasharray="2 2" /><path d={`M5 6h${stub.w * 0.5}M5 10h${stub.w * 0.35}M${stub.w * 0.76} 6h${stub.w * 0.16}`} stroke={P.paper} strokeWidth="2" /></>)}
    </g>
  );
}

/** The one marker scrawl a room may have: one word, lower case, Poppins 900 skewed and tilted, a stepped marker underline. (x, y) is the left of the baseline. */
export function Scrawl({ x, y, text, size = 14, color = P.paper, rotate = -8 }: { x: number; y: number; text: string; size?: number; color?: string; rotate?: number }) {
  const word = text.trim().split(/\s+/)[0].toLowerCase();
  const w = word.length * size * 0.62;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) skewX(-12)`}>
      <text x="0" y="0" fill={color} fontFamily={FONT.display} fontWeight={900} fontSize={size}>{word}</text>
      <path d={`M-2 ${size * 0.3}h${w * 0.4}v2h${w * 0.35}v-2h${w * 0.3}`} fill="none" stroke={color} strokeWidth="2.5" />
    </g>
  );
}

/**
 * Where the bus parks: a bay painted on asphalt or concrete, a dashed orange outline and the word in cream road paint.
 * A floor decoration (draw it before <Props>); put the HopBus prop inside it. Three nodes.
 *   x, y, w, h   the bay in scene px
 *   text         default "HOP"
 */
export function HopBay({ x, y, w, h, text = "HOP" }: { x: number; y: number; w: number; h: number; text?: string }) {
  const size = Math.min(h * 0.5, (w - 8) / Math.max(1, text.length * 0.8));
  return (
    <g>
      <rect x={x + 2} y={y + 2} width={w - 4} height={h - 4} fill="none" stroke={P.orange} strokeWidth="3" strokeDasharray="10 6" />
      <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} fill={P.orange} opacity=".12" />
      <text x={x + w / 2} y={y + h / 2 + size * 0.36} textAnchor="middle" fill={P.paper} opacity=".8" fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="3">{text.toUpperCase()}</text>
    </g>
  );
}

/**
 * Brand textures as patterns, by name: url(#${uid}-${name}). Pass only what the room uses (alongside the kit's Defs).
 *   "ht"         night halftone, 2 px dots: a hard shadow with texture, or to darken a cutout
 *   "ht-cream"   cream halftone: light on orange or night
 *   "newsprint"  cream paper with a headline bar and grey type: walls, scraps, the papers on a news stand
 *   "grain"      sparse night speckle: lay it over a flat brand ground
 */
export function BrandDefs({ uid, names }: { uid: string; names: string[] }) {
  const want = new Set(names);
  const pat = (id: string, w: number, h: number, node: ReactNode) => (want.has(id) ? <pattern key={id} id={`${uid}-${id}`} width={w} height={h} patternUnits="userSpaceOnUse">{node}</pattern> : null);
  return (
    <defs>
      {pat("ht", 6, 6, <path d="M0 0h2v2H0ZM3 3h2v2H3Z" fill={P.night} />)}
      {pat("ht-cream", 6, 6, <path d="M0 0h2v2H0ZM3 3h2v2H3Z" fill={P.paper} />)}
      {pat("newsprint", 48, 32, <><rect width="48" height="32" fill={P.paper} /><rect x="3" y="3" width="26" height="4" fill={P.night} opacity=".8" /><path d="M3 11h20M26 11h19M3 15h20M26 15h17M3 19h18M26 19h19M3 23h20M26 23h15M3 27h16M26 27h19" stroke={P.night} strokeWidth="1" opacity=".3" /></>)}
      {pat("grain", 16, 16, <path d="M2 3h1v1H2ZM9 1h1v1H9ZM13 7h1v1h-1ZM5 10h1v1H5ZM11 13h1v1h-1ZM1 14h1v1H1Z" fill={P.night} opacity=".35" />)}
    </defs>
  );
}
