"use client";

import clsx from "clsx";
import { AlertTriangle, Check, X } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import type { Crew } from "../types";
import { STEP_NAMES, summary, ticketsText, whenText, whereText, whoText, type CheckItem, type Ctx, type Derived, type Form } from "./model";

/** What the primary button (NEXT or the save button) and BACK do, the same on the phone bar and the desktop side panel. */
export type Actions = {
  primaryLabel: string;
  primaryDisabled: boolean;
  /** The save is waiting for a second tap (START NOW). */
  armed: boolean;
  onPrimary: () => void;
  onBack: () => void;
  backDisabled: boolean;
};

/** The top of the flow: close, the crew, and the five-step bar. Tapping a finished step goes back to it. */
export function Header({ crew, step, done, onStep, onClose, closeDisabled }: { crew: Crew; step: number; done: (i: number) => boolean; onStep: (i: number) => void; onClose: () => void; closeDisabled: boolean }) {
  return (
    <header className="border-b border-line px-4 pb-3 pt-4 lg:px-8">
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-ghost !min-h-[48px] !w-12 flex-none !p-0" aria-label="Close without saving" disabled={closeDisabled} onClick={onClose}>
          <X size={20} />
        </button>
        <div className="min-w-0">
          <p className="seclabel">Add a drop</p>
          <h2 className="flex items-center gap-2 font-display text-lg font-black leading-tight">
            <span className="min-w-0 truncate">{crew.name}</span>
            {crew.verified && <VerifiedBadge />}
          </h2>
        </div>
      </div>
      <nav aria-label="Steps" className="mt-4 grid grid-cols-5 gap-1.5 lg:gap-4">
        {STEP_NAMES.map((name, i) => {
          const isDone = done(i);
          const current = i === step;
          return (
            <button key={name} type="button" disabled={!isDone && !current} aria-current={current ? "step" : undefined} onClick={() => onStep(i)} className="py-1 text-left disabled:cursor-default">
              <span className={clsx("block h-1 rounded-full", isDone || current ? "bg-orange" : "bg-line")} />
              <span className={clsx("mt-2 flex items-center gap-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.06em] lg:text-[11px] lg:tracking-[0.1em]", current ? "text-cream" : "text-dim")}>
                {isDone ? <Check size={12} className="flex-none text-orange" aria-label="Done" /> : <span>{i + 1}</span>}
                {name}
              </span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}

/** The two buttons: the primary one (orange; red while the save waits for a second tap) and a ghost BACK. */
function Buttons({ a, row }: { a: Actions; row: boolean }) {
  return (
    <div className={row ? "flex gap-3" : "grid gap-2"}>
      <button type="button" className={clsx("btn btn-ghost !min-h-[48px]", row ? "order-first px-5" : "order-last w-full")} disabled={a.backDisabled} onClick={a.onBack}>
        BACK
      </button>
      <button type="button" className={clsx("btn !min-h-[48px]", row ? "flex-1" : "w-full", a.armed && "!bg-fireant")} disabled={a.primaryDisabled} onClick={a.onPrimary}>
        {a.primaryLabel}
      </button>
    </div>
  );
}

/** Phone: a fixed bar with one short line (the summary, or what is stopping NEXT in red) and BACK + the primary button. */
export function PhoneBar({ line, problem, actions }: { line: string; problem: string; actions: Actions }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink-2 px-4 pad-bottom pt-3 lg:hidden">
      <p role="status" className={clsx("mb-2.5 font-mono text-[11px] uppercase leading-snug tracking-[0.1em]", problem ? "text-fireant" : "text-dim")}>
        {problem || line}
      </p>
      <Buttons a={actions} row />
    </div>
  );
}

/**
 * Desktop: the drop so far on the right. The sentence, one line per step (a check when it is done, a warning when it has a
 * problem, "Next" and "Later" for what is still to do), the checks, what is stopping NEXT, and the buttons.
 */
export function Aside({
  f,
  d,
  ctx,
  step,
  done,
  checks,
  problem,
  actions,
}: {
  f: Form;
  d: Derived;
  ctx: Ctx;
  step: number;
  done: (i: number) => boolean;
  checks: CheckItem[];
  problem: string;
  actions: Actions;
}) {
  // A step is only flagged for something wrong, not for something not filled in yet.
  const bad = [
    !!d.problems[0] || !!d.clash,
    d.overflow.length > 0 || d.codeErr.some(Boolean),
    !!d.problems[2] && (f.picked.length > 0 || step > 2),
    !!d.problems[3],
  ];
  const lines = [
    { key: "When", value: whenText(f, d, false) },
    { key: "Tickets", value: ticketsText(f, d) },
    { key: "Where", value: f.picked.length ? whereText(f, false) : "No spots yet" },
    { key: "Who", value: whoText(f, d, ctx, false) },
  ];
  return (
    <aside className="hidden border-l border-line lg:block" aria-label="This drop">
      <div className="sticky top-0 flex flex-col gap-5 p-6">
        <p className="seclabel">This drop</p>
        <p className="font-display text-[19px] font-black leading-snug">{summary(f, d)}</p>
        <dl className="grid gap-2.5">
          {lines.map((l, i) => {
            const pending = i > step && !done(i);
            return (
              <div key={l.key} className="grid grid-cols-[18px_66px_minmax(0,1fr)] items-start gap-x-2.5 font-body text-[14.5px] leading-snug">
                <span className="pt-0.5">
                  {pending ? null : bad[i] ? <AlertTriangle size={16} className="text-fireant" aria-label="Problem" /> : done(i) ? <Check size={16} className="text-keke" aria-label="Done" /> : null}
                </span>
                <dt className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">{l.key}</dt>
                <dd className={clsx("min-w-0 break-words", pending ? "text-dim" : bad[i] ? "text-fireant" : "text-cream")}>{pending ? (i === step + 1 ? "Next" : "Later") : l.value}</dd>
              </div>
            );
          })}
        </dl>
        {checks.length > 0 && (
          <ul className="grid gap-2.5 border-t border-line pt-5" aria-label="Checks">
            {checks
              .filter((c) => !c.late || !c.ok)
              .map((c, i) => (
                <li key={i} className={clsx("flex items-start gap-2.5 font-body text-[14.5px] leading-snug", c.ok ? "text-cream" : "text-fireant")}>
                  {c.ok ? <Check size={16} className="mt-0.5 flex-none text-keke" aria-label="Fine" /> : <AlertTriangle size={16} className="mt-0.5 flex-none text-fireant" aria-label="Problem" />}
                  <span className="min-w-0">{c.short ?? c.text}</span>
                </li>
              ))}
          </ul>
        )}
        {problem && (
          <p role="status" className="font-body text-[14px] leading-snug text-fireant">
            {problem}
          </p>
        )}
        <Buttons a={actions} row={false} />
      </div>
    </aside>
  );
}
