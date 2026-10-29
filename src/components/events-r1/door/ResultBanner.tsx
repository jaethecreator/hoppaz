"use client";

import clsx from "clsx";
import { Check, Clock, X } from "lucide-react";
import type { ScanResult } from "@/lib/events-r1/types";
import { lagosClock, NOT_VALID_WORDS, ticketCount } from "./helpers";

/**
 * What the last scan said. Green: checked in. Amber: already in. Red: not valid. Solid fills and big text so it reads at a glance in a dark club. Standard mode shows the guest first
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
      <div className="t-card p-4">
        <p className="font-body text-[13.5px] text-t-muted">Check this guest in?</p>
        <p className="t-title mt-1 break-words text-[30px] font-extrabold leading-tight text-t-text">{result.name}</p>
        <p className="mt-0.5 font-body text-[19px] font-semibold text-t-text">
          {result.ticket}
          {more ? ` · ${more}` : ""}
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="lip !min-h-[56px] flex-1 !text-[17px]" disabled={busy} onClick={onConfirm}>
            Check in
          </button>
          <button type="button" className="lip-ghost !min-h-[56px] flex-1 !text-[16px]" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Status, not decoration: these colours do not follow the tint, so green, amber and red read the same at the door in any look.
  const tone = result.ok ? "in" : result.kind === "already_used" ? "used" : "bad";
  const Icon = result.ok ? Check : result.kind === "already_used" ? Clock : X;
  const box = { in: "bg-[#14803A] text-white", used: "bg-[#F5B301] text-[#1A1200]", bad: "bg-[#C8262B] text-white" }[tone];

  let head = "";
  let name = "";
  let line = "";
  if (result.ok) {
    head = "Checked in";
    name = result.name;
    line = `${result.ticket}${more ? ` · ${more}` : ""}`;
  } else if (result.kind === "already_used") {
    head = `Already checked in at ${lagosClock(result.at)}`;
    name = result.name;
    line = more ?? "";
  } else {
    head = "Not valid";
    line = NOT_VALID_WORDS[result.reason];
  }

  return (
    <div role="status" data-result={tone} className={clsx("flex items-start gap-3 rounded-hz p-4", box)}>
      <Icon size={34} strokeWidth={3} className="mt-1 flex-none" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-body text-[16px] font-extrabold leading-tight">{head}</p>
        {name && <p className="mt-1 break-words font-body text-[30px] font-extrabold leading-tight">{name}</p>}
        {line && <p className={clsx("font-body font-semibold leading-snug", name ? "mt-0.5 text-[19px]" : "mt-1 text-[19px]")}>{line}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-2 -mt-2 grid h-11 w-11 flex-none place-items-center opacity-80">
        <X size={20} aria-hidden />
      </button>
    </div>
  );
}
