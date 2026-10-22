"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { Report, ReportReason } from "@/lib/events-r1/types";
import { Section, SectionHead } from "./parts";

/** Open reports at which the data layer hides an event from the lists (the same number as in the SQL). */
const HIDE_AT = 3;

const REASON: Record<ReportReason, string> = {
  fake_or_scam: "Fake or scam",
  wrong_place: "Wrong place",
  offensive: "Offensive",
  other: "Other",
};

const stamp = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

/**
 * Release 1: reports on the new events, from api.reports.list() (staff only). Open ones are grouped by event with a
 * count; three or more hide the event from the lists until staff have checked it. This section reads the Release 1 data
 * layer, not /api/admin/game, so in fake mode it needs the dev panel's "Hoppaz Staff" signed in.
 */
export default function EventReportsSection() {
  const api = useR1Api();
  const list = useR1Query((a) => a.reports.list(), []);
  const [busy, setBusy] = useState("");
  const [fail, setFail] = useState("");

  const groups = useMemo(() => {
    const by = new Map<string, { id: string; title: string; reports: Report[] }>();
    for (const r of list.data ?? []) {
      if (r.status !== "open") continue;
      const g = by.get(r.event_id) ?? { id: r.event_id, title: r.event_title, reports: [] };
      g.reports.push(r);
      by.set(r.event_id, g);
    }
    return [...by.values()].sort((a, b) => b.reports.length - a.reports.length);
  }, [list.data]);

  const review = async (id: string) => {
    if (!api || busy) return;
    setBusy(id);
    setFail("");
    try {
      await api.reports.markReviewed(id);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy("");
    }
  };

  const signedOut = list.error && /Sign in first|Not allowed/.test(list.error.message);

  return (
    <>
      <SectionHead title="Event reports" hint={`Reports from guests on new events. An event with ${HIDE_AT} or more open reports stays hidden until you check it.`} />
      {signedOut ? (
        <Section title="Staff sign in">
          <p className="hint">{api?.mode === "fake" ? "Sign in as Hoppaz Staff in /dev/events-r1 to try this." : "Reports show here once you are signed in as Hoppaz staff."}</p>
          {api?.mode === "fake" && (
            <Link href="/dev/events-r1" className="btn btn-ghost mt-3 px-4 normal-case">
              Open the dev panel
            </Link>
          )}
        </Section>
      ) : list.error ? (
        <p role="alert" className="hint text-fireant">
          {list.error.message}
        </p>
      ) : (
        <>
          {groups.map((g) => (
            <Section key={g.id} title={g.title}>
              <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2">
                <span className="pill !font-body !text-[12px] !normal-case !tracking-normal">
                  {g.reports.length} open {g.reports.length === 1 ? "report" : "reports"}
                </span>
                {g.reports.length >= HIDE_AT && <span className="pill pill-fireant !font-body !text-[12px] !normal-case !tracking-normal">Hidden until checked</span>}
                <Link href={`/event/${encodeURIComponent(g.id)}`} className="font-body text-[13px] text-orange underline underline-offset-4">
                  Open event page
                </Link>
              </div>
              {g.reports.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-bold">{REASON[r.reason]}</p>
                    {r.note && <p className="font-body text-[14px] text-cream">{r.note}</p>}
                    <p className="hint">
                      {r.reporter_name || `Guest ${r.reporter_id.slice(0, 6)}`} · {stamp(r.created_at)}
                    </p>
                  </div>
                  <button type="button" className="btn btn-ghost min-h-[44px] px-4 normal-case" disabled={busy === r.id} onClick={() => void review(r.id)}>
                    Mark reviewed
                  </button>
                </div>
              ))}
            </Section>
          ))}
          {!groups.length && <p className="hint">{list.loading ? "Loading" : "No open reports."}</p>}
          {fail && (
            <p role="alert" className="hint text-fireant">
              {fail}
            </p>
          )}
        </>
      )}
    </>
  );
}
