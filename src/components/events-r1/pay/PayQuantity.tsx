"use client";

import { Minus, Plus } from "lucide-react";
import { naira, ticketsWord } from "./words";

export const MAX_QTY = 5;

/**
 * How many tickets, for a paid type: a stepper from 1 to `max`, and one line with what the buyer pays ("2 tickets · ₦6,000").
 * Hoppaz's fee comes from the host's side; Bachs adds its card or transfer fee on top at checkout, and the buyer sees it there.
 */
export default function PayQuantity({
  unit,
  qty,
  max,
  total,
  onQty,
  disabled,
}: {
  unit: number;
  qty: number;
  max: number;
  total: number;
  onQty: (n: number) => void;
  disabled?: boolean;
}) {
  const step = "grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-cream disabled:opacity-40";
  return (
    <div className="mb-3 rounded-hz border border-line bg-ink-2 px-3 py-2">
      <div className="flex min-h-[48px] items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-body text-[15px] text-cream">Tickets</span>
          <span className="block font-body text-[13px] text-dim">{naira(unit)} each</span>
        </span>
        <span className="flex items-center gap-2">
          <button type="button" aria-label="Fewer tickets" disabled={disabled || qty <= 1} onClick={() => onQty(qty - 1)} className={step}>
            <Minus size={16} aria-hidden />
          </button>
          <span className="w-6 text-center font-display text-[20px] font-black tabular-nums" aria-live="polite" aria-label={`${qty} selected`}>
            {qty}
          </span>
          <button type="button" aria-label="More tickets" disabled={disabled || qty >= max} onClick={() => onQty(qty + 1)} className={step}>
            <Plus size={16} aria-hidden />
          </button>
        </span>
      </div>
      <p className="border-t border-line pt-2 font-body text-[14px] text-cream" aria-live="polite">
        {ticketsWord(qty)} · {naira(total)}
        <span className="block font-body text-[12px] text-dim">Plus a small card or transfer fee at checkout</span>
      </p>
    </div>
  );
}
