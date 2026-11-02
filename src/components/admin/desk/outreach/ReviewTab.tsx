"use client";

import { useState } from "react";
import { isClean } from "./format";
import ReviewCard from "./ReviewCard";
import { Btn, Fail, Loading } from "./ui";
import { useOutreach } from "./useOutreach";

/** The review queue: rows the scout pulled, waiting for a yes. */
export default function ReviewTab() {
  const { data, api, by, say } = useOutreach();
  const queue = data.queue;
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (!queue) return data.errors.queue ? <LoadFail text={data.errors.queue} retry={data.reloadQueue} /> : <Loading text="Loading the queue" />;

  const clean = queue.filter(isClean);
  const waiting = queue.filter((r) => r.status !== "blocked").length;

  /** One at a time, so a failure stops with a clear count and the rest stay in the queue. */
  const approveAll = async () => {
    const rows = [...clean];
    setConfirm(false);
    setProgress({ done: 0, total: rows.length });
    let done = 0;
    let fail = "";
    for (const r of rows) {
      try {
        await api.approve(r.id, by);
        done += 1;
        data.setQueue((q) => (q ? q.filter((x) => x.id !== r.id) : q));
        setProgress({ done, total: rows.length });
      } catch (e) {
        fail = `${r.fields.name}: ${e instanceof Error ? e.message : "That did not work"}`;
        break;
      }
    }
    setProgress(null);
    say(fail ? `Approved ${done} of ${rows.length}. Stopped at ${fail}` : `Approved ${done} ${done === 1 ? "event" : "events"}`, fail ? "error" : "ok");
    void data.reloadQueue();
    void data.reloadOrganisers();
  };

  return (
    <div>
      <ScoutHelp />
      {data.errors.queue && <Fail>{data.errors.queue}</Fail>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="font-display text-[15px] font-bold">
          {waiting ? `${waiting} waiting` : "Nothing waiting"}
          {queue.length > waiting && <span className="font-body font-normal text-dim">{` · ${queue.length - waiting} blocked`}</span>}
        </p>
        <div className="flex-1" />
        {clean.length > 0 &&
          (confirm ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm approve all">
              <span className="font-body text-[14px]">
                Put {clean.length} {clean.length === 1 ? "event" : "events"} live now?
              </span>
              <Btn solid onClick={() => void approveAll()}>
                Yes, approve {clean.length}
              </Btn>
              <Btn onClick={() => setConfirm(false)}>Cancel</Btn>
            </div>
          ) : (
            <Btn solid disabled={!!progress} onClick={() => setConfirm(true)}>
              {progress ? `Approving ${progress.done} of ${progress.total}` : `Approve all confirmed (${clean.length})`}
            </Btn>
          ))}
      </div>
      {clean.length > 0 && <p className="hint -mt-1 mb-3">Confirmed rows with a start time and no flags. Anything with a chip needs a look first.</p>}

      {queue.map((r) => (
        <ReviewCard key={r.id} row={r} others={queue.filter((o) => o.id !== r.id && o.status !== "blocked")} />
      ))}
      {!queue.length && <p className="hint">The queue is empty. Run the scout to fill it.</p>}
      {queue.length > 1 && <p className="hint mt-2">Keys: focus a card (Tab, or J and K), then A approve, E edit, R reject.</p>}
    </div>
  );
}

export function LoadFail({ text, retry }: { text: string; retry: () => Promise<void> }) {
  return (
    <div className="card">
      <p role="alert" className="font-body text-[14px] text-fireant">
        {text}
      </p>
      <Btn className="mt-3" onClick={() => void retry()}>
        Try again
      </Btn>
    </div>
  );
}

function ScoutHelp() {
  return (
    <details className="card mb-4 !p-3">
      <summary className="cursor-pointer font-display text-[14px] font-bold">How to fill this queue</summary>
      <p className="hint mt-2">
        Fill this queue by running the scout on your computer: <code className="font-mono text-cream">docs/skill/hoppaz-event-scout/SKILL.md</code>
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 font-body text-[14px]">
        <li>Run the Hoppaz event scout skill in the Claude desktop app. It saves events.json and the flyers in ~/hoppaz-scout, in a folder for today.</li>
        <li>Check it with a dry run: node scripts/events/load-scout.mjs on that events.json. It prints what would be new, changed or blocked, and writes nothing.</li>
        <li>Run it again with --apply to send the batch here. Then review the rows below. Do this 2 or 3 times a week.</li>
      </ol>
    </details>
  );
}
