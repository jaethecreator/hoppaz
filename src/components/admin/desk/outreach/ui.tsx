import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { OrganiserStage } from "@/lib/events-r1/types";
import { STAGE_LABEL, STAGE_TONE } from "./format";

/** Sentence case versions of the desk's pill, chip and button, shared by the Outreach tabs. */

export function Tag({ tone = "", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx("pill !font-body !text-[12px] !normal-case !tracking-normal", tone)}>
      {children}
    </span>
  );
}

export const StageTag = ({ stage }: { stage: OrganiserStage }) => <Tag tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Tag>;

export function FilterChip({ on, children, ...rest }: { on: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={on} className="chip !min-h-[40px] !px-3.5 !font-body !text-[13px] !normal-case !tracking-normal" {...rest}>
      {children}
    </button>
  );
}

/** A normal-sized action button: ghost by default, solid with `solid`, red with `danger`. At least 44 px tall for a thumb. */
export function Btn({ solid, danger, className, ...rest }: { solid?: boolean; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={clsx("btn min-h-[44px] px-4 normal-case", !solid && "btn-ghost", danger && (solid ? "!bg-fireant !text-cream disabled:!bg-ink-3 disabled:!text-dim" : "!border-fireant !text-fireant"), className)} {...rest} />;
}

export function Fail({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-2 whitespace-pre-line font-body text-[14px] text-fireant">
      {children}
    </p>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Loading({ text = "Loading" }: { text?: string }) {
  return (
    <p role="status" className="hint py-6 text-center">
      {text}
    </p>
  );
}
