import type { ReactNode } from "react";
import type { CampaignProp } from "@/lib/campaign/layout";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { BRAND_LINES, BrandSign, HopBay, HopBus, P, Plate, Props, RouteLine, Shade, Stamp, StringLights, type RoomArtProps } from "./kit";

/**
 * Bourdillon, Ikoyi: the quiet, leafy side of the island at dusk, in green and cream. A flat teal sky over the lagoon, the
 * Lekki-Ikoyi Link Bridge across the whole top of the room (one tall white pylon on the right, cable fans, a lit deck and two
 * boats on the water), a quay promenade, then the neighbourhood: Bogobiri House (a green villa with a bamboo bar and a
 * gallery) and Danfo Bistro (a building that is the front of a danfo) behind a tree-lined alley, The Jazzhole (a cream record
 * shop), Pitstop Village (three cabins round a yard under string lights) and a square with one big rain tree. Alexander
 * Avenue runs down the right of the room under an estate gateway: SUVs at the kerbs, a danfo passing, the Hop bus in its bay.
 *
 * Names, sign and the three place colours come from src/lib/rooms/hotspotRooms.ts ("ikoyi"). The place's green and cream own
 * the facades and the SUVs, gold is only ever brass and lit glass, and the room's big sign is the orange Hoppaz gateway sign.
 * Same pixel look as the clubhouse: 2 px ink, top-left light, a hard shadow to the lower right, flat colour, no gradients.
 *
 * The Hoppaz layer (docs/ROOM-TEMPLATES.md "Look"): the orange Hop bus in its painted bay (`hop-bus`), the route through the
 * four venue doors (finale in the Pitstop yard), the estate gateway as the bounce wordmark sign (BOURDILLON in its strip),
 * an orange and cream vendor umbrella on the chip seller's cart and one rubber stamp on the forecourt. No violet at all.
 */
const PLACE = hotspotRoomData("ikoyi");
const SIGN = PLACE?.sign ?? "BOURDILLON";
const PAL = PLACE?.palette ?? { primary: "#2E4A3E", secondary: "#E8DCC4", accent: "#C9A24B" };
const NAMES = PLACE?.landmarks.map((l) => l.name) ?? ["Bogobiri House", "The Jazzhole", "Danfo Bistro", "Pitstop Village"];

const GREEN = PAL.primary;
const GREEN_DK = "#213629";
const GREEN_LT = "#4B6B58";
const CREAM = PAL.secondary;
const CREAM_DK = "#C7BA9A";
/** Brass and lit glass only. Never a sign ground. */
const GOLD = PAL.accent;
const LIT = P.gold;
const GLASS = "#3B4A4F";

/** The dusk sky in flat bands (natural, calm: orange stays the loudest colour). */
const SKY = ["#29434D", "#3A5F67", "#6A8C89", "#D2B78D"] as const;
const FAR = "#26403F";

const rep = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("");

/** The pylon's x, the deck's top and bottom (scene px). */
const PYLON = 700;
const DECK = 84;

/** The lagoon, the bridge and the sky: drawn in scene pixels (the hero's box is shifted back), so it runs past the box into the ring. */
function Bridge({ ox, oy, uid }: { ox: number; oy: number; uid: string }) {
  const cables = Array.from({ length: 8 }, (_, k) => {
    const y = 14 + k * 9;
    const d = 262 - k * 34;
    return `M${PYLON} ${y}L${PYLON - d} ${DECK}M${PYLON} ${y}L${PYLON + d} ${DECK}`;
  }).join("");
  const lampHeads = rep(24, (i) => `M${10 + i * 40} 74h4v4h-4Z`);
  const lampPosts = rep(24, (i) => `M${12 + i * 40} 78v6`);
  const piers = [60, 180, 300, 420, 860].map((x) => `M${x - 5} 95h10v32h-10Z`).join("");
  const shoreLit = "M14 66h2v2h-2ZM44 58h2v2h-2ZM48 62h2v2h-2ZM104 62h2v2h-2ZM122 76h2v2h-2ZM170 64h2v2h-2ZM232 68h2v2h-2ZM246 72h2v2h-2ZM322 72h2v2h-2ZM392 74h2v2h-2ZM420 72h2v2h-2ZM494 76h2v2h-2ZM802 76h2v2h-2ZM834 70h2v2h-2ZM872 80h2v2h-2ZM926 68h2v2h-2Z";
  const glitter = rep(14, (i) => `M${20 + i * 66} ${106 + (i % 3) * 8}h${8 + (i % 2) * 6}`);
  return (
    <g transform={`translate(${-ox},${-oy})`}>
      {SKY.map((c, i) => <rect key={c} x="0" y={[0, 30, 54, 72][i]} width="960" height={[30, 24, 18, 30][i]} fill={c} />)}
      <circle cx="222" cy="84" r="26" fill="#E3C99A" opacity=".35" />
      <circle cx="222" cy="86" r="15" fill="#F0DDB2" />
      <path d="M0 100V78H12V62H28V74H40V54H54V70H70V80H84V66H98V58H116V72H130V84H150V70H166V60H180V76H200V86H222V72H240V64H256V78H272V88H300V74H316V66H332V80H350V90H380V76H396V68H412V82H430V90H470V80H486V72H502V84H520V92H560V100ZM780 100V84H796V72H812V80H830V66H846V76H862V86H880V70H900V80H920V64H940V76H960V100Z" fill={FAR} />
      <path d={shoreLit} fill={LIT} opacity=".85" />
      {/* the water, a shade under the deck, the lit deck's glitter and the pylon's reflection */}
      <rect x="0" y="96" width="960" height="64" fill={`url(#${uid}-water)`} />
      <rect x="0" y="96" width="960" height="10" fill="#1D3F4C" opacity=".55" />
      <path d={glitter} stroke={LIT} strokeWidth="2" opacity=".6" />
      <path d={`M${PYLON - 2} 108h4v8h-4ZM${PYLON - 2} 122h4v6h-4ZM${PYLON - 2} 134h4v8h-4Z`} fill={P.paper} opacity=".45" />
      {/* two boats: a white cruiser with a green stripe, a moored wooden canoe */}
      <g transform="translate(116,112)">
        <path d="M-8 22h14M62 24h16" stroke={P.lagoonLight} strokeWidth="2" opacity=".7" />
        <path d="M2 12H62L54 24H10Z" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <path d="M6 17H58" stroke={GREEN} strokeWidth="3" />
        <rect x="20" y="2" width="26" height="10" fill={P.paper} stroke={P.ink} strokeWidth="2" />
        <rect x="23" y="5" width="20" height="4" fill={P.night} />
        <path d="M52 12V-2" stroke={P.ink} strokeWidth="2" />
        <path d="M52 -2h8l-3 3 3 3h-8Z" fill={GREEN} stroke={P.ink} strokeWidth="1" />
      </g>
      <g transform="translate(424,132)">
        <path d="M-6 12h10M44 14h12" stroke={P.lagoonLight} strokeWidth="2" opacity=".7" />
        <path d="M0 4H48L42 14H8Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
        <rect x="14" y="-3" width="16" height="7" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      </g>
      {/* the deck, its approach piers, lamps and the single pylon with its cable fans */}
      <path d={piers} fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y={DECK} width="960" height="11" fill={P.concrete} />
      <rect x="0" y={DECK} width="960" height="3" fill={P.paper} />
      <rect x="0" y={DECK + 8} width="960" height="3" fill={P.concreteDark} />
      <path d={`M0 ${DECK}H960M0 ${DECK + 11}H960`} stroke={P.ink} strokeWidth="2" />
      <path d={lampPosts} stroke={P.ink} strokeWidth="2" />
      <path d={lampHeads} fill={GOLD} />
      <path d={cables} fill="none" stroke={P.paper} strokeWidth="1.5" opacity=".9" />
      <rect x={PYLON - 11} y={DECK - 6} width="22" height="18" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <path d={`M${PYLON - 8} ${DECK - 4}L${PYLON - 3} 8H${PYLON + 3}L${PYLON + 8} ${DECK - 4}Z`} fill={P.paper} stroke={P.ink} strokeWidth="2" />
      <path d={`M${PYLON} 8H${PYLON + 3}L${PYLON + 8} ${DECK - 4}H${PYLON}Z`} fill={P.stone} />
      <path d={`M${PYLON - 6} 36H${PYLON + 6}M${PYLON - 7} 60H${PYLON + 7}`} stroke={P.ink} strokeWidth="1.5" />
      <rect x={PYLON - 5} y="4" width="10" height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x={PYLON - 2} y="0" width="4" height="4" fill={P.red} stroke={P.ink} strokeWidth="1" />
      {/* the quay: stone edge and a railing on posts */}
      <rect x="0" y="146" width="960" height="14" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="148" width="960" height="3" fill={P.paper} />
      <path d={rep(30, (i) => `M${i * 32 + 16} 134v12`)} stroke={P.ink} strokeWidth="4" />
      <path d={rep(30, (i) => `M${i * 32 + 16} 135v10`)} stroke={CREAM} strokeWidth="2" />
      <path d="M0 136H960" stroke={P.ink} strokeWidth="4" />
      <path d="M0 136H960" stroke={CREAM} strokeWidth="2" />
    </g>
  );
}

/** Bogobiri House: a green villa with a cream parapet and an adire band; a bamboo bar on the left, an arched door, a gallery on the right. 8 by 4 tiles. */
function Bogobiri({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="2" y="26" width={w - 4} height={h - 30} fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="28" width="5" height={h - 34} fill={GREEN_LT} />
      <rect x={w - 10} y="28" width="6" height={h - 34} fill={GREEN_DK} />
      <path d="M92 10V4H104V-2H152V4H164V10Z" fill={CREAM} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y="10" width={w} height="16" fill={CREAM} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="12" width={w - 4} height="3" fill={P.paper} />
      <rect x="2" y="26" width={w - 4} height="10" fill={`url(#${uid}-adire)`} stroke={P.ink} strokeWidth="1" />
      <Plate x={(w - 140) / 2} y={40} w={140} h={20} text={name} fill={P.night} color={P.paper} />
      {/* the bamboo bar */}
      <rect x="10" y="62" width="88" height="40" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d="M16 74H92M16 86H92" stroke={GOLD} strokeWidth="2" opacity=".8" />
      <path d="M22 70v4M34 70v4M52 82v4M72 70v4M84 82v4" stroke={LIT} strokeWidth="3" />
      <rect x="4" y="56" width="100" height="10" fill={`url(#${uid}-bamboo)`} stroke={P.ink} strokeWidth="2" />
      <path d="M12 66V104M96 66V104" stroke={P.ink} strokeWidth="4" />
      <path d="M12 66V104M96 66V104" stroke={P.woodLight} strokeWidth="2" />
      <rect x="10" y="98" width="88" height="12" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="99" width="84" height="3" fill={P.woodLight} />
      {/* the arched door under two lanterns */}
      <path d="M106 118V82Q128 62 150 82V118Z" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <path d="M112 116V86Q128 72 144 86V116Z" fill={LIT} />
      <path d="M128 76V116M112 100H144" stroke={P.ink} strokeWidth="2" />
      <rect x="98" y="84" width="6" height="10" fill={GOLD} stroke={P.ink} strokeWidth="1.5" />
      <rect x="152" y="84" width="6" height="10" fill={GOLD} stroke={P.ink} strokeWidth="1.5" />
      <rect x="102" y="116" width="52" height="6" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      {/* the gallery: two lit windows with framed work */}
      {[170, 212].map((x, i) => (
        <g key={x}>
          <rect x={x} y="62" width="36" height="42" fill={P.night} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="65" width="30" height="36" fill={LIT} opacity=".4" />
          <rect x={x + 5} y="68" width="12" height="16" fill={i ? P.leaf : P.red} stroke={P.ink} strokeWidth="1.5" />
          <rect x={x + 20} y="72" width="10" height="10" fill={i ? P.red : P.danfo} stroke={P.ink} strokeWidth="1.5" />
          <rect x={x + 8} y="90" width="20" height="4" fill={P.paper} stroke={P.ink} strokeWidth="1" />
        </g>
      ))}
      {/* the low front wall with a gap at the door */}
      <rect x="0" y={h - 10} width="100" height="10" fill={CREAM_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="156" y={h - 10} width={w - 156} height="10" fill={CREAM_DK} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** The Jazzhole: a cream shopfront under a green cornice, a striped awning, record and book windows, a record on a bracket. 7 by 4 tiles. */
function Jazzhole({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const scallops = rep(Math.floor((w - 16) / 16), (i) => (i % 2 ? "" : `M${8 + i * 16} 66h16l-8 7Z`));
  const scallopsCream = rep(Math.floor((w - 16) / 16), (i) => (i % 2 ? `M${8 + i * 16} 66h16l-8 7Z` : ""));
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="2" y="18" width={w - 4} height={h - 22} fill={CREAM} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="20" width="5" height={h - 26} fill={P.paper} />
      <rect x={w - 10} y="20" width="6" height={h - 26} fill={CREAM_DK} />
      <rect x="0" y="4" width={w} height="18" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="6" width={w - 4} height="3" fill={GREEN_LT} />
      <Plate x={(w - 144) / 2 + 8} y={26} w={144} h={22} text={name} fill={P.night} color={P.paper} />
      {/* the record on its bracket */}
      <path d="M8 42H30" stroke={P.ink} strokeWidth="3" />
      <circle cx="26" cy="60" r="14" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <circle cx="26" cy="60" r="9" fill="none" stroke={P.nightLine} strokeWidth="2" />
      <circle cx="26" cy="60" r="5" fill={CREAM} />
      <circle cx="26" cy="60" r="1.5" fill={P.ink} />
      {/* the awning */}
      <rect x="8" y="52" width={w - 16} height="14" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="2" />
      <path d={scallops} fill={GREEN} stroke={P.ink} strokeWidth="1.5" />
      <path d={scallopsCream} fill={CREAM} stroke={P.ink} strokeWidth="1.5" />
      {/* two windows full of records and books, a green door between */}
      {[12, w - 98].map((x, i) => (
        <g key={x}>
          <rect x={x} y="76" width="86" height="40" fill={P.night} stroke={P.ink} strokeWidth="2" />
          <rect x={x + 3} y="79" width="80" height="11" fill={`url(#${uid}-spines)`} />
          <rect x={x + 3} y="92" width="80" height="11" fill={`url(#${uid}-spines)`} transform={`translate(${i ? 5 : 11} 0)`} />
          <rect x={x + 3} y="105" width="80" height="9" fill={`url(#${uid}-spines)`} />
          <path d={`M${x + 3} 91.5H${x + 83}M${x + 3} 104.5H${x + 83}`} stroke={P.woodLight} strokeWidth="2" />
        </g>
      ))}
      <rect x={w / 2 - 12} y="74" width="24" height="50" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 8} y="78" width="16" height="26" fill={LIT} stroke={P.ink} strokeWidth="1.5" />
      <rect x={w / 2 + 5} y="108" width="3" height="6" fill={GOLD} />
      <rect x="0" y={h - 8} width={w} height="8" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** Danfo Bistro: the front of a danfo as a building. A destination board with the name, a lit windscreen, two headlights and a bumper. 8 by 4 tiles. */
function DanfoBistro({ w, h, name }: { w: number; h: number; name: string }) {
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="64" y="16" width="5" height="14" fill={P.ink} />
      <rect x={w - 69} y="16" width="5" height="14" fill={P.ink} />
      <Plate x={(w - 160) / 2} y={-2} w={160} h={22} text={name} fill={P.night} color={P.paper} />
      <rect x="6" y="28" width={w - 12} height="12" fill={P.danfoDark} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="30" width={w - 16} height="3" fill={P.danfo} />
      <rect x="2" y="40" width={w - 4} height={h - 44} fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="42" width="5" height={h - 48} fill={P.paper} opacity=".4" />
      {/* the windscreen: two lit panes round a pillar, wipers */}
      <rect x="14" y="46" width={w - 28} height="42" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="18" y="50" width={(w - 52) / 2} height="34" fill={LIT} />
      <rect x={w / 2 + 6} y="50" width={(w - 52) / 2} height="34" fill={LIT} />
      <rect x={w / 2 - 6} y="46" width="12" height="42" fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <path d="M22 80L60 62M" stroke={P.ink} strokeWidth="2" />
      <path d={`M${w - 22} 80L${w - 60} 62`} stroke={P.ink} strokeWidth="2" />
      <path d="M22 54h30M26 62h24" stroke={P.paper} strokeWidth="2" opacity=".5" />
      {/* the black band, the door in the grille, the headlights and plates */}
      <rect x="2" y="92" width={w - 4} height="9" fill={P.night} />
      <rect x={w / 2 - 28} y="90" width="56" height={h - 98} fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x={w / 2 - 24} y="94" width="22" height={h - 108} fill={LIT} />
      <rect x={w / 2 + 2} y="94" width="22" height={h - 108} fill={LIT} />
      <path d={`M${w / 2} 92V${h - 12}`} stroke={P.ink} strokeWidth="2" />
      {[34, w - 34].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="104" r="11" fill={P.paper} stroke={P.ink} strokeWidth="2" />
          <circle cx={cx} cy="104" r="5" fill={LIT} />
        </g>
      ))}
      <rect x="64" y="108" width="30" height="10" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d="M69 113h20" stroke={P.ink} strokeWidth="2" />
      <rect x={w - 94} y="108" width="30" height="10" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M${w - 89} 113h20`} stroke={P.ink} strokeWidth="2" />
      <rect x="0" y={h - 10} width={w} height="10" fill={P.night} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y={h - 8} width={w - 4} height="2" fill={P.cap} />
      <rect x="-4" y="50" width="6" height="14" fill={P.ink} />
      <rect x={w - 2} y="50" width="6" height="14" fill={P.ink} />
    </g>
  );
}

/** Pitstop Village: three cabins (coffee roastery, healthy plates, the dining room) under corrugated roofs, with the name board over them. 7 by 2 tiles. */
function Pitstop({ w, h, uid, name }: { w: number; h: number; uid: string; name: string }) {
  const cw = (w - 8) / 3;
  const tones = [GREEN, CREAM, GREEN_DK];
  return (
    <g>
      <Shade w={w} h={h} dx={6} dy={8} />
      <rect x="40" y="-6" width="5" height="14" fill={P.ink} />
      <rect x={w - 45} y="-6" width="5" height="14" fill={P.ink} />
      <Plate x={(w - 150) / 2} y={-26} w={150} h={22} text={name} fill={P.night} color={P.paper} />
      {tones.map((tone, i) => {
        const x = i * (cw + 4);
        return (
          <g key={i}>
            <rect x={x} y="6" width={cw} height={h - 6} fill={tone} stroke={P.ink} strokeWidth="2" />
            <rect x={x - 1} y="-2" width={cw + 2} height="12" fill={`url(#${uid}-corr)`} stroke={P.ink} strokeWidth="2" />
            {i < 2 ? (
              <g>
                <rect x={x + 8} y="22" width={cw - 16} height="24" fill={P.night} stroke={P.ink} strokeWidth="2" />
                <rect x={x + 11} y="28" width={cw - 22} height="12" fill={LIT} opacity=".85" />
                <rect x={x + 6} y="14" width={cw - 12} height="8" fill={`url(#${uid}-awn)`} stroke={P.ink} strokeWidth="1.5" />
                <rect x={x + 8} y="46" width={cw - 16} height="6" fill={P.wood} stroke={P.ink} strokeWidth="1.5" />
              </g>
            ) : (
              <g>
                <rect x={x + 10} y="16" width={cw - 20} height={h - 18} fill={P.night} stroke={P.ink} strokeWidth="2" />
                <rect x={x + 14} y="20" width={(cw - 32) / 2} height={h - 26} fill={LIT} />
                <rect x={x + 18 + (cw - 32) / 2} y="20" width={(cw - 32) / 2} height={h - 26} fill={LIT} />
              </g>
            )}
          </g>
        );
      })}
      <rect x="6" y="-14" width="8" height="14" fill={P.concrete} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="-22" width="5" height="5" fill={P.paper} opacity=".5" />
      <circle cx={cw - 12} cy="2" r="5" fill={GOLD} stroke={P.ink} strokeWidth="1.5" />
    </g>
  );
}

/** One big crown in three stepped tones over a trunk at (16, 28) of a one tile box. `s` scales it about the trunk. */
function RainTree({ s = 1, uid }: { s?: number; uid: string }) {
  void uid;
  return (
    <g transform={`translate(16 30) scale(${s}) translate(-16 -30)`}>
      <ellipse cx="22" cy="31" rx="50" ry="9" fill={P.shadow} opacity=".22" />
      <path d="M11 31L13 6H20L22 31Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M13 29L14 8H16L15 29Z" fill={P.woodLight} />
      <path d="M-34 -6H-26V-22H-14V-38H0V-50H32V-38H46V-24H58V-8H68V6H46V12H-20V6H-34Z" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
      <path d="M-28 -8H-20V-22H-8V-36H4V-46H30V-34H42V-22H54V-8H62V2H40V6H-18V0H-28Z" fill={P.leaf} />
      <path d="M-20 -12H-12V-24H0V-36H12V-42H26V-32H34V-22H22V-16H6V-10H-10V-8H-20Z" fill={P.mint} />
    </g>
  );
}

/** A slender palm: base at (16, 30), trunk up to about -32, a crown about 64 px wide. */
function Palm({ flip }: { flip: boolean }) {
  return (
    <g transform={flip ? "translate(32 0) scale(-1 1)" : undefined}>
      <ellipse cx="21" cy="30" rx="12" ry="4" fill={P.shadow} opacity=".25" />
      <path d="M13 30H20L19 6L21 -30H16L14 6Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <path d="M15 28L16 6L18 -28" fill="none" stroke={P.woodLight} strokeWidth="2" />
      <path d="M18 -31C6 -46 -10 -43 -17 -29C-6 -37 6 -37 17 -29ZM19 -31C31 -46 47 -43 54 -29C43 -37 31 -37 20 -29ZM17 -32C8 -52 -1 -57 -9 -55C1 -52 9 -44 16 -33ZM20 -32C29 -52 38 -57 46 -55C36 -52 28 -44 21 -33Z" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <path d="M17 -34C8 -44 -4 -43 -10 -35C0 -40 9 -39 16 -33Z" fill={P.mint} />
      <path d="M15 -29a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z" fill={P.goldDark} stroke={P.ink} strokeWidth="1" />
    </g>
  );
}

/** An iron street lamp: the pole rises above its tile and a warm lantern hangs on a short arm. */
function Lamp() {
  return (
    <g>
      <rect x="12" y="29" width="16" height="4" fill={P.shadow} opacity=".25" />
      <rect x="10" y="24" width="12" height="7" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <path d="M16 24V-24" stroke={P.ink} strokeWidth="4" />
      <path d="M15 22V-22" stroke={P.cap} strokeWidth="1" />
      <path d="M16 -24Q16 -33 27 -33" fill="none" stroke={P.ink} strokeWidth="3" />
      <rect x="22" y="-38" width="14" height="9" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="24" y="-33" width="10" height="4" fill={LIT} />
      <rect x="24" y="-33" width="4" height="2" fill={P.paper} />
    </g>
  );
}

/** A top view SUV, nose to the camera (down). Variant 0 black, 1 green, 2 cream. */
function Suv({ w, h, v }: { w: number; h: number; v: number }) {
  const [body, lite, edge] = v === 1 ? [GREEN, GREEN_LT, GREEN_DK] : v === 2 ? [CREAM, P.paper, CREAM_DK] : ["#2A2623", "#46403B", "#1C1917"];
  return (
    <g>
      <rect x="10" y="9" width={w - 8} height={h - 6} fill={P.shadow} opacity=".3" />
      <path d={`M2 14h8v18h-8ZM${w - 10} 14h8v18h-8ZM2 ${h - 34}h8v18h-8ZM${w - 10} ${h - 34}h8v18h-8Z`} fill={P.ink} />
      <rect x="6" y="3" width={w - 12} height={h - 8} fill={body} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="5" width="4" height={h - 12} fill={lite} opacity=".7" />
      <rect x="11" y="8" width={w - 22} height="10" fill={GLASS} stroke={edge} strokeWidth="1.5" />
      <rect x="11" y="20" width={w - 22} height={h - 52} fill={lite} stroke={edge} strokeWidth="1.5" />
      <path d={`M16 26V${h - 38}M${w - 16} 26V${h - 38}`} stroke={edge} strokeWidth="2" />
      <rect x="11" y={h - 30} width={w - 22} height="12" fill={GLASS} stroke={edge} strokeWidth="1.5" />
      <rect x="9" y={h - 16} width={w - 18} height="8" fill={body} stroke={edge} strokeWidth="1.5" />
      <path d={`M10 ${h - 12}h9v3h-9ZM${w - 19} ${h - 12}h9v3h-9Z`} fill={P.paper} />
    </g>
  );
}

/** A danfo from above: yellow roof with a rack and a bundle, windscreen and headlights at the bottom. */
function DanfoTop({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <rect x="10" y="9" width={w - 8} height={h - 6} fill={P.shadow} opacity=".3" />
      <path d={`M2 16h8v18h-8ZM${w - 10} 16h8v18h-8ZM2 ${h - 40}h8v18h-8ZM${w - 10} ${h - 40}h8v18h-8Z`} fill={P.ink} />
      <rect x="6" y="3" width={w - 12} height={h - 8} fill={P.danfo} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="5" width="4" height={h - 12} fill={P.paper} opacity=".4" />
      <path d={`M${w - 14} 8V${h - 30}`} stroke={P.danfoDark} strokeWidth="3" />
      <rect x="12" y="14" width={w - 24} height="34" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <path d={`M12 31H${w - 12}M${w / 2} 14V48`} stroke={P.woodDark} strokeWidth="2" />
      <rect x="18" y="20" width="14" height="10" fill={P.paper} stroke={P.ink} strokeWidth="1.5" />
      <rect x="11" y={h - 32} width={w - 22} height="14" fill="#9FD3E8" stroke={P.ink} strokeWidth="1.5" />
      <rect x="11" y={h - 18} width={w - 22} height="10" fill={P.danfoDark} stroke={P.ink} strokeWidth="1.5" />
      <path d={`M10 ${h - 14}h10v3h-10ZM${w - 20} ${h - 14}h10v3h-10Z`} fill={P.paper} />
      <path d={`M9 5h10v3h-10ZM${w - 19} 5h10v3h-10Z`} fill={P.red} />
    </g>
  );
}

/** A stone gate pillar with a brass lantern on top. The box is 1 by 2 tiles; the shaft rises above it. */
function Pillar() {
  return (
    <g>
      <rect x="6" y="56" width="28" height="6" fill={P.shadow} opacity=".28" />
      <rect x="3" y="-34" width="26" height="92" fill={CREAM} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="-32" width="6" height="88" fill={P.paper} />
      <rect x="23" y="-32" width="4" height="88" fill={CREAM_DK} />
      <path d="M3 -8H29M3 22H29" stroke={P.ink} strokeWidth="1.5" />
      <rect x="-1" y="-42" width="34" height="10" fill={CREAM_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="8" y="-58" width="16" height="16" fill={GOLD} stroke={P.ink} strokeWidth="2" />
      <rect x="11" y="-55" width="10" height="10" fill={LIT} />
      <rect x="-1" y="50" width="34" height="10" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
    </g>
  );
}

/** The sliding gate leaf, parked against its pillar: iron bars over a green kick panel. */
function GateLeaf() {
  return (
    <g>
      <rect x="3" y="26" width="28" height="5" fill={P.shadow} opacity=".25" />
      <rect x="2" y="2" width="28" height="26" fill="none" stroke={P.ink} strokeWidth="2" />
      <path d="M7 2V28M12 2V28M17 2V28M22 2V28M27 2V28" stroke={P.ink} strokeWidth="2" />
      <path d="M7 2V-2M12 2V-2M17 2V-2M22 2V-2M27 2V-2" stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="16" width="28" height="12" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="19" width="8" height="5" fill={GOLD} />
    </g>
  );
}

/** The guard booth: a cream booth with a green roof, a lit window and a green door. 1 by 2 tiles. */
function Booth() {
  return (
    <g>
      <rect x="4" y="58" width="30" height="6" fill={P.shadow} opacity=".28" />
      <rect x="3" y="14" width="26" height="46" fill={CREAM} stroke={P.ink} strokeWidth="2" />
      <rect x="5" y="16" width="5" height="42" fill={P.paper} />
      <rect x="9" y="22" width="16" height="16" fill={LIT} stroke={P.ink} strokeWidth="2" />
      <path d="M17 22V38" stroke={P.ink} strokeWidth="2" />
      <rect x="11" y="42" width="12" height="18" fill={GREEN} stroke={P.ink} strokeWidth="2" />
      <rect x="-3" y="8" width="38" height="9" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="-1" y="9" width="34" height="2" fill={GREEN_LT} />
    </g>
  );
}

/** The gateway sign over the head of the avenue: the bounce wordmark on orange, the place's name in the strip. 8 by 2 tiles, the pillars cover its ends. */
function GateSign({ w }: { w: number }) {
  return (
    <g>
      <BrandSign x={14} y={2} w={w - 28} h={56} wordmark tone="orange" sub={SIGN} />
    </g>
  );
}

/** A clipped hedge box. */
function Hedge({ uid }: { uid: string }) {
  return (
    <g>
      <rect x="5" y="14" width="30" height="18" fill={P.shadow} opacity=".22" />
      <rect x="1" y="9" width="30" height="21" fill={`url(#${uid}-hedge)`} stroke={P.ink} strokeWidth="2" />
      <rect x="3" y="10" width="26" height="4" fill={P.mint} opacity=".8" />
    </g>
  );
}

/** A sandwich board with a record on it. */
function ABoard() {
  return (
    <g>
      <rect x="9" y="26" width="18" height="4" fill={P.shadow} opacity=".25" />
      <path d="M8 28L12 6H24L28 28Z" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="13" y="9" width="10" height="14" fill={P.night} />
      <circle cx="18" cy="16" r="4" fill="none" stroke={P.paper} strokeWidth="1.5" />
      <circle cx="18" cy="16" r="1" fill={P.paper} />
    </g>
  );
}

/** A book and record rack on the pavement, 1 by 2 tiles. */
function BookRack({ uid }: { uid: string }) {
  return (
    <g>
      <rect x="6" y="56" width="24" height="6" fill={P.shadow} opacity=".25" />
      <rect x="4" y="6" width="24" height="54" fill={P.woodDark} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="10" width="18" height="12" fill={`url(#${uid}-spines)`} />
      <rect x="7" y="26" width="18" height="12" fill={`url(#${uid}-spines)`} transform="translate(5 0)" />
      <rect x="7" y="42" width="18" height="12" fill={`url(#${uid}-spines)`} />
      <path d="M6 24H26M6 40H26" stroke={P.woodLight} strokeWidth="2" />
    </g>
  );
}

/** A picnic table with a bench either side, for the Pitstop yard. */
function Picnic({ v }: { v: number }) {
  return (
    <g>
      <rect x="6" y="22" width="56" height="9" fill={P.shadow} opacity=".25" />
      <rect x="6" y="2" width="52" height="7" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="2" y="10" width="60" height="9" fill={P.wood} stroke={P.ink} strokeWidth="2" />
      <rect x="4" y="11" width="56" height="2" fill={P.woodLight} />
      <rect x="10" y="19" width="4" height="9" fill={P.ink} />
      <rect x="50" y="19" width="4" height="9" fill={P.ink} />
      <rect x={v ? 38 : 16} y="3" width="8" height="4" fill={P.paper} />
      <rect x={v ? 20 : 40} y="12" width="6" height="4" fill={GREEN} />
    </g>
  );
}

/** Plantain chips on a cart under an orange and cream umbrella (the Lagos way: Hoppaz lives on the vendor's parasol). */
function ChipsCart({ w }: { w: number }) {
  const cx = w / 2;
  return (
    <g>
      <ellipse cx={cx + 3} cy="30" rx="26" ry="3.5" fill={P.shadow} opacity=".28" />
      <rect x={cx - 1} y="-18" width="3" height="30" fill={P.ink} />
      <path d={`M${cx} -34L${cx - 34} -12H${cx + 34}Z`} fill={P.orange} />
      <path d={`M${cx} -34L${cx - 17} -12H${cx}ZM${cx} -34L${cx + 17} -12H${cx}Z`} fill={P.paper} />
      <path d={`M${cx} -34L${cx - 34} -12H${cx + 34}Z`} fill="none" stroke={P.ink} strokeWidth="2" />
      <rect x={cx - 34} y="-13" width="68" height="4" fill={P.orange} stroke={P.ink} strokeWidth="2" />
      <rect x="6" y="8" width={w - 12} height="18" fill={P.woodLight} stroke={P.ink} strokeWidth="2" />
      <rect x="9" y="10" width={w - 18} height="3" fill={P.paper} opacity=".6" />
      <rect x="12" y="0" width={w - 24} height="9" fill={P.night} stroke={P.ink} strokeWidth="1.5" />
      <path d="M16 6h4v-3h-4ZM24 6h4v-3h-4ZM34 6h4v-3h-4ZM42 6h4v-3h-4Z" fill={P.danfo} />
      <circle cx="14" cy="28" r="4" fill={P.ink} />
      <circle cx={w - 14} cy="28" r="4" fill={P.ink} />
    </g>
  );
}

/** A litter bin. */
function Bin() {
  return (
    <g>
      <rect x="9" y="26" width="18" height="4" fill={P.shadow} opacity=".25" />
      <rect x="9" y="10" width="14" height="18" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
      <rect x="7" y="8" width="18" height="4" fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      <rect x="12" y="15" width="8" height="2" fill={P.paper} opacity=".5" />
    </g>
  );
}

/** The estate wall closing the east of the avenue: a cream wall with piers, cap and trees leaning over it. Drawn in scene pixels. */
function EstateWall({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const piers = rep(Math.floor(h / 64), (i) => `M${x} ${y + 4 + i * 64}h${w}v8h${-w}Z`);
  const crowns = [34, 130, 226].filter((c) => c < h - 30);
  return (
    <g>
      <rect x={x + 5} y={y + 6} width={w} height={h} fill={P.shadow} opacity=".25" />
      <rect x={x} y={y} width={w} height={h} fill={P.ink} />
      <rect x={x + 3} y={y + 2} width={w - 6} height={h - 4} fill={CREAM} />
      <rect x={x + 3} y={y + 2} width="5" height={h - 4} fill={P.paper} />
      <path d={piers} fill={P.concreteDark} stroke={P.ink} strokeWidth="2" />
      {crowns.map((c) => (
        <g key={c} transform={`translate(${x + 14} ${y + c})`}>
          <path d="M-30 6H-22V-8H-12V-18H8V-8H18V4H24V16H12V24H-18V16H-30Z" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
          <path d="M-24 4H-16V-6H-8V-14H4V-6H14V4H18V12H-24Z" fill={P.leaf} />
          <path d="M-18 2H-12V-4H-4V-10H2V-4H-10V2H-18Z" fill={P.mint} />
        </g>
      ))}
    </g>
  );
}

export default function HotspotIkoyiArt({ layout, uid, brand }: RoomArtProps) {
  void brand;
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const t = (n: number) => n * tile;
  const fill = (name: string) => `url(#${uid}-${name})`;
  const lamps = layout.props.filter((p) => p.kind === "streetlamp");
  const tiles = (id: string) => layout.props.find((p) => p.id === id);
  const bus = tiles("hop-bus");

  const custom: Record<string, (prop: CampaignProp, tile: number) => ReactNode> = {
    bridge: (p, tl) => <Bridge ox={p.x * tl} oy={p.y * tl} uid={uid} />,
    arthouse: (p, tl) => <Bogobiri w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[0]} />,
    recordshop: (p, tl) => <Jazzhole w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[1]} />,
    bistro: (p, tl) => <DanfoBistro w={p.w * tl} h={p.h * tl} name={NAMES[2]} />,
    village: (p, tl) => <Pitstop w={p.w * tl} h={p.h * tl} uid={uid} name={NAMES[3]} />,
    gatesign: (p, tl) => <GateSign w={p.w * tl} />,
    pillar: () => <Pillar />,
    gateleaf: () => <GateLeaf />,
    booth: () => <Booth />,
    suv: (p, tl) => <Suv w={p.w * tl} h={p.h * tl} v={p.variant ?? 0} />,
    danfo: (p, tl) => <DanfoTop w={p.w * tl} h={p.h * tl} />,
    hopbus: (p, tl) => <HopBus w={p.w * tl} h={p.h * tl} dir="v" />,
    raintree: () => <RainTree uid={uid} />,
    tree: (p) => <g transform={p.variant === 1 ? "translate(32 0) scale(-1 1)" : undefined}><RainTree s={0.55} uid={uid} /></g>,
    palm: (p) => <Palm flip={p.variant === 1} />,
    streetlamp: () => <Lamp />,
    hedge: () => <Hedge uid={uid} />,
    aboard: () => <ABoard />,
    bookrack: () => <BookRack uid={uid} />,
    yardlights: (p, tl) => (
      <g>
        <path d="M14 2V40M{0}" stroke={P.ink} strokeWidth="3" />
        <path d={`M${p.w * tl - 14} 2V40`} stroke={P.ink} strokeWidth="3" />
        <StringLights x1={14} x2={p.w * tl - 14} y={2} sag={8} bulbs={10} colors={[LIT, P.paper, GOLD]} />
      </g>
    ),
    picnic: (p) => <Picnic v={p.variant ?? 0} />,
    chipscart: (p, tl) => <ChipsCart w={p.w * tl} />,
    bin: () => <Bin />,
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <defs>
        <pattern id={`${uid}-setts`} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect width="32" height="16" fill="#CDBF9E" />
          <path d="M0 0H32M0 8H32M8 0V8M24 0V8M0 8V16M16 8V16" stroke="#B3A685" strokeWidth="1" />
          <path d="M3 3h3M18 11h3M26 4h2" stroke="#DDD1B2" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-slab`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#DAD0B4" />
          <path d="M0 0H32M0 16H32M16 0V16M0 16V32" stroke="#C0B494" strokeWidth="1" />
          <path d="M5 5h2M22 22h3M9 26h1M26 7h2" stroke="#E8DFC7" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-asphalt`} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#37322F" />
          <path d="M4 5h2M20 14h3M11 25h2M27 8h1M6 19h1" stroke="#47403B" strokeWidth="1" />
          <path d="M15 3h1M25 27h2" stroke="#2B2623" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-water`} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect width="32" height="16" fill="#2B5F70" />
          <path d="M2 4h6M18 4h6M10 11h6M26 11h4" stroke="#4C8A99" strokeWidth="2" />
          <path d="M0 15H32" stroke="#234F5E" strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-hedge`} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={GREEN_DK} />
          <path d="M2 3h5v3H2ZM10 9h5v3h-5ZM5 12h3v2H5Z" fill={P.leaf} />
          <path d="M3 3h2M11 9h2" stroke={P.mint} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-adire`} width="16" height="10" patternUnits="userSpaceOnUse">
          <rect width="16" height="10" fill={P.night} />
          <path d="M8 1L13 5L8 9L3 5Z" fill={CREAM} />
          <rect x="7" y="4" width="2" height="2" fill={P.night} />
        </pattern>
        <pattern id={`${uid}-bamboo`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={P.woodLight} />
          <path d="M2 0V8M6 0V8" stroke={P.wood} strokeWidth="1" />
          <path d="M0 4H8" stroke={P.woodDark} strokeWidth="1" />
        </pattern>
        <pattern id={`${uid}-spines`} width="24" height="12" patternUnits="userSpaceOnUse">
          <rect width="24" height="12" fill={P.night} />
          <rect x="1" y="1" width="3" height="11" fill={GREEN_LT} />
          <rect x="5" y="2" width="4" height="10" fill={CREAM} />
          <rect x="10" y="1" width="3" height="11" fill={P.red} />
          <rect x="14" y="3" width="4" height="9" fill={GOLD} />
          <rect x="19" y="1" width="3" height="11" fill={P.leaf} />
        </pattern>
        <pattern id={`${uid}-awn`} width="24" height="16" patternUnits="userSpaceOnUse">
          <rect width="12" height="16" fill={GREEN} />
          <rect x="12" width="12" height="16" fill={CREAM} />
        </pattern>
        <pattern id={`${uid}-corr`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={GREEN_LT} />
          <rect width="3" height="8" fill={GREEN} />
          <rect x="4" width="1" height="8" fill={P.mint} />
        </pattern>
        <pattern id={`${uid}-zebra`} width="24" height="30" patternUnits="userSpaceOnUse">
          <rect x="4" width="12" height="30" fill={P.paper} opacity=".85" />
        </pattern>
      </defs>

      {/* The ground: a dark green surround, setts for the lanes and squares, slabs on the promenade and forecourt. */}
      <rect width={W} height={H} fill="#1E2F26" />
      <rect x={t(1)} y={t(5)} width={W - t(2)} height={H - t(5) - t(1)} fill={fill("setts")} />
      <rect x={t(1)} y={t(5)} width={W - t(2)} height={t(2)} fill={fill("slab")} />
      <rect x={t(1)} y={t(17)} width={t(21)} height={t(2)} fill={fill("slab")} />
      <path d={`M${t(1)} ${t(7)}H${t(29)}M${t(1)} ${t(17)}H${t(22)}`} stroke={P.concreteDark} strokeWidth="2" opacity=".7" />

      {/* The ring: whitewashed estate walls with the trees of the compounds leaning over them, and the avenue running out of the room. */}
      <rect x="0" y={t(5)} width={tile} height={H - t(5)} fill={P.ink} />
      <rect x="3" y={t(5)} width={tile - 6} height={H - t(5)} fill={CREAM} />
      <rect x="3" y={t(5)} width="5" height={H - t(5)} fill={P.paper} />
      <rect x="0" y={t(19)} width={t(22)} height={tile} fill={P.ink} />
      <rect x="0" y={t(19) + 3} width={t(22)} height={tile - 6} fill={CREAM} />
      <rect x="0" y={t(19) + 3} width={t(22)} height="5" fill={P.paper} />
      <rect x={t(28)} y={t(19)} width={t(2)} height={tile} fill={P.ink} />
      <rect x={t(28)} y={t(19) + 3} width={t(2)} height={tile - 6} fill={CREAM} />
      <rect x={t(29)} y={t(5)} width={tile} height={H - t(5)} fill={fill("hedge")} stroke={P.ink} strokeWidth="2" />
      {[250, 430, 570].map((y) => (
        <g key={y} transform={`translate(10 ${y})`}>
          <path d="M-18 6H-10V-8H0V-18H20V-8H30V4H34V16H22V24H-8V16H-18Z" fill={GREEN_DK} stroke={P.ink} strokeWidth="2" />
          <path d="M-12 4H-4V-6H4V-14H16V-6H26V4H28V12H-12Z" fill={P.leaf} />
        </g>
      ))}
      {layout.walls.map((wl, i) => <EstateWall key={i} x={t(wl.x)} y={t(wl.y)} w={t(wl.w)} h={t(wl.h)} />)}

      {/* Alexander Avenue: kerbs, the asphalt, the centre line and the crossing at its head. */}
      <rect x={t(22)} y={t(7)} width={t(6)} height={H - t(7)} fill={fill("asphalt")} />
      <rect x={t(22) - 6} y={t(7)} width="6" height={H - t(7)} fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x={t(28) - 6} y={t(7)} width="6" height={t(4)} fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <rect x={t(22)} y={t(7) - 6} width={t(6)} height="6" fill={P.stone} stroke={P.ink} strokeWidth="2" />
      <path d={`M${t(25)} ${t(7) + 36}V${H}`} stroke={P.paper} strokeWidth="3" strokeDasharray="18 14" opacity=".75" />
      <rect x={t(22)} y={t(7) + 6} width={t(6)} height="30" fill={fill("zebra")} />

      {/* Tree beds, dappled shade and the lamps' warm pools: flat shapes, no gradients. */}
      <ellipse cx={t(12) + 16} cy={t(14) + 26} rx="30" ry="10" fill={P.leaf} stroke={P.ink} strokeWidth="2" />
      <ellipse cx={t(12) + 16} cy={t(14) + 24} rx="22" ry="6" fill={P.mint} opacity=".8" />
      {[t(9), t(12)].map((x, i) => <ellipse key={x} cx={x + 16} cy={[t(8) + 26, t(9) + 26][i]} rx="16" ry="6" fill={P.leaf} stroke={P.ink} strokeWidth="2" />)}
      <rect width={W} height={H - t(5)} y={t(5)} fill={P.night} opacity=".14" />
      {lamps.map((l) => <ellipse key={l.id} cx={t(l.x) + 22} cy={t(l.y) + 24} rx="46" ry="20" fill={P.gold} opacity=".2" />)}
      <ellipse cx={t(17)} cy={t(15) + 6} rx="92" ry="30" fill={P.gold} opacity=".1" />

      {/* The bus bay, and the Hoppaz route through the four venue doors: Stop 1 at Bogobiri House, round the square, finale in the Pitstop yard. */}
      {bus && <HopBay x={t(bus.x) - 4} y={t(bus.y) - 4} w={t(bus.w) + 8} h={t(bus.h) + 8} />}
      <RouteLine points={[[144, 368], [144, 560], [304, 560, 0], [304, 368, 0], [528, 368], [688, 368, 0], [688, 496, 0], [592, 496]]} />

      <Props layout={layout} uid={uid} custom={custom} />

      {/* One rubber stamp on the forecourt paving. */}
      <Stamp x={t(18) + 8} y={t(18) + 14} text={BRAND_LINES.hop} size={8} rotate={-5} />
    </svg>
  );
}
