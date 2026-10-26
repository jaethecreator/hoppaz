"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { copyText, eventUrl } from "../page/share";

/**
 * After creating (build brief section 11, "The room push"). The room comes first and loudest: a host with a room invites it,
 * a host who posted as themselves is asked "Where do your guests go after the night?". The rest is optional.
 */
export default function DoneSheet({ event, roomName, onNewRoom }: { event: R1Event; roomName: string | null; onNewRoom: () => void }) {
  const router = useRouter();
  const api = useR1Api();
  const [pop, setPop] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const url = eventUrl(event);
  const show = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(""), 1800);
  };
  const invite = async () => {
    if (!api || sent) return;
    try {
      await api.pops.send({ eventId: event.id, body: `New from ${roomName}: ${event.title}. Get your spot.`, audience: "everyone", alsoRoom: true });
      setSent(true);
      show("Sent to your room");
    } catch (e) {
      show(e instanceof Error ? e.message : "Try again");
    }
  };
  const view = () => {
    if (!roomName) setPop(true);
    else router.push(`/event/${event.slug || event.id}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 lg:items-center" role="dialog" aria-modal="true" aria-label="Your event is live">
      {!pop ? (
        <div className="w-full max-w-[460px] rounded-t-hz bg-t-solid shadow-2xl lg:rounded-hz">
          <div className="grid gap-1 px-5 pb-3 pt-5">
            <b className="font-display text-[22px] font-black">Your event is live</b>
            <span className="font-body text-[13.5px] text-t-muted">{event.title}</span>
          </div>
          <div className="mx-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <code className="truncate rounded-hz border border-t-line bg-t-bg px-3 py-2.5 font-mono text-[13px]">{url.replace(/^https?:\/\//, "")}</code>
            <button type="button" className="lip-ghost" onClick={async () => show((await copyText(url)) ? "Link copied" : "Copy failed")}>
              Copy
            </button>
          </div>
          <div className="grid gap-2 px-5 pt-4">
            <button type="button" onClick={roomName ? invite : () => setPop(true)} className="room-cta relative grid grid-cols-[40px_1fr_auto] items-center gap-3 overflow-hidden rounded-hz border-2 border-t-accent bg-gradient-to-br from-[var(--t-soft)] to-[var(--t-tile)] p-3.5 text-left shadow-lip">
              <span className="grid h-10 w-10 place-items-center rounded-hz bg-t-accent text-[18px] text-t-on">✦</span>
              <span>
                <b className="block font-display text-[15.5px] font-extrabold leading-tight text-t-accent">{roomName ? `Invite your ${roomName} room` : "Give your guests a room"}</b>
                <small className="mt-0.5 block font-body text-[12.5px] text-t-muted">
                  {roomName ? "Members get this event, the chat and its quests" : "One link for every future event. Who's in it?"}
                </small>
              </span>
              <span className="rounded-hz bg-t-accent px-3 py-2 font-display text-[13px] font-extrabold text-t-on">{roomName ? (sent ? "Sent" : "Invite") : "Start"}</span>
            </button>
            <span className="pt-2 font-body text-[12.5px] font-bold text-t-muted">Make it shine (all optional)</span>
            {["Write a description", "Add the lineup or programme", "Set ticket tiers and prices", "Add quests for guests"].map((t) => (
              <button key={t} type="button" onClick={() => router.push(`/host/${event.id}?new=1`)} className="flex items-center gap-3 rounded-hz border border-t-line bg-t-bg px-3 py-2.5 text-left font-body text-[14px]">
                <i className="h-5 w-5 rounded-[5px] border-2 border-t-line" />
                {t}
                <em className="ml-auto font-body text-[13px] font-bold not-italic text-t-accent">Add</em>
              </button>
            ))}
          </div>
          <div className="grid gap-2 p-5">
            <button type="button" className="lip w-full" onClick={view}>
              See your event page
            </button>
            <button type="button" className="font-body text-[14px] font-bold text-t-muted" onClick={() => router.push(`/host/${event.id}?new=1`)}>
              Manage event
            </button>
          </div>
        </div>
      ) : (
        <div className="relative grid w-full max-w-[440px] gap-3 rounded-t-hz bg-t-solid px-6 pb-7 pt-6 shadow-2xl lg:rounded-hz">
          <div className="relative mx-auto h-20 w-48" aria-hidden>
            <span className="absolute left-2 top-5 h-11 w-11 rounded-full border-2 border-t-solid bg-t-soft" />
            <span className="absolute left-12 top-2 h-11 w-11 rounded-full border-2 border-t-solid bg-t-line" />
            <span className="absolute right-4 top-5 h-11 w-11 rounded-full border-2 border-t-solid bg-t-soft" />
            <b className="absolute left-[84px] top-3 grid h-14 w-14 rotate-6 place-items-center rounded-hz bg-t-accent font-display text-[24px] font-black text-t-on shadow-lip">?</b>
          </div>
          <b className="text-balance font-display text-[21px] font-black leading-tight">Where do your guests go after the night?</b>
          <p className="font-body text-[14px] text-t-muted">
            Right now, nowhere. Give them a room: one link where every future event, announcement, chat and quest finds them, without you chasing anyone on WhatsApp.
          </p>
          <div className="grid gap-2">
            {["Your next event reaches them automatically", "They chat, plan and bring friends", "Your look, your logo, set up in a minute"].map((t, i) => (
              <div key={t} className="flex items-center gap-2.5 font-body text-[14px] font-semibold">
                <i className="grid h-6 w-6 flex-none place-items-center rounded-hz bg-t-soft font-display text-[12px] font-extrabold not-italic text-t-accent">{i + 1}</i>
                {t}
              </div>
            ))}
          </div>
          <button type="button" className="lip mt-1 w-full !min-h-[50px]" onClick={onNewRoom}>
            Set up my room
          </button>
          <button type="button" className="py-1.5 font-body text-[14px] font-semibold text-t-muted" onClick={() => router.push(`/event/${event.slug || event.id}`)}>
            Not now, show my event
          </button>
        </div>
      )}
      {note && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
          {note}
        </div>
      )}
    </div>
  );
}
