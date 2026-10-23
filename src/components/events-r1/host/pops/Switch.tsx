"use client";

import clsx from "clsx";

/** A small On/Off switch for a list row (the label is for screen readers; the row's status pill says the state in words). */
export default function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="-my-2 flex min-h-[44px] flex-none items-center pl-2 disabled:opacity-50"
    >
      <span className={clsx("relative h-[26px] w-[44px] rounded-full transition-colors", on ? "bg-orange" : "bg-ink-3 ring-1 ring-inset ring-line")} aria-hidden>
        <span className={clsx("absolute top-[3px] h-5 w-5 rounded-full bg-cream transition-[left]", on ? "left-[21px]" : "left-[3px]")} />
      </span>
    </button>
  );
}
