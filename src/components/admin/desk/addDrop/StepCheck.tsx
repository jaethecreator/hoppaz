"use client";

import { useId, type ReactNode } from "react";
import { MINUTE, dayWord, hhmm, lagosDay, lagosShort, plural } from "../format";
import { ruleName, summary, whenText, whereText, whoText, type CheckItem, type Derived, type Form, type StepProps } from "./model";
import { CheckLine } from "./ui";

/** "Today, Fri 16 Oct", "Tomorrow, Sat 17 Oct", "Sun 18 Oct"; a series says it starts then. */
function dayLabel(f: Form, d: Derived): string {
  if (f.mode === "now") return "Right now";
  if (d.opens === null) return "Time not set";
  const w = dayWord(d.opens);
  const day = lagosDay(d.opens);
  const base = w === "today" || w === "tomorrow" ? `${w}, ${day}` : day;
  return d.series ? `Starting ${base}` : base.charAt(0).toUpperCase() + base.slice(1);
}

function Row({ k, onEdit, locked, children }: { k: string; onEdit: () => void; locked: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[96px_minmax(0,1fr)_auto]">
      <p className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">{k}</p>
      <div className="min-w-0 font-body text-[15px] leading-snug">{children}</div>
      <button
        type="button"
        disabled={locked}
        onClick={onEdit}
        aria-label={`Edit ${k.toLowerCase()}`}
        className="-m-2 p-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-orange disabled:opacity-40"
      >
        EDIT
      </button>
    </div>
  );
}

/** Step 5: the whole drop in plain words with a way back to each part, the name Hoppers see, and the checks. */
export default function StepCheck({
  f,
  d,
  ctx,
  set,
  go,
  checks,
  locked,
  saveError,
  partial,
  onDone,
}: StepProps & {
  go: (step: number) => void;
  checks: CheckItem[];
  /** Saving, or stopped half way: nothing can change under the save. */
  locked: boolean;
  saveError: string;
  partial: string;
  onDone: () => void;
}) {
  const id = useId();
  const per = f.perDrop;
  const dropCodes = (i: number) => d.slotCodes.slice(i * per, (i + 1) * per).join(", ");
  const len = d.len ?? 0;
  const titleBad = d.baseTitle.length < 2 || d.baseTitle.length > d.titleMax;
  return (
    <div>
      <p className="seclabel">Check before you save</p>
      <h2 className="mt-3 font-display text-[26px] font-black leading-[1.15]">{summary(f, d)}</h2>
      <p className="hint mt-3 !text-[14px]">
        {dayLabel(f, d)}, in the {ctx.crew.name} room. {f.test ? "Test run: no push, its own win rule." : `Crew members only, one ticket per person across ${ruleName(f, d, ctx)}.`}
      </p>

      <div className="mt-6 rounded-hz border border-line bg-ink-2">
        <Row k="When" locked={locked} onEdit={() => go(0)}>
          {whenText(f, d, true)}
          {d.series && (
            <>
              <ol className="mt-1.5 font-mono text-[12.5px] leading-6">
                {d.times.map((t, i) => (
                  <li key={i}>
                    <span className="text-dim">{i + 1}.</span> {lagosShort(t)} to {hhmm(t + len * MINUTE)}
                  </li>
                ))}
              </ol>
              {f.mystery && <p className="hint mt-1.5">Mystery times: drop 1 opens at the exact time, the others at a random moment in their slot.</p>}
            </>
          )}
        </Row>
        <Row k="Tickets" locked={locked} onEdit={() => go(1)}>
          {d.series ? (
            <>
              {d.dropsN} drops × {plural(per, "ticket")}
              <ul className="mt-1.5 font-mono text-[12.5px] leading-6">
                {Array.from({ length: d.dropsN }, (_, i) => (
                  <li key={i} className="break-all">
                    <span className="text-dim">Drop {i + 1}:</span> {dropCodes(i)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {plural(per, "ticket")} · <span className="break-all font-mono text-[14px]">{dropCodes(0)}</span>
            </>
          )}
        </Row>
        <Row k="Where" locked={locked} onEdit={() => go(2)}>
          {whereText(f, true)}
        </Row>
        <Row k="Who" locked={locked} onEdit={() => go(3)}>
          {whoText(f, d, ctx, true)}
        </Row>
      </div>

      <div className="mt-7">
        <label className="label" htmlFor={id}>
          Name Hoppers see
        </label>
        <input id={id} className="min-h-[48px]" value={f.title} maxLength={d.titleMax} disabled={locked} aria-invalid={titleBad ? true : undefined} onChange={(e) => set({ title: e.target.value })} />
        {d.series && f.mystery && <p className="hint mt-1.5">Each drop gets its number added: &ldquo;{d.baseTitle || "Name"} · 2/{d.dropsN}&rdquo;.</p>}
      </div>

      <ul className="mt-5 grid gap-2.5" aria-label="Checks">
        {checks.map((c, i) => (
          <CheckLine key={i} ok={c.ok}>
            {c.text}
          </CheckLine>
        ))}
      </ul>

      {saveError && (
        <p role="alert" className="mt-5 rounded-hz border border-fireant bg-fireant/10 p-3 font-body text-[14.5px] leading-snug text-fireant">
          {saveError}
        </p>
      )}
      {partial && (
        <div role="alert" className="mt-5 rounded-hz border border-fireant bg-fireant/10 p-4">
          <p className="font-body text-[15px] leading-snug">{partial}</p>
          <button type="button" className="btn mt-3 w-full !min-h-[48px]" onClick={onDone}>
            DONE
          </button>
        </div>
      )}
    </div>
  );
}
