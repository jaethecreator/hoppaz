"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import Sheet from "@/components/Sheet";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "itshoppaz@gmail.com";

/**
 * Paz's answers to the questions a new Hopper has. Written answers for now: there is no live help behind it, so the last
 * line says where to write.
 */
const ANSWERS: ReadonlyArray<{ q: string; a: string }> = [
  { q: "What is a hotspot?", a: "A hotspot is an open room at a real Lagos junction. Anyone can look in. You need an account to go in and chat." },
  { q: "What are the pins and signs on the map?", a: "The signs are events. The crosshair pins are hotspots. Tap either to see more." },
  { q: "What does WE OUTSIDE do?", a: "It tells people you are going, and puts you in that event's room." },
  { q: "How do I change where I am?", a: "Tap the crosshair at the top right of the map, then use your location or pick your area." },
  { q: "What is my home base?", a: "It is the open hotspot for the part of Lagos you are in. The chip under the top bar takes you to it." },
];

export default function AskPaz({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Sheet open onClose={onClose} label="Ask Paz">
      <div className="mx-auto max-w-[520px]">
        <h2 className="pr-9 font-display text-[24px] font-black uppercase leading-none">Ask Paz</h2>
        <p className="hint mt-1.5">The things new Hoppers ask first.</p>
        <ul className="mt-3 divide-y divide-line rounded-hz border border-line bg-ink-3">
          {ANSWERS.map((x, i) => (
            <li key={x.q}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-2 text-left">
                <span className="font-body text-[15px] font-semibold leading-snug">{x.q}</span>
                <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open === i && "rotate-180")} />
              </button>
              {open === i && <p className="px-3 pb-3 font-body text-[14px] leading-snug text-cream/90">{x.a}</p>}
            </li>
          ))}
        </ul>
        <p className="hint mt-3">
          Still stuck? Write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hz-link break-all">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </Sheet>
  );
}
