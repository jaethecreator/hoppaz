"use client";

import clsx from "clsx";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import type { R1Event, TicketType } from "@/lib/events-r1/types";

/** Can a person pick this type now? Free, and either a place left or a waitlist to join. */
export const pickable = (t: TicketType, event: Pick<R1Event, "waitlist_on">) => t.price_naira === 0 && (t.spots_left !== 0 || event.waitlist_on);

/** The type to start on: the first free one with room, else the first free one. */
export function defaultType(event: Pick<R1Event, "ticket_types" | "waitlist_on">): TicketType | null {
  const free = event.ticket_types.filter((t) => t.price_naira === 0);
  return free.find((t) => t.spots_left !== 0) ?? free.find((t) => pickable(t, event)) ?? free[0] ?? null;
}

function sub(t: TicketType, event: Pick<R1Event, "waitlist_on">): string {
  if (t.price_naira > 0) return `₦${t.price_naira.toLocaleString("en-NG")} · ${PAID_UNAVAILABLE}`;
  if (t.spots_left === 0) return event.waitlist_on ? "Join waitlist · Free" : "Full";
  return `${t.spots_left === null ? "No limit" : `${t.spots_left} spot${t.spots_left === 1 ? "" : "s"} left`} · Free`;
}

/** An event with more than one ticket type: the types as radio rows, picked before Register. */
export default function TicketPicker({
  event,
  value,
  onChange,
  disabled,
}: {
  event: R1Event;
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Ticket" className="mb-3 flex flex-col gap-2">
      {event.ticket_types.map((t) => {
        const ok = pickable(t, event) && !disabled;
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!ok}
            onClick={() => onChange(t.id)}
            className={clsx(
              "flex min-h-[56px] items-center gap-3 rounded-hz border px-3 py-2 text-left disabled:opacity-50",
              on ? "border-orange bg-ink-3" : "border-line bg-ink-2"
            )}
          >
            <span className={clsx("grid h-5 w-5 flex-none place-items-center rounded-full border", on ? "border-orange" : "border-dim")} aria-hidden>
              {on && <span className="h-2.5 w-2.5 rounded-full bg-orange" />}
            </span>
            <span className="min-w-0">
              <span className="block font-body text-[15px] text-cream">{t.name}</span>
              <span className="block font-body text-[13px] text-dim">{sub(t, event)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
