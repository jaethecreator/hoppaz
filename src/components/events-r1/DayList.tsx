"use client";

import { useState } from "react";
import clsx from "clsx";
import { demoFlyer } from "@/components/event/demo";
import { hasEnded } from "@/components/today/helpers";
import { eventTitle } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { groupByNight, rowMeta } from "./words";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/** A small flyer; with none (or one that will not load) a block with the first letter of the name. */
function Thumb({ event }: { event: EventRow }) {
  const src = demoFlyer(event);
  const [bad, setBad] = useState(false);
  const box = "h-[46px] w-9 flex-none rounded-[4px] border border-line";
  if (!src || bad) {
    return (
      <span aria-hidden className={clsx(box, "grid place-items-center bg-ink-3 font-display text-[16px] font-black text-orange")}>
        {eventTitle(event).trim().charAt(0).toUpperCase() || "H"}
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} className={clsx(box, "bg-ink-3 object-cover")} />;
}

/**
 * Release 1: events as plain text under day headings ("Events on Friday 23 Oct"). Each row is the name, then
 * "19:00 · Maroko · Free" (or "Online" where the place would be). Used by the NEXT 20 card and the Events screen.
 * `onPick` gets the event that was tapped; the parent decides what that does (the NEXT 20 card closes itself first).
 */
export default function DayList({
  events,
  now,
  onPick,
  className,
}: {
  events: EventRow[];
  now: number;
  onPick: (event: EventRow) => void;
  className?: string;
}) {
  const sorted = [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return (
    <div className={className}>
      {groupByNight(sorted).map((g) => (
        <section key={g.key} aria-label={g.heading}>
          <h3 className="px-3 pb-1 pt-3 font-body text-[13px] font-semibold text-dim">{g.heading}</h3>
          <ul>
            {g.events.map((e) => {
              const over = hasEnded(e, now);
              return (
                <li key={e.id} className="border-t border-line/60">
                  <button type="button" onClick={() => onPick(e)} className="flex min-h-[58px] w-full items-center gap-3 px-3 py-1.5 text-left active:bg-ink-3">
                    <Thumb event={e} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block truncate font-display text-[14px] font-black leading-tight", over && "text-dim")}>{eventTitle(e)}</span>
                      <span className="mt-1 block truncate font-body text-[13px] text-dim">{rowMeta(e)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
