"use client";

import { useState } from "react";
import { popWhen } from "@/components/events-r1/page/time";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Pop } from "@/lib/events-r1/types";
import { CARD, ErrorLine, Pill, useFlash } from "../ui";
import { errWord } from "../words";
import { shareToWhatsApp } from "./share";
import { peopleWord, toWord } from "./words";

const LINK = "inline-flex min-h-[44px] items-center font-body text-[14px] text-orange underline underline-offset-4 disabled:opacity-50";

function Heading({ children }: { children: string }) {
  return <h2 className="mb-2 font-display text-[16px] font-black">{children}</h2>;
}

/** Sent Pops, newest first (the caller sorts). */
export function SentList({ pops }: { pops: Pop[] }) {
  const api = useR1Api();
  const [said, say] = useFlash();

  const share = async (p: Pop) => {
    if (!api) return;
    try {
      const r = await shareToWhatsApp(await api.pops.shareText(p.id));
      say(r === "copied" ? "Copied" : "Could not copy");
    } catch {
      say("Could not copy");
    }
  };

  return (
    <section aria-label="Sent">
      <Heading>Sent</Heading>
      {pops.length === 0 ? (
        <p className="hint">Nothing sent yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pops.map((p) => (
            <li key={p.id} className={CARD} data-pop="sent">
              <p className="whitespace-pre-line break-words font-body text-[15px] leading-snug">{p.body}</p>
              <p className="mt-2 font-body text-[13px] text-dim">
                {toWord(p.audience)} · {popWhen(p.sent_at)} · {peopleWord(p.recipients)}
              </p>
              <div className="flex flex-wrap items-center gap-x-4">
                {p.also_room && <Pill>Also in Announcements</Pill>}
                <button type="button" className={LINK} onClick={() => void share(p)}>
                  Share to WhatsApp
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-1" aria-live="polite">
        {said}
      </p>
    </section>
  );
}

/** Scheduled Pops, soonest first, each with a Cancel link. */
export function ScheduledList({ pops }: { pops: Pop[] }) {
  const api = useR1Api();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const cancel = async (p: Pop) => {
    if (!api || busy) return;
    setBusy(p.id);
    setError("");
    try {
      await api.pops.cancelScheduled(p.id);
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy("");
    }
  };

  if (pops.length === 0) return null;
  return (
    <section aria-label="Scheduled">
      <Heading>Scheduled</Heading>
      <ul className="flex flex-col gap-2">
        {pops.map((p) => (
          <li key={p.id} className={CARD} data-pop="scheduled">
            <p className="whitespace-pre-line break-words font-body text-[15px] leading-snug">{p.body}</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 font-body text-[13px] text-dim">
                {toWord(p.audience)} · {popWhen(p.send_at)}
                {p.also_room ? " · Also in Announcements" : ""}
              </p>
              <button type="button" className={LINK} disabled={busy === p.id} onClick={() => void cancel(p)}>
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}
