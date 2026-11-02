"use client";

import clsx from "clsx";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { SectionHead } from "../sections/parts";
import OrganisersTab from "./OrganisersTab";
import ReviewTab from "./ReviewTab";
import { Loading } from "./ui";
import { OutreachContext, useStaffName, type FocusRequest, type OutreachCtx, type OutreachData, type Tone } from "./useOutreach";
import WeekTab from "./WeekTab";

type TabKey = "review" | "organisers" | "week";

/**
 * Outreach: the routine for pulled events and the organisers behind them. Three tabs: Review (the queue the scout fills), Organisers
 * (the tracker, the default) and Week. The desk shell loads the data (useOutreachData) so the rail can show a count before this opens.
 */
export default function OutreachSection({ data }: { data: OutreachData }) {
  const [by, setBy] = useStaffName();
  const [tab, setTab] = useState<TabKey>("organisers");
  const [note, setNote] = useState<{ text: string; tone: Tone } | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const n = useRef(0);

  const say = useCallback((text: string, tone: Tone = "ok") => {
    if (timer.current) clearTimeout(timer.current);
    setNote({ text, tone });
    if (tone === "ok") timer.current = setTimeout(() => setNote(null), 5000);
  }, []);

  const openOrganiser = useCallback((id: string, mode?: FocusRequest["mode"], email?: string) => {
    setTab("organisers");
    setFocus({ id, mode, email, n: ++n.current });
  }, []);

  const api = data.api;
  const ctx = useMemo<OutreachCtx | null>(() => (api ? { data, api, by: by.trim() || "Jae", say, openOrganiser } : null), [data, api, by, say, openOrganiser]);

  const waiting = (data.queue ?? []).filter((r) => r.status !== "blocked").length;
  const tabs: { key: TabKey; label: string; n?: number }[] = [
    { key: "organisers", label: "Organisers" },
    { key: "review", label: "Review", n: waiting },
    { key: "week", label: "Week" },
  ];

  return (
    <>
      <SectionHead title="Outreach" hint="Review what the scout pulled, then reach out to the organisers behind it." />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 font-body text-[14px]">
          <span className="text-dim">You are:</span>
          <input aria-label="Your name, used in the log" className="!w-32 !py-2" value={by} maxLength={30} onChange={(e) => setBy(e.target.value)} onBlur={() => !by.trim() && setBy("Jae")} />
        </label>
        <div className="flex-1" />
        <button type="button" className="btn btn-ghost min-h-[44px] w-11 px-0" aria-label="Refresh" title="Refresh" onClick={() => void data.reload()}>
          <RefreshCw size={16} className={clsx(data.loading && "animate-spin")} aria-hidden />
        </button>
      </div>

      {note && (
        <div
          role={note.tone === "error" ? "alert" : "status"}
          className={clsx("mb-3 flex items-start gap-2 rounded-hz border px-3 py-2 font-body text-[14px]", note.tone === "error" ? "border-fireant text-fireant" : "border-keke text-keke")}
        >
          <p className="min-w-0 flex-1 whitespace-pre-line">{note.text}</p>
          <button type="button" aria-label="Close" className="-m-2 grid h-11 w-11 place-items-center" onClick={() => setNote(null)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Outreach" className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`outreach-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="outreach-panel"
            onClick={() => (setTab(t.key), setFocus(null))}
            className={clsx("chip !min-h-[44px] !px-4 !font-body !text-[14px] !normal-case !tracking-normal", tab === t.key && "chip-on")}
          >
            {t.label}
            {!!t.n && <span className={clsx("font-bold", tab !== t.key && "text-orange")}>{t.n}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="outreach-panel" aria-labelledby={`outreach-tab-${tab}`}>
        {!ctx ? (
          <Loading />
        ) : (
          <OutreachContext.Provider value={ctx}>
            {tab === "review" && <ReviewTab />}
            {tab === "organisers" && <OrganisersTab focus={focus} />}
            {tab === "week" && <WeekTab onOpen={(id) => openOrganiser(id)} />}
          </OutreachContext.Provider>
        )}
      </div>
    </>
  );
}
