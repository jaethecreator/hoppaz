"use client";

import { RefreshCw } from "lucide-react";
import { MINUTE, dayWord, hhmm, lagosDate, lagosShort } from "../format";
import type { StepProps } from "./model";
import { ChipRow, Question, RadioCard, Switch } from "./ui";

const LENGTHS = [
  { value: "15", label: "15 MIN" },
  { value: "30", label: "30 MIN" },
  { value: "60", label: "1 HOUR" },
  { value: "120", label: "2 HOURS" },
  { value: "other", label: "OTHER" },
];

/** Step 1: schedule it or start now, how long it stays open, and once or a series (with its mystery times). */
export default function StepWhen({ f, d, ctx, set }: StepProps) {
  const schedule = f.mode === "schedule";
  const len = d.len;
  const closesAt =
    d.opens !== null && d.closes !== null
      ? `Closes at ${hhmm(d.closes)}${lagosDate(d.closes) === lagosDate(d.opens) ? "" : ` ${dayWord(d.closes)}`}. `
      : "";
  return (
    <div>
      <Question title="When does it open?" hint="Times are Lagos time." />

      <div className="mt-5">
        <ChipRow
          label="When"
          value={f.mode}
          options={[
            { value: "schedule", label: "SCHEDULE IT" },
            { value: "now", label: "START NOW" },
          ]}
          onChange={(mode) => set({ mode: mode as "schedule" | "now" })}
          chipClass="min-h-[48px] flex-1"
        />
      </div>

      {schedule && (
        <div className="mt-5 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
          <label className="label">
            Day
            <select className="min-h-[48px]" value={f.day} onChange={(e) => set({ day: e.target.value })}>
              {ctx.days.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Opens at
            <input className="min-h-[48px]" type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
          </label>
        </div>
      )}

      <div className="mt-6">
        <p className="label">How long it stays open</p>
        <ChipRow label="How long it stays open" value={f.len} options={LENGTHS} onChange={(len) => set({ len: len as typeof f.len })} />
        {f.len === "other" && (
          <label className="label mt-3 block w-44">
            Minutes (1 to 10080)
            <input type="number" inputMode="numeric" min={1} max={10080} value={f.lenOther} onChange={(e) => set({ lenOther: e.target.value })} />
          </label>
        )}
        <p className="hint mt-2.5 !text-[14px]">
          {schedule
            ? `${closesAt}Hoppers see a countdown before it opens.`
            : `Opens the moment you save${f.test ? "" : " and sends members a push"}. ${d.len !== null ? `Runs ${d.len} min.` : ""}`}
        </p>
        {schedule && d.clash && !d.series && (
          <p className="hint mt-2 !text-fireant" role="status">
            {d.clash}
          </p>
        )}
      </div>

      {schedule && (
        <div className="mt-8">
          <p className="label">Once, or a series?</p>
          <div role="radiogroup" aria-label="Once, or a series?" className="grid gap-3">
            <RadioCard on={!d.series} onSelect={() => set({ series: false })} title="Just this drop" sub={d.opens !== null ? `One drop, opens ${hhmm(d.opens)}.` : "One drop."} />
            <RadioCard
              on={d.series}
              disabled={f.test}
              onSelect={() => set({ series: true })}
              title="A series of drops"
              sub={f.test ? "Not in a test run. A test run is one drop." : "The same drop every few hours (for example every 3 hours, 8 drops), with mystery times if you want."}
            >
              {d.series && (
                <div className="pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="label">
                      Every (hours)
                      <input type="number" inputMode="numeric" min={1} max={12} value={f.every} onChange={(e) => set({ every: e.target.value })} />
                    </label>
                    <label className="label">
                      Drops
                      <input type="number" inputMode="numeric" min={2} max={24} value={f.drops} onChange={(e) => set({ drops: e.target.value })} />
                    </label>
                  </div>
                  <div className="mt-4">
                    <Switch
                      on={f.mystery}
                      onChange={(mystery) => set({ mystery })}
                      title="MYSTERY TIMES"
                      sub={
                        f.mystery
                          ? "Drop 1 opens at the exact time. Each later drop opens at a random moment in its slot. Hoppers never see a countdown after drop 1."
                          : `Every drop opens exactly ${d.every ?? "N"} ${d.every === 1 ? "hour" : "hours"} after the last. Hoppers see a countdown for each.`
                      }
                    />
                  </div>
                  {d.times.length > 0 && len !== null && (
                    <div className="mt-4">
                      <p className="label">Drop times</p>
                      <ol className="rounded-hz border border-line bg-ink-3 p-3 font-mono text-[12.5px] leading-6" aria-label="Drop times">
                        {d.times.map((t, i) => (
                          <li key={i}>
                            <span className="text-dim">{i + 1}.</span> {lagosShort(t)} to {hhmm(t + len * MINUTE)}
                          </li>
                        ))}
                      </ol>
                      {f.mystery && (
                        <button type="button" className="btn btn-ghost mt-3 !min-h-[40px] px-3 py-2" onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}>
                          <RefreshCw size={14} /> SHUFFLE TIMES
                        </button>
                      )}
                      {d.clash && (
                        <p className="hint mt-3 !text-fireant" role="status">
                          {d.clash}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </RadioCard>
          </div>
        </div>
      )}
    </div>
  );
}
