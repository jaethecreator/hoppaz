import type { CampaignLayout, CampaignProp } from "@/lib/campaign/layout";
import { sceneSize } from "@/lib/campaign/layout";

/** Deliberately shared three-tone materials: original props use the same light and pixel scale. */
const P = { ink: "#282A31", shadow: "#181B21", wall: "#4C4F58", cap: "#75777C", cream: "#EADFC4", paper: "#F5EBDD", wood: "#9A7150", woodLight: "#BF9570", woodDark: "#6D4E37", mint: "#7F9C79", leaf: "#597855", leafDark: "#3E5840", slate: "#556E79", slateLight: "#839EA6", ember: "#F47945", emberDark: "#B34B28", gold: "#D8B468", goldDark: "#8C713D", stone: "#C4BDA7" };

function Plant({ tree = false }: { tree?: boolean }) {
  return tree ? <>
    <path d="M-3 20H34V32H-3Z" fill={P.shadow} opacity=".25" /><path d="M12 12H21V34H12Z" fill={P.woodDark} /><path d="M12 16H16V31H12Z" fill={P.woodLight} />
    <path d="M2-10H26V-4H34V16H27V24H3V18H-5V-2H2Z" fill={P.leafDark} stroke={P.ink} strokeWidth="2" /><path d="M2-7H24V-1H31V12H23V19H1V13H-2V0H2Z" fill={P.leaf} /><path d="M5-4H19V2H24V7H11V4H1V1H5Z" fill={P.mint} /><path d="M8 12H13V16H8ZM23 6H27V10H23Z" fill="#98B085" />
  </> : <>
    <path d="M8 25H30V32H8Z" fill={P.shadow} opacity=".25" /><path d="M7 19H25L23 31H10Z" fill={P.wood} stroke={P.ink} strokeWidth="2" /><path d="M8 19H24V23H8Z" fill={P.woodLight} /><path d="M10 24H13V29H10Z" fill="#C6A17A" />
    <path d="M14 19V3H20V19M14 14H6V5H11V10H14M19 13H27V4H23V9H19" fill={P.leafDark} stroke={P.ink} strokeWidth="2" /><path d="M14 3H18V10H14M7 6H10V10H7M24 5H26V10H24" fill={P.mint} /><path d="M11 17H3V11H8V14H12M20 17H29V12H25V14H20" fill={P.leaf} />
  </>;
}

function Prop({ prop, tile }: { prop: CampaignProp; tile: number }) {
  const w = prop.w * tile, h = prop.h * tile;
  const commonShadow = <rect x="4" y="6" width={w - 4} height={h - 2} fill={P.shadow} opacity=".25" />;
  let art;
  switch (prop.kind) {
    case "plant": art = <Plant />; break;
    case "tree": art = <Plant tree />; break;
    case "console": art = <>
      {commonShadow}<rect x="1" y="2" width={w - 6} height={h - 4} fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><rect x="4" y="2" width={w - 12} height={h - 10} fill={P.ink} /><rect x="6" y="4" width={w - 16} height="3" fill={P.slateLight} />
      {Array.from({ length: Math.floor(w / 20) - 1 }, (_, i) => <g key={i} transform={`translate(${10 + i * 20},10)`}><rect width="12" height="6" fill={i % 3 === 0 ? P.ember : P.mint} /><path d="M2 10V17M6 10V17M10 10V17" stroke={P.slateLight} strokeWidth="2" /><rect x="1" y={i % 2 ? 12 : 10} width="3" height="2" fill={P.paper} /><rect x="9" y="14" width="3" height="2" fill={P.paper} /></g>)}
      <rect x={w - 27} y="8" width="16" height="16" fill={P.slate} /><path d={`M${w - 24} 13h3v-3h3v6h3v-3h2`} fill="none" stroke={P.mint} strokeWidth="2" />
    </>; break;
    case "speaker": art = <>
      {commonShadow}<rect x="4" y="1" width={w - 9} height={h - 4} fill={P.ink} stroke={P.shadow} strokeWidth="2" /><rect x="5" y="2" width="3" height={h - 7} fill={P.wall} /><circle cx={w / 2} cy={h > 32 ? 18 : 14} r="8" fill={P.wall} stroke={P.shadow} strokeWidth="2" /><circle cx={w / 2} cy={h > 32 ? 18 : 14} r="4" fill={P.slate} />{h > 32 && <><circle cx={w / 2} cy="42" r="10" fill={P.wall} stroke={P.shadow} strokeWidth="2" /><circle cx={w / 2} cy="42" r="5" fill={P.slate} /></>}<rect x="10" y={h - 8} width="12" height="2" fill={P.gold} />
    </>; break;
    case "headphones": art = <>
      {commonShadow}<path d="M4 8H26V27H4Z" fill={P.slate} stroke={P.ink} strokeWidth="2" /><path d="M6 8H24V13H6Z" fill={P.slateLight} /><path d="M8 14H23V23H8Z" fill={P.slateLight} /><path d="M11 18V12C11 6 21 6 21 12V18" fill="none" stroke={P.ink} strokeWidth="3" /><path d="M9 13H13V19H9ZM19 13H23V19H19Z" fill={P.gold} /><path d="M9 27V30M23 27V30" stroke={P.ink} strokeWidth="3" />
    </>; break;
    case "sofa": art = w > h ? <>
      {commonShadow}<rect x="1" y="2" width={w - 5} height={h - 6} fill={prop.variant ? P.emberDark : P.leafDark} stroke={P.ink} strokeWidth="2" /><rect x="3" y="3" width={w - 9} height="7" fill={prop.variant ? P.ember : P.mint} /><path d={`M5 12H${w - 9}V24H5Z`} fill={prop.variant ? "#CC7752" : P.leaf} /><path d={`M${w / 2 - 2} 12V24`} stroke={P.ink} strokeWidth="2" /><rect x="2" y="9" width="7" height="17" fill={prop.variant ? P.ember : P.mint} /><rect x={w - 13} y="9" width="7" height="17" fill={prop.variant ? P.ember : P.mint} /><path d={`M9 28v3M${w - 13} 28v3`} stroke={P.ink} strokeWidth="3" />
    </> : <>
      {commonShadow}<rect x="2" y="1" width={w - 6} height={h - 4} fill={P.leafDark} stroke={P.ink} strokeWidth="2" /><rect x="20" y="3" width="7" height={h - 8} fill={P.mint} /><rect x="5" y="10" width="15" height={h - 23} fill={P.leaf} /><path d={`M5 ${h / 2}h16`} stroke={P.ink} strokeWidth="2" /><rect x="3" y="2" width="23" height="8" fill={P.mint} /><rect x="3" y={h - 14} width="23" height="8" fill={P.mint} />
    </>; break;
    case "table": art = <>
      {commonShadow}<path d="M4 7H26V25H4Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><path d="M4 4H26V21H4Z" fill={P.woodLight} stroke={P.ink} strokeWidth="2" /><rect x="8" y="8" width="11" height="9" fill={P.paper} /><circle cx="13" cy="12" r="4" fill={P.ink} /><circle cx="13" cy="12" r="1" fill={P.ember} /><rect x="21" y="9" width="4" height="6" fill={P.paper} />
    </>; break;
    case "records": art = <>
      {commonShadow}<rect x="1" y="1" width={w - 6} height="27" fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><rect x="2" y="2" width={w - 8} height="4" fill={P.woodLight} />
      {Array.from({ length: Math.floor(w / 20) }, (_, i) => <g key={i} transform={`translate(${6 + i * 19},8)`}><rect width="15" height="15" fill={[P.slate, P.ember, P.mint, P.gold][i % 4]} stroke={P.ink} strokeWidth="1" /><circle cx="7.5" cy="7.5" r="5" fill={P.ink} /><circle cx="7.5" cy="7.5" r="1.5" fill={P.paper} /></g>)}<rect x="2" y="25" width={w - 8} height="4" fill={P.woodLight} />
    </>; break;
    case "plinth": art = <>
      {commonShadow}<path d={`M5 10H${w - 5}V29H5Z`} fill="#A59C87" stroke={P.ink} strokeWidth="2" /><path d={`M5 7H${w - 5}V22H5Z`} fill={P.cream} stroke={P.ink} strokeWidth="2" /><rect x={w / 2 - 9} y="22" width="18" height="4" fill={P.goldDark} />
      <path d={`M${w / 2 - 12} 0H${w / 2 + 11}V16H${w / 2 - 12}Z`} fill={P.paper} fillOpacity=".25" stroke={P.slateLight} strokeWidth="1" />
      {prop.variant === 1 ? <path d={`M${w / 2 - 6} 2h12v9h-4v4h-4v-4h-4Z`} fill={P.gold} stroke={P.goldDark} strokeWidth="2" /> : prop.variant === 2 ? <path d={`M${w / 2} 1l7 8-7 7-7-7Z`} fill={P.gold} stroke={P.goldDark} strokeWidth="2" /> : <><circle cx={w / 2} cy="8" r="7" fill={P.gold} stroke={P.goldDark} strokeWidth="2" /><circle cx={w / 2} cy="8" r="2" fill={P.goldDark} /></>}<path d={`M${w / 2 - 10} 1v10`} stroke={P.paper} strokeWidth="2" opacity=".6" />
    </>; break;
    case "poster": art = <>
      {commonShadow}<rect x="2" y="1" width={w - 8} height={h - 5} fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><rect x="5" y="4" width={w - 14} height={h - 12} fill={prop.variant === 1 ? P.slate : prop.variant === 2 ? P.gold : P.ember} />
      {prop.variant === 1 ? <><path d={`M8 ${h - 17}l12-27 10 16 9-9 15 20`} fill={P.cream} /><circle cx={w - 22} cy="19" r="7" fill={P.gold} /></> : <><circle cx={w / 2 - 2} cy={h / 2 - 6} r={w > 32 ? 18 : 9} fill={P.ink} /><circle cx={w / 2 - 2} cy={h / 2 - 6} r={w > 32 ? 10 : 5} fill={P.woodDark} /><circle cx={w / 2 - 2} cy={h / 2 - 6} r="3" fill={P.paper} /></>}
      <rect x="9" y={h - 20} width={w - 23} height="3" fill={P.paper} /><rect x="9" y={h - 13} width={w - 31} height="2" fill={P.paper} />
    </>; break;
    case "counter": art = <>
      {commonShadow}<rect x="2" y="7" width={w - 6} height="23" fill={P.wood} stroke={P.ink} strokeWidth="2" /><rect x="1" y="1" width={w - 6} height="15" fill={P.cream} stroke={P.ink} strokeWidth="2" /><path d={`M8 19v7M${w - 15} 19v7`} stroke={P.woodLight} strokeWidth="2" /><rect x="13" y="5" width="20" height="10" fill={P.ember} /><rect x="18" y="7" width="9" height="2" fill={P.paper} /><rect x={w - 30} y="5" width="15" height="10" fill={P.slate} /><rect x={w - 26} y="7" width="7" height="2" fill={P.paper} />
    </>; break;
    case "bench": art = <>
      {commonShadow}<path d={`M3 7H${w - 4}V25H3Z`} fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><path d={`M3 4H${w - 4}V8H3ZM3 11H${w - 4}V15H3ZM3 18H${w - 4}V22H3Z`} fill={P.woodLight} /><path d={`M8 26v4M${w - 11} 26v4`} stroke={P.ink} strokeWidth="3" />
    </>; break;
    case "fountain": art = <>
      <path d="M15 9H54L64 19V53L54 63H15L5 53V19Z" fill={P.shadow} opacity=".2" /><path d="M12 4H50L60 14V48L50 58H12L2 48V14Z" fill={P.stone} stroke={P.ink} strokeWidth="2" /><path d="M15 10H47L54 17V44L47 51H15L8 44V17Z" fill={P.slate} stroke={P.slateLight} strokeWidth="2" /><path d="M17 14H45L50 19V28H13V19Z" fill={P.slateLight} /><circle cx="31" cy="31" r="15" fill={P.ink} stroke={P.cream} strokeWidth="2" /><circle cx="31" cy="31" r="9" fill={P.wall} /><circle cx="31" cy="31" r="4" fill={P.gold} /><path d="M14 43h8M40 18h7M41 44h7" stroke={P.slateLight} strokeWidth="2" />
    </>; break;
    case "maptable": art = <>
      {commonShadow}<path d={`M3 8H${w - 5}V27H3Z`} fill={P.woodDark} stroke={P.ink} strokeWidth="2" /><path d={`M3 4H${w - 5}V22H3Z`} fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="6" width={w - 16} height="13" fill={P.paper} /><path d={`M7 15h12l6-3h${w - 31}v7H7Z`} fill={P.slateLight} /><path d={`M9 9h7M18 8v6M24 10h${w - 36}`} stroke={P.stone} strokeWidth="1" />
      <path d="M27 6h4v5l-2 3-2-3Z" fill={P.ember} stroke={P.ink} strokeWidth="1" /><rect x={w - 14} y="7" width="4" height="4" fill={P.gold} />
    </>; break;
    case "lamp": art = <>
      <rect x="12" y="25" width="17" height="6" fill={P.shadow} opacity=".25" /><path d="M16 9V27M9 27H23" stroke={P.ink} strokeWidth="3" /><path d="M10 3H22L27 15H5Z" fill={P.gold} stroke={P.ink} strokeWidth="2" /><path d="M11 5H16L14 12H8Z" fill={P.cream} />
    </>; break;
    case "rug": art = <>
      <rect x="1" y="1" width={w - 4} height={h - 4} fill={P.slate} stroke={P.woodDark} strokeWidth="2" /><rect x="7" y="7" width={w - 16} height={h - 16} fill="none" stroke={P.cream} strokeWidth="2" />{[0, 1, 2, 3].map((i) => <path key={i} d={`M${20 + i * 26} 19l10 10-10 10-10-10ZM${20 + i * 26} 57l10 10-10 10-10-10Z`} fill={P.gold} opacity=".6" />)}<path d={`M5 ${h - 1}v4M13 ${h - 1}v4M21 ${h - 1}v4M${w - 7} ${h - 1}v4`} stroke={P.cream} strokeWidth="2" />
    </>; break;
  }
  return <g transform={`translate(${prop.x * tile},${prop.y * tile})`}>{art}</g>;
}

export default function ClubhouseArt({ layout, uid, brand }: { layout: CampaignLayout; uid: string; brand: string }) {
  const { width, height } = sceneSize(layout);
  const tile = layout.grid.tile;
  const pattern = (name: string) => `url(#${uid}-${name})`;
  const mat = `WELCOME TO ${brand.toUpperCase()}`;
  // 10 px mono, stepping down for a long name so it always fits the 192 px mat.
  const matSize = Math.max(6, Math.min(10, (176 / mat.length - 1.5) / 0.6));
  const offset = (name: string, originalX: number) => ((layout.zones.find((zone) => zone.id === name)?.x ?? originalX) - originalX) * tile;
  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" shapeRendering="crispEdges">
    <defs>
      <pattern id={`${uid}-path`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill={P.cream} /><path d="M0 0H32V32" fill="none" stroke="#C9BBA0" strokeWidth="1" /><path d="M4 5h2M24 25h3M15 17h1" fill="none" stroke="#D9CBB0" strokeWidth="1" /></pattern>
      <pattern id={`${uid}-acoustic`} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill={P.slate} /><path d="M0 0H16V16" fill="none" stroke="#475D66" strokeWidth="1" /><path d="M3 4h2M10 11h2" fill="none" stroke="#68838A" strokeWidth="1" /></pattern>
      <pattern id={`${uid}-wood`} width="64" height="16" patternUnits="userSpaceOnUse"><rect width="64" height="16" fill={P.woodLight} /><path d="M0 0H64M0 8H64M32 0V8M10 8V16" stroke={P.wood} strokeWidth="1" /><path d="M4 3h20M36 11h18" stroke="#CDA481" strokeWidth="1" /></pattern>
      <pattern id={`${uid}-marble`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#E9E3CE" /><path d="M0 0H32V32M3 7l5 4 7-2M21 22l5 3" fill="none" stroke="#CDC6B1" strokeWidth="1" /></pattern>
      <pattern id={`${uid}-grass`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill={P.mint} /><path d="M4 6h3v2M20 22h3v2M12 17h2M28 3h2" fill="none" stroke={P.leaf} strokeWidth="1" /><path d="M5 25h3M24 12h2" stroke="#9BB38A" strokeWidth="1" /></pattern>
      <pattern id={`${uid}-terrazzo`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#DAD4C5" /><path d="M4 3h4v3H4ZM22 18h3v4h-3ZM11 25h3v2h-3" fill={P.slateLight} /><path d="M18 7h3v2h-3M3 20h3v2H3" fill={P.ember} opacity=".5" /></pattern>
      <pattern id={`${uid}-stage`} width="32" height="16" patternUnits="userSpaceOnUse"><rect width="32" height="16" fill="#8E6D53" /><path d="M0 0H32M16 0V16" stroke={P.woodDark} strokeWidth="1" /><path d="M3 7h8M20 12h5" stroke={P.woodLight} strokeWidth="1" /></pattern>
    </defs>

    <rect width={width} height={height} fill="#333D32" /><rect x="24" y="28" width={width - 36} height={height - 40} fill={P.shadow} opacity=".4" /><rect x={tile} y={tile} width={width - tile * 2} height={height - tile * 2} fill={pattern("path")} stroke={P.ink} strokeWidth="4" />
    {layout.zones.map((zone) => <g key={zone.id}><rect x={zone.x * tile} y={zone.y * tile} width={zone.w * tile} height={zone.h * tile} fill={pattern(zone.material)} /><rect x={zone.x * tile + 3} y={zone.y * tile + 3} width={zone.w * tile - 6} height={zone.h * tile - 6} fill="none" stroke={zone.id === "courtyard" ? P.leaf : P.woodDark} strokeWidth="2" /></g>)}

    {/* Cutaway wall faces have a single top-left light and hard lower-right shadow. */}
    {layout.walls.map((wall, i) => <g key={i}><rect x={wall.x * tile + 5} y={wall.y * tile + 7} width={wall.w * tile} height={wall.h * tile} fill={P.shadow} opacity=".25" /><rect x={wall.x * tile} y={wall.y * tile} width={wall.w * tile} height={wall.h * tile} fill={P.ink} /><rect x={wall.x * tile + 3} y={wall.y * tile + 3} width={wall.w * tile - 6} height={wall.h * tile - 10} fill={P.wall} /><rect x={wall.x * tile + 2} y={wall.y * tile + 2} width={wall.w * tile - 4} height="5" fill={P.cap} /></g>)}

    {/* Studio acoustic wall, studio glass and warm practical lights. */}
    <g transform={`translate(${offset("studio", 1)},0)`}>
    {[0, 1, 2, 3, 4, 5].map((i) => <g key={i}><rect x={69 + i * 29} y="41" width="21" height="14" fill={i % 2 ? P.ink : P.slate} /><path d={`M${72 + i * 29} 44h15M${72 + i * 29} 49h15`} stroke={P.slateLight} strokeWidth="1" /></g>)}
    <rect x="35" y="104" width="24" height="72" fill={P.slateLight} stroke={P.ink} strokeWidth="2" /><path d="M37 106l20 20M37 124l20 20M37 142l20 20" stroke={P.cream} strokeWidth="2" opacity=".6" /><path d="M47 106v68" stroke={P.ink} strokeWidth="2" />
    </g>

    {/* The stage and dominant banner are hand-set type, not an invented official mark. */}
    <g transform={`translate(${offset("stage", 10)},0)`}>
    <rect x="350" y="80" width="262" height="86" fill={P.shadow} /><rect x="352" y="77" width="256" height="82" fill={pattern("stage")} stroke={P.ink} strokeWidth="2" /><path d="M353 148h254M353 154h254" stroke={P.gold} strokeWidth="2" />
    <rect x="347" y="38" width="272" height="49" fill={P.shadow} /><rect x="344" y="35" width="272" height="49" fill={P.ember} stroke={P.ink} strokeWidth="3" /><rect x="350" y="41" width="260" height="37" fill={P.ink} /><text x="480" y="66" fill={P.paper} fontFamily="var(--font-poppins),sans-serif" fontSize={Math.min(23, 224 / Math.max(1, brand.length * .7))} fontWeight="900" textAnchor="middle" letterSpacing={brand.length > 20 ? 0 : 1}>{brand.toUpperCase()}</text>
    {[359, 398, 560, 599].map((x, i) => <g key={x}><rect x={x} y="94" width="8" height="5" fill={i % 2 ? P.cream : P.gold} /><path d={`M${x + 4} 99l-14 45h28Z`} fill={i % 2 ? P.paper : P.gold} opacity=".08" /></g>)}
    <path d="M463 136h34M468 143h24" stroke={P.cream} strokeWidth="2" /><path d="M322 174h18M620 174h18" stroke={P.ember} strokeWidth="4" />
    </g>

    {/* Awards wall: framed, deliberately unlabelled archive displays. */}
    <g transform={`translate(${offset("awards", 21)},0)`}>
    {[711, 776, 841].map((x, i) => <g key={x}><rect x={x} y="38" width="42" height="18" fill={P.goldDark} stroke={P.shadow} strokeWidth="2" /><rect x={x + 4} y="42" width="34" height="10" fill={P.cream} /><rect x={x + 12} y="44" width="18" height="2" fill={i % 2 ? P.wood : P.gold} /><rect x={x + 15} y="48" width="12" height="1" fill={P.wood} /></g>)}
    <rect x="731" y="139" width="92" height="33" fill="#D7C9A9" stroke={P.goldDark} strokeWidth="2" /><path d="M739 146h76v19h-76Z" fill="none" stroke={P.paper} strokeWidth="2" />
    </g>

    {/* Central planted garden, paving, tiny border foliage and string lamps. */}
    <g transform={`translate(${offset("courtyard", 10)},0)`}>
    <path d="M480 256V448M320 400H640" stroke={P.cream} strokeWidth="28" /><path d="M470 262h20M470 288h20M470 315h20M326 390v20M352 390v20M379 390v20M406 390v20M433 390v20M514 390v20M540 390v20M567 390v20M594 390v20M621 390v20" stroke="#C8B998" strokeWidth="1" />
    <path d="M352 270H606" fill="none" stroke={P.ink} strokeWidth="2" />{[358, 390, 422, 454, 486, 518, 550, 582, 602].map((x) => <g key={x}><path d={`M${x} 270v6`} stroke={P.ink} strokeWidth="1" /><rect x={x - 2} y="275" width="5" height="5" fill={P.gold} stroke={P.ink} strokeWidth="1" /></g>)}
    {[322, 335, 348, 610, 622, 634].map((x, i) => <g key={x}><path d={`M${x} 432v-9m0 3l-4-3m4 5l4-4`} stroke={P.leafDark} strokeWidth="2" /><rect x={x - 2} y="421" width="4" height="3" fill={i % 2 ? P.paper : P.ember} /></g>)}
    </g>

    {/* Record lounge windows and gallery posters add architecture at the same scale. */}
    {[420, 466, 512].map((y) => <g key={y}><rect x="37" y={y} width="20" height="34" fill={P.slateLight} stroke={P.ink} strokeWidth="2" /><path d={`M47 ${y + 2}v30M39 ${y + 15}h16`} stroke={P.paper} strokeWidth="2" /></g>)}
    <g transform={`translate(${offset("campaign", 21)},0)`}><rect x="701" y="566" width="151" height="8" fill={P.goldDark} /><path d="M704 568h145" stroke={P.gold} strokeWidth="2" /></g>

    {/* Walkways stay open. The room names are tags in the world (CampaignWorld), so the art carries no zone plaques. */}
    <text x={width / 2} y="486" fill={P.woodDark} fontSize="10" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono),monospace" letterSpacing="2">GOOD MUSIC. GOOD COMPANY.</text>
    {/* The welcome mat between the two entry planters: 6 tiles wide, the crew's name on it. */}
    <rect x={width / 2 - 96} y="575" width="192" height="20" fill={P.ink} /><text x={width / 2} y="589" fill={P.cream} fontSize={matSize} textAnchor="middle" fontFamily="var(--font-mono),monospace" fontWeight="500" letterSpacing="1.5">{mat}</text>

    {[...layout.props].sort((a, b) => (a.kind === "rug" ? -100 : a.y) - (b.kind === "rug" ? -100 : b.y)).map((prop) => <Prop key={prop.id} prop={prop} tile={tile} />)}
    <path d={`M${width / 2 - 40} ${height - 17}h80`} stroke={P.cream} strokeWidth="4" />
  </svg>;
}
