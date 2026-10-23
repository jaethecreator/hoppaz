"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useR1Now } from "@/lib/events-r1/hooks";
import type { R1Event, ViewerState } from "@/lib/events-r1/types";
import JoinCall from "./JoinCall";
import { hasOnline } from "./link";
import { copyText, eventUrl, shareOrCopy } from "./share";

const CELL = "btn btn-ghost min-h-[44px] flex-1 whitespace-nowrap px-2 normal-case";

/**
 * What the host sees where a guest sees Register: a small strip. Manage (the host page comes with the dashboard package),
 * Share and Copy link. A new event (?new=1) says it is live, in one line above.
 */
export default function HostStrip({ event, viewer }: { event: R1Event; viewer: ViewerState }) {
  const now = useR1Now();
  const [fresh, setFresh] = useState(false);
  const [said, setSaid] = useState("");

  useEffect(() => {
    setFresh(new URLSearchParams(window.location.search).get("new") === "1");
  }, []);
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(""), 2200);
    return () => window.clearTimeout(t);
  }, [said]);

  const url = eventUrl(event);
  const share = async () => {
    const res = await shareOrCopy({ title: event.title, text: event.title, url });
    if (res === "copied") setSaid("Copied");
    else if (res === "failed") setSaid("Could not copy");
  };
  const copy = async () => {
    setSaid((await copyText(url)) ? "Copied" : "Could not copy");
  };

  return (
    <div>
      {fresh && (
        <p className="mb-2 flex items-center gap-1.5 font-body text-[14px] text-cream">
          <Check size={15} strokeWidth={3} className="text-keke" aria-hidden /> Your event is live
        </p>
      )}
      <div className="rounded-hz border border-line bg-ink-3 p-3">
        <p className="font-display text-[15px] font-black">You host this event</p>
        <div className="mt-2.5 flex gap-2">
          <Link href={`/host/${encodeURIComponent(event.id)}`} className={CELL}>
            Manage
          </Link>
          <button type="button" onClick={() => void share()} className={CELL}>
            Share
          </button>
          <button type="button" onClick={() => void copy()} className={CELL}>
            Copy link
          </button>
        </div>
        <p className="mt-1.5 h-4 font-body text-[13px] text-dim" aria-live="polite">
          {said}
        </p>
        {hasOnline(event) && (
          <div className="mt-2 border-t border-line pt-3">
            <JoinCall event={event} viewer={viewer} now={now} />
          </div>
        )}
      </div>
    </div>
  );
}
