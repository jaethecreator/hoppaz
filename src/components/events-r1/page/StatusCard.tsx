"use client";

import { useEffect, useState } from "react";
import { Clock, Send } from "lucide-react";
import { useR1Api, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, ViewerState } from "@/lib/events-r1/types";
import JoinCall from "./JoinCall";
import { hasOnline } from "./link";
import { eventUrl, shareOrCopy } from "./share";
import { startsIn } from "./time";
import YoureGoing from "./YoureGoing";

const ROW = "btn btn-ghost w-full justify-start gap-2.5 normal-case";

/**
 * Where the Register button turns into once you have done something: You're going (the host's room card, the long ticket stub with countdown
 * and QR, Add to calendar and Event chat; then the call, invite, cancel; the big "You're going" header only right after registering here), Pending (the host's message), On the waitlist (your place) or Declined.
 */
export default function StatusCard({ event, viewer, fresh = false }: { event: R1Event; viewer: ViewerState; fresh?: boolean }) {
  const reg = viewer.registration;
  const api = useR1Api();
  const now = useR1Now();
  const { data: settings } = useR1Query((a) => a.events.getRegistrationSettings(event.id), [event.id]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");

  useEffect(() => {
    if (!invite) return;
    const t = window.setTimeout(() => setInvite(""), 2200);
    return () => window.clearTimeout(t);
  }, [invite]);

  if (!reg) return null;
  const going = reg.status === "going" || reg.status === "checked_in";
  const online = hasOnline(event);
  // With more than one ticket type the card says which one this is.
  const typeName = event.ticket_types?.length > 1 ? reg.ticket_name : "";
  // A paid ticket is undone by a refund from the host, not by the buyer.
  const paidTicket = going && (event.ticket_types?.find((t) => t.id === reg.ticket_type_id)?.price_naira ?? 0) > 0;

  const title = reg.status === "requested" ? "Pending" : reg.status === "waitlisted" ? "On the waitlist" : "Declined";
  const note =
    reg.status === "requested"
      ? settings?.messages.pending
      : reg.status === "declined"
        ? settings?.messages.declined
        : reg.status === "waitlisted"
          ? reg.waitlist_pos
            ? `You are number ${reg.waitlist_pos} in line. We will tell you if a place opens.`
            : "We will tell you if a place opens."
          : null;

  const cancel = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.registrations.cancel(event.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
      setBusy(false);
      setConfirming(false);
    }
  };

  const doInvite = async () => {
    const url = eventUrl(event, api?.registrations.inviteRef(event.id));
    const res = await shareOrCopy({ title: event.title, text: `Come to ${event.title} with me`, url });
    if (res === "copied") setInvite("Copied");
    else if (res === "shared") setInvite("Shared");
    else if (res === "failed") setInvite("Could not copy");
  };

  return (
    <div className={going ? "" : "rounded-hz border border-line bg-ink-3 p-4"}>
      {going ? (
        <YoureGoing
          event={event}
          reg={reg}
          header={fresh}
          cover={false}
          qr={event.kind !== "online"}
          kicker={reg.status === "checked_in" ? undefined : [startsIn(event, now), online ? "Online" : ""].filter(Boolean).join(" · ")}
        />
      ) : (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full border border-line text-dim" aria-hidden>
            <Clock size={16} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[24px] font-black leading-tight">{title}</p>
            {typeName && <p className="font-body text-[14px] text-dim">{typeName}</p>}
            {note && <p className="mt-1 font-body text-[14px] leading-snug text-dim">{note}</p>}
          </div>
        </div>
      )}

      {going && online && viewer.canSeeOnlineLink && (
        <div className="mt-4">
          <JoinCall event={event} viewer={viewer} now={now} />
        </div>
      )}

      {going && (
        <div className="mt-4 space-y-2">
          <button type="button" onClick={() => void doInvite()} className={ROW}>
            <Send size={16} className="text-orange" aria-hidden /> Invite a friend
            {invite && <span className="ml-auto font-body text-[13px] font-normal text-dim">{invite}</span>}
          </button>
        </div>
      )}

      {paidTicket && reg.status !== "checked_in" && <p className="mt-4 border-t border-line pt-3 font-body text-[13px] text-dim">You paid for this ticket. Ask the host if you need a refund.</p>}

      {reg.status !== "declined" && reg.status !== "checked_in" && !paidTicket && (
        <div className="mt-4 border-t border-line pt-3">
          {confirming ? (
            <div role="group" aria-label="Cancel registration">
              <p className="font-body text-[14px]">{going ? "Give up your place?" : "Cancel your request?"}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void cancel()} disabled={busy} className="btn btn-ghost flex-1 normal-case">
                  Yes, cancel
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="btn flex-1 normal-case">
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4">
              Cancel registration
            </button>
          )}
          {error && (
            <p role="alert" className="mt-1 font-body text-[13px] text-fireant">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
