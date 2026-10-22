import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { ER, FitText, Heartbeat, plateMetrics, type Draw } from "./emergencyKit";
import { FONT, P } from "./kit";

/**
 * Emergency Room by SOS, the sections of the room. Same brick red, bone and charcoal on
 * the light grey floor, but it reads as a rave venue with their brand: section signs without crosses, light frames and stands
 * instead of curtains, clothes for the merch, their Instagram glyph, their logo on the back wall. The "+" with a heartbeat line
 * (their mark) is used sparingly: the deck top and the logo only. Colours come from ER (emergencyKit.tsx), one place.
 */

/** Their handle and page: data only for now, a tap will open it later (nothing here is wired). */
export const ER_INSTAGRAM = { handle: "@emergencyroombysos", url: "https://www.instagram.com/emergencyroombysos/" } as const;
/** Their next event's DJs, in order. Names only. */
export const ER_PERFORMERS = ["VALOR", "PROPHESOR", "CHIEFIMAM", "TEMPEST", "OJONIMI"] as const;
/** Their logo file (150 by 150 px, so it is a little soft when drawn larger), under /public/brands. */
export const ER_LOGO_SRC = "/brands/emergency-room-sos.jpg";

/** A section sign: a brick red plate, the title in bone (two lines when it is long), a small mono line under it. No cross. */
export function RaveSign({ x, y, w, title, sub }: { x: number; y: number; w: number; title: string; sub?: string }) {
  const { lines, hh } = plateMetrics(w, title, sub);
  const two = lines.length === 2;
  const y1 = two ? y + 15 : sub ? y + 15 : y + hh / 2 + 5;
  return (
    <g>
      <rect x={x + 3} y={y + 5} width={w} height={hh} fill={P.shadow} opacity=".25" />
      <rect x={x} y={y + 3} width={w} height={hh} fill={ER.redDeep} stroke={ER.charcoal} strokeWidth="2" />
      <rect x={x} y={y} width={w} height={hh} fill={ER.red} stroke={ER.charcoal} strokeWidth="2" />
      <rect x={x + 3} y={y + 3} width={w - 6} height={hh - 6} fill="none" stroke={ER.bone} strokeWidth="1" opacity=".55" />
      {lines.map((ln, i) => <FitText key={i} x={x + w / 2} y={y1 + i * 13} w={w - 14} text={ln} max={13} min={9} fill={ER.bone} />)}
      {sub && <FitText x={x + w / 2} y={y + hh - 7} w={w - 14} text={sub} max={7.5} min={5} fill={ER.bone} mono spacing={0.8} />}
    </g>
  );
}

/** Their mark: a thin "+" with a heartbeat line running out of it, red. About 3 times as wide as high. */
export function PlusBeat({ x, y, w, color = ER.red }: { x: number; y: number; w: number; color?: string }) {
  const h = w / 3;
  return (
    <g>
      <path d={`M${x + h * 0.5} ${y + h * 0.1}V${y + h * 0.9}M${x} ${y + h * 0.5}H${x + h}`} stroke={color} strokeWidth="2" />
      <Heartbeat x={x + h * 1.1} y={y} w={w - h * 1.1} h={h} color={color} sw={1.8} />
    </g>
  );
}

/**
 * A light bay: a top bar with a thin red LED line on two bone stands, the sign hung from the bar on two chains. No curtains.
 * `children(ix, iw, top, bottom)` draws the section's furniture inside, ix the inner left and iw the inner width.
 */
export function LedBay({ w, h, title, sub, children }: { w: number; h: number; title: string; sub?: string; children: (ix: number, iw: number, top: number, bottom: number) => ReactNode }) {
  const post = 9;
  const { hh } = plateMetrics(w - post * 2 - 10, title, sub);
  const top = 10 + hh + 5;
  return (
    <g>
      <rect x={post - 1} y="0" width={w - post * 2 + 2} height="8" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1.5" />
      <rect x={post + 2} y="3" width={w - post * 2 - 4} height="2" fill={ER.red} />
      {[0, 1].map((side) => {
        const px = side ? w - post : 0;
        return (
          <g key={side}>
            <rect x={px} y="0" width={post} height={h - 1} fill={ER.bone} stroke={ER.charcoal} strokeWidth="1.5" />
            <rect x={px + 1.5} y="2" width={post - 3} height="5" fill={ER.red} />
            <rect x={px - 2} y={h - 5} width={post + 4} height="4" fill={ER.boneDark} stroke={ER.charcoal} strokeWidth="1" />
          </g>
        );
      })}
      <path d={`M${w / 2 - 30} 8V11M${w / 2 + 30} 8V11`} stroke={ER.charcoal} strokeWidth="1.5" />
      <RaveSign x={post + 5} y={10} w={w - post * 2 - 10} title={title} sub={sub} />
      {children(post + 3, w - post * 2 - 6, top, h - 3)}
    </g>
  );
}

/** A counter along the bottom: bone top, a front with a red lip. */
function Counter({ x, w, bottom, depth = 24 }: { x: number; w: number; bottom: number; depth?: number }) {
  const y = bottom - depth;
  return (
    <g>
      <rect x={x + 3} y={y + 4} width={w - 2} height={depth} fill={P.shadow} opacity=".22" />
      <rect x={x + 1} y={y} width={w - 2} height={depth} fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
      <rect x={x + 2} y={y + 1} width={w - 4} height="7" fill={P.white} />
      <rect x={x + 2} y={y + 8} width={w - 4} height="2" fill={ER.boneShade} />
      <rect x={x + 3} y={bottom - 8} width={w - 6} height="4" fill={ER.red} />
    </g>
  );
}

/** One garment hanging from a rail at (x, y): a tee or a hoodie, 24 wide, with its hanger. */
function Garment({ x, y, color, hoodie }: { x: number; y: number; color: string; hoodie?: boolean }) {
  const body = hoodie ? "M4 2L0 7L3 12L6 10V28H20V10L23 12L26 7L22 2Q13 6 4 2Z" : "M5 2L0 7L3 11L6 9V24H18V9L21 11L24 7L19 2Q12 6 5 2Z";
  return (
    <g transform={`translate(${x},${y})`}>
      <path d="M12 -2V1M12 -2l-5 4M12 -2l5 4" stroke={ER.charcoal} strokeWidth="1.2" fill="none" />
      <path d={body} fill={color} stroke={ER.charcoal} strokeWidth="1.5" strokeLinejoin="round" />
      {hoodie && <path d="M8 3Q13 11 18 3" fill="none" stroke={ER.charcoal} strokeWidth="1.2" />}
      {hoodie && <rect x="8" y="19" width="10" height="4" fill="none" stroke={ER.charcoal} strokeWidth="1" opacity=".6" />}
      <rect x={hoodie ? 8 : 7} y="12" width={hoodie ? 10 : 10} height="3" fill="#FFFFFF" opacity=".5" />
    </g>
  );
}

/** A cap: a dome and a brim. */
function Cap({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path d="M0 8Q0 0 8 0Q16 0 16 8Z" fill={color} stroke={ER.charcoal} strokeWidth="1.3" />
      <rect x="9" y="6" width="9" height="3" fill={color} stroke={ER.charcoal} strokeWidth="1.2" />
    </g>
  );
}

/** The Instagram glyph in a simple flat form: a rounded square, a ring and a dot. s px square. */
export function InstagramGlyph({ x, y, s, color = ER.red }: { x: number; y: number; s: number; color?: string }) {
  const sw = Math.max(2.5, s / 9);
  return (
    <g>
      <rect x={x + sw / 2} y={y + sw / 2} width={s - sw} height={s - sw} rx={s * 0.28} fill="none" stroke={color} strokeWidth={sw} />
      <circle cx={x + s / 2} cy={y + s / 2} r={s * 0.22} fill="none" stroke={color} strokeWidth={sw} />
      <circle cx={x + s * 0.76} cy={y + s * 0.24} r={sw * 0.55} fill={color} />
    </g>
  );
}

/** A small potted plant for the lounge. */
function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path d="M2 12H14L13 20H3Z" fill={ER.redDeep} stroke={ER.charcoal} strokeWidth="1.3" />
      <path d="M8 12V2M8 8L2 3M8 7L14 2M8 10L3 8M8 10L13 8" stroke="#3F6B4A" strokeWidth="2.2" fill="none" />
    </g>
  );
}

/**
 * The section props of the Emergency Room: no crosses, no curtains, no medical props. Kinds: ravehall, performers, experiences,
 * merchrack, healing, entrancedesk, erlightbox (their logo image).
 */
export function raveProps(): Record<string, Draw> {
  const bay = (p: CampaignProp, title: string, sub: string | undefined, body: (ix: number, iw: number, top: number, bottom: number) => ReactNode) => (
    <LedBay w={p.w * 32} h={p.h * 32} title={title} sub={sub}>{body}</LedBay>
  );
  return {
    // The back wall logo: a lit lightbox with their logo image (or the vector redraw), a bone frame and a red LED edge.
    erlightbox: (p) => {
      const w = p.w * 32;
      const h = p.h * 32 - 2;
      const iw = w - 10;
      const ih = h - 10;
      return (
        <g>
          <rect x="4" y="5" width={w} height={h} fill={P.shadow} opacity=".25" />
          <rect x="0" y="0" width={w} height={h} fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
          <svg x="5" y="5" width={iw} height={ih} viewBox={`0 0 ${iw} ${ih}`}>
            <rect width={iw} height={ih} fill={ER.logoDark} />
            <image href={ER_LOGO_SRC} x="0" y={-(iw - ih) / 2} width={iw} height={iw} preserveAspectRatio="xMidYMid slice" />
          </svg>
          <rect x="5" y="5" width={iw} height={ih} fill="none" stroke={ER.charcoal} strokeWidth="1.5" />
          <rect x="2.5" y="2.5" width={w - 5} height={h - 5} fill="none" stroke={ER.red} strokeWidth="1.5" opacity=".9" />
        </g>
      );
    },
    // The Hall of Fame: a gallery wall. A plate and a row of framed photos and award frames.
    ravehall: (p) => {
      const w = p.w * 32;
      const h = p.h * 32;
      const plateW = Math.min(150, w * 0.5);
      const fy = 22;
      const fh = h - fy - 8;
      const n = Math.max(3, Math.floor((w - 20) / 36));
      const step = (w - 20) / n;
      return (
        <g>
          <rect x="2" y={fy + fh - 2} width={w - 4} height="3" fill={ER.boneDark} stroke={ER.charcoal} strokeWidth="1" />
          {Array.from({ length: n }, (_, i) => {
            const fw = step - 8;
            const award = i % 3 === 1;
            return (
              <g key={i} transform={`translate(${10 + i * step},${fy})`}>
                <rect x="2" y="3" width={fw} height={fh} fill={P.shadow} opacity=".22" />
                <rect x="0" y="0" width={fw} height={fh - 2} fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
                {award ? (
                  <g><rect x="4" y="4" width={fw - 8} height={fh - 12} fill={ER.redPale} /><path d={`M${fw / 2 - 6} ${fh / 2 - 12}h12v5q0 6 -6 7q-6 -1 -6 -7Z`} fill={ER.red} /><rect x={fw / 2 - 1} y={fh / 2 - 1} width="2" height="6" fill={ER.red} /><rect x={fw / 2 - 5} y={fh / 2 + 5} width="10" height="3" fill={ER.red} /><rect x="6" y={fh - 12} width={fw - 12} height="3" fill={ER.charSoft} /></g>
                ) : (
                  <g><rect x="4" y="4" width={fw - 8} height={fh - 12} fill={i % 2 ? ER.boneDark : ER.charSoft} /><rect x="4" y={fh - 18} width={fw - 8} height="6" fill={i % 2 ? ER.red : ER.redTint} opacity=".85" /></g>
                )}
              </g>
            );
          })}
          <rect x={w / 2 - plateW / 2 + 3} y="3" width={plateW} height="20" fill={P.shadow} opacity=".25" />
          <rect x={w / 2 - plateW / 2} y="0" width={plateW} height="20" fill={ER.red} stroke={ER.charcoal} strokeWidth="2" />
          <rect x={w / 2 - plateW / 2 + 3} y="3" width={plateW - 6} height="14" fill="none" stroke={ER.bone} strokeWidth="1" opacity=".55" />
          <FitText x={w / 2} y={14.6} w={plateW - 14} text="HALL OF FAME" max={12} fill={ER.bone} />
        </g>
      );
    },
    // PERFORMERS ON DUTY: the next event's DJs on a board, in order, names only.
    performers: (p) => {
      const w = p.w * 32;
      const h = p.h * 32;
      return (
        <g>
          <rect x="4" y="5" width={w - 4} height={h - 6} fill={P.shadow} opacity=".25" />
          <rect x="1" y="2" width={w - 4} height={h - 6} fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
          <rect x="3" y="4" width={w - 8} height="24" fill={ER.red} />
          <FitText x={w / 2 - 2} y={20} w={w - 24} text="PERFORMERS ON DUTY" max={13} fill={ER.bone} />
          {ER_PERFORMERS.map((name, i) => (
            <g key={name}>
              <rect x="16" y={38 + i * 11 - 6} width="4" height="4" fill={ER.red} />
              <FitText x={26} y={38 + i * 11} w={w - 44} text={name} max={9.5} fill={ER.charcoal} anchor="start" spacing={0.8} />
            </g>
          ))}
        </g>
      );
    },
    // EXPERIENCES: a big Instagram glyph on a lit panel with their handle under it. A tap will open ER_INSTAGRAM.url later.
    experiences: (p) =>
      bay(p, "EXPERIENCES", "FOLLOW US", (ix, iw, top, bottom) => {
        const gs = Math.min(46, bottom - top - 24);
        return (
          <g>
            <rect x={ix + 6} y={top} width={iw - 12} height={bottom - top - 2} fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
            <rect x={ix + 9} y={top + 3} width={iw - 18} height={bottom - top - 8} fill="none" stroke={ER.redTint} strokeWidth="1.5" />
            <InstagramGlyph x={ix + iw / 2 - gs / 2} y={top + 7} s={gs} />
            <text x={ix + iw / 2} y={bottom - 9} textAnchor="middle" fill={ER.charcoal} fontFamily={FONT.mono} fontWeight={500} fontSize={Math.min(9.5, (iw - 30) / 11.6)}>{ER_INSTAGRAM.handle}</text>
          </g>
        );
      }),
    // MERCH: a rail of hanging tees and hoodies, folded stacks and caps on the counter.
    merchrack: (p) =>
      bay(p, "MERCH", "THE DRIP", (ix, iw, top, bottom) => {
        const n = Math.max(3, Math.floor((iw - 8) / 28));
        const gap = (iw - 8) / n;
        const colors = ER.merch;
        return (
          <g>
            <rect x={ix + 2} y={top + 1} width={iw - 4} height="3" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1" />
            {Array.from({ length: n }, (_, i) => <Garment key={i} x={ix + 6 + i * gap + (gap - 26) / 2} y={top + 6} color={colors[(i * 2) % colors.length]} hoodie={i % 2 === 1} />)}
            <Counter x={ix} w={iw} bottom={bottom} depth={26} />
            {[0, 1, 2].map((i) => <rect key={i} x={ix + 8} y={bottom - 33 + i * 3} width={22 - i * 2} height="3" fill={colors[(i + 1) % colors.length]} stroke={ER.charcoal} strokeWidth="0.8" />)}
            {[0, 1, 2].map((i) => <rect key={`b${i}`} x={ix + 36} y={bottom - 33 + i * 3} width={20 - i} height="3" fill={colors[(i + 4) % colors.length]} stroke={ER.charcoal} strokeWidth="0.8" />)}
            <Cap x={ix + iw - 56} y={bottom - 34} color={colors[2]} />
            <Cap x={ix + iw - 36} y={bottom - 34} color={colors[1]} />
            <Cap x={ix + iw - 18} y={bottom - 34} color={colors[3]} />
          </g>
        );
      }),
    // AFROTECH HEALING: a calm lounge corner. A rug, a low sofa, a plant and a floor lamp with a soft pool of light.
    healing: (p) =>
      bay(p, "AFROTECH HEALING", "SIT BACK", (ix, iw, top, bottom) => (
        <g>
          <ellipse cx={ix + iw - 18} cy={bottom - 14} rx="30" ry="18" fill={ER.lamp} opacity=".5" />
          <rect x={ix + 8} y={bottom - 22} width={iw - 16} height="17" fill={ER.bone} stroke={ER.redTint} strokeWidth="1.5" />
          <rect x={ix + 12} y={bottom - 50} width={iw - 40} height="30" fill={ER.redDeep} stroke={ER.charcoal} strokeWidth="2" />
          <rect x={ix + 14} y={bottom - 48} width={iw - 44} height="10" fill={ER.red} />
          <rect x={ix + 15} y={bottom - 36} width={(iw - 46) / 2} height="12" fill={ER.redTint} stroke={ER.red} strokeWidth="1" /><rect x={ix + 17 + (iw - 46) / 2} y={bottom - 36} width={(iw - 46) / 2} height="12" fill={ER.redTint} stroke={ER.red} strokeWidth="1" />
          <Plant x={ix + 2} y={bottom - 32} />
          <path d={`M${ix + iw - 14} ${bottom - 4}V${bottom - 36}`} stroke={ER.charcoal} strokeWidth="2" />
          <path d={`M${ix + iw - 22} ${bottom - 34}L${ix + iw - 18} ${bottom - 44}H${ix + iw - 10}L${ix + iw - 6} ${bottom - 34}Z`} fill={ER.lamp} stroke={ER.charcoal} strokeWidth="1.5" />
        </g>
      )),
    // ENTRANCE: where the tickets will be. A counter with stubs, a scanner and a tray of wristbands.
    entrancedesk: (p) =>
      bay(p, "ENTRANCE", "TICKETS HERE", (ix, iw, top, bottom) => (
        <g>
          <Counter x={ix} w={iw} bottom={bottom} depth={Math.min(26, bottom - top)} />
          <g transform={`translate(${ix + 8},${bottom - 32})`}>{[0, 1, 2].map((i) => <rect key={i} x={i * 6} y={-i} width="14" height="7" fill={i === 2 ? ER.red : P.white} stroke={ER.charcoal} strokeWidth="1" />)}</g>
          <rect x={ix + iw / 2 - 6} y={bottom - 32} width="12" height="8" fill={ER.charSoft} stroke={ER.charcoal} strokeWidth="1" /><rect x={ix + iw / 2 - 4} y={bottom - 30} width="8" height="2" fill={ER.redTint} />
          {[0, 1, 2, 3].map((i) => <circle key={i} cx={ix + iw - 30 + i * 6} cy={bottom - 28} r="3" fill="none" stroke={ER.merch[(i + 1) % 5]} strokeWidth="2" />)}
        </g>
      )),
  };
}
