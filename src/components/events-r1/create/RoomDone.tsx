"use client";

/* eslint-disable @next/next/no-img-element -- the room's logo is a data URL or a bucket link */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { R1Event, RoomSummary } from "@/lib/events-r1/types";
import { siteOrigin } from "@/lib/events-r1/siteUrl";
import { copyText } from "../page/share";

/** hoppaz.fun/r/<slug> as shown (the site's own address while testing on another host). */
export const roomLinkText = (slug: string) => `${siteOrigin().replace(/^https?:\/\//, "")}/r/${slug}`;

/**
 * After creating a room (build brief section 13, wireframe E3): "Your room is live" with the link and Copy, then, first and loudest,
 * "Bring your N guests in" (only when N is more than 0: the people who went to the room's events and are not members), then the to-do
 * list, then Open my room.
 */
export default function RoomDone({
  room, logo, guests, event, onClose,
}: { room: RoomSummary; logo: string | null; guests: number; event: R1Event | null; onClose?: () => void }) {
  const router = useRouter();
  const api = useR1Api();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const link = roomLinkText(room.slug);
  const show = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(""), 2000);
  };
  const open = () => {
    onClose?.();
    router.push(`/rooms/${encodeURIComponent(room.slug)}`);
  };
  /** One tap invites everyone going to the room's latest event: a Pop to the event's guests with the room's link. */
  const bring = async () => {
    if (!api || !event || busy || sent) return;
    setBusy(true);
    try {
      await api.pops.send({ eventId: event.id, body: `Join ${room.name} on Hoppaz: ${link}`, audience: "everyone", alsoRoom: false });
      setSent(true);
      show(`Invited ${guests} ${guests === 1 ? "guest" : "guests"}`);
    } catch (e) {
      show(e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };
  const todo: Array<[string, string, () => void]> = [
    ["Post your next event here", "Create", () => router.push(`/create?mode=event&room=${encodeURIComponent(room.id)}`)],
    ["Write a welcome announcement", "Write", () => { onClose?.(); router.push(`/rooms/${encodeURIComponent(room.slug)}/admin?tab=announcements`); }],
    ["Add admins to help run it", "Add", () => { onClose?.(); router.push(`/rooms/${encodeURIComponent(room.slug)}/admin?tab=members`); }],
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 lg:items-center lg:p-4" role="dialog" aria-modal="true" aria-label="Your room is live" data-room-done>
      <div className="max-h-[92dvh] w-full max-w-[460px] overflow-y-auto overscroll-contain rounded-t-hz bg-t-solid pb-[calc(76px+env(safe-area-inset-bottom))] shadow-2xl lg:rounded-hz lg:pb-0">
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          {logo ? (
            <img src={logo} alt="" className="h-[52px] w-[52px] flex-none rounded-hz border border-t-line object-cover" />
          ) : (
            <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-hz bg-t-accent font-display text-[22px] font-black text-t-on">{room.name[0]?.toUpperCase()}</span>
          )}
          <div className="grid min-w-0 gap-0.5">
            <b className="font-display text-[22px] font-black leading-tight">Your room is live</b>
            <span className="truncate font-body text-[13.5px] text-t-muted">{room.name}</span>
          </div>
        </div>
        <div className="mx-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <code className="truncate rounded-hz border border-t-line bg-t-bg px-3 py-2.5 font-mono text-[13px]" data-room-link>
            {link}
          </code>
          <button type="button" className="lip-ghost" onClick={async () => show((await copyText(`${siteOrigin()}/r/${room.slug}`)) ? "Link copied" : "Copy failed")}>
            Copy
          </button>
        </div>
        <div className="grid gap-2 px-5 pt-4">
          {guests > 0 && (
            <button
              type="button"
              onClick={bring}
              disabled={busy || !event}
              className="relative grid grid-cols-[40px_1fr_auto] items-center gap-3 overflow-hidden rounded-hz border-2 border-t-accent bg-gradient-to-br from-[var(--t-soft)] to-[var(--t-tile)] p-3.5 text-left shadow-lip"
              data-bring
            >
              <span className="grid h-10 w-10 place-items-center rounded-hz bg-t-accent text-[18px] text-t-on">✦</span>
              <span>
                <b className="block font-display text-[15.5px] font-extrabold leading-tight text-t-accent">
                  Bring your {guests} {guests === 1 ? "guest" : "guests"} in
                </b>
                <small className="mt-0.5 block font-body text-[12.5px] text-t-muted">{event ? `Everyone going to ${event.title} gets an invite` : "They went to your events and are not in yet"}</small>
              </span>
              <span className="rounded-hz bg-t-accent px-3 py-2 font-display text-[13px] font-extrabold text-t-on">{sent ? "Sent" : busy ? "Sending" : "Invite all"}</span>
            </button>
          )}
          <span className="pt-2 font-body text-[12.5px] font-bold text-t-muted">Next</span>
          {todo.map(([t, cta, go]) => (
            <button key={t} type="button" onClick={go} className="flex items-center gap-3 rounded-hz border border-t-line bg-t-bg px-3 py-2.5 text-left font-body text-[14px]">
              <i className="h-5 w-5 rounded-[5px] border-2 border-t-line" />
              {t}
              <em className="ml-auto font-body text-[13px] font-bold not-italic text-t-accent">{cta}</em>
            </button>
          ))}
        </div>
        <div className="p-5">
          <button type="button" className="lip w-full" onClick={open} data-open-room>
            Open my room
          </button>
        </div>
      </div>
      {note && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
          {note}
        </div>
      )}
    </div>
  );
}
