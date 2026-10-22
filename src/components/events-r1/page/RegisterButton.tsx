"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Settings2 } from "lucide-react";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import type { R1Event } from "@/lib/events-r1/types";
import SignInSheet from "../SignInSheet";
import HostStrip from "./HostStrip";
import QuestionsForm from "./QuestionsForm";
import TicketPicker from "./TicketPicker";
import StatusCard from "./StatusCard";
import { useFreshEvent } from "./useFreshEvent";
import { useRegisterFlow } from "./useRegisterFlow";

/**
 * The one button on an event, and everything a tap on it leads to, inline: sign in (when signed out), the host's
 * questions (when there are any), then the registration. Used by the event page and by the map and Events card.
 *
 * On the event page the area then becomes the status card (You're in, Pending, On the waitlist, Declined), or the host
 * strip for the host. On a card it stays a button that says where you stand and opens the event page for the rest.
 * `trailing` sits beside the button in the same row (the card's "Open event page").
 */
export default function RegisterButton({
  event: given,
  placement,
  trailing,
}: {
  event: R1Event;
  placement: "sheet" | "side" | "page";
  trailing?: React.ReactNode;
}) {
  const event = useFreshEvent(given);
  const flow = useRegisterFlow(event);
  const { viewer, label, phase } = flow;
  const page = placement === "page";
  const side = placement === "side";

  // ?register=1 on the event page (a shared "Register" link) starts the flow once, then drops the mark from the address.
  const auto = useRef(false);
  const { ready, start } = flow;
  const registered = !!viewer?.registration;
  const host = !!viewer?.isHost;
  useEffect(() => {
    if (!page || auto.current || !ready) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("register") !== "1") return;
    auto.current = true;
    url.searchParams.delete("register");
    window.history.replaceState(window.history.state, "", url);
    if (!host && !registered) start();
  }, [page, ready, host, registered, start]);

  const busy = phase === "busy";
  const btn = "btn normal-case";
  let body: React.ReactNode;

  if (host && page && viewer) {
    body = <HostStrip event={event} viewer={viewer} />;
  } else if (page && viewer?.registration) {
    body = <StatusCard event={event} viewer={viewer} />;
  } else if (phase === "form") {
    body = (
      <QuestionsForm
        questions={flow.questions}
        who={flow.user?.name ?? null}
        busy={busy}
        submitText={label.text}
        onSubmit={(answers) => void flow.submit(answers, true)}
        onCancel={flow.cancel}
      />
    );
  } else {
    let main: React.ReactNode;
    if (host) {
      main = (
        <Link href={`/host/${encodeURIComponent(event.id)}`} className={clsx(btn, !side && "flex-1")}>
          <Settings2 size={15} aria-hidden /> Manage
        </Link>
      );
    } else if (label.disabled) {
      main = (
        <button type="button" disabled className={clsx(btn, !side && "flex-1")}>
          {label.text}
        </button>
      );
    } else if (label.status) {
      main = (
        <Link href={`/event/${encodeURIComponent(event.id)}`} className={clsx(btn, "btn-ghost border-keke text-keke", !side && "flex-1")}>
          {label.text}
        </Link>
      );
    } else {
      main = (
        <button type="button" onClick={flow.start} disabled={!flow.ready || busy} aria-busy={busy} className={clsx(btn, !side && "flex-1")}>
          {label.text}
        </button>
      );
    }
    body = (
      <>
        {flow.multi && !host && !label.status && (
          <TicketPicker event={event} value={flow.selected?.id ?? null} onChange={flow.selectType} disabled={busy} />
        )}
        <div className={clsx("gap-2", side ? "grid" : "flex")}>
          {main}
          {trailing}
        </div>
        {label.kind === "get_ticket" && !host && <p className="hint mt-2">{PAID_UNAVAILABLE}</p>}
      </>
    );
  }

  return (
    <div className="mt-4">
      {body}
      {flow.error && (
        <p role="alert" className="mt-2 font-body text-[13px] text-fireant">
          {flow.error}
        </p>
      )}
      <SignInSheet
        open={phase === "signin"}
        reason={`Register for ${event.title}`}
        onClose={flow.cancel}
        onSignedIn={() => void flow.proceed()}
      />
    </div>
  );
}
