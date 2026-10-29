"use client";

import clsx from "clsx";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { Qr } from "@/components/events-r1/host/OverviewTab";
import { copyText } from "@/components/events-r1/page/share";
import { QUESTS_ON } from "@/lib/events-r1/flags";
import { useAnnouncements, useR1Now, useR1Query, useRoomEvents } from "@/lib/events-r1/hooks";
import type { Look } from "@/lib/events-r1/looks";
import type { RoomSummary } from "@/lib/events-r1/types";
import { useInviteLink } from "./useInviteLink";
import { isPast, tileOf, whenLine } from "../words";
import { Card, Tile, useFlashLine } from "./ui";

const WEEK = 7 * 864e5;

/**
 * Overview: bring in the guests who have not joined (first and loudest, only when there are some), the counts, the invite link,
 * "Grow your room" (each step jumps to the tab where it is done) and what is coming up. The design's 8 week growth chart is not here:
 * the room's count has no history behind it, only the join date of each member who is listed.
 */
export default function OverviewTab({ room, look, onTab }: { room: RoomSummary; look: Look; onTab: (t: string) => void }) {
  const now = useR1Now();
  const guests = useR1Query((a) => a.rooms.guestsNotJoined(room.id), [room.id]);
  const members = useR1Query((a) => a.rooms.members(room.id), [room.id]);
  const events = useRoomEvents(room.id);
  const chat = useR1Query((a) => a.rooms.messages(room.id, "general"), [room.id]);
  const anns = useAnnouncements(room.id);
  const link = useInviteLink(room);
  const [said, say] = useFlashLine();
  const [qr, setQr] = useState(false);

  const n = guests.data?.count ?? 0;
  const live = (events.data ?? []).filter((e) => e.status !== "cancelled");
  const upcoming = live.filter((e) => !isPast(e, now)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const fresh = (members.data ?? []).filter((m) => now - Date.parse(m.joined_at) < WEEK).length;
  // General chat only (event chats are their own); the data layer hands over its last 80 lines.
  const lines = chat.data ? chat.data.filter((m) => now - Date.parse(m.created_at) < WEEK).length : null;
  const plainAnns = (anns.data ?? []).filter((a) => !a.event_id);

  const copy = async () => say((await copyText(link.url)) ? "Copied" : "Could not copy");
  const text = `Join ${room.name} on Hoppaz: ${link.url}`;

  const steps: Array<{ id: string; label: string; done: boolean; tab: string }> = [
    { id: "look", label: "Add your logo and look", done: !!room.logo_url, tab: "profile" },
    { id: "about", label: "Say what the room is about", done: !!room.about.trim(), tab: "profile" },
    { id: "ann", label: "Post your first announcement", done: plainAnns.length > 0, tab: "announcements" },
    { id: "next", label: "Plan your next event", done: upcoming.length > 0, tab: "events" },
    { id: "twod", label: "Open your 2D room", done: look.two_d?.on !== false && room.has_3d, tab: "twod" },
  ];
  if (QUESTS_ON) steps.push({ id: "quests", label: "Switch on room quests", done: false, tab: "quests" });
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-4">
      {n > 0 && (
        <button type="button" onClick={() => onTab("members")} className="t-card flex items-center gap-4 border-2 !border-t-accent p-4 text-left shadow-lip" data-bring-in>
          <span className="grid h-12 w-12 flex-none place-items-center rounded-hz bg-t-accent text-t-on">
            <Sparkles size={20} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <b className="t-title block text-[17px] font-extrabold leading-tight text-t-accent">
              Bring your {n.toLocaleString("en-NG")} {n === 1 ? "guest" : "guests"} in
            </b>
            <span className="mt-0.5 block font-body text-[13.5px] text-t-muted">They went to your events but haven&apos;t joined yet. One tap sends them an invite.</span>
          </span>
          <span className="lip flex-none !px-5">Invite</span>
        </button>
      )}

      <section aria-label="Counts" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile n={room.members.toLocaleString("en-NG")} label={room.members === 1 ? "member" : "members"} extra={fresh > 0 ? `+${fresh} this week` : undefined} />
        <Tile n={live.length.toLocaleString("en-NG")} label={live.length === 1 ? "event" : "events"} />
        {lines !== null && <Tile n={chat.data && chat.data.length >= 80 && lines >= 80 ? "80+" : String(lines)} label="chat messages this week" />}
      </section>

      <Card title="Invite link" aside={`Anyone with it can ${room.join_mode === "open" ? "join" : room.join_mode === "ask" ? "ask to join" : "join"}`}>
        <div className="flex items-stretch gap-2">
          <p className="flex min-h-[44px] min-w-0 flex-1 items-center truncate rounded-hz border border-t-line bg-t-bg px-3 font-mono text-[13.5px]" data-invite-link>
            {link.shown}
          </p>
          <button type="button" onClick={() => void copy()} className="lip-ghost flex-none !px-4">
            Copy
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="lip-ghost">
            WhatsApp
          </a>
          <button type="button" className="lip-ghost" aria-expanded={qr} onClick={() => setQr(!qr)}>
            QR code
          </button>
        </div>
        {qr && link.url && <Qr url={link.url} title={room.name} />}
        <p className={clsx("font-body text-[13px] text-t-muted", said && "mt-2")} aria-live="polite">
          {said}
        </p>
      </Card>

      <Card title="Grow your room" aside={`${done} of ${steps.length} done`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-t-soft" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
          <i className="block h-full rounded-full bg-t-accent transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {steps.map((s) => (
            <li key={s.id} className="rounded-hz border border-t-line bg-t-bg">
              <button type="button" onClick={() => onTab(s.tab)} className="flex min-h-[52px] w-full items-center gap-3 px-3 text-left" data-grow={s.id}>
                <span className={clsx("grid h-6 w-6 flex-none place-items-center rounded-[5px] border-2", s.done ? "border-t-accent bg-t-accent text-t-on" : "border-t-line text-transparent")} aria-hidden>
                  <Check size={14} strokeWidth={3.5} />
                </span>
                <span className={clsx("min-w-0 flex-1 font-body text-[15px] font-bold", s.done && "text-t-muted line-through")}>{s.label}</span>
                <span className="flex-none font-body text-[14px] font-extrabold text-t-accent">{s.done ? "Edit" : "Start"}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Coming up" aside="Times in Lagos">
        <ul className="divide-y divide-t-line">
          {upcoming.slice(0, 4).map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onTab("events")} className="flex min-h-[48px] w-full items-center gap-3 py-2 text-left">
                <span className="w-16 flex-none font-mono text-[13px] text-t-accent">
                  {tileOf(e.starts_at).mon} {tileOf(e.starts_at).day}
                </span>
                <span className="min-w-0 flex-1 truncate font-body text-[14.5px]">
                  {e.title} <span className="text-t-muted">· {whenLine({ ...e, venue_name: "" })}</span>
                </span>
              </button>
            </li>
          ))}
          {room.pending_requests > 0 && (
            <li>
              <button type="button" onClick={() => onTab("members")} className="flex min-h-[48px] w-full items-center gap-3 py-2 text-left">
                <span className="w-16 flex-none font-mono text-[13px] text-t-accent">Waiting</span>
                <span className="font-body text-[14.5px]">
                  {room.pending_requests} {room.pending_requests === 1 ? "person asked" : "people asked"} to join
                </span>
              </button>
            </li>
          )}
        </ul>
        {upcoming.length === 0 && room.pending_requests === 0 && <p className="font-body text-[14px] text-t-muted">Nothing coming up. Post an event and your members hear about it first.</p>}
      </Card>
    </div>
  );
}
