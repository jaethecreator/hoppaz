"use client";

import { useState } from "react";
import CardFace from "@/components/cards/CardFace";
import Reveal, { claimItems } from "@/components/reveal/Reveal";
import type { DropCard } from "@/lib/cards";

const SAMPLE: DropCard[] = [
  { key: "tafawa-balewa-square", name: "Tafawa Balewa Square", tier: "rare", set_key: "lagos-island", set_name: "Lagos Island", fact: "It stands on the old Lagos Racecourse, where Nigeria's independence was celebrated on 1 October 1960.", copy_no: 12, copies_total: 1000, starter: false, xp_bonus: 15, new: true },
  { key: "balogun-market", name: "Balogun Market", tier: "common", set_key: "lagos-island", set_name: "Lagos Island", fact: "One of the biggest markets in Lagos, spread across the streets around Balogun Street on Lagos Island, known for fabrics.", copy_no: null, copies_total: null, starter: true, xp_bonus: 0, new: true },
];

/** A stand-in for a street box: the four faces, and a reveal that pays a Rare (pity-lifted) and a starter. */
export default function DevCards() {
  const [open, setOpen] = useState(false);
  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 pb-10 pt-3 text-cream">
      <h1 className="font-display text-[28px] font-black">Cards</h1>
      <p className="hint mt-1">Dev page. The four tiers, and a box that pays a card.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <CardFace name="Balogun Market" tier="common" setName="Lagos Island" cardKey="balogun-market" size="sm" />
        <CardFace name="Tafawa Balewa Square" tier="rare" setName="Lagos Island" cardKey="tafawa-balewa-square" copy="S1 · 12 of 1000" visited size="sm" />
        <CardFace name="FESTAC '77" tier="epic" setName="Surulere" cardKey="festac-77" copy="S1 · 7 of 100" size="sm" />
        <CardFace name="Fela Anikulapo-Kuti" tier="legendary" setName="Music" cardKey="fela" copy="S1 · 1 of 10" size="sm" />
      </div>
      <button id="open-card-box" type="button" className="btn mt-5 w-full" onClick={() => setOpen(true)}>
        OPEN A CARD BOX
      </button>
      {open && (
        <Reveal
          label="Street box"
          where="Lagos Island"
          open={async () => ({ items: claimItems({ reward: "A card", xp: 10, cards: SAMPLE }) })}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}
