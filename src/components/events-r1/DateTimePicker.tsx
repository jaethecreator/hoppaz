"use client";

import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  clockOf, dayChips, dayKeyOf, formatWhen, instantOf, MAX_DAYS_AHEAD, minutesOf, monthCells, monthTitle, shiftMonth, shortDay, TIMES,
  withDay, withMinutes,
} from "./dateTime";

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_MS = 864e5;
const CHIP = "chip min-h-[44px] flex-none px-4 font-body text-[14px] normal-case tracking-normal disabled:opacity-30";

/** Arrow keys move between the buttons of one list (data-nav); Enter and Space are the buttons' own. */
function arrows(e: KeyboardEvent<HTMLElement>, prev: string, next: string) {
  if (e.key !== prev && e.key !== next) return;
  const here = e.target as HTMLElement;
  const all = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-nav]:not(:disabled)"));
  const at = all.indexOf(here as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  all[Math.max(0, Math.min(all.length - 1, at + (e.key === next ? 1 : -1)))]?.focus();
}

/**
 * The Hoppaz date and time picker: one row ("Starts  Fri 23 Oct · 19:00") that opens in place (no pop-up, no native
 * controls) into day chips, a month calendar for any day up to a year ahead, and a list of times in 15 minute steps.
 * Lagos time. `value` and what `onChange` hands back are ISO strings with the +01:00 offset. Anything before `min` is
 * greyed out and cannot be tapped.
 */
export default function DateTimePicker({
  label,
  value,
  onChange,
  min,
  error,
  now,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  error?: string;
  /** Epoch ms for "Today" (the fake clock moves it). */
  now?: number;
}) {
  const [open, setOpen] = useState(false);
  const [cal, setCal] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ms = Date.parse(value);
  const valid = Number.isFinite(ms);
  const day = valid ? dayKeyOf(ms) : "";
  const minutes = valid ? minutesOf(ms) : -1;
  const [month, setMonth] = useState(() => (valid ? dayKeyOf(ms) : dayKeyOf(Date.now())).slice(0, 7));

  const base = now ?? Date.now();
  const today = dayKeyOf(base);
  const lastDay = dayKeyOf(base + MAX_DAYS_AHEAD * DAY_MS);
  const minMs = min ? Date.parse(min) : NaN;
  const minDay = Number.isFinite(minMs) ? dayKeyOf(minMs) : today;
  // The first day that can be picked: today, or the day of `min` when that is later.
  const firstDay = minDay > today ? minDay : today;
  const chips = useMemo(() => dayChips(base, 10), [base]);
  const inStrip = chips.some((c) => c.key === day);

  // Opening: the picked time is scrolled into view inside the list (not the page) and takes the keyboard focus.
  useEffect(() => {
    if (!open) return;
    const box = list.current;
    const on = box?.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
    if (box && on) {
      box.scrollTop = Math.max(0, on.offsetTop - box.clientHeight / 2 + on.clientHeight / 2);
      on.focus({ preventScroll: true });
    }
  }, [open, day]);

  const close = () => {
    setOpen(false);
    setCal(false);
    row.current?.focus();
  };

  const pickDay = (key: string) => {
    if (key < firstDay || key > lastDay) return;
    onChange(withDay(valid ? value : `${key}T19:00:00+01:00`, key));
    setCal(false);
  };
  const pickTime = (m: number) => {
    onChange(withMinutes(valid ? value : `${today}T19:00:00+01:00`, m));
    close();
  };

  const title = monthTitle(month);
  const arrow = "grid h-11 w-11 flex-none place-items-center rounded-hz border border-line text-cream disabled:opacity-30";

  return (
    <div
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={row}
        type="button"
        aria-expanded={open}
        aria-label={`${label}: ${formatWhen(value) || "not set"}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 text-left"
      >
        <span className="w-14 flex-none font-body text-[15px] text-dim">{label}</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-2 font-body text-[15px] text-cream">
          {formatWhen(value) || "Pick a time"}
          <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {error && (
        <p role="alert" className="pb-2 font-body text-[14px] text-fireant">
          {error}
        </p>
      )}

      {open && (
        <div className="flex flex-col gap-3 pb-3">
          <div role="group" aria-label={`${label} day`} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onKeyDown={(e) => arrows(e, "ArrowLeft", "ArrowRight")}>
            {chips.map((c) => (
              <button key={c.key} type="button" data-nav aria-pressed={day === c.key} disabled={c.key < firstDay} onClick={() => pickDay(c.key)} className={CHIP}>
                {c.label}
              </button>
            ))}
            {valid && !inStrip && (
              <button type="button" data-nav aria-pressed className={CHIP}>
                {shortDay(day)}
              </button>
            )}
            <button type="button" data-nav aria-expanded={cal} onClick={() => setCal((c) => !c)} className={clsx(CHIP, cal && "border-orange text-orange")}>
              More days
            </button>
          </div>

          {cal && (
            <div className="rounded-hz border border-line bg-ink-3/40 p-2" role="group" aria-label={`${label} calendar`}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-label="Previous month" disabled={month <= firstDay.slice(0, 7)} onClick={() => setMonth((m) => shiftMonth(m, -1))} className={arrow}>
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <p aria-live="polite" className="min-w-0 truncate text-center font-display text-[15px] font-black leading-none">
                  {title}
                </p>
                <button type="button" aria-label="Next month" disabled={month >= lastDay.slice(0, 7)} onClick={() => setMonth((m) => shiftMonth(m, 1))} className={arrow}>
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-7 gap-0.5">
                {WEEK.map((w, i) => (
                  <span key={i} className="pb-1 text-center font-mono text-[10px] text-dim">
                    {w}
                  </span>
                ))}
                {monthCells(month).map((key, i) => {
                  if (!key) return <span key={`b${i}`} />;
                  const usable = key >= firstDay && key <= lastDay;
                  const on = key === day;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!usable}
                      aria-label={shortDay(key)}
                      aria-pressed={on}
                      onClick={() => pickDay(key)}
                      className={clsx(
                        "num grid h-11 place-items-center rounded-hz border text-[14px]",
                        on ? "border-orange bg-orange text-brand-ink" : key === today ? "border-orange text-orange" : "border-transparent text-cream",
                        !usable && "opacity-25"
                      )}
                    >
                      {Number(key.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            ref={list}
            role="listbox"
            aria-label={`${label} time`}
            className="relative max-h-[220px] overflow-y-auto rounded-hz border border-line bg-ink-3/40"
            onKeyDown={(e) => arrows(e, "ArrowUp", "ArrowDown")}
          >
            {TIMES.map((m) => {
              const off = valid && Number.isFinite(minMs) && day !== "" && instantOf(day, m) < minMs;
              const on = m === minutes;
              return (
                <button
                  key={m}
                  type="button"
                  role="option"
                  data-nav
                  aria-selected={on}
                  disabled={off}
                  onClick={() => pickTime(m)}
                  className={clsx(
                    "flex min-h-[44px] w-full items-center px-4 text-left font-body text-[15px] disabled:opacity-30",
                    on ? "bg-orange text-brand-ink" : "text-cream"
                  )}
                >
                  {clockOf(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
