"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

/** The tinted blocks Sales and Payouts are built from (the Payouts and Sales design). */

export function MCard({ title, aside, children, label, className }: { title?: string; aside?: ReactNode; children: ReactNode; label?: string; className?: string }) {
  return (
    <section className={clsx("t-card grid min-w-0 gap-3 p-4", className)} aria-label={label ?? title}>
      {title && (
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h3 className="font-body text-[15px] font-bold">{title}</h3>
          {aside && <span className="font-body text-[12.5px] text-t-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** One line of money: a label (with a small line under it) and an amount. */
export type Line = { label: string; small?: string; amount?: string; tone?: "neg" | "tot" };

export function Lines({ rows }: { rows: Line[] }) {
  return (
    <dl className="grid">
      {rows.map((r) => (
        <div key={r.label} className={clsx("flex justify-between gap-3 border-t border-t-line py-[9px] font-body text-[14.5px] first:border-t-0", r.tone === "tot" && "font-extrabold")}>
          <dt className="min-w-0">
            {r.label}
            {r.small && <small className="block text-[12.5px] font-normal text-t-muted">{r.small}</small>}
          </dt>
          <dd className={clsx("whitespace-nowrap tabular-nums", r.tone === "neg" && "text-t-muted", r.tone === "tot" && "font-display text-[18px] font-extrabold")}>{r.amount ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Fine({ children }: { children: ReactNode }) {
  return <p className="m-0 font-body text-[12.5px] text-t-muted">{children}</p>;
}

/** A message at the top of a screen: an icon in a circle, a title, a line, and maybe a button. */
export function Msg({ icon, title, children, tone, action }: { icon: ReactNode; title: string; children?: ReactNode; tone?: "bad" | "ok"; action?: ReactNode }) {
  return (
    <div
      className={clsx(
        "grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-hz border px-4 py-3.5",
        tone === "bad" ? "border-[#E5484D] bg-[color-mix(in_srgb,#E5484D_10%,var(--t-tile))]" : "border-t-line bg-t-soft"
      )}
      role={tone === "bad" ? "alert" : undefined}
      data-pay-msg
    >
      <span className={clsx("grid h-9 w-9 place-items-center rounded-full bg-t-solid font-extrabold", tone === "bad" && "text-[color-mix(in_srgb,#E5484D_80%,var(--t-text))]", tone === "ok" && "text-[color-mix(in_srgb,#1FA847_65%,var(--t-text))]")} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <b className="block font-body text-[15px]">{title}</b>
        {children && <p className="mt-0.5 font-body text-[14px] text-t-muted">{children}</p>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2.5">{action}</div>}
      </div>
    </div>
  );
}

export function Stat({ value, label, extra, className }: { value: string; label: string; extra?: string; className?: string }) {
  return (
    <div className={clsx("t-card p-3.5", className)}>
      <b className="block font-display text-[26px] font-extrabold leading-[1.1] tabular-nums">{value}</b>
      <span className="font-body text-[12.5px] text-t-muted">
        {label}
        {extra && <em className="ml-1 text-[12px] font-bold not-italic text-[color-mix(in_srgb,#1FA847_65%,var(--t-text))]">{extra}</em>}
      </span>
    </div>
  );
}

export function Chip({ children, good }: { children: ReactNode; good?: boolean }) {
  return <span className={clsx("whitespace-nowrap rounded-hz bg-t-soft px-2 py-[3px] font-body text-[11.5px] font-extrabold", good && "text-[color-mix(in_srgb,#1FA847_65%,var(--t-text))]")}>{children}</span>;
}

/** A dashed empty state. */
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2.5 rounded-hz border-[1.5px] border-dashed border-t-line px-[18px] py-9 text-center">
      <b className="font-display text-[19px] font-extrabold">{title}</b>
      <p className="m-0 max-w-[44ch] font-body text-[15px] text-t-muted">{children}</p>
      {action}
    </div>
  );
}
