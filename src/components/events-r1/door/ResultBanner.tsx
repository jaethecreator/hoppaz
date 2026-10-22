"use client";

import clsx from "clsx";
import { Check, Clock, X } from "lucide-react";
import type { ScanResult } from "@/lib/events-r1/types";
import { lagosClock, NOT_VALID_WORDS, ticketCount } from "./helpers";

/**
 * What the last scan said. Green: checked in. Amber: already in. Red: not valid. Standard mode shows the guest first
 * ("confirm") with Check in and Skip: nobody is checked in until the door person taps Check in.
 */
export default function ResultBanner({
  result,
  busy,
  onConfirm,
  onSkip,
  onClose,
}: {
  result: ScanResult;
  busy: boolean;
  onConfirm: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const more = ticketCount(result);

  if (result.ok && result.kind === "confirm") {
    return (
      <div className="rounded-hz border border-line bg-ink-2 p-4">
        <p className="font-body text-[13px] text-dim">Check this guest in?</p>
        <p className="mt-1 font-display text-[24px] font-black leading-tight">{result.name}</p>
        <p className="font-body text-[15px] text-dim">
          {result.ticket}
          {more ? ` · ${more}` : ""}
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn min-h-[52px] flex-1 text-[16px] normal-case" disabled={busy} onClick={onConfirm}>
            Check in
          </button>
          <button type="button" className="btn btn-ghost min-h-[52px] flex-1 text-[16px] normal-case" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  const tone = result.ok ? "keke" : result.kind === "already_used" ? "danfo" : "fireant";
  const Icon = result.ok ? Check : result.kind === "already_used" ? Clock : X;
  const box = { keke: "border-keke bg-keke/15", danfo: "border-danfo bg-danfo/15", fireant: "border-fireant bg-fireant/15" }[tone];
  const text = { keke: "text-keke", danfo: "text-danfo", fireant: "text-fireant" }[tone];

  let head = "";
  let line = "";
  if (result.ok) {
    head = `Checked in: ${result.name}`;
    line = `${result.ticket}${more ? ` · ${more}` : ""}`;
  } else if (result.kind === "already_used") {
    head = `Already checked in at ${lagosClock(result.at)}`;
    line = result.name;
  } else {
    head = "Not valid";
    line = NOT_VALID_WORDS[result.reason];
  }

  return (
    <div className={clsx("flex items-start gap-3 rounded-hz border-2 p-4", box)}>
      <Icon size={26} strokeWidth={3} className={clsx("mt-0.5 flex-none", text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-[20px] font-black leading-tight text-cream">{head}</p>
        <p className="mt-0.5 font-body text-[15px] text-cream">{line}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-2 -mt-2 grid h-11 w-11 flex-none place-items-center text-dim">
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
