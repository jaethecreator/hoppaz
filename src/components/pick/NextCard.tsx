"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { demoFlyer } from "@/components/event/demo";
import { hasEnded } from "@/components/today/helpers";
import { dayLabel } from "@/lib/filters";
import { clockShort, eventTitle, isEventLead } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import DayList from "@/components/events-r1/DayList";
import { useDialog } from "./useDialog";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/** Where the card sits: under the top bar, no wider than a phone, no taller than half the screen. */
function place(anchor: HTMLElement | null, opener: HTMLElement | null) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(380, vw - 24);
  const top = Math.round((anchor?.getBoundingClientRect().bottom ?? 64) + 2);
  const left = Math.round(Math.min(Math.max(opener?.getBoundingClientRect().left ?? 12, 12), vw - width - 12));
  const maxHeight = Math.round(Math.max(200, Math.min(vh * 0.5, vh - top - 16)));
  return { top, left, width, maxHeight };
}

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

/** "TODAY · 10PM" while NEXT 20 spans several days; just the time once a day is picked. A lead has no confirmed time. */
function whenLine(e: EventRow, now: number, withDay: boolean) {
  if (withDay) return dayLabel(e.starts_at, now);
  if (isEventLead(e)) return "TIME TBC";
  return `${hasEnded(e, now) ? "ENDED · " : ""}${clockShort(e.starts_at)}`;
}

/**
 * The list behind the NEXT 20 chip: a compact card hung under the top bar (never a full-height sheet), the events
 * in the current pick with a small flyer, the name, the day and time and the area. A tap on a row closes the card
 * and hands that event back. Closes on a tap outside, on Escape, or with the X. Shared by the Map and Events.
 */
export default function NextCard({
  heading,
  sub,
  events,
  now,
  withDay,
  onBackToNext,
  onPick,
  onClose,
  anchorRef,
  openerRef,
  r1 = false,
}: {
  heading: string;
  sub: string;
  events: EventRow[];
  now: number;
  /** Rows name their day too (NEXT 20 spans several days). */
  withDay: boolean;
  /** Set while a day is picked: puts a "Next 20" way back in the card. */
  onBackToNext?: () => void;
  onPick: (event: EventRow) => void;
  onClose: () => void;
  /** The card hangs under this (the top bar, or the page header). */
  anchorRef: RefObject<HTMLElement | null>;
  /** The chip that opened it, so the card lines up under it on a wide screen. */
  openerRef: RefObject<HTMLElement | null>;
  /** Release 1 wording and day list (the Map only). */
  r1?: boolean;
}) {
  const r1on = EVENTS_R1 && r1;
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  const [pos, setPos] = useState(() => place(anchorRef.current, openerRef.current));
  useEffect(() => {
    const again = () => setPos(place(anchorRef.current, openerRef.current));
    again();
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [anchorRef, openerRef]);

  return createPortal(
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        className="absolute flex animate-fade flex-col overflow-hidden rounded-[12px] border border-line bg-ink-2 shadow-[0_18px_50px_rgb(0_0_0/0.55)] outline-none"
      >
        <div className="flex flex-none items-center gap-2 border-b border-line py-1.5 pl-3 pr-1">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[15px] font-black leading-none">{heading}</h2>
            <p className={clsx("mt-1 truncate text-dim", r1on ? "font-body text-[12px]" : "font-mono text-[10px] uppercase tracking-[0.1em]")}>{sub}</p>
          </div>
          {onBackToNext && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToNext();
              }}
              className="h-9 flex-none rounded-hz border border-line px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-orange"
            >
              Next 20
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 flex-none place-items-center text-dim hover:text-cream">
            <X size={17} aria-hidden />
          </button>
        </div>

        {events.length === 0 ? (
          <p className="hint px-4 py-6 text-center">Nothing listed for this day yet.</p>
        ) : r1on ? (
          // Release 1: plain text under day headings.
          <DayList
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            events={events}
            now={now}
            onPick={(e) => {
              onClose();
              onPick(e);
            }}
          />
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {events.map((e, i) => {
              const over = !withDay && hasEnded(e, now);
              return (
                <li key={e.id} className={i > 0 ? "border-t border-line/60" : undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onPick(e);
                    }}
                    className="flex min-h-[58px] w-full items-center gap-3 px-3 py-1.5 text-left active:bg-ink-3"
                  >
                    <Thumb event={e} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block truncate font-display text-[14px] font-black leading-tight", over && "text-dim")}>{eventTitle(e)}</span>
                      <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-dim">
                        {whenLine(e, now, withDay)}
                        {e.area ? ` · ${e.area}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
