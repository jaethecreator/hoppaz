import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { Defs, Flyer, Floor, FONT, Frame, Lineup, P, Plate, Props, Shade, Walls, type RoomArtProps } from "./kit";

/**
 * Tech event: a founders' night or a meetup in a hub or a hotel hall. A bright daytime office: cool grey tile, slate walls,
 * white and cream furniture, Hoppaz orange on the signs and the sponsor banners (one violet bean-bag, nothing else).
 * A projector screen with a slide on the back wall, a banner with the event title over it, a stage you can walk onto,
 * session seats, demo and sponsor booths down the side walls, a coffee bar and a registration desk by the door.
 * Everything here draws from the layout (src/lib/campaign/rooms/eventTech.ts); the kit does the flyer and the agenda board.
 */

type Draw = (prop: CampaignProp, tile: number) => ReactNode;
type Size = { w: number; h: number };

/** The slide on the big screen: a title block, three grey lines and a bar chart that ends on an orange bar. */
function Screen({ w, h }: Size) {
  const bars = [14, 22, 19, 33, 50];
  return (
    <g>
      <rect x="6" y="9" width={w - 4} height={h - 12} fill={P.shadow} opacity=".25" />
      <rect x="2" y="3" width={w - 4} height={h - 10} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="8" width={w - 14} height={h - 20} fill={P.white} />
      <rect x="7" y="8" width={w - 14} height="2" fill={P.paper} />
      <rect x="16" y="16" width="96" height="28" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="23" width="62" height="5" fill={P.night} />
      <rect x="24" y="33" width="42" height="4" fill={P.night} opacity=".75" />
      {[0, 1, 2].map((i) => <rect key={i} x="16" y={52 + i * 8} width={96 - i * 18} height="3" fill={P.slateLight} />)}
      <rect x="128" y="16" width="2" height="62" fill={P.ink} />
      <rect x="128" y="76" width="112" height="2" fill={P.ink} />
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={136 + i * 21} y={76 - b} width="15" height={b} fill={i === 4 ? P.orange : P.slate} stroke={P.ink} strokeWidth="1" />
          <rect x={137 + i * 21} y={77 - b} width="3" height={b - 2} fill={P.paper} opacity=".4" />
        </g>
      ))}
    </g>
  );
}

/** The event title on an orange plate hung over the screen, with a pair of code brackets at its ends. */
function TitleBanner({ w, h, title }: Size & { title: string }) {
  const size = Math.max(7, Math.min(15, (w - 76) / Math.max(4, title.length * 0.72)));
  return (
    <g>
      <path d={`M40 0V9M${w - 40} 0V9`} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="12" width={w - 4} height={h - 8} fill={P.shadow} opacity=".25" />
      <rect x="2" y="7" width={w - 4} height={h - 8} fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="9" width={w - 8} height="2" fill={P.paper} opacity=".4" />
      <path d={`M24 13L16 19L24 25M${w - 24} 13L${w - 16} 19L${w - 24} 25`} fill="none" stroke={P.night} strokeWidth="3" />
      <text x={w / 2} y={19 + size * 0.36} textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="1">{title}</text>
    </g>
  );
}

function Whiteboard({ w, h }: Size) {
  return (
    <g>
      <rect x="6" y="8" width={w - 8} height={h - 10} fill={P.shadow} opacity=".25" />
      <rect x="2" y="2" width={w - 8} height={h - 12} fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="5" width={w - 14} height={h - 18} fill={P.white} />
      <rect x="10" y="10" width="18" height="11" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="40" y="10" width="18" height="11" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d="M28 15H40M54 21L62 32" stroke={P.orange} strokeWidth="2" />
      <rect x="66" y="9" width="14" height="12" fill={P.danfo} stroke={P.danfoDark} strokeWidth="1" />
      <rect x="64" y="28" width="14" height="12" fill={P.keke} stroke={P.kekeDark} strokeWidth="1" />
      <path d="M12 32H34M12 38H26" stroke={P.slate} strokeWidth="2" />
      <rect x="12" y={h - 12} width="34" height="4" fill={P.cap} stroke={P.ink} strokeWidth="1" />
      <rect x="16" y={h - 15} width="8" height="3" fill={P.orange} /><rect x="27" y={h - 15} width="8" height="3" fill={P.lagoon} /><rect x="38" y={h - 15} width="6" height="3" fill={P.ink} />
    </g>
  );
}

/** "WIFI: GUEST" and nothing else: no password on the wall. */
function WifiSign({ w, h }: Size) {
  return (
    <g>
      <rect x="10" y="10" width={w - 10} height={h - 14} fill={P.shadow} opacity=".25" />
      <rect x="6" y="6" width={w - 12} height={h - 14} fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="8" width={w - 16} height="2" fill={P.white} />
      <path d="M44 27a6 6 0 0 1 8 0M39 23a12 12 0 0 1 18 0M34 19a18 18 0 0 1 28 0" fill="none" stroke={P.slate} strokeWidth="3" />
      <rect x="46" y="30" width="4" height="4" fill={P.orange} />
      <text x={w / 2} y="47" textAnchor="middle" fill={P.ink} fontFamily={FONT.mono} fontWeight={700} fontSize="8" letterSpacing=".5">WIFI: GUEST</text>
    </g>
  );
}

/** The platform: boards, a lip with an orange LED strip and a step in the middle (the aisle). */
function Stage({ w, h, uid }: Size & { uid: string }) {
  const mid = w / 2;
  return (
    <g>
      <rect x="5" y="7" width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x="0" y="0" width={w} height={h} fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height={h - 12} fill={`url(#${uid}-stagewood)`} />
      <rect x="2" y="2" width={w - 4} height="5" fill={P.ink} opacity=".3" />
      <rect x="2" y={h - 10} width={w - 4} height="8" fill={P.woodDark} />
      <rect x="2" y={h - 4} width={w - 4} height="2" fill={P.orange} />
      <rect x={mid - 32} y={h - 14} width="64" height="12" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d={`M${mid - 30} ${h - 9}H${mid + 30}`} stroke={P.wood} strokeWidth="2" />
      <path d={`M${mid - 30} ${h - 5}H${mid + 30}`} stroke={P.wood} strokeWidth="2" />
    </g>
  );
}

function Podium() {
  return (
    <g>
      <ellipse cx="18" cy="29" rx="11" ry="3" fill={P.shadow} opacity=".28" />
      <path d="M8 13H24L23 29H9Z" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="10" y="15" width="3" height="12" fill={P.paper} opacity=".35" />
      <path d="M4 8H28L26 14H6Z" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="18" width="9" height="7" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x="7" y="3" width="11" height="6" fill={P.slate} stroke={P.ink} strokeWidth="1" />
      <path d="M24 9V3H19" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="15" y="1" width="5" height="4" fill={P.ink} />
    </g>
  );
}

/** A high stool: a slate seat, ink legs and a foot ring. Used on the stage and at the coffee bar. */
function Stool() {
  return (
    <g>
      <ellipse cx="18" cy="28" rx="9" ry="3" fill={P.shadow} opacity=".3" />
      <path d="M11 17L9 28M21 17L23 28M10 24H22" stroke={P.ink} strokeWidth="3" fill="none" />
      <ellipse cx="16" cy="15" rx="10" ry="5" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <ellipse cx="14" cy="13.5" rx="4" ry="1.5" fill={P.paper} opacity=".5" />
    </g>
  );
}

function RunnerArt({ w, h }: Size) {
  return (
    <g>
      <rect x="0" y="0" width={w} height={h} fill={P.cream} />
      <rect x="0" y="0" width="3" height={h} fill={P.slateLight} />
      <rect x={w - 3} y="0" width="3" height={h} fill={P.slateLight} />
      {Array.from({ length: Math.floor(h / 32) }, (_, i) => <path key={i} d={`M${w / 2 - 10} ${i * 32 + 20}L${w / 2} ${i * 32 + 10}L${w / 2 + 10} ${i * 32 + 20}`} fill="none" stroke={P.slate} strokeWidth="2" />)}
    </g>
  );
}

/** Rows of chairs facing the stage, from a pattern so a block is one rect. `mark` puts an orange RESERVED ribbon on a chair. */
function ChairRows({ uid, w, h, mark }: Size & { uid: string; mark?: number }) {
  return (
    <g>
      <rect width={w} height={h} fill={`url(#${uid}-chair)`} />
      {mark !== undefined && <rect x={mark * 32 + 8} y="19" width="16" height="4" fill={P.orange} stroke={P.ink} strokeWidth="1" />}
    </g>
  );
}

function AvDesk({ w, h }: Size) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="11" width={w - 2} height="19" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="4" width={w - 4} height="14" fill={P.cap} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="6" width="26" height="9" fill={P.ink} />
      <path d="M10 8v5M15 8v3M20 8v5M25 8v2" stroke={P.paper} strokeWidth="2" />
      <rect x="38" y="1" width="18" height="12" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="40" y="3" width="14" height="7" fill={P.paper} />
      <rect x="42" y="5" width="6" height="2" fill={P.orange} />
      <circle cx="58" cy="9" r="2" fill={P.red} />
    </g>
  );
}

function Camera() {
  return (
    <g>
      <ellipse cx="18" cy="29" rx="10" ry="3" fill={P.shadow} opacity=".28" />
      <path d="M16 14L9 29M16 14L23 29M16 14V30" stroke={P.ink} strokeWidth="2" fill="none" />
      <rect x="6" y="3" width="19" height="11" fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <rect x="24" y="6" width="6" height="5" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x="9" y="5" width="3" height="3" fill={P.red} />
    </g>
  );
}

/** A roll-up banner on its cassette: variant 0 orange, 1 slate, 2 night with an orange block. */
function Rollup({ w, h, variant }: Size & { variant: number }) {
  const panel = variant === 0 ? P.orange : variant === 1 ? P.slate : P.night;
  const ink = variant === 0 ? P.night : P.paper;
  return (
    <g>
      <rect x="6" y="8" width={w - 8} height={h - 10} fill={P.shadow} opacity=".25" />
      <rect x="4" y="0" width={w - 8} height="3" fill={P.ink} />
      <rect x="5" y="2" width={w - 10} height={h - 12} fill={panel} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="4" width="2" height={h - 16} fill={P.paper} opacity=".3" />
      <rect x="11" y="9" width={w - 22} height="10" fill={variant === 2 ? P.orange : ink} />
      <rect x="11" y="23" width={w - 22} height="3" fill={ink} />
      <rect x="11" y="29" width={w - 28} height="3" fill={ink} />
      <rect x="11" y={h - 22} width={w - 22} height="5" fill={variant === 1 ? P.orange : P.brandEmber} />
      <rect x="3" y={h - 9} width={w - 6} height="6" fill={P.ink} />
    </g>
  );
}

/** A demo table: a wood top, an orange or slate strip on the front, a monitor on the left and a laptop beside it. */
function DemoTable({ w, h, variant }: Size & { variant: number }) {
  const screen = variant === 0 ? P.night : variant === 1 ? P.slate : P.orange;
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="12" width={w - 2} height="19" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="5" width={w - 4} height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="7" width={w - 10} height="2" fill={P.paper} opacity=".4" />
      <rect x="4" y="24" width={w - 8} height="3" fill={variant === 1 ? P.slateLight : P.orange} />
      <rect x="14" y="14" width="6" height="5" fill={P.ink} />
      <rect x="10" y="-15" width="30" height="21" fill={P.ink} stroke={P.shadow} strokeWidth="2" />
      <rect x="13" y="-12" width="24" height="15" fill={screen} />
      <rect x="16" y="-9" width="11" height="2" fill={variant === 2 ? P.night : P.orange} />
      <rect x="16" y="-5" width="17" height="2" fill={variant === 2 ? P.paper : P.mint} />
      <rect x="16" y="-1" width="8" height="2" fill={P.paper} />
      <rect x="47" y="9" width="28" height="7" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x="50" y="-6" width="22" height="15" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="52" y="-4" width="18" height="10" fill={P.paper} />
      <rect x="54" y="-1" width="3" height="5" fill={P.slate} /><rect x="59" y="-3" width="3" height="7" fill={P.orange} /><rect x="64" y="0" width="3" height="4" fill={P.slate} />
      <rect x={w - 14} y="6" width="6" height="7" fill={P.paper} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** A bean-bag: variant 0 ember, 1 slate, 2 violet (the room's one violet shape). */
function Beanbag({ variant }: { variant: number }) {
  const main = variant === 0 ? P.ember : variant === 1 ? P.slate : P.violet;
  return (
    <g>
      <rect x="7" y="27" width="24" height="5" fill={P.shadow} opacity=".25" />
      <path d="M8 11H24L28 16V25L24 29H8L4 25V16Z" fill={main} stroke={P.ink} strokeWidth="2" />
      <rect x="22" y="17" width="5" height="9" fill={P.shadow} opacity=".28" />
      <rect x="8" y="13" width="9" height="3" fill={P.paper} opacity=".45" />
      <path d="M16 15V22" stroke={P.ink} strokeWidth="1" opacity=".5" />
    </g>
  );
}

/** A standing table for networking: a round one for a single tile, a long one with two pedestals for more. */
function HighTable({ w }: { w: number }) {
  if (w <= 32) {
    return (
      <g>
        <ellipse cx="18" cy="29" rx="9" ry="3" fill={P.shadow} opacity=".28" />
        <rect x="14" y="14" width="3" height="15" fill={P.ink} />
        <rect x="10" y="27" width="11" height="2" fill={P.ink} />
        <ellipse cx="16" cy="12" rx="13" ry="7" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <rect x="9" y="6" width="4" height="6" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      </g>
    );
  }
  return (
    <g>
      <rect x="6" y="14" width={w - 4} height="16" fill={P.shadow} opacity=".25" />
      <rect x="10" y="14" width="4" height="15" fill={P.ink} /><rect x={w - 14} y="14" width="4" height="15" fill={P.ink} />
      <rect x="5" y="27" width="14" height="2" fill={P.ink} /><rect x={w - 19} y="27" width="14" height="2" fill={P.ink} />
      <rect x="2" y="4" width={w - 6} height="13" fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="6" width={w - 12} height="2" fill={P.white} />
      <rect x="9" y="-1" width="5" height="7" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x="22" y="7" width="15" height="6" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 22} y="0" width="5" height="7" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 14} y="8" width="6" height="4" fill={P.slate} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** The swag table: tote bags, a stack of tees and a mug under a small sign. */
function SwagTable({ w, h }: Size) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="12" width={w - 2} height="19" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="5" width={w - 4} height="14" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="-4" width="14" height="14" fill={P.cream} stroke={P.ink} strokeWidth="2" /><path d="M9 -4V-8H17V-4" fill="none" stroke={P.ink} strokeWidth="2" /><rect x="9" y="2" width="8" height="3" fill={P.orange} />
      <rect x="24" y="-2" width="14" height="12" fill={P.orange} stroke={P.ink} strokeWidth="2" /><path d="M27 -2V-6H35V-2" fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x="42" y="2" width="14" height="5" fill={P.slate} stroke={P.ink} strokeWidth="1" /><rect x="42" y="-2" width="14" height="5" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <Plate x={w / 2 - 14} y={20} w={28} h={9} text="SWAG" fill={P.ink} color={P.paper} mono size={5.5} />
    </g>
  );
}

/** A step-and-repeat backdrop on two legs, with a camera on it: the corner where everyone takes the same photo. */
function SelfieWall({ w, h, uid }: Size & { uid: string }) {
  return (
    <g>
      <rect x="8" y="9" width={w - 8} height={h - 14} fill={P.shadow} opacity=".25" />
      <rect x="6" y={h - 12} width="5" height="10" fill={P.ink} /><rect x={w - 17} y={h - 12} width="5" height="10" fill={P.ink} />
      <rect x="2" y="2" width={w - 6} height={h - 12} fill={`url(#${uid}-repeat)`} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="5" width={w - 12} height="2" fill={P.paper} opacity=".4" />
      <rect x={w / 2 - 12} y="14" width="24" height="16" fill={P.ink} stroke={P.paper} strokeWidth="2" />
      <circle cx={w / 2} cy="22" r="5" fill={P.slateLight} stroke={P.paper} strokeWidth="2" />
      <rect x={w / 2 - 9} y="11" width="7" height="4" fill={P.paper} />
    </g>
  );
}

function Charger({ w, h }: Size) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="6" width={w - 2} height="24" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="8" width={w - 6} height="4" fill={P.slateLight} />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x={7 + i * 9} y="15" width="7" height="12" fill={P.ink} />
          {i !== 2 && i !== 4 && <rect x={8 + i * 9} y="17" width="5" height="9" fill={P.paper} />}
          <rect x={9 + i * 9} y="13" width="3" height="2" fill={P.keke} />
        </g>
      ))}
      <Plate x={w / 2 - 20} y={-5} w={40} h={11} text="CHARGE" fill={P.orange} color={P.night} mono />
    </g>
  );
}

function Vending({ w, h }: Size) {
  const snacks = [P.orange, P.danfo, P.mint, P.paper, P.ember, P.slateLight, P.danfo, P.orange, P.paper];
  return (
    <g>
      <rect x="6" y="8" width={w - 2} height={h - 4} fill={P.shadow} opacity=".25" />
      <rect x="1" y="2" width={w - 2} height={h - 4} fill={P.lagoon} stroke={P.ink} strokeWidth="2" />
      <rect x={w - 6} y="4" width="3" height={h - 8} fill={P.lagoonDark} />
      <rect x="4" y="6" width="18" height="36" fill={P.ink} />
      {snacks.map((c, i) => <rect key={i} x={6 + (i % 3) * 5.5} y={9 + Math.floor(i / 3) * 12} width="4" height="7" fill={c} />)}
      <rect x="24" y="8" width="5" height="9" fill={P.ink} /><rect x="25" y="10" width="3" height="2" fill={P.paper} /><rect x="25" y="14" width="3" height="2" fill={P.paper} />
      <rect x="5" y="46" width="18" height="10" fill={P.ink} />
      <rect x="4" y="3" width="18" height="3" fill={P.paper} />
    </g>
  );
}

/** The coffee counter: espresso machine, grinder, a pastry dome and a tablet, a shelf of mugs and a menu board above. */
function CoffeeBar({ w, h }: Size) {
  const mugs = [P.paper, P.orange, P.slateLight, P.paper, P.ember, P.paper];
  return (
    <g>
      {/* The menu board and the mug shelf hang on the wall behind the counter. */}
      <rect x="10" y="-94" width={w - 20} height="56" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="14" y="-90" width={w - 28} height="12" fill={P.orange} />
      <text x={w / 2} y="-80" textAnchor="middle" fill={P.night} fontFamily={FONT.display} fontWeight={900} fontSize="8" letterSpacing="1">COFFEE + SNACKS</text>
      {[0, 1, 2].map((i) => <g key={i}><rect x="18" y={-70 + i * 10} width={44 - i * 6} height="3" fill={P.paper} /><rect x={w - 50} y={-70 + i * 10} width="24" height="3" fill={P.gold} /></g>)}
      <rect x="8" y="-24" width={w - 16} height="4" fill={P.woodDark} stroke={P.ink} strokeWidth="1" />
      {mugs.map((c, i) => <rect key={i} x={14 + i * 19} y="-32" width="7" height="8" fill={c} stroke={P.ink} strokeWidth="1" />)}
      {/* The counter. */}
      <Shade w={w} h={h} />
      <rect x="1" y="12" width={w - 2} height="19" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="5" width={w - 4} height="14" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="7" width={w - 10} height="2" fill={P.paper} opacity=".6" />
      <rect x="10" y="-6" width="32" height="18" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="13" y="-3" width="26" height="6" fill={P.ink} />
      <rect x="15" y="-1" width="4" height="2" fill={P.orange} />
      <rect x="20" y="8" width="7" height="5" fill={P.paper} stroke={P.ink} strokeWidth="1" />
      <rect x="48" y="-1" width="10" height="14" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
      <rect x="51" y="-4" width="4" height="4" fill={P.ink} />
      <path d="M68 13a9 8 0 0 1 18 0Z" fill={P.paper} stroke={P.slateLight} strokeWidth="2" />
      <rect x="73" y="9" width="8" height="4" fill={P.gold} />
      <rect x="96" y="7" width="5" height="6" fill={P.paper} stroke={P.ink} strokeWidth="1" /><rect x="103" y="7" width="5" height="6" fill={P.orange} stroke={P.ink} strokeWidth="1" />
      <rect x={w - 14} y="7" width="9" height="7" fill={P.ink} /><rect x={w - 12} y="9" width="5" height="2" fill={P.mint} />
      <Plate x={w / 2 - 22} y={21} w={44} h={9} text="COFFEE" fill={P.slate} color={P.paper} mono size={5} />
    </g>
  );
}

/** The registration desk, which is the way out: a badge stand, a laptop and a small EXIT plate. */
function RegDesk({ w, h }: Size) {
  return (
    <g>
      <Shade w={w} h={h} />
      <rect x="1" y="12" width={w - 2} height="19" fill={P.cream} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="5" width={w - 4} height="14" fill={P.white} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="24" width={w - 8} height="3" fill={P.orange} />
      <rect x="6" y="-1" width="14" height="12" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      {[0, 1, 2].map((i) => <g key={i}><rect x={8 + i * 4} y="1" width="3" height="6" fill={P.paper} /><rect x={8 + i * 4} y="1" width="3" height="2" fill={i === 1 ? P.orange : P.slate} /></g>)}
      <rect x="35" y="9" width="18" height="6" fill={P.slateLight} stroke={P.ink} strokeWidth="1" />
      <rect x="37" y="-2" width="14" height="10" fill={P.slate} stroke={P.ink} strokeWidth="2" />
      <rect x="39" y="0" width="10" height="6" fill={P.paper} />
      <Plate x={w / 2 - 14} y={-7} w={28} h={10} text="EXIT" fill={P.orange} color={P.night} size={6.5} spacing={0.8} />
    </g>
  );
}

export default function TechArt({ layout, uid, brand, content }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const title = (content?.title || brand || "Tech night").toUpperCase();
  const banner = title.length > 38 ? `${title.slice(0, 37)}...` : title;
  const mat = `WELCOME TO ${title.slice(0, 22)}`;
  // 10 px mono, stepping down for a long name so it always fits the 192 px mat (the clubhouse's welcome mat, same maths).
  const matSize = Math.max(6, Math.min(10, (176 / mat.length - 1.5) / 0.6));
  const lineup = content?.lineup?.length
    ? content.lineup
    : [{ name: "Opening keynote", time: "10AM" }, { name: "Founder panel", time: "11AM" }, { name: "Live demos", time: "1PM" }, { name: "Mixer", time: "4PM" }];
  const sized = (p: CampaignProp, t: number): Size => ({ w: p.w * t, h: p.h * t });

  const custom: Record<string, Draw> = {
    "event-flyer": (p, t) => <Flyer uid={uid} x={6} y={4} w={p.w * t - 12} h={p.h * t - 8} url={content?.flyerUrl} title={title} line={content?.line} />,
    "event-lineup": (p, t) => <Lineup x={2} y={4} w={p.w * t - 4} h={p.h * t - 8} items={lineup} title="AGENDA" />,
    titlebanner: (p, t) => <TitleBanner {...sized(p, t)} title={banner} />,
    screen: (p, t) => <Screen {...sized(p, t)} />,
    whiteboard: (p, t) => <Whiteboard {...sized(p, t)} />,
    wifisign: (p, t) => <WifiSign {...sized(p, t)} />,
    techstage: (p, t) => <Stage {...sized(p, t)} uid={uid} />,
    podium: () => <Podium />,
    stool: () => <Stool />,
    runner: (p, t) => <RunnerArt {...sized(p, t)} />,
    chairrow: (p, t) => <ChairRows {...sized(p, t)} uid={uid} mark={p.id === "seats-l-1" ? 3 : p.id === "seats-r-1" ? 0 : undefined} />,
    avdesk: (p, t) => <AvDesk {...sized(p, t)} />,
    camera: () => <Camera />,
    rollup: (p, t) => <Rollup {...sized(p, t)} variant={p.variant ?? 0} />,
    demotable: (p, t) => <DemoTable {...sized(p, t)} variant={p.variant ?? 0} />,
    beanbag: (p) => <Beanbag variant={p.variant ?? 0} />,
    hightable: (p, t) => <HighTable w={p.w * t} />,
    swagtable: (p, t) => <SwagTable {...sized(p, t)} />,
    selfiewall: (p, t) => <SelfieWall {...sized(p, t)} uid={uid} />,
    charger: (p, t) => <Charger {...sized(p, t)} />,
    vending: (p, t) => <Vending {...sized(p, t)} />,
    coffeebar: (p, t) => <CoffeeBar {...sized(p, t)} />,
    regdesk: (p, t) => <RegDesk {...sized(p, t)} />,
  };

  const wallFace = tile + 3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["floortile", "stagewood", "acoustic"]} />
      <defs>
        <pattern id={`${uid}-techfloor`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#DCE2E7" />
          <path d="M0 0H32V32" fill="none" stroke="#C3CCD3" strokeWidth="1" />
          <path d="M5 7h3M21 22h4M12 27h1" stroke="#EDF1F4" strokeWidth="1" />
          <path d="M24 6h2M8 18h2" stroke="#CED6DC" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-seatrug`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#9EB1BA" />
          <path d="M0 0H16V16" fill="none" stroke="#8FA4AE" strokeWidth="1" />
          <path d="M4 5h2M11 12h2" stroke="#B3C4CB" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-repeat`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={P.night} />
          <rect x="2" y="2" width="4" height="4" fill={P.orange} />
          <rect x="10" y="10" width="4" height="4" fill={P.paper} opacity=".7" />
        </pattern>
        <pattern id={`${uid}-chair`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect x="6" y="11" width="24" height="20" fill={P.shadow} opacity=".22" />
          <rect x="5" y="3" width="22" height="13" fill={P.paper} stroke={P.ink} strokeWidth="2" />
          <rect x="8" y="5" width="7" height="2" fill={P.white} />
          <rect x="4" y="15" width="24" height="13" fill={P.slate} stroke={P.ink} strokeWidth="2" />
          <rect x="6" y="17" width="20" height="3" fill={P.slateLight} />
          <rect x="7" y="28" width="3" height="3" fill={P.ink} />
          <rect x="22" y="28" width="3" height="3" fill={P.ink} />
        </pattern>
      </defs>

      <Frame layout={layout} ground="#1D2A31" />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-techfloor)`} stroke={P.ink} strokeWidth="4" />

      {/* Floor patches: the coffee corner and the lobby in warm tile, a blue-grey carpet under the seats, a mat under every booth. */}
      <Floor uid={uid} rect={{ x: 22, y: 5, w: 5, h: 3 }} material="floortile" border={P.concreteDark} tile={tile} />
      <Floor uid={uid} rect={{ x: 11, y: 15, w: 8, h: 4 }} material="floortile" border={P.concreteDark} tile={tile} />
      <rect x={9 * tile} y={8 * tile} width={12 * tile} height={5 * tile} fill={`url(#${uid}-seatrug)`} stroke={P.slate} strokeWidth="2" />
      {[8, 11].map((y) => <rect key={`d${y}`} x={4 * tile + 2} y={y * tile + 2} width={3 * tile - 4} height={3 * tile - 4} fill={P.slateLight} opacity=".45" stroke={P.slate} strokeWidth="2" />)}
      {[8, 11].map((y) => <rect key={`s${y}`} x={23 * tile + 2} y={y * tile + 2} width={3 * tile - 4} height={3 * tile - 4} fill={P.cream} opacity=".8" stroke={P.orange} strokeWidth="2" />)}

      {/* Daylight from the windows lies on the floor in two bands. */}
      <path d={`M${3 * tile} ${9 * tile}L${3 * tile + 112} ${9 * tile + 44}V${11 * tile + 44}L${3 * tile} ${11 * tile}Z`} fill={P.white} opacity=".5" />
      <path d={`M${3 * tile} ${13 * tile}L${3 * tile + 112} ${13 * tile + 44}V${15 * tile + 44}L${3 * tile} ${15 * tile}Z`} fill={P.white} opacity=".5" />
      <path d={`M${27 * tile} ${16 * tile}L${27 * tile - 96} ${16 * tile + 40}V${17 * tile + 40}L${27 * tile} ${17 * tile + 16}Z`} fill={P.white} opacity=".5" />

      <Walls layout={layout} face={P.slate} cap={P.slateLight} />

      {/* Back wall: acoustic panels and a skirting strip. */}
      <rect x={wallFace} y={tile + 8} width={W - tile * 2 - 6} height={4 * tile - 24} fill={`url(#${uid}-acoustic)`} />
      <rect x={wallFace} y={5 * tile - 13} width={W - tile * 2 - 6} height="6" fill={P.slateLight} />
      {/* Side walls: windows (left), a clock (right). */}
      {[9, 13].map((y) => (
        <g key={y}>
          <rect x="42" y={y * tile + 4} width="46" height={2 * tile - 8} fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
          <path d={`M65 ${y * tile + 6}V${y * tile + 2 * tile - 6}M44 ${y * tile + tile}H86`} stroke={P.paper} strokeWidth="2" />
          <path d={`M47 ${y * tile + 10}h8M47 ${y * tile + 14}h4`} stroke={P.white} strokeWidth="2" />
        </g>
      ))}
      <g>
        <rect x={27 * tile + 10} y={16 * tile + 4} width="46" height="46" fill={P.lagoonLight} stroke={P.ink} strokeWidth="2" />
        <path d={`M${27 * tile + 33} ${16 * tile + 6}V${16 * tile + 48}M${27 * tile + 12} ${16 * tile + 27}H${27 * tile + 54}`} stroke={P.paper} strokeWidth="2" />
      </g>
      <g>
        <circle cx={28 * tile - 2} cy={9 * tile + 16} r="11" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d={`M${28 * tile - 2} ${9 * tile + 16}V${9 * tile + 9}M${28 * tile - 2} ${9 * tile + 16}H${28 * tile + 4}`} stroke={P.ink} strokeWidth="2" />
      </g>

      <Props layout={layout} uid={uid} custom={custom} order={(p) => (p.solid ? p.y : p.y - 100)} />

      {/* The welcome mat at the bottom centre, the event's name on it. */}
      <rect x={W / 2 - 96} y={H - tile - 33} width="192" height="20" fill={P.ink} />
      <rect x={W / 2 - 94} y={H - tile - 31} width="188" height="2" fill={P.cap} />
      <text x={W / 2} y={H - tile - 19} textAnchor="middle" fill={P.cream} fontFamily={FONT.mono} fontWeight={500} fontSize={matSize} letterSpacing="1.5">{mat}</text>

      {/* Spotlights over the stage: three fixtures on the wall, three pools of light. */}
      {[12, 15, 18].map((cx) => (
        <g key={cx}>
          <path d={`M${cx * tile - 4} ${5 * tile}L${cx * tile - 30} ${8 * tile}H${cx * tile + 30}L${cx * tile + 4} ${5 * tile}Z`} fill={P.white} opacity=".16" />
          <rect x={cx * tile - 6} y={5 * tile - 7} width="12" height="5" fill={P.cap} stroke={P.ink} strokeWidth="1" />
        </g>
      ))}

      {/* The front lip of the room. */}
      <path d={`M${tile} ${H - 1}H${W - tile}`} stroke={P.ink} strokeWidth="4" />
    </svg>
  );
}
