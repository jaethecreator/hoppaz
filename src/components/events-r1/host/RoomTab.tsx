"use client";

import Link from "next/link";
import { useState } from "react";
import { Toggle } from "@/components/events-r1/create/Fields";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, Registration } from "@/lib/events-r1/types";
import { ErrorLine } from "./ui";
import { countsOf, errWord } from "./words";

/**
 * Room (the old Roomz). No room: "N people are going. Where do they go after the night?" with Set up my room, and, for a host who
 * already has a room, a way to move this event into it. With a room: the room card and the event chat setting. The old Look list
 * is gone: the look lives in Details. Numbers about people who joined the room from this event are not counted by the data
 * layer yet, so they are not shown; "Ask guests to join" has no setting yet and is marked Coming soon.
 */
export default function RoomTab({ event, regs }: { event: R1Event; regs: Registration[] | null }) {
  const api = useR1Api();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const going = regs ? countsOf(regs).going : event.going;
  const room = useR1Query((a) => (event.room_id ? a.rooms.get(event.room_id) : Promise.resolve(null)), [event.room_id]);

  const setRoom = async (on: boolean) => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.events.update(event.id, { add_to_room: on });
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(false);
    }
  };

  if (!event.room_id) {
    const title = going > 0 ? `${going.toLocaleString("en-NG")} ${going === 1 ? "person is" : "people are"} going. Where do they go after the night?` : "Where do your guests go after the night?";
    return (
      <div className="flex flex-col gap-4">
        <section className="rounded-hz border-2 border-dashed border-t-accent bg-t-tile px-5 py-8 text-center lg:py-10" aria-label="Set up a room">
          <div className="mb-4 flex justify-center" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={`-ml-2.5 h-9 w-9 rounded-full border-2 border-t-tile first:ml-0 ${i === 0 ? "bg-t-accent" : "bg-t-soft"}`} />
            ))}
          </div>
          <h3 className="t-title mx-auto max-w-[460px] text-[22px] font-extrabold leading-tight">{title}</h3>
          <p className="mx-auto mt-2 max-w-[460px] font-body text-[14.5px] text-t-muted">A room keeps them: your next event, announcements, chat and quests in one link. Everyone going can join in one tap.</p>
          <Link href="/create?mode=room" className="lip mt-5 !px-6">
            Set up my room
          </Link>
          <p className="mt-3 font-body text-[13px] font-semibold text-t-muted">Takes about a minute: name, logo, look.</p>
        </section>

        {event.host.roomId && event.host.roomName && (
          <section className="t-card p-4 lg:p-5" aria-label="Move this event into your room">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-body text-[16px] font-extrabold">Already have a room?</h3>
              <p className="font-body text-[13.5px] text-t-muted">Move this event into it</p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <p className="flex min-h-[44px] min-w-0 flex-1 items-center truncate rounded-hz border border-t-line bg-t-bg px-3 font-body text-[15px]">{event.host.roomName}</p>
              <button type="button" className="lip-ghost flex-none !px-4" disabled={busy} onClick={() => void setRoom(true)}>
                {busy ? "Connecting" : "Connect"}
              </button>
            </div>
            <ErrorLine>{error}</ErrorLine>
          </section>
        )}
      </div>
    );
  }

  const r = room.data;
  const name = r?.name ?? event.host.roomName ?? "Your room";
  return (
    <div className="flex flex-col gap-4">
      <section className="t-card p-4 lg:p-5" aria-label="Your room">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-hz bg-t-accent font-display text-[20px] font-black text-t-on">{name.trim()[0]?.toUpperCase() ?? "R"}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate font-body text-[16px]">{name}</b>
            <span className="block font-body text-[13.5px] text-t-muted">
              {r ? `${r.members.toLocaleString("en-NG")} ${r.members === 1 ? "member" : "members"} · ` : ""}this event shows in your room
            </span>
          </div>
          <Link href={`/rooms/${encodeURIComponent(event.host.roomId ?? event.room_id)}`} className="lip-ghost flex-none">
            Open room
          </Link>
          {r && (r.my_role === "owner" || r.my_role === "admin") && (
            <Link href={`/rooms/${encodeURIComponent(r.slug)}/admin`} className="lip flex-none" data-open-room-admin>
              Open room admin
            </Link>
          )}
        </div>

        <div className="mt-3 border-t border-t-line pt-1">
          <Toggle on onChange={(on) => void setRoom(on)} disabled={busy || !event.host.roomId} label="Event chat inside your room" hint={event.host.roomId ? "This event shows in your room and has its own chat there" : "Set by the room's owner"} />
          <div className="flex min-h-[64px] items-center justify-between gap-3 border-t border-t-line py-3 opacity-60">
            <div className="min-w-0 flex-1">
              <b className="flex flex-wrap items-center gap-2 font-body text-[15px]">
                Ask guests to join your room
                <span className="rounded-hz bg-t-soft px-2 py-0.5 font-body text-[11px] font-extrabold text-t-muted">Coming soon</span>
              </b>
              <span className="block font-body text-[13px] text-t-muted">After they register</span>
            </div>
            <input type="checkbox" disabled aria-label="Ask guests to join your room" />
          </div>
        </div>
        <ErrorLine>{error}</ErrorLine>
      </section>
    </div>
  );
}
