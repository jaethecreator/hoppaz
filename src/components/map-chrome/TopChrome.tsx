"use client";

import Link from "next/link";
import clsx from "clsx";
import { Bus, Crosshair, Flame, SlidersHorizontal, X } from "lucide-react";
import Wordmark from "@/components/Wordmark";

/**
 * Everything across the top of the map: one compact row (wordmark, the NEXT 20 chip that names what you are
 * looking at and the orange calendar beside it, streak, "what kind", "where am I"), and a slim row of removable
 * pills when a vibe filter is on. The chip and calendar come in as `pick` (DayPick), so the page owns what they
 * do. Anything the page needs to say (a failed load) is passed as children and sits under the bar.
 *
 * The visible chips are 36px tall; each button is 44px tall and 40px wide to tap. The row has to hold seven
 * things on a 360px phone (the bus button shows on Hop days), so every button keeps its size and the wordmark
 * is the one thing that gives: it scales down with its proportions kept, never squeezed.
 */

const CHIP =
  "grid h-9 place-items-center rounded-hz border backdrop-blur transition-colors";

export default function TopChrome({
  hudRef,
  pick,
  types,
  onRemoveType,
  onClearTypes,
  streak,
  onFilter,
  onLocate,
  showBus,
  onBus,
  children,
}: {
  hudRef?: React.Ref<HTMLDivElement>;
  /** The NEXT 20 chip and the orange calendar button (DayPick). */
  pick: React.ReactNode;
  types: string[];
  onRemoveType: (t: string) => void;
  onClearTypes: () => void;
  /** Daily streak, from the game dashboard. 0 when there is none yet. */
  streak: number;
  onFilter: () => void;
  onLocate: () => void;
  /** Hop day only: a button that flies to the bus. */
  showBus: boolean;
  onBus: () => void;
  children?: React.ReactNode;
}) {
  const filtered = types.length > 0;
  return (
    <div ref={hudRef} className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* A soft scrim so the wordmark and icons read over any map: map labels must not show through. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top,0px)+5.5rem)] bg-gradient-to-b from-ink/95 via-ink/80 to-transparent" />

      <div className="pad-top relative mx-auto max-w-[640px] px-3.5 pb-2">
        <div className="flex items-center">
          <div className="pointer-events-auto mr-auto min-w-[44px] max-w-[82px] flex-1 py-1 pr-1.5 [&_img]:!h-auto [&_img]:!w-full">
            <Wordmark size={15} className="w-full" />
          </div>

          {pick}

          <Link
            href="/me#earn"
            aria-label={`Daily streak ${streak}. Ways to earn`}
            className="pointer-events-auto -my-1 flex h-11 flex-none items-center px-0.5"
          >
            <span className={clsx(CHIP, "min-w-[52px] grid-flow-col gap-1.5 border-line bg-ink-2/95 px-2")}>
              <Flame size={16} strokeWidth={2.2} className="text-orange" aria-hidden />
              <span className="num text-[15px]">{streak}</span>
            </span>
          </Link>

          <button
            onClick={onFilter}
            aria-label={filtered ? `What kind: ${types.join(", ")}` : "What kind"}
            className="pointer-events-auto -my-1 grid h-11 w-10 flex-none place-items-center"
          >
            <span
              className={clsx(
                CHIP,
                "w-9",
                filtered ? "border-orange bg-orange text-brand-ink" : "border-line bg-ink-2/95 text-cream"
              )}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </span>
          </button>

          {showBus && (
            <button
              onClick={onBus}
              aria-label="Where is the bus"
              className="pointer-events-auto -my-1 grid h-11 w-10 flex-none place-items-center"
            >
              <span className={clsx(CHIP, "w-9 border-line bg-ink-2/95 text-cream")}>
                <Bus size={16} aria-hidden />
              </span>
            </button>
          )}

          <button
            onClick={onLocate}
            aria-label="Set your location"
            className="pointer-events-auto -my-1 -mr-0.5 grid h-11 w-10 flex-none place-items-center"
          >
            <span className={clsx(CHIP, "w-9 border-line bg-ink-2/95 text-cream")}>
              <Crosshair size={16} aria-hidden />
            </span>
          </button>
        </div>

        {filtered && (
          <div className="pointer-events-auto -mx-3.5 mt-px flex items-center gap-1.5 overflow-x-auto px-3.5 py-[7px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {types.map((t) => (
              <button
                key={t}
                aria-pressed="true"
                aria-label={`Remove ${t}`}
                onClick={() => onRemoveType(t)}
                className="chip relative min-h-[30px] flex-none gap-1.5 px-2.5 text-[10px] before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
              >
                {t}
                <X size={12} aria-hidden />
              </button>
            ))}
            <button
              onClick={onClearTypes}
              className="relative flex h-[30px] flex-none items-center px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-cream underline underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
            >
              Clear
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
