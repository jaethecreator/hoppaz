"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Clock, MessageCircle, Send } from "lucide-react";
import { useR1Api, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, ViewerState } from "@/lib/events-r1/types";
import { downloadIcs, googleCalendarUrl } from "./calendar";
import JoinCall from "./JoinCall";
import { hasOnline } from "./link";
import { eventUrl, shareOrCopy } from "./share";
import { startsIn } from "./time";
import TicketQr from "./TicketQr";

const ROW = "btn btn-ghost w-full justify-start gap-2.5 normal-case";

/**
 * Where the Register button turns into once you have done something: You're in (countdown, QR ticket, the call,
 * calendar, invite, chat, cancel), Pending (the host's message), On the waitlist (your place) or Declined.
 */
export default function StatusCard({ event, viewer }: { event: R1Event; viewer: ViewerState }) {
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
  // An online-only event has no door, so no ticket to scan.
  const ticket = going && event.kind !== "online";

  const title = going ? "You're in" : reg.status === "requested" ? "Pending" : reg.status === "waitlisted" ? "On the waitlist" : "Declined";
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
    <div className="rounded-hz border border-line bg-ink-3 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full border ${going ? "border-keke text-keke" : "border-line text-dim"}`}
          aria-hidden
        >
          {going ? <Check size={17} strokeWidth={3} /> : <Clock size={16} />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[24px] font-black leading-tight">{title}</p>
          {going && (
            <p className="font-body text-[14px] text-dim" aria-live="polite">
              {reg.status === "checked_in" ? "Checked in" : startsIn(event, now)}
              {online && " · Online"}
            </p>
          )}
          {note && <p className="mt-1 font-body text-[14px] leading-snug text-dim">{note}</p>}
        </div>
      </div>

      {ticket && (
        <div className="mt-4">
          <TicketQr eventId={event.id} regKey={`${reg.id}:${reg.status}`} />
        </div>
      )}

      {going && online && viewer.canSeeOnlineLink && (
        <div className="mt-4 border-t border-line pt-4">
          <JoinCall event={event} viewer={viewer} now={now} />
        </div>
      )}

      {going && (
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => downloadIcs(event)} className="btn btn-ghost gap-1.5 px-2 normal-case">
              <CalendarPlus size={16} className="flex-none text-orange" aria-hidden /> Add to calendar
            </button>
            <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer noopener" className="btn btn-ghost px-2 normal-case">
              Google Calendar
            </a>
          </div>
          <button type="button" onClick={() => void doInvite()} className={ROW}>
            <Send size={16} className="text-orange" aria-hidden /> Invite a friend
            {invite && <span className="ml-auto font-body text-[13px] font-normal text-dim">{invite}</span>}
          </button>
          <Link href={`/chat?c=${encodeURIComponent(event.id)}`} className={ROW}>
            <MessageCircle size={16} className="text-orange" aria-hidden /> Open event chat
          </Link>
        </div>
      )}

      {reg.status !== "declined" && reg.status !== "checked_in" && (
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
