"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { Organiser } from "@/lib/events-r1/types";
import { igUrl, lastContact } from "./format";
import OrganiserPanel, { type Mode } from "./OrganiserPanel";
import { Btn, StageTag, Tag } from "./ui";
import type { FocusRequest } from "./useOutreach";

/**
 * One line of the tracker. The buttons on the line are the routine: copy the message, open their Instagram, log that you contacted
 * them. Everything else is in the panel under the line (tap the name).
 */
export default function OrganiserRow({ org, open, onToggle, focus }: { org: Organiser; open: boolean; onToggle: (open: boolean) => void; focus?: FocusRequest }) {
  const [mode, setMode] = useState<Mode>(null);
  const [copyKey, setCopyKey] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const seen = useRef(0);

  // A request from outside (a claim request, the week page) opens the panel, straight into the action it asked for.
  useEffect(() => {
    if (!focus || focus.id !== org.id || seen.current === focus.n) return;
    seen.current = focus.n;
    if (focus.mode === "message") {
      setMode("message");
      setCopyKey((k) => k + 1);
    } else setMode(focus.mode ?? null);
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus, org.id]);

  const copyMessage = () => {
    onToggle(true);
    setMode("message");
    setCopyKey((k) => k + 1);
  };
  const declined = org.stage === "declined" || org.do_not_contact;

  return (
    <section ref={ref} aria-label={org.name} className={clsx("card mb-2 scroll-mt-4 !p-3", open && "border-orange/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(!open)}
          className="min-h-[44px] min-w-0 flex-1 basis-[200px] text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words font-display text-[15px] font-bold">{org.name}</span>
            <StageTag stage={org.stage} />
            {org.transfer_pending && <Tag tone="pill-violet">Link open</Tag>}
            {org.claim_requests > 0 && <Tag tone="pill-danfo">{org.claim_requests} asked to claim</Tag>}
          </span>
          <span className="hint mt-0.5 block">
            {org.events_upcoming} upcoming · {lastContact(org)}
            {org.pulled_waiting > 0 && ` · ${org.pulled_waiting} to review`}
          </span>
        </button>
        {!open && !declined && org.stage !== "claimed" && (
          <div className="flex flex-wrap gap-2">
            <Btn solid onClick={copyMessage}>
              Copy message
            </Btn>
            {org.ig_handle && (
              <a href={igUrl(org.ig_handle)} target="_blank" rel="noreferrer noopener" className="btn btn-ghost min-h-[44px] px-4 normal-case">
                Instagram ↗
              </a>
            )}
            <Btn
              onClick={() => {
                onToggle(true);
                setMode("contact");
              }}
            >
              I contacted them
            </Btn>
          </div>
        )}
        {(open || declined || org.stage === "claimed") && (
          <Btn onClick={() => onToggle(!open)}>{open ? "Close" : "Open"}</Btn>
        )}
      </div>
      {open && <OrganiserPanel org={org} mode={mode} setMode={setMode} copyKey={copyKey} copyMessage={copyMessage} focus={focus?.id === org.id ? focus : undefined} />}
    </section>
  );
}
