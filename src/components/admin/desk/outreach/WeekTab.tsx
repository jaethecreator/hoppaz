"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrganiserStage, WeekSummary } from "@/lib/events-r1/types";
import { STAGE_LABEL } from "./format";
import { LoadFail } from "./ReviewTab";
import { Btn, Loading } from "./ui";
import { useOutreach } from "./useOutreach";

type Key = keyof WeekSummary["previous"];
const ROWS: { key: Key; label: string }[] = [
  { key: "contacted", label: "Contacted" },
  { key: "replies", label: "Replies" },
  { key: "offers", label: "Offers" },
  { key: "claimed", label: "Claimed" },
  { key: "declined", label: "Declined" },
  { key: "listed", label: "New listings" },
];

/** Stage colours for the bar: the same hues as the stage pills. */
const BAR: Record<OrganiserStage, string> = {
  pulled: "bg-dim",
  listed: "bg-lagoon",
  offered: "bg-danfo",
  claimed: "bg-keke",
  declined: "bg-fireant",
};
const STAGES: OrganiserStage[] = ["pulled", "listed", "offered", "claimed", "declined"];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });

/** This week against last week, the organisers by stage, and who has waited longest. Plain CSS bars, no chart library. */
export default function WeekTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { api, data } = useOutreach();
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      setWeek(await api.week());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    }
  }, [api]);
  // Reloads when the lists change, so a contact logged a moment ago shows here.
  useEffect(() => {
    void load();
  }, [load, data.organisers]);

  if (!week) return err ? <LoadFail text={err} retry={load} /> : <Loading text="Loading the week" />;

  const total = STAGES.reduce((n, s) => n + week.stages[s], 0);

  return (
    <div>
      <p className="hint mb-3">
        {day(week.from)} to {day(week.to)}, against the week before.
      </p>
      <section aria-label="This week" className="card mb-4 !p-0">
        <table className="w-full border-collapse text-left font-body text-[15px]">
          <thead>
            <tr className="seclabel">
              <th scope="col" className="px-3 py-2 font-medium">&nbsp;</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">This week</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Last week</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ key, label }) => {
              const now = week[key];
              const was = week.previous[key];
              const up = now > was;
              const down = now < was;
              return (
                <tr key={key} className="border-t border-line">
                  <th scope="row" className="px-3 py-3 font-normal">{label}</th>
                  <td className="px-3 py-3 text-right font-display text-xl font-black tabular-nums">{now}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-dim">{was}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${up ? "text-keke" : down ? "text-fireant" : "text-dim"}`}>
                    <span aria-hidden>{up ? "▲" : down ? "▼" : "="}</span>
                    <span className="sr-only">{up ? "Up" : down ? "Down" : "Same"}</span> {up || down ? Math.abs(now - was) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="hint mb-4">
        Also this week: {week.pulled_new} new pulled, {week.rejected} rejected, {week.claim_requests} asked to claim.
      </p>

      <section aria-label="Organisers by stage" className="card mb-4">
        <h2 className="seclabel mb-3">Organisers by stage ({total})</h2>
        {total > 0 && (
          <div className="flex h-5 overflow-hidden rounded-hz bg-ink-3" role="img" aria-label={STAGES.map((s) => `${STAGE_LABEL[s]} ${week.stages[s]}`).join(", ")}>
            {STAGES.filter((s) => week.stages[s] > 0).map((s) => (
              <div key={s} className={BAR[s]} style={{ width: `${(week.stages[s] / total) * 100}%` }} />
            ))}
          </div>
        )}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-body text-[14px]">
          {STAGES.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-3 rounded-sm ${BAR[s]}`} aria-hidden />
              {STAGE_LABEL[s]} <span className="font-bold tabular-nums">{week.stages[s]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Waiting longest" className="card !p-3">
        <h2 className="seclabel mb-2">Waiting longest</h2>
        {week.waiting.length === 0 && <p className="hint">Nobody has waited 7 days or more.</p>}
        {week.waiting.map((w) => (
          <div key={w.id} className="flex items-center gap-2 border-t border-line py-1 first:border-0">
            <p className="min-w-0 flex-1 font-body text-[15px]">
              <span className="font-bold">{w.name}</span> <span className="text-dim">· {w.days} days</span>
            </p>
            <Btn onClick={() => onOpen(w.id)}>Open</Btn>
          </div>
        ))}
      </section>
    </div>
  );
}
