"use client";

import { useState } from "react";
import Link from "next/link";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import { useEventChat, useR1Api, useR1Auth, useR1Event, useR1Now, useRoom, useRoomEvents, useRoomMessages, useViewerState } from "@/lib/events-r1/hooks";
import type { EventChat as Chat, R1Event, ViewerState } from "@/lib/events-r1/types";
import SignInSheet from "../SignInSheet";
import { ChatTop, Composer, Lines, Pinned, type Lock } from "./ChatView";
import { clockWord, dayWord, roomPath } from "./words";

/**
 * Release 1 event chat (/rooms/<slug>/chat/<event id>): the chat of one event, tied to its room. Opens an hour before the
 * event, closes 3 days after it ends (then it is read only, with "This event has closed"). Who comes in follows the event.
 * The chat is found by the event, so the slug in the address only decides where Back goes.
 */
export default function EventChat({ slug, eventId }: { slug: string; eventId: string }) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const now = useR1Now();
  const { data: chat, loading } = useEventChat(eventId);
  const { data: event } = useR1Event(eventId);
  const { data: viewer } = useViewerState(eventId);
  const { data: room } = useRoom(chat?.room_id ?? slug);
  const { data: lines } = useRoomMessages(chat?.room_id, eventId);
  const { data: siblings } = useRoomEvents(chat?.room_id);
  const [signin, setSignin] = useState(false);

  const back = room ? roomPath(room) : "/crew";

  if ((loading && !chat) || (!event && loading)) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the chat" lines={2} />
      </div>
    );
  }
  if (!chat || !event) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-[560px]">
          <PageHeader title="No chat" back={back} />
          <p className="hint">This event has no chat.</p>
          {event && (
            <Link href={`/event/${event.id}`} className="btn btn-ghost mt-4 normal-case">
              Open event page
            </Link>
          )}
        </div>
      </div>
    );
  }

  const closed = chat.state === "closed";
  const all = lines ?? [];
  const pinned = all.filter((m) => m.pinned_pop).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const talk = all.filter((m) => !m.pinned_pop);

  // The next event of this room that has not started, for the closed state.
  const next = (siblings ?? []).find((e) => e.id !== event.id && e.status === "live" && Date.parse(e.starts_at) > now);

  const lock: Lock | undefined = closed
    ? { line: "This chat is closed." }
    : !user
      ? { line: "Sign in to chat", action: { label: "Sign in", onClick: () => setSignin(true) } }
      : !chat.can_enter
        ? undefined
        : chat.state === "upcoming"
          ? { line: `The chat opens ${dayWord(chat.opens_at)} at ${clockWord(chat.opens_at)}` }
          : undefined;

  return (
    <div className="flex h-full flex-col">
      <ChatTop title={event.title} sub={`Event: ${dayWord(event.starts_at)}${event.area ? ` · ${event.area}` : ""}`} back={back}>
        <Strip event={event} viewer={viewer ?? null} />
      </ChatTop>

      {closed ? (
        <>
          <Pinned lines={pinned} />
          <Lines lines={talk} meName={user?.name ?? null} />
          <div className="flex-none border-t border-line bg-ink px-4 py-3" data-closed>
            <div className="mx-auto w-full max-w-[560px]">
              <p className="font-display text-[17px] font-black">This event has closed</p>
              <p className="hint mt-0.5">The chat is closed. Thanks for coming.</p>
              <div className="mt-3 flex gap-2">
                <Link href={room ? `${roomPath(room)}/general` : "/crew"} className="btn min-w-0 flex-1 normal-case" data-go-general>
                  Go to General
                </Link>
                <Link href={next ? `/event/${next.id}` : room ? roomPath(room) : "/"} className="btn btn-ghost min-w-0 flex-1 normal-case" data-next-event>
                  See the next event
                </Link>
              </div>
            </div>
          </div>
        </>
      ) : !chat.can_enter && user ? (
        <Blocked chat={chat} event={event} viewer={viewer ?? null} roomName={room?.name ?? null} />
      ) : (
        <>
          <Pinned lines={pinned} />
          <Lines lines={talk} meName={user?.name ?? null} />
          <Composer
            lock={lock}
            hint={chat.state === "open" ? `Chat closes ${dayWord(chat.closes_at)}` : undefined}
            onSend={async (body) => void (await api?.rooms.send(chat.room_id, eventId, body))}
          />
        </>
      )}
      <SignInSheet open={signin} reason={`Chat for ${event.title}`} onClose={() => setSignin(false)} onSignedIn={() => setSignin(false)} />
    </div>
  );
}

/** "You're in · Show ticket": the ticket and the chat live together. A person who has not registered gets a link to do it. */
function Strip({ event, viewer }: { event: R1Event; viewer: ViewerState | null }) {
  const status = viewer?.registration?.status;
  const going = status === "going" || status === "checked_in";
  const href = `/event/${event.id}`;
  return (
    <p className="flex items-center gap-1.5 font-body text-[14px]" data-strip>
      {viewer?.isHost ? (
        <Link href={href} className="text-orange underline underline-offset-4">
          You host this event
        </Link>
      ) : going ? (
        <>
          <span className="font-semibold">You&apos;re in</span>
          <span className="text-dim">·</span>
          <Link href={href} className="text-orange underline underline-offset-4">
            Show ticket
          </Link>
        </>
      ) : (
        <Link href={href} className="text-orange underline underline-offset-4">
          Open event page
        </Link>
      )}
    </p>
  );
}

/** The viewer cannot come in: one line that says why, and the way to the event. */
function Blocked({ chat, event, viewer, roomName }: { chat: Chat; event: R1Event; viewer: ViewerState | null; roomName: string | null }) {
  const s = viewer?.registration?.status;
  const why =
    event.visibility === "community"
      ? `This chat is for members of ${roomName ?? "the room"}.`
      : !s || s === "cancelled" || s === "declined"
        ? "Register for the event to join the chat."
        : s === "requested"
          ? "You can join the chat once the host approves you."
          : "This chat is for people who are going.";
  return (
    <div className="flex-1 overflow-y-auto px-4 py-8" data-blocked={chat.event_id}>
      <div className="mx-auto w-full max-w-[560px] text-center">
        <p className="font-body text-[15px]">{why}</p>
        <Link href={`/event/${event.id}`} className="btn mt-4 normal-case">
          Open event page
        </Link>
      </div>
    </div>
  );
}
