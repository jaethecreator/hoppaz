import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { BRAND_LINES, Defs, Floor, FONT, Frame, HopFlyer, HoppazWordmark, Lineup, P, PaperScraps, Plate, Props, RouteLine, Shade, Stamp, Walls, type RoomArtProps } from "./kit";

/** The red velvet family and the dark room tones this room adds to the kit's palette. */
const V = {
  red: "#8E2B2B", redDark: "#6A1D1F", redDeep: "#4A1317", redLight: "#B04545", redHi: "#C85A55",
  wine: "#2A0F12", floor: "#5E4231", floorLine: "#4E3526", floorFleck: "#74533C", wainscot: "#4A2C1F",
} as const;

type Draw = (p: CampaignProp, tile: number) => ReactNode;

/**
 * Theatre night. The back wall (rows 1 to 3) carries the proscenium: a gold arch, red drapes and valance, the marquee with
 * the show title (an orange frame round a night plate: the Hoppaz sign), and the flyer and line-up in frames either side,
 * with a patch of pasted scraps and a rubber stamp at the far ends. The stage is the 12 tile floor under the arch with
 * footlights on its lip and a few spot cones. The stalls fill the middle (a red runner up the centre aisle, the route
 * running up it to centre stage), box seats line both side walls, a foyer with the box office (the exit) sits under the
 * foyer wall and the merch table carries the room's bounce wordmark.
 *
 * Brand: the velvet hall, the gold metalwork and the wood are the place; everything Hoppaz says (marquee, plates, merch,
 * the flyer, the route, the scraps and the stamp) is orange, night and cream. HopFlyer's sun is the room's one violet.
 */
export default function TheatreArt({ layout, uid, brand, content }: RoomArtProps) {
  const t = layout.grid.tile;
  const W = layout.grid.width * t;
  const H = layout.grid.height * t;
  const url = (name: string) => `url(#${uid}-${name})`;
  const title = (content?.title || brand || "Theatre night").toUpperCase().slice(0, 40);
  const line = (content?.line ?? "").toUpperCase().slice(0, 44);
  const lineup = content?.lineup?.length ? content.lineup : [{ name: "Opening act", time: "7PM" }, { name: "Spoken word", time: "8PM" }, { name: "The main show", time: "9PM" }];
  const titleSize = Math.max(8, Math.min(16, 376 / Math.max(6, title.length * 0.74)));
  // The back wall stamp prints the brand line "HOP OR STAY" over two rows: HOP, then OR STAY.
  const [hopWord, ...hopTail] = BRAND_LINES.hop.split(" ");
  const hopRest = hopTail.join(" ");

  // The proscenium opening is the stage's 12 tiles (x 9 to 20); the back wall ends at y = 4 tiles.
  const AX0 = 9 * t;
  const AX1 = 21 * t;
  const AW = AX1 - AX0;
  const WALL_B = 4 * t;
  const OPEN_Y = 73;
  const LIP_Y = 8 * t;

  // A velvet valance: a band with a scalloped lower edge, running right to left.
  const teeth = Math.round(AW / 12);
  let valance = `M${AX0} ${OPEN_Y}H${AX1}V${OPEN_Y + 8}`;
  for (let i = 0; i < teeth; i++) valance += "l-6 8l-6-8";
  valance += "Z";

  const stool: Draw = () => (
    <g>
      <ellipse cx="18" cy="28" rx="9" ry="3" fill={P.shadow} opacity=".3" />
      <path d="M12 17L10 28M20 17L22 28" stroke={P.ink} strokeWidth="3" />
      <path d="M10 24H22" stroke={P.goldDark} strokeWidth="2" />
      <ellipse cx="16" cy="14" rx="10" ry="6" fill={V.red} stroke={P.ink} strokeWidth="2" />
      <ellipse cx="13" cy="12" rx="5" ry="1.5" fill={V.redHi} opacity=".7" />
    </g>
  );

  const custom: Record<string, Draw> = {
    // Posters in frames: the kit's flyer and line-up board, with a gold moulding and a picture light.
    "event-flyer": (p) => (
      <g>
        <rect x="-3" y="1" width={p.w * t + 6} height={p.h * t - 2} fill={P.gold} stroke={P.ink} strokeWidth="2" />
        <HopFlyer uid={uid} x={0} y={4} w={p.w * t} h={p.h * t - 8} url={content?.flyerUrl} title={title} line={content?.line} />
        <rect x={p.w * t / 2 - 9} y="-3" width="18" height="4" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
      </g>
    ),
    "event-lineup": (p) => (
      <g>
        <rect x="-3" y="1" width={p.w * t + 6} height={p.h * t - 2} fill={P.gold} stroke={P.ink} strokeWidth="2" />
        <Lineup x={0} y={4} w={p.w * t} h={p.h * t - 8} items={lineup} />
        <rect x={p.w * t / 2 - 9} y="-3" width="18" height="4" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
      </g>
    ),

    // The stage.
    curtain: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <rect x="5" y="6" width={w - 1} height={h - 4} fill={P.shadow} opacity=".25" />
          <rect x="0" y="-2" width={w} height={h + 1} fill={url("velvet")} />
          <path d={`M1 -2V${h - 1}H${w - 1}V-2`} fill="none" stroke={P.ink} strokeWidth="2" />
          <rect x={w - 8} y="0" width="6" height={h - 12} fill={P.ink} opacity=".18" />
          <rect x="0" y="58" width={w} height="6" fill={P.gold} stroke={P.ink} strokeWidth="1" />
          <rect x={w / 2 - 3} y="64" width="6" height="12" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
          <rect x="2" y={h - 12} width={w - 4} height="8" fill={V.redDark} />
          <path d={`M3 ${h - 4}H${w - 3}`} stroke={P.gold} strokeWidth="3" strokeDasharray="3 3" />
        </g>
      );
    },
    piano: () => (
      <g>
        <path d="M6 8H44L62 20V62H6Z" fill={P.shadow} opacity=".25" />
        <path d="M2 2H40L58 14V54H2Z" fill="#1C1815" stroke={P.ink} strokeWidth="2" />
        <path d="M5 5H38L54 16" fill="none" stroke="#4B4743" strokeWidth="2" />
        <path d="M12 12H36L48 22V40H12Z" fill="#2B2724" />
        <rect x="6" y="9" width="3" height="36" fill="#3A3633" />
        <rect x="6" y="46" width="48" height="10" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d="M10 49H50" stroke={P.ink} strokeWidth="6" strokeDasharray="3 4" />
        <rect x="3" y="56" width="5" height="7" fill={P.ink} />
        <rect x="49" y="56" width="5" height="7" fill={P.ink} />
        <rect x="26" y="57" width="8" height="5" fill={P.gold} stroke={P.ink} strokeWidth="1" />
      </g>
    ),
    stagestool: stool,
    mic: () => (
      <g>
        <ellipse cx="18" cy="28" rx="9" ry="3" fill={P.shadow} opacity=".3" />
        <path d="M9 28H23" stroke={P.ink} strokeWidth="3" />
        <path d="M16 27V10" stroke={P.ink} strokeWidth="3" />
        <path d="M16 10L22 6" stroke={P.ink} strokeWidth="2" />
        <rect x="21" y="2" width="7" height="8" fill={P.slate} stroke={P.ink} strokeWidth="2" />
        <rect x="23" y="3" width="2" height="3" fill={P.slateLight} />
      </g>
    ),
    lectern: () => (
      <g>
        <rect x="8" y="16" width="22" height="14" fill={P.shadow} opacity=".25" />
        <path d="M7 13H25V29H7Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
        <path d="M5 5H27V14H5Z" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
        <rect x="8" y="7" width="12" height="5" fill={P.paper} />
        <rect x="22" y="6" width="3" height="5" fill={P.ink} />
        <rect x="13" y="18" width="6" height="6" fill={P.gold} stroke={P.goldDark} strokeWidth="1" />
      </g>
    ),

    // The stalls: eight seats a row, red velvet with a gold number plate, a row letter at the aisle end.
    seatrow: (p, tile) => {
      const w = p.w * tile;
      const xs = Array.from({ length: p.w }, (_, i) => i * tile);
      const letter = "ABCDEF"[p.variant ?? 0] ?? "A";
      const end = p.x < 14 ? w - 15 : 5;
      return (
        <g>
          <rect x="4" y="6" width={w - 2} height={tile - 4} fill={P.shadow} opacity=".25" />
          <rect x="1" y="2" width={w - 2} height={tile - 4} fill={V.redDeep} stroke={P.ink} strokeWidth="2" />
          <path d={xs.map((x) => `M${x + 4} 4h24v10h-24z`).join("")} fill={V.redLight} stroke={P.ink} strokeWidth="2" />
          <path d={xs.map((x) => `M${x + 3} 13h26v14h-26z`).join("")} fill={V.red} stroke={P.ink} strokeWidth="2" />
          <path d={xs.map((x) => `M${x + 6} 15h20v2h-20z`).join("")} fill={V.redHi} />
          <path d={xs.map((x) => `M${x + 12} 20h8v4h-8z`).join("")} fill={P.gold} stroke={P.goldDark} strokeWidth="1" />
          <path d={xs.map((x) => `M${x + 14} 21v2M${x + 17} 21v2`).join("")} stroke={P.ink} strokeWidth="1" />
          <rect x={end} y="5" width="10" height="10" fill={P.ink} />
          <text x={end + 5} y="13" textAnchor="middle" fill={P.gold} fontFamily={FONT.display} fontWeight={900} fontSize="8">{letter}</text>
        </g>
      );
    },

    // Box seats: a raised box with two velvet chairs and a padded gold rail on the stalls side (mirrored on the right).
    boxseat: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      const flip = (p.variant ?? 0) === 1;
      return (
        <g>
          <Shade w={w} h={h} dx={5} dy={6} />
          <g transform={flip ? `translate(${w},0) scale(-1,1)` : undefined}>
            <rect x="1" y="1" width={w - 2} height={h - 2} fill="#35201A" stroke={P.ink} strokeWidth="2" />
            <rect x="3" y="3" width={w - 6} height={h - 12} fill={P.woodDark} />
            <rect x="3" y="3" width={w - 6} height="2" fill={P.woodLight} opacity=".6" />
            <rect x="3" y={h - 9} width={w - 6} height="6" fill="#1F120D" />
            <rect x="6" y="7" width={w - 30} height={h - 20} fill={V.redDark} />
            <path d={`M9 9h7v16h-7zM9 ${h - 27}h7v16h-7z`} fill={V.red} stroke={P.ink} strokeWidth="2" />
            <path d={`M16 11h13v12h-13zM16 ${h - 25}h13v12h-13z`} fill={V.redLight} stroke={P.ink} strokeWidth="2" />
            <rect x={w - 23} y="3" width="4" height={h - 12} fill={P.gold} />
            <rect x={w - 19} y="3" width="15" height={h - 12} fill={V.red} stroke={P.ink} strokeWidth="2" />
            <rect x={w - 17} y="5" width="3" height={h - 16} fill={V.redHi} opacity=".7" />
            <rect x="2" y={h / 2 - 6} width="4" height="10" fill={P.gold} stroke={P.ink} strokeWidth="1" />
          </g>
        </g>
      );
    },

    // VIP corner.
    velvetsofa: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      const cw = (w - 16) / 3;
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="2" width={w - 4} height={h - 5} fill={V.redDark} stroke={P.ink} strokeWidth="2" />
          <rect x="7" y="3" width={w - 16} height="9" fill={V.red} />
          {[0, 1, 2].map((i) => <rect key={i} x={8 + i * cw} y="13" width={cw - 2} height="11" fill={V.redLight} />)}
          <rect x="1" y="7" width="7" height="19" fill={V.red} stroke={P.ink} strokeWidth="2" />
          <rect x={w - 11} y="7" width="7" height="19" fill={V.red} stroke={P.ink} strokeWidth="2" />
          <path d={`M5 27v3M${w - 8} 27v3`} stroke={P.gold} strokeWidth="3" />
        </g>
      );
    },
    armchair: () => (
      <g>
        <rect x="5" y="8" width="26" height="22" fill={P.shadow} opacity=".25" />
        <rect x="3" y="3" width="24" height="25" fill={V.redDark} stroke={P.ink} strokeWidth="2" />
        <rect x="6" y="5" width="18" height="7" fill={V.red} />
        <rect x="7" y="14" width="16" height="11" fill={V.redLight} />
        <rect x="3" y="9" width="5" height="17" fill={V.red} stroke={P.ink} strokeWidth="2" />
        <rect x="22" y="9" width="5" height="17" fill={V.red} stroke={P.ink} strokeWidth="2" />
        <path d="M6 28v3M24 28v3" stroke={P.gold} strokeWidth="3" />
      </g>
    ),
    teatable: () => (
      <g>
        <ellipse cx="19" cy="26" rx="10" ry="4" fill={P.shadow} opacity=".25" />
        <path d="M14 15h4v11h-4z" fill={P.ink} />
        <ellipse cx="16" cy="13" rx="11" ry="7" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
        <ellipse cx="13" cy="11" rx="5" ry="1.5" fill={P.cream} opacity=".6" />
        <rect x="18" y="5" width="4" height="7" fill={P.gold} stroke={P.ink} strokeWidth="1" />
        <rect x="19" y="3" width="2" height="3" fill={P.leaf} />
      </g>
    ),
    rope: (p, tile) => {
      const w = p.w * tile;
      const posts = [8, w / 2, w - 8];
      return (
        <g>
          <rect x="6" y="26" width={w - 8} height="4" fill={P.shadow} opacity=".25" />
          <path d={`M8 13Q${w / 4} 26 ${w / 2} 13Q${(w * 3) / 4} 26 ${w - 8} 13`} fill="none" stroke={P.ink} strokeWidth="6" />
          <path d={`M8 13Q${w / 4} 26 ${w / 2} 13Q${(w * 3) / 4} 26 ${w - 8} 13`} fill="none" stroke={P.red} strokeWidth="3" />
          {posts.map((x, i) => (
            <g key={i}>
              <rect x={x - 3} y="12" width="6" height="16" fill={P.gold} stroke={P.ink} strokeWidth="2" />
              <circle cx={x} cy="10" r="4" fill={P.goldDark} stroke={P.ink} strokeWidth="2" />
            </g>
          ))}
        </g>
      );
    },

    // The bar.
    backbar: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      const n = Math.floor((w - 16) / 10);
      const bottle = (k: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 4 === k).map((i) => `M${8 + i * 10} 6h4v11h-4z`).join("");
      return (
        <g>
          <rect x="4" y="5" width={w - 2} height={h - 4} fill={P.shadow} opacity=".25" />
          <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="3" y="3" width={w - 6} height="16" fill="#1B1214" />
          <path d={bottle(0)} fill={P.gold} stroke={P.ink} strokeWidth="1" />
          <path d={bottle(1)} fill={P.mint} stroke={P.ink} strokeWidth="1" />
          <path d={bottle(2)} fill={P.red} stroke={P.ink} strokeWidth="1" />
          <path d={bottle(3)} fill={P.paper} stroke={P.ink} strokeWidth="1" />
          <rect x="3" y="18" width={w - 6} height="3" fill={P.woodLight} />
          <rect x="3" y="22" width={w - 6} height="7" fill={P.wood} />
        </g>
      );
    },
    barcounter: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="7" width={w - 2} height={h - 8} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="1" y="1" width={w - 2} height="14" fill={P.cream} stroke={P.ink} strokeWidth="2" />
          <rect x="3" y="3" width={w - 6} height="2" fill={P.paper} />
          <path d="M12 6h3v6h-3zM44 6h3v6h-3zM76 6h3v6h-3zM104 6h3v6h-3z" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
          <rect x="4" y="27" width={w - 8} height="3" fill={P.gold} />
          <Plate x={w / 2 - 15} y={16} w={30} h={10} text="Bar" fill={P.night} color={P.paper} size={6} />
        </g>
      );
    },
    barstool: stool,

    // The foyer.
    coatrack: (p, tile) => {
      const w = p.w * tile;
      const n = Math.floor((w - 8) / 13);
      const tones = [P.red, P.slate, P.cream, P.mint];
      const coats = (k: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 4 === k).map((i) => `M${6 + i * 13} 7h10v18h-10z`).join("");
      return (
        <g>
          <rect x="5" y="22" width={w - 6} height="8" fill={P.shadow} opacity=".25" />
          <rect x="2" y="2" width={w - 4} height="3" fill={P.ink} />
          <path d={Array.from({ length: n }, (_, i) => `M${11 + i * 13} 4v4`).join("")} stroke={P.ink} strokeWidth="2" />
          {tones.map((c, k) => <path key={k} d={coats(k)} fill={c} stroke={P.ink} strokeWidth="2" />)}
          <rect x="2" y="26" width={w - 4} height="4" fill={P.woodDark} stroke={P.ink} strokeWidth="1" />
        </g>
      );
    },
    coatcounter: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="7" width={w - 2} height={h - 8} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="1" y="1" width={w - 2} height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
          <rect x="5" y="4" width="14" height="8" fill={P.paper} stroke={P.ink} strokeWidth="1" />
          <path d="M8 6h8M8 9h6" stroke={P.ink} strokeWidth="1" />
          <circle cx="32" cy="8" r="3" fill={P.gold} stroke={P.ink} strokeWidth="1" />
          <path d="M46 5h4v7h-4zM54 5h4v7h-4zM62 5h4v7h-4zM70 5h4v7h-4z" fill={P.cream} stroke={P.ink} strokeWidth="1" />
          <Plate x={w / 2 - 22} y={17} w={44} h={10} text="Coats" fill={P.night} color={P.paper} size={6} />
        </g>
      );
    },
    merchrack: (p, tile) => {
      const w = p.w * tile;
      const n = Math.floor((w - 8) / 15);
      const tones = [P.orange, P.paper, P.night, P.orange];
      const row =(y: number, k: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 4 === k).map((i) => `M${6 + i * 15} ${y}h12v9h-12z`).join("");
      return (
        <g>
          <rect x="5" y="5" width={w - 6} height="26" fill={P.shadow} opacity=".25" />
          <rect x="1" y="1" width={w - 2} height="29" fill="#1B1214" stroke={P.ink} strokeWidth="2" />
          {tones.map((c, k) => <path key={k} d={row(4, k) + row(17, (k + 2) % 4)} fill={c} stroke={P.ink} strokeWidth="1" />)}
          <rect x="3" y="14" width={w - 6} height="2" fill={P.woodLight} />
          <rect x="3" y="27" width={w - 6} height="2" fill={P.woodLight} />
        </g>
      );
    },
    merchcounter: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="7" width={w - 2} height={h - 8} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="1" y="1" width={w - 2} height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
          <path d="M6 4h12v8h-12zM8 3h12v8h-12z" fill={P.paper} stroke={P.ink} strokeWidth="1" />
          <rect x="10" y="5" width="6" height="3" fill={V.red} />
          <rect x="30" y="4" width="10" height="8" fill={P.ink} />
          <rect x="32" y="5" width="6" height="3" fill={P.mint} />
          <path d="M52 5h4v7h-4zM60 5h4v7h-4zM68 5h4v7h-4z" fill={P.cream} stroke={P.ink} strokeWidth="1" />
          {/* The room's wordmark: Hoppaz merch, the bounce wordmark on a night plate. */}
          <rect x={w / 2 - 26} y={15} width={52} height={13} fill={P.night} stroke={P.ink} strokeWidth="2" />
          <HoppazWordmark x={w / 2} y={19} h={7} fill={P.orange} anchor="middle" />
        </g>
      );
    },
    ticketdesk: (p, tile) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <Shade w={w} h={h} />
          <rect x="1" y="7" width={w - 4} height={h - 8} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
          <rect x="1" y="1" width={w - 4} height="14" fill={P.cream} stroke={P.ink} strokeWidth="2" />
          <rect x="5" y="4" width="22" height="8" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
          <path d="M11 5v6M17 5v6M23 5v6" stroke={P.goldDark} strokeWidth="1" />
          <rect x="31" y="4" width="11" height="8" fill={P.paper} stroke={P.ink} strokeWidth="1" />
          <rect x="33" y="5" width="3" height="6" fill={V.red} />
          <circle cx={w - 14} cy="8" r="3" fill={P.gold} stroke={P.ink} strokeWidth="1" />
          <Plate x={3} y={17} w={w - 10} h={10} text="Box office" fill={P.night} color={P.paper} size={6} />
          <rect x={w / 2 - 17} y="-8" width="28" height="9" fill={P.orange} stroke={P.ink} strokeWidth="2" />
          <text x={w / 2 - 3} y="-1" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="6.5" letterSpacing=".8">EXIT</text>
        </g>
      );
    },
    bistro: () => (
      <g>
        <ellipse cx="19" cy="27" rx="11" ry="4" fill={P.shadow} opacity=".25" />
        <path d="M14 17h4v10h-4z" fill={P.ink} />
        <ellipse cx="16" cy="14" rx="12" ry="8" fill={V.red} stroke={P.ink} strokeWidth="2" />
        <ellipse cx="13" cy="11" rx="6" ry="2" fill={V.redLight} />
        <rect x="15" y="7" width="3" height="6" fill={P.paper} stroke={P.ink} strokeWidth="1" />
        <rect x="15" y="5" width="3" height="2" fill={P.gold} />
      </g>
    ),
    easel: (p, tile) => {
      const w = p.w * tile;
      const red = (p.variant ?? 0) === 0;
      return (
        <g>
          <rect x="10" y="24" width={w - 14} height="6" fill={P.shadow} opacity=".25" />
          <path d={`M16 24L10 31M${w - 16} 24L${w - 10} 31M${w / 2} 24V31`} stroke={P.ink} strokeWidth="3" />
          <rect x="8" y="1" width={w - 16} height="24" fill={P.paper} stroke={P.ink} strokeWidth="2" />
          {red ? (
            <>
              <rect x="11" y="4" width={w - 22} height="18" fill={P.night} />
              <circle cx="24" cy="13" r="5" fill={P.orange} />
              <rect x="34" y="8" width="16" height="3" fill={P.paper} />
              <rect x="34" y="14" width="12" height="2" fill={P.paper} />
            </>
          ) : (
            <>
              <rect x="11" y="4" width={w - 22} height="18" fill={P.night} />
              <Plate x={11} y={4} w={w - 22} h={9} text="What's on" fill={P.orange} color={P.night} size={5.5} />
              <rect x="15" y="16" width="24" height="2" fill={P.cream} />
              <rect x="15" y="19" width="16" height="1.5" fill={P.cream} opacity=".7" />
            </>
          )}
        </g>
      );
    },
  };

  const frame = (x: number, y: number, w: number, h: number, tone: string, mark: string) => (
    <g key={`${x}-${y}`}>
      <rect x={x + 3} y={y + 4} width={w} height={h} fill={P.shadow} opacity=".3" />
      <rect x={x} y={y} width={w} height={h} fill={P.gold} stroke={P.ink} strokeWidth="2" />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} fill={tone} />
      <rect x={x + 6} y={y + 6} width={w - 12} height={Math.max(3, h * 0.3)} fill={mark} />
      <rect x={x + 6} y={y + h - 12} width={w - 12} height="2" fill={mark} opacity=".8" />
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["stagewood", "redcarpet"]} />
      <defs>
        <pattern id={`${uid}-parquet`} width="64" height="16" patternUnits="userSpaceOnUse">
          <rect width="64" height="16" fill={V.floor} />
          <path d="M0 0H64M0 8H64M32 0V8M10 8V16M50 8V16" stroke={V.floorLine} strokeWidth="1" />
          <path d="M4 3h18M38 11h14" stroke={V.floorFleck} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-marble`} width="64" height="64" patternUnits="userSpaceOnUse">
          <rect width="64" height="64" fill={P.cream} />
          <rect width="32" height="32" fill="#D9CFB4" />
          <rect x="32" y="32" width="32" height="32" fill="#D9CFB4" />
          <path d="M0 0H64M0 32H64M32 0V64M0 0V64" stroke="#C4BA9F" strokeWidth="1" />
          <path d="M6 8h4M42 40h5M20 52h3M50 14h2" stroke="#F1EBD9" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-paper`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={V.redDark} />
          <path d="M8 1l5 5-5 5-5-5z" fill="#7A2327" />
          <rect x="7" y="5" width="2" height="2" fill={P.goldDark} />
          <path d="M0 15h16" stroke={V.redDeep} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-velvet`} width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill={V.red} />
          <rect x="2" width="4" height="8" fill={V.redLight} />
          <rect x="12" width="4" height="8" fill={V.redDark} />
        </pattern>
        <pattern id={`${uid}-backdrop`} width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill="#3A1216" />
          <rect x="3" width="3" height="8" fill="#4C1A1E" />
          <rect x="12" width="4" height="8" fill="#2A0C0F" />
        </pattern>
      </defs>

      <Frame layout={layout} ground="#170D10" />
      <rect x={t} y={t} width={W - t * 2} height={H - t * 2} fill={url("parquet")} stroke={P.ink} strokeWidth="4" />

      {/* Floors: the stage, the red carpet of the VIP corner, the bar's tiles, the foyer, the runner and the landing. */}
      <Floor uid={uid} rect={{ x: 9, y: 4, w: 12, h: 4 }} material="stagewood" border={P.gold} tile={t} />
      <Floor uid={uid} rect={{ x: 4, y: 4, w: 5, h: 4 }} material="redcarpet" border={P.gold} tile={t} />
      <Floor uid={uid} rect={{ x: 21, y: 4, w: 5, h: 4 }} material="marble" border={P.goldDark} tile={t} />
      <Floor uid={uid} rect={{ x: 1, y: 15, w: 28, h: 4 }} material="marble" tile={t} />
      <path d={`M${t} ${15 * t}H${W - t}`} stroke={P.ink} strokeWidth="2" />
      {/* Two rugs under the bistro tables. */}
      {[7, 18].map((x) => (
        <g key={x}>
          <rect x={x * t + 4} y="534" width={5 * t - 8} height="54" fill={V.redDark} stroke={P.ink} strokeWidth="2" />
          <rect x={x * t + 10} y="540" width={5 * t - 20} height="42" fill="none" stroke={P.gold} strokeWidth="2" />
        </g>
      ))}
      <rect x={14 * t} y={LIP_Y} width={2 * t} height={7 * t} fill={url("redcarpet")} />
      <rect x={13 * t} y={15 * t} width={4 * t} height={H - 15 * t} fill={url("redcarpet")} />
      <path d={`M${14 * t + 1} ${LIP_Y}V${15 * t}M${16 * t - 1} ${LIP_Y}V${15 * t}M${13 * t + 1} ${15 * t}V${H}M${17 * t - 1} ${15 * t}V${H}`} stroke={P.gold} strokeWidth="2" />
      <path d={`M${13 * t} ${15 * t + 1}H${14 * t}M${16 * t} ${15 * t + 1}H${17 * t}`} stroke={P.gold} strokeWidth="2" />

      {/* The cutaway walls: red wallpaper, gold cornice. */}
      <Walls layout={layout} face={V.redDark} cap={P.gold} />
      {layout.walls.map((w, i) => <rect key={i} x={w.x * t + 3} y={w.y * t + 7} width={w.w * t - 6} height={Math.max(2, w.h * t - 14)} fill={url("paper")} />)}
      <rect x={t + 3} y={104} width={W - t * 2 - 6} height="17" fill={V.wainscot} />
      <rect x={t + 3} y={104} width={W - t * 2 - 6} height="2" fill={P.gold} />

      {/* The back wall's Lagos texture, outermost either side: a patch of pasted scraps on the left, a rubber stamp on the right. Two framed pictures sit between these and the flyer and line-up. */}
      <PaperScraps x={40} y={44} w={84} h={60} />
      {frame(212, 56, 30, 44, P.night, P.orange)}
      {frame(702, 56, 28, 44, P.night, P.orange)}
      <circle cx="900" cy="78" r="23" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <Stamp x={900} y={78} text={hopWord} sub={hopRest} shape="circle" size={8} rotate={-8} />
      {/* Framed posters on the foyer wall: gold mouldings (metal), brand pictures. */}
      {[70, 214, 306, 398, 534, 626, 718, 870].map((x) => (
        <g key={x}>
          <rect x={x} y={456} width="22" height="15" fill={P.gold} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y={459} width="16" height="9" fill={x % 3 === 0 ? P.paper : P.night} />
          <rect x={x + 5} y={461} width="8" height="2" fill={x % 3 === 0 ? P.night : P.orange} />
        </g>
      ))}

      {/* The proscenium: backdrop, drapes, valance, gold pillars and the marquee with the show title. */}
      <rect x={AX0} y={OPEN_Y} width={AW} height={WALL_B - OPEN_Y} fill={url("backdrop")} />
      <circle cx={W / 2} cy="104" r="10" fill={P.gold} stroke={P.goldDark} strokeWidth="2" />
      <path d="M352 90h2v2h-2zM396 112h2v2h-2zM560 96h2v2h-2zM604 116h2v2h-2zM432 86h2v2h-2zM528 118h2v2h-2z" fill={P.paper} />
      <rect x={AX0} y={OPEN_Y} width={t} height={WALL_B - OPEN_Y} fill={url("velvet")} />
      <rect x={AX1 - t} y={OPEN_Y} width={t} height={WALL_B - OPEN_Y} fill={url("velvet")} />
      <path d={`M${AX0 + 1} ${OPEN_Y}V${WALL_B}M${AX1 - 1} ${OPEN_Y}V${WALL_B}`} stroke={P.ink} strokeWidth="2" />
      {[AX0 - 20, AX1].map((x) => (
        <g key={x}>
          <rect x={x} y={OPEN_Y} width="20" height={WALL_B - OPEN_Y} fill={P.gold} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y={OPEN_Y + 3} width="4" height={WALL_B - OPEN_Y - 8} fill={P.paper} opacity=".55" />
          <rect x={x + 13} y={OPEN_Y + 3} width="4" height={WALL_B - OPEN_Y - 8} fill={P.goldDark} />
          <rect x={x - 3} y={WALL_B - 7} width="26" height="7" fill={P.goldDark} stroke={P.ink} strokeWidth="2" />
        </g>
      ))}
      <path d={valance} fill={url("velvet")} stroke={P.ink} strokeWidth="2" />
      <path d={`M${AX0 + 6} ${OPEN_Y + 16}H${AX1}`} stroke={P.gold} strokeWidth="3" strokeDasharray="2 10" />
      <rect x={AX0 - 24} y="35" width={AW + 48} height="38" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x={AX0 - 18} y="40" width={AW + 36} height="28" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x={AX0 - 15} y="43" width={AW + 30} height="22" fill="none" stroke={P.paper} strokeWidth="2" strokeDasharray="2 8" />
      <text x={W / 2} y={line ? 55 : 59} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={titleSize} letterSpacing="2">{title}</text>
      {line && <text x={W / 2} y="63" textAnchor="middle" fill={P.paper} fontFamily={FONT.mono} fontSize="6.5" letterSpacing="1.5">{line}</text>}

      {/* Spot rig under the valance and the light cones that fall on the stage. */}
      <rect x="336" y="90" width="288" height="3" fill={P.ink} />
      {[400, 480, 560].map((cx) => (
        <g key={cx}>
          <rect x={cx - 6} y="92" width="12" height="8" fill={P.ink} />
          <rect x={cx - 4} y="99" width="8" height="3" fill={P.gold} />
          <path d={`M${cx - 4} 102L${cx - 34} ${LIP_Y - 8}H${cx + 34}L${cx + 4} 102Z`} fill={P.paper} opacity=".1" />
        </g>
      ))}

      {/* The stage lip with footlights, the shadow it throws and the steps down to the runner. */}
      <rect x={AX0 + 4} y={LIP_Y + 12} width={AW} height="8" fill={P.shadow} opacity=".25" />
      <path d={`M${AX0 + 4} ${LIP_Y - 3}H${AX1 - 4}`} stroke={P.ink} strokeWidth="2" />
      <path d={`M${AX0 + 10} ${LIP_Y - 7}H${AX1 - 6}`} stroke={P.gold} strokeWidth="5" strokeDasharray="6 10" />
      <rect x={AX0} y={LIP_Y} width={AW} height="12" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x={AX0 + 2} y={LIP_Y + 2} width={AW - 4} height="2" fill={P.gold} />
      <rect x={14 * t - 8} y={LIP_Y + 12} width={2 * t + 16} height="7" fill="#8E6D53" stroke={P.ink} strokeWidth="2" />
      <rect x={14 * t - 4} y={LIP_Y + 19} width={2 * t + 8} height="7" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />

      {/* The route up the centre aisle, from the foyer to centre stage (floor decoration: props stand on it). */}
      <RouteLine points={[[480, 600], [480, 440], [480, 312], [480, 208]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* The doorway at the bottom of the foyer. */}
      <path d={`M${t} ${H - 1}H${13 * t}M${17 * t} ${H - 1}H${W - t}`} stroke={P.ink} strokeWidth="4" />
    </svg>
  );
}
