"use client";

import clsx from "clsx";
import { AlertTriangle, Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The small pieces every step of the add-a-drop flow shares: the big question, a row of chips, a radio card, a switch and
 * a check line. Hoppaz classes only (globals.css), so the flow looks like the rest of the desk.
 */

/** The big question at the top of a step, with its hint. */
export function Question({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl font-black leading-tight">{title}</h2>
      {hint && <p className="hint mt-1.5 !text-[14px]">{hint}</p>}
    </div>
  );
}

/** A row of chips that picks one option (radio group). */
export function ChipRow({
  label,
  value,
  options,
  onChange,
  disabled,
  chipClass,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  chipClass?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={clsx("chip min-h-[40px]", on && "chip-on", disabled && "opacity-50", chipClass)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A big tappable option with a round radio mark, a title and a line of small print. `children` sit under the title inside the
 * same card (a field that belongs to this option), so they are not part of the button.
 */
export function RadioCard({
  on,
  onSelect,
  title,
  sub,
  disabled,
  children,
}: {
  on: boolean;
  onSelect: () => void;
  title: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={clsx("rounded-hz border", on ? "border-orange bg-orange/10" : "border-line bg-ink-2", disabled && "opacity-50")}>
      <button type="button" role="radio" aria-checked={on} aria-disabled={disabled} disabled={disabled} onClick={onSelect} className="flex w-full items-start gap-3 p-4 text-left">
        <span aria-hidden className={clsx("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border-2", on ? "border-orange" : "border-line")}>
          {on && <span className="h-3 w-3 rounded-full bg-orange" />}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[17px] font-black leading-tight">{title}</span>
          {sub && <span className="mt-1 block font-body text-[14px] leading-snug text-dim">{sub}</span>}
        </span>
      </button>
      {children && <div className="px-4 pb-4 sm:pl-[52px]">{children}</div>}
    </div>
  );
}

/** An on/off switch with a title and a line of small print. The whole row is the button. */
export function Switch({ on, onChange, title, sub, disabled }: { on: boolean; onChange: (on: boolean) => void; title: string; sub?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="flex w-full items-start gap-3 text-left disabled:opacity-50">
      <span aria-hidden className={clsx("relative mt-0.5 h-7 w-12 flex-none rounded-full border transition-colors", on ? "border-orange bg-orange" : "border-line bg-ink-3")}>
        <span className={clsx("absolute left-0.5 top-[3px] h-5 w-5 rounded-full transition-transform", on ? "translate-x-5 bg-brand-ink" : "bg-dim")} />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-cream">{title}</span>
        {sub && <span className="mt-1 block font-body text-[13px] leading-snug text-dim">{sub}</span>}
      </span>
    </button>
  );
}

/** A square checkbox card: a title and a line of small print. */
export function CheckCard({ on, onChange, title, sub }: { on: boolean; onChange: (on: boolean) => void; title: string; sub: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx("flex w-full items-start gap-3 rounded-hz border p-4 text-left", on ? "border-orange bg-orange/10" : "border-line bg-ink-2")}
    >
      <span aria-hidden className={clsx("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-[4px] border-2", on ? "border-orange bg-orange text-brand-ink" : "border-line bg-ink-3")}>
        {on && <Check size={16} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[17px] font-black leading-tight">{title}</span>
        <span className="mt-1 block font-body text-[14px] leading-snug text-dim">{sub}</span>
      </span>
    </button>
  );
}

/** A line with a keke check or a fireant warning in front. */
export function CheckLine({ ok, children, className }: { ok: boolean; children: ReactNode; className?: string }) {
  return (
    <li className={clsx("flex items-start gap-2.5 font-body text-[14.5px] leading-snug", ok ? "text-cream" : "text-fireant", className)}>
      {ok ? <Check size={18} className="mt-px flex-none text-keke" aria-label="Fine" /> : <AlertTriangle size={18} className="mt-px flex-none text-fireant" aria-label="Problem" />}
      <span className="min-w-0">{children}</span>
    </li>
  );
}
