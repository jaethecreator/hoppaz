"use client";

import { useState } from "react";
import { popWhen } from "@/components/events-r1/page/time";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Pop, PopAuto, R1Event } from "@/lib/events-r1/types";
import { CARD, ErrorLine, Pill } from "../ui";
import { errWord } from "../words";
import Switch from "./Switch";
import { autoLabel, AUTO_ORDER, autoState, COUNTER_FROM, POP_MAX } from "./words";
import type { AutoState } from "./words";

const TONE: Record<AutoState, string> = { scheduled: "pill-danfo", sent: "pill-keke", off: "" };
const WORD: Record<AutoState, string> = { scheduled: "Scheduled", sent: "Sent", off: "Off" };

/** Automatic Pops: Day before, 1 hour before, Doors open. Each can be switched off, and its text can be changed until it goes. */
export default function AutoPops({ event, pops, now }: { event: R1Event; pops: Pop[]; now: number }) {
  const api = useR1Api();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PopAuto | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<unknown>): Promise<boolean> => {
    if (!api || busy) return false;
    setBusy(true);
    setError("");
    try {
      await job();
      return true;
    } catch (e) {
      setError(errWord(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (auto: PopAuto) => {
    if (!api || !draft.trim()) return;
    if (await run(() => api.pops.editAuto(event.id, auto, draft))) setEditing(null);
  };

  return (
    <section aria-label="Automatic Pops">
      <h2 className="font-display text-[16px] font-black">Automatic Pops</h2>
      <p className="hint mb-2">Sent to everyone going. Switch one off and it is never sent.</p>
      <ul className="flex flex-col gap-2">
        {AUTO_ORDER.map((auto) => {
          const p = pops.find((x) => x.auto === auto);
          if (!p) return null;
          const state = autoState(p);
          const passed = !!p.send_at && Date.parse(p.send_at) <= now;
          const open = editing === auto;
          return (
            <li key={auto} className={CARD} data-auto={auto} data-state={state}>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 font-body text-[15px] font-bold">{autoLabel(auto, event.kind)}</p>
                <Pill tone={TONE[state]}>{WORD[state]}</Pill>
                <Switch
                  on={state !== "off"}
                  label={`${autoLabel(auto, event.kind)} Pop`}
                  disabled={busy || state === "sent" || (state === "off" && passed)}
                  onChange={(on) => void run(() => api!.pops.setAuto(event.id, auto, on))}
                />
              </div>
              <p className="font-body text-[13px] text-dim">{popWhen(p.sent_at ?? p.send_at)}</p>
              {open ? (
                <div className="mt-2">
                  <label className="sr-only" htmlFor={`auto-${auto}`}>
                    Text
                  </label>
                  <textarea id={`auto-${auto}`} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, POP_MAX))} rows={3} maxLength={POP_MAX} className="w-full resize-none" />
                  <p className="hint mt-1 flex items-center justify-between gap-3">
                    <span>{draft.length >= COUNTER_FROM ? `${draft.length}/${POP_MAX}` : ""}</span>
                    <span className="flex items-center gap-4">
                      <button type="button" className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn px-5 normal-case" disabled={busy || !draft.trim()} onClick={() => void save(auto)}>
                        Save
                      </button>
                    </span>
                  </p>
                </div>
              ) : (
                <>
                  <p className="mt-1.5 whitespace-pre-line break-words font-body text-[15px] leading-snug">{p.body}</p>
                  {state !== "sent" && (
                    <button
                      type="button"
                      className="inline-flex min-h-[44px] items-center font-body text-[14px] text-orange underline underline-offset-4"
                      onClick={() => {
                        setEditing(auto);
                        setDraft(p.body);
                        setError("");
                      }}
                    >
                      Edit text
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}
