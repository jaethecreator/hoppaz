"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export const CARD = "rounded-hz border border-line bg-ink-2 p-4";

/** A status pill in sentence case (the app's .pill is mono caps). */
export function Pill({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={clsx("pill !font-body !text-[12px] !normal-case !tracking-normal", tone)}>{children}</span>;
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx(CARD, className)}>
      <h2 className="font-display text-[16px] font-black">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A short line that shows for a moment ("Copied", "Saved"). */
export function useFlash(ms = 2200): [string, (s: string) => void] {
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

export function ErrorLine({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="font-body text-[14px] text-fireant">
      {children}
    </p>
  ) : null;
}
