"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, DoorOpen, Megaphone, MessageCircle, MessageSquare } from "lucide-react";
import clsx from "clsx";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import { useR1Api, useR1Now, useRoom, useRoomChats, useRoomEvents } from "@/lib/events-r1/hooks";
import type { R1Event, RoomSummary } from "@/lib/events-r1/types";
import SignInSheet from "../SignInSheet";
import Tag from "./AnnouncementTag";
import { dayWord, enterPath, roomPath } from "./words";
import { priceWord, timeWord } from "../words";
import RoomHeader from "./RoomHeader";

/**
 * Release 1 room home (/rooms/<slug>, and /rooms/hq for Hoppaz HQ): the wallpaper header, Enter room, the two sections every
 * room has (Announcements, General) plus any open event chat, the latest announcement, and the room's events.
 */
export default function RoomHome({ slug }: { slug: string }) {
  const { data: room, loading } = useRoom(slug);

  if (loading && !room) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the room" lines={2} />
      </div>
    );
  }
  if (!room) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-[560px]">
          <PageHeader title="Room not found" back="/crew" />
          <p className="hint">There is no room at this address.</p>
          <Link href="/crew" className="btn btn-ghost mt-4 normal-case">
            Go to Roomz
          </Link>
        </div>
      </div>
    );
  }
  return <Home room={room} />;
}

function Home({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const base = roomPath(room);
  const hq = room.kind === "hq";
  const { data: events } = useRoomEvents(room.id);
  const { data: chats } = useRoomChats(room.id);
  const openChats = (chats ?? []).filter((c) => c.state === "open" && c.can_enter);
  const [signin, setSignin] = useState(false);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!api || busy) return;
    if (!api.auth.current()) return setSignin(true);
    setBusy(true);
    try {
      await api.rooms.join(room.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pb-24" data-hub-scroll>
      <div className="mx-auto w-full max-w-[760px]">
        <RoomHeader room={room} />
        <div className="px-4">
          {/* HQ is chat first: no Enter room, the sections and the optional 3D button are the way in. */}
          {!hq &&
            (room.joined ? (
              <Link href={enterPath(room)} className="btn mt-4 w-full text-[15px] normal-case" data-enter-room>
                <DoorOpen size={18} aria-hidden /> Enter room
              </Link>
            ) : (
              <button type="button" className="btn mt-4 w-full text-[15px] normal-case" onClick={join} disabled={busy || !api} data-join>
                <DoorOpen size={18} aria-hidden /> Join
              </button>
            ))}

          <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-2">
            <Link href={`${base}/announcements`} className="btn btn-ghost min-h-[44px] normal-case" data-section="announcements">
              <Megaphone size={16} aria-hidden /> Announcements
              {room.unread > 0 && (
                <span className="grid h-[20px] min-w-[20px] place-items-center rounded-full bg-orange px-1 font-display text-[11px] font-black text-brand-ink">{room.unread}</span>
              )}
            </Link>
            <Link href={`${base}/general`} className="btn btn-ghost min-h-[44px] normal-case" data-section="general">
              <MessageCircle size={16} aria-hidden /> General
            </Link>
            {openChats.map((c) => (
              <Link key={c.event_id} href={`${base}/chat/${c.event_id}`} className="btn btn-ghost min-h-[44px] max-w-full normal-case" data-section={`chat-${c.event_id}`}>
                <MessageSquare size={16} aria-hidden /> <span className="truncate">{c.event_title}</span>
              </Link>
            ))}
          </nav>

          {hq && <WalkButton room={room} />}

          <Latest room={room} />

          <section aria-label="Events" className="mt-6">
            <p className="seclabel mb-2">Events</p>
            {events && events.length > 0 ? (
              <div>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </div>
            ) : (
              events && <p className="hint">No events yet.</p>
            )}
            <Link href="/" className="mt-1 flex min-h-[44px] items-center justify-between border-t border-line font-body text-[14px] text-cream" data-all-events>
              See all events on the map <ChevronRight size={16} className="text-dim" aria-hidden />
            </Link>
          </section>
        </div>
      </div>
      <SignInSheet open={signin} reason={`Join ${room.name}`} onClose={() => setSignin(false)} onSignedIn={() => setSignin(false)} />
    </div>
  );
}

/** Hoppaz HQ's optional walkable room. Off until the 3D room is ready; it never opens by itself. */
function WalkButton({ room }: { room: RoomSummary }) {
  if (room.has_3d) {
    return (
      <div className="mt-3">
        <Link href={`/crew/${room.id}/room`} className="btn btn-ghost w-full normal-case" data-walk>
          Walk the 3D room (optional)
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <button type="button" className="btn btn-ghost w-full normal-case" disabled data-walk>
        Walk the 3D room (optional)
      </button>
      <p className="hint mt-1.5 text-center">Opens when the 3D room is ready</p>
    </div>
  );
}

/** The latest announcement, where the General chat preview used to be. */
function Latest({ room }: { room: RoomSummary }) {
  const a = room.latest_announcement;
  const now = useR1Now();
  if (!a) {
    if (!room.can_post) return null;
    return (
      <Link href={`${roomPath(room)}/announcements`} className="card mt-4 block font-body text-[14px]">
        Post your first announcement
      </Link>
    );
  }
  return (
    <Link href={`${roomPath(room)}/announcements`} className="card mt-4 block" data-latest>
      <Tag a={a} now={now} />
      <p className="mt-1.5 line-clamp-3 whitespace-pre-line font-body text-[15px] leading-snug">{a.body}</p>
      <p className="mt-2 flex items-center gap-1 font-body text-[13px] text-orange">
        See all announcements <ChevronRight size={14} aria-hidden />
      </p>
    </Link>
  );
}

function EventRow({ event: e }: { event: R1Event }) {
  const past = e.status === "ended";
  const meta = e.status === "cancelled" ? `Cancelled · ${dayWord(e.starts_at)}` : past ? `Past · ${dayWord(e.starts_at)}` : `${dayWord(e.starts_at)} · ${timeWord(e)} · ${priceWord(e)}`;
  return (
    <Link href={`/event/${e.id}`} className={clsx("flex min-h-[56px] items-center gap-3 border-b border-line py-2.5", past && "opacity-70")} data-event-row={e.id}>
      <CalendarDays size={18} className="flex-none text-dim" aria-hidden />
      <span className="min-w-0 flex-1">
        <b className="block truncate font-display text-[15px] font-semibold">{e.title}</b>
        <span className="hint block truncate">{meta}</span>
      </span>
      <ChevronRight size={16} className="flex-none text-dim" aria-hidden />
    </Link>
  );
}
