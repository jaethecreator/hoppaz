"use client";

import clsx from "clsx";
import { EVENTS_TITLE, NEXT_LINE, dayHeading } from "./words";

/**
 * Release 1: the two lines that say what the Map and Events are showing.
 * "Events in Lagos" and "Showing the next 20 events", or the picked day: "Events on Friday 23 Oct".
 */
export function eventsLine(mode: "next" | "day", date: string) {
  return mode === "next" ? NEXT_LINE : dayHeading(date);
}

export default function EventsHeading({
  mode,
  date,
  className,
}: {
  mode: "next" | "day";
  /** The picked day (a night key) while mode is "day". */
  date: string;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0 [text-shadow:0_1px_10px_rgb(0_0_0/0.7)]", className)}>
      <h1 className="truncate font-display text-[17px] font-black leading-tight">{EVENTS_TITLE}</h1>
      <p className="truncate font-body text-[13px] leading-snug text-cream/80">{eventsLine(mode, date)}</p>
    </div>
  );
}
