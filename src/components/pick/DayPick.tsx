"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import clsx from "clsx";
import { CalendarDays, X } from "lucide-react";
import { NEXT_COUNT, nightOf, nightTag } from "@/lib/filters";
import type { EventRow } from "@/lib/types";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import { EVENTS_TITLE, NEXT_LINE } from "@/components/events-r1/words";
import MonthPopup from "./MonthPopup";
import NextCard from "./NextCard";

/**
 * What the Map and Events are showing, and how to change it: a NEXT 20 chip that names the pick, and beside it a
 * solid orange calendar button. The chip opens the list of the events in the pick (NextCard); the calendar opens a
 * small month (MonthPopup). Pick a day and the chip reads that day, with an x to go back to NEXT 20.
 *
 * It draws two buttons in whatever row it is dropped into, and the popups portal to the page, so the Map's top bar
 * and the Events header use it as it is. The page keeps the state and does the work: it hands in the pick and gets
 * back "go to NEXT 20", "go to this day" and "this event was tapped".
 */

/** "TODAY", "SAT 17", or with the month once it is more than two weeks out ("SAT 17 NOV"). */
function chipLabel(date: string, now: number) {
  const today = nightOf(now);
  if (date === today) return "TODAY";
  const far = Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) > 13 * 864e5;
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" }).toUpperCase();
  return far ? `${nightTag(date)} ${month}` : nightTag(date);
}

/** "Saturday 17 Oct", or "Today". */
function dayHeading(date: string, now: number) {
  if (date === nightOf(now)) return "Today";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}

export default function DayPick({
  mode,
  date,
  events,
  counts,
  now,
  anchorRef,
  onNext,
  onDay,
  onPickEvent,
}: {
  mode: "next" | "day";
  /** The picked day (a night key) while mode is "day". */
  date: string;
  /** The events in the current pick: the next twenty, or that day's. */
  events: EventRow[];
  /** Events per day key (countByDay), for the calendar's dots. */
  counts: Record<string, number>;
  now: number;
  /** The list hangs under this: the top bar, or the page header. */
  anchorRef: RefObject<HTMLElement | null>;
  onNext: () => void;
  onDay: (date: string) => void;
  onPickEvent: (event: EventRow) => void;
}) {
  const [list, setList] = useState(false);
  const [cal, setCal] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  const isNext = mode === "next";
  const label = isNext ? `NEXT ${NEXT_COUNT}` : chipLabel(date, now);
  const sorted = useMemo(() => [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)), [events]);
  const n = events.length;
  const nOn = `${n} ${n === 1 ? "event" : "events"}`;

  return (
    <>
      <div
        className={clsx(
          "pointer-events-auto mr-1 flex h-9 flex-none items-stretch rounded-hz border backdrop-blur transition-colors",
          isNext ? "border-line bg-ink-2/95" : "border-orange bg-ink-2/95"
        )}
      >
        <button
          ref={chip}
          type="button"
          onClick={() => {
            setCal(false);
            setList((o) => !o);
          }}
          aria-haspopup="dialog"
          aria-expanded={list}
          aria-label={isNext ? `Next ${NEXT_COUNT}: ${nOn}. Show the list` : `${dayHeading(date, now)}: ${nOn}. Show the list`}
          className={clsx(
            "relative whitespace-nowrap pl-2 font-mono text-[11px] font-medium tracking-[0.08em] before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
            isNext ? "pr-2 text-cream" : "pr-1 text-orange"
          )}
        >
          {label}
        </button>
        {!isNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label={`Back to Next ${NEXT_COUNT}`}
            className="relative grid w-7 place-items-center text-dim before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:text-cream"
          >
            <X size={13} strokeWidth={2.4} aria-hidden />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setList(false);
          setCal(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={cal}
        aria-label="Open the calendar"
        className="group pointer-events-auto grid h-11 w-10 flex-none place-items-center"
      >
        <span className="grid h-9 w-9 place-items-center rounded-hz border border-orange bg-orange text-brand-ink shadow-chunk transition-[transform,box-shadow] duration-75 group-active:translate-y-1 group-active:shadow-none">
          <CalendarDays size={18} strokeWidth={2.2} aria-hidden />
        </span>
      </button>

      {list && (
        <NextCard
          heading={EVENTS_R1 ? EVENTS_TITLE : isNext ? `Next ${NEXT_COUNT}` : dayHeading(date, now)}
          sub={EVENTS_R1 ? (isNext ? NEXT_LINE : n === 0 ? "Nothing listed" : nOn) : isNext ? `${nOn} coming up` : n === 0 ? "Nothing listed" : `${nOn} on`}
          events={sorted}
          now={now}
          withDay={isNext}
          onBackToNext={isNext ? undefined : onNext}
          onPick={onPickEvent}
          onClose={() => setList(false)}
          anchorRef={anchorRef}
          openerRef={chip}
        />
      )}
      {cal && (
        <MonthPopup
          counts={counts}
          selected={isNext ? null : date}
          nextOn={isNext}
          now={now}
          onPick={onDay}
          onNext={onNext}
          onClose={() => setCal(false)}
        />
      )}
    </>
  );
}
