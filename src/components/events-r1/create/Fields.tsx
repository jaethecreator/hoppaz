"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/** One choice out of a few, as pills. Selected goes orange (the .chip rule). Sentence case, not shouty. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("flex flex-wrap gap-2", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="chip min-h-[40px] flex-none px-4 font-body text-[14px] normal-case tracking-normal"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** On or off. */
export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block font-body text-[15px] text-cream">{label}</span>
        {hint && <span className="hint block">{hint}</span>}
      </span>
      <span className={clsx("relative h-[26px] w-[44px] flex-none rounded-full transition-colors", on ? "bg-orange" : "bg-ink-3 ring-1 ring-inset ring-line")} aria-hidden>
        <span className={clsx("absolute top-[3px] h-5 w-5 rounded-full bg-cream transition-[left]", on ? "left-[21px]" : "left-[3px]")} />
      </span>
    </button>
  );
}

/** A tappable row that opens in place (no modal). The summary reads like "Tickets: Free". */
export function Row({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-hz border border-line bg-ink-2">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left">
        <span className="min-w-0 font-body text-[15px]">
          <span className="text-dim">{label}:</span> <span className="text-cream">{value}</span>
        </span>
        <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-line px-4 pb-3 pt-2">{children}</div>}
    </div>
  );
}
