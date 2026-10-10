import clsx from "clsx";
import { TIER } from "@/components/play/open/tiers";
import { TIER_LABEL, type CardTier } from "@/lib/cards";

/**
 * A card's face, all drawn in code (CARDS.md, "What the front end does"): the
 * tier frame, the art window, the name, the set, the tier and, on an Epic or
 * Legendary, the copy number. There is no card art yet, so the art window is a
 * drawn street grid with the place's pin, steady per card (from its key). The
 * WANTED ribbon comes with phase B, when a Hopper's shot can win the art.
 */
export default function CardFace({
  name,
  tier,
  setName,
  cardKey,
  copy,
  visited = false,
  dim = false,
  size = "md",
  className,
}: {
  name: string;
  tier: CardTier;
  setName: string;
  cardKey: string;
  /** "S1 · 7 of 10" */
  copy?: string | null;
  visited?: boolean;
  /** Not in your album yet: the face greys out. */
  dim?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const T = TIER[tier];
  const w = size === "lg" ? "w-[min(78vw,280px)]" : size === "md" ? "w-[220px]" : "w-full";
  return (
    <div
      className={clsx("relative overflow-hidden rounded-[14px] border-[3px] bg-[#17120f] p-[7px] text-[#F5EBDD]", w, dim && "opacity-40 grayscale", className)}
      style={{ borderColor: T.t, boxShadow: dim ? undefined : `0 0 ${tier === "legendary" ? 28 : 16}px ${T.c}55` }}
    >
      <div className="relative aspect-[102/96] overflow-hidden rounded-[8px]" style={{ background: T.bg }}>
        <StreetArt cardKey={cardKey} accent={T.t} />
        {visited && (
          <span className="absolute bottom-2 left-2 -rotate-6 rounded-[4px] border-2 border-[#2FD35C] bg-black/60 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#2FD35C]">
            Visited
          </span>
        )}
      </div>
      <p className={clsx("mt-2 truncate text-center font-display font-black leading-tight", size === "sm" ? "text-[12px]" : "text-[16px]")}>{name}</p>
      <p className={clsx("truncate text-center font-mono uppercase tracking-[0.1em] text-[#F5EBDD]/60", size === "sm" ? "text-[8px]" : "text-[9.5px]")}>{setName}</p>
      <p className={clsx("mt-1 text-center font-mono uppercase tracking-[0.14em]", size === "sm" ? "text-[8px]" : "text-[10px]")} style={{ color: T.t }}>
        {TIER_LABEL[tier]}
        {copy ? ` · ${copy.replace(/^S1 · /, "")}` : ""}
      </p>
    </div>
  );
}

/** A steady pseudo-random from the card key, so the same card always draws the same streets. */
function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function StreetArt({ cardKey, accent }: { cardKey: string; accent: string }) {
  const r = seeded(cardKey);
  const roads = Array.from({ length: 7 }, () => {
    const vertical = r() > 0.5;
    const at = 8 + r() * 84;
    const bend = (r() - 0.5) * 30;
    return vertical ? `M${at} -5 Q${at + bend} 50 ${at - bend / 2} 105` : `M-5 ${at} Q50 ${at + bend} 105 ${at - bend / 2}`;
  });
  const px = 30 + r() * 40;
  const py = 34 + r() * 30;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      {roads.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#F5EBDD" strokeOpacity={i < 2 ? 0.32 : 0.14} strokeWidth={i < 2 ? 3.2 : 1.6} strokeLinecap="round" />
      ))}
      <circle cx={px} cy={py} r="13" fill={accent} opacity=".18" />
      <path d={`M${px} ${py + 9}c-6-7-9-11-9-15a9 9 0 0 1 18 0c0 4-3 8-9 15z`} fill="#FF4D00" />
      <circle cx={px} cy={py - 6} r="3.4" fill="#0E0B0A" />
    </svg>
  );
}
