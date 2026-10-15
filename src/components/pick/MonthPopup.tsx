"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { nightOf } from "@/lib/filters";
import { useDialog } from "./useDialog";

/** Events load up to 45 days ahead (useEvents), so the calendar stops there. */
export const LOADABLE_DAYS = 45;

const DAY_MS = 864e5;
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/** "2026-10" moved by k months. */
function shiftMonth(key: string, k: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + k, 1, 12)).toISOString().slice(0, 7);
}

/** The cells of one month, Monday first: blanks, then every date as "2026-10-17". */
function monthCells(key: string) {
  const [y, m] = key.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay() + 6) % 7;
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= len; d++) cells.push(`${key}-${String(d).padStart(2, "0")}`);
  return cells;
}

const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", "");

/**
 * The calendar: one month at a time, small, centred on the screen (about 300px on a phone and never taller than
 * it). Days with events carry a dot, today is ringed, the picked day is solid orange, and days past what is loaded
 * (or already over) cannot be tapped. Picking a day closes it. "Next 20" goes back to the next twenty events.
 * Shared by the Map and Events.
 */
export default function MonthPopup({
  counts,
  selected,
  nextOn,
  now,
  onPick,
  onNext,
  onClose,
}: {
  /** Events per day key (countByDay). */
  counts: Record<string, number>;
  /** The picked day, or null while NEXT 20 is showing. */
  selected: string | null;
  /** NEXT 20 is the current pick. */
  nextOn: boolean;
  now: number;
  onPick: (date: string) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  const today = nightOf(now);
  const last = nightOf(now + LOADABLE_DAYS * DAY_MS);
  const [month, setMonth] = useState(() => (selected && selected >= today && selected <= last ? selected : today).slice(0, 7));
  const cells = monthCells(month);
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
  const canPrev = month > today.slice(0, 7);
  const canNext = month < last.slice(0, 7);

  const arrow = "grid h-9 w-9 flex-none place-items-center rounded-hz border border-line text-cream disabled:opacity-30";

  return createPortal(
    <div className="fixed inset-0 z-[70] grid animate-fade place-items-center bg-black/55 p-4" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a day"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-[300px] overflow-y-auto rounded-[12px] border border-line bg-ink-2 p-3 shadow-[0_18px_50px_rgb(0_0_0/0.6)] outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} disabled={!canPrev} aria-label="Previous month" className={arrow}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <h2 aria-live="polite" className="min-w-0 truncate text-center font-display text-[15px] font-black leading-none">
            {title}
          </h2>
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={!canNext} aria-label="Next month" className={arrow}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>

        <div className="mt-2.5 grid grid-cols-7 gap-0.5">
          {WEEK.map((w, i) => (
            <span key={i} className="pb-1 text-center font-mono text-[10px] text-dim">
              {w}
            </span>
          ))}
          {cells.map((date, i) => {
            if (!date) return <span key={`b${i}`} />;
            const usable = date >= today && date <= last;
            const n = counts[date] ?? 0;
            const on = date === selected;
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                disabled={!usable}
                onClick={() => {
                  onClose();
                  onPick(date);
                }}
                aria-label={`${longDay(date)}${isToday ? ", today" : ""}, ${n === 0 ? "nothing listed" : `${n} on`}`}
                aria-pressed={on}
                aria-current={isToday ? "date" : undefined}
                className={clsx(
                  "flex h-[38px] flex-col items-center justify-center gap-[3px] rounded-hz border",
                  on ? "border-orange bg-orange text-brand-ink" : isToday ? "border-orange text-orange" : "border-transparent",
                  !on && !isToday && (n > 0 ? "text-cream" : "text-dim"),
                  !usable && "opacity-25"
                )}
              >
                <span className="num text-[14px]">{Number(date.slice(8))}</span>
                <span className={clsx("h-1 w-1 rounded-full", usable && n > 0 ? (on ? "bg-brand-ink" : "bg-orange") : "bg-transparent")} />
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onNext();
            }}
            aria-pressed={nextOn}
            className={clsx(
              "h-9 rounded-hz border px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
              nextOn ? "border-orange bg-orange text-brand-ink" : "border-line text-orange"
            )}
          >
            Next 20
          </button>
          <button type="button" onClick={onClose} className="h-9 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
