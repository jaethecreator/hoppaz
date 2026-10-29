"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export const errText = (e: unknown) => (e instanceof Error ? e.message : "That did not work. Try again");

/** A line that shows for a moment ("Copied", "Saved"). */
export function useFlashLine(ms = 2200): [string, (s: string) => void] {
  const [text, setText] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback(
    (s: string) => {
      setText(s);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(""), ms);
    },
    [ms]
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [text, flash];
}

export function Tile({ n, label, extra }: { n: string; label: string; extra?: string }) {
  return (
    <div className="t-card p-4">
      <p className="num text-[28px] lg:text-[32px]">{n}</p>
      <p className="mt-1.5 font-body text-[13.5px] text-t-muted">
        {label}
        {extra && <b className="ml-1.5 font-bold text-[#1FA847]">{extra}</b>}
      </p>
    </div>
  );
}

export function Card({ title, aside, children, label, className }: { title?: string; aside?: ReactNode; children: ReactNode; label?: string; className?: string }) {
  return (
    <section className={clsx("t-card p-4 lg:p-5", className)} aria-label={label ?? title}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="font-body text-[16px] font-extrabold">{title}</h3>
          {aside && <p className="text-right font-body text-[13.5px] text-t-muted">{aside}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export const SOON = <span className="rounded-hz bg-t-soft px-2 py-0.5 font-body text-[11px] font-extrabold text-t-muted">Coming soon</span>;

/** A settings row that has no backend yet: shown, switched off, marked "Coming soon". Nothing here saves. */
export function SoonRow({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-3 border-t border-t-line py-3 first:border-t-0" data-soon>
      <div className="min-w-0 flex-1">
        <b className="flex flex-wrap items-center gap-2 font-body text-[15px]">
          {title}
          {SOON}
        </b>
        <span className="block font-body text-[13px] text-t-muted">{hint}</span>
      </div>
      {children && (
        <div className="flex-none opacity-60" aria-disabled="true">
          {children}
        </div>
      )}
    </div>
  );
}

export function Err({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="font-body text-[14px] text-fireant">
      {children}
    </p>
  ) : null;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "H";
