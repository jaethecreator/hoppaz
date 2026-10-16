"use client";

import { crewKey, newRehearsalKey, plural, winsOnKey } from "../format";
import type { StepProps } from "./model";
import { CheckCard, ChipRow, Question, RadioCard } from "./ui";

const MEMBERS = [
  { value: "0", label: "ANY MEMBER" },
  { value: "30", label: "30 MIN" },
  { value: "60", label: "1 HOUR" },
  { value: "1440", label: "1 DAY" },
  { value: "other", label: "OTHER" },
];

const people = (n: number) => `${n} ${n === 1 ? "person has" : "people have"}`;

/** Step 4: how far the one-ticket rule reaches, how long a member must have been in the crew, and the test run switch. */
export default function StepWho({ f, d, ctx, set }: StepProps) {
  const { crew, desk, seriesKey } = ctx;
  const games = desk.games;
  const locked = f.test;
  return (
    <div>
      <Question title="Who can win?" hint="Only crew members can ever win. Pick how far the one-ticket rule reaches." />

      <div role="radiogroup" aria-label="How far the one-ticket rule reaches" className="mt-5 grid gap-3">
        {seriesKey && (
          <RadioCard
            on={d.rule === "series"}
            disabled={locked}
            onSelect={() => set({ rule: "series" })}
            title={`One per person across “${seriesKey}”`}
            sub={`Someone who won any drop in this series cannot win again. ${people(winsOnKey(games, seriesKey))} won so far.`}
          />
        )}
        <RadioCard
          on={d.rule === "crew"}
          disabled={locked}
          onSelect={() => set({ rule: "crew" })}
          title={`One per person across all ${crew.name} drops, ever`}
          sub={`Winners of any past ${crew.name} drop cannot win this one. ${people(winsOnKey(games, crewKey(crew.id)))} won.`}
        />
        <RadioCard
          on={d.rule === "new"}
          disabled={locked}
          onSelect={() => set({ rule: "new" })}
          title="Start a new series"
          sub={d.rule === "new" && d.nameUsed ? undefined : "Everyone can win again, once, in the new series."}
        >
          {d.rule === "new" && !locked && (
            <div className="pt-1">
              <label className="label">
                Name of the series
                <input value={d.newName} maxLength={80} spellCheck={false} onChange={(e) => set({ newName: e.target.value })} aria-invalid={!d.nameOk ? true : undefined} />
              </label>
              {d.nameUsed && <p className="hint mt-2 !text-fireant">That is an existing series: {plural(winsOnKey(games, d.nameT), "person has", "people have")} won on it.</p>}
            </div>
          )}
        </RadioCard>
      </div>
      {locked && <p className="hint mt-2">A test run has its own win rule.</p>}

      <div className="mt-8">
        <p className="label">How long they must be in the crew before it opens</p>
        <ChipRow label="How long they must be in the crew" value={f.test ? "0" : f.minKey} options={MEMBERS} disabled={locked} onChange={(v) => set({ minKey: v as typeof f.minKey })} />
        {f.minKey === "other" && !locked && (
          <label className="label mt-3 block w-44">
            Minutes (0 to 10080)
            <input type="number" inputMode="numeric" min={0} max={10080} value={f.minOther} onChange={(e) => set({ minOther: e.target.value })} />
          </label>
        )}
        <p className="hint mt-2.5 !text-[14px]">30 minutes or more stops one person opening fresh accounts to win.</p>
      </div>

      <div className="mt-8">
        <CheckCard
          on={f.test}
          title="This is a test run"
          sub="No push to members, and its own win rule, so nobody's real win is used up."
          onChange={(test) => set(test ? { test: true, testKey: newRehearsalKey(), series: false, seriesOffNote: f.series && f.mode === "schedule" } : { test: false, seriesOffNote: false })}
        />
        {f.test && f.seriesOffNote && <p className="hint mt-2">A series is not allowed in a test run, so it is switched off.</p>}
      </div>
    </div>
  );
}
