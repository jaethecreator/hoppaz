"use client";

/* eslint-disable @next/next/no-img-element -- room logos are data URLs or bucket links of unknown size */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useEventChat, useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, Registration, RoomMessage, RoomSummary } from "@/lib/events-r1/types";
import { avatarColor, clock12, isNewRoom, showCount } from "../roompage/words";
import { eventChatHref, roomPath } from "../rooms/words";
import { googleCalendarUrl } from "./calendar";
import { SAVED_NOW } from "./CheckoutContact";
import TicketStub from "./TicketStub";

type Reg = Pick<Registration, "id" | "status" | "quantity" | "ticket_name" | "ticket_type_id">;

/**
 * "You're going" (design "After you pay", B5 and B6): the header, the card that brings the guest into the host's room, the ticket stub,
 * then Add to calendar and Event chat. The room is where the event chat lives, so the card shows people already talking.
 *
 * `page` is the screen after paying (/tickets/return): on a wide screen the stub and its buttons sit on the left, the header and the room
 * card on the right. `stack` is the event page's status card: one column, in the phone order. `header` is the big "You're going" (the
 * event page shows it only right after registering; the stub itself says "You're going" too).
 *
 * A Personal event (no room) has no card and no Event chat: Add to calendar is the main action.
 */
export default function YoureGoing({
  event,
  reg,
  layout = "stack",
  header = true,
  kicker,
  qr = true,
  cover = true,
}: {
  event: R1Event;
  reg: Reg;
  layout?: "page" | "stack";
  header?: boolean;
  kicker?: string;
  qr?: boolean;
  cover?: boolean;
}) {
  // The room the event was posted in. A Personal event has none: no room card and no event chat.
  const roomId = event.room_id ?? null;
  const { data: chat } = useEventChat(roomId ? event.id : null);
  const qty = reg.quantity ?? 1;
  const [savedNow, setSavedNow] = useState(false);
  useEffect(() => {
    try {
      setSavedNow(window.sessionStorage.getItem(SAVED_NOW) === event.id);
    } catch {
      setSavedNow(false);
    }
  }, [event.id]);

  const head = header && (
    <div className="grid gap-1" data-going-head>
      <span aria-hidden className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-t-accent text-t-on">
        <Check size={20} strokeWidth={3} />
      </span>
      <h2 className="t-title m-0 text-[28px] font-black leading-[1.05] tracking-[-0.02em]">{reg.status === "checked_in" ? "You're checked in" : "You're going"}</h2>
      <p className="m-0 font-body text-[14.5px] text-t-muted">
        {qty} ticket{qty === 1 ? "" : "s"} for {event.title}.{qr ? " Your QR code is below." : ""}
      </p>
      {savedNow && (
        <span className="flex items-center gap-2 font-body text-[13px] text-t-muted" data-saved-line>
          <Check size={14} strokeWidth={3} className="flex-none text-t-accent" aria-hidden />
          Your details are saved for next time. Change them in Account.
        </span>
      )}
    </div>
  );

  const card = roomId ? <RoomCard event={event} roomId={roomId} opensAt={chat?.opens_at ?? null} state={chat?.state ?? null} /> : null;
  const stub = <TicketStub event={event} reg={reg} kicker={kicker} qr={qr} cover={cover} actions={false} />;
  const actions = <Actions event={event} chatState={chat?.state ?? null} opensAt={chat?.opens_at ?? null} />;

  if (layout === "page") {
    return (
      <div className="mx-auto grid w-full max-w-[980px] content-start gap-[18px] px-[18px] pb-[30px] pt-[22px] lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-8 lg:pb-14 lg:pt-11">
        <div className="contents lg:grid lg:gap-3.5">
          <div className="order-3 lg:order-none">{stub}</div>
          <div className="order-4 lg:order-none">{actions}</div>
        </div>
        <div className="contents lg:grid lg:content-start lg:gap-[18px]">
          <div className="order-1 lg:order-none">{head}</div>
          {card && <div className="order-2 lg:order-none">{card}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-[18px]">
      {head}
      {card}
      {stub}
      {actions}
    </div>
  );
}

/** The event's chat on its room page (eventChatHref, with the room the event was posted in). Null for a Personal event. */
const chatHref = (event: R1Event) => (event.room_id ? eventChatHref({ id: event.id, host: { roomId: event.room_id } }) : null);

/** Add to calendar and Event chat, under the stub. Event chat opens the room page on this event's channel; before then it says when. */
function Actions({ event, chatState, opensAt }: { event: R1Event; chatState: string | null; opensAt: string | null }) {
  const href = chatHref(event);
  const cal = googleCalendarUrl(event);
  if (!href) {
    return (
      <a href={cal} target="_blank" rel="noopener noreferrer" className="lip w-full" data-going-cal>
        Add to calendar
      </a>
    );
  }
  const ghost = "lip-ghost !min-h-[44px] w-full text-center";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <a href={cal} target="_blank" rel="noopener noreferrer" className={ghost} data-going-cal>
        Add to calendar
      </a>
      {chatState === "upcoming" && opensAt ? (
        <span className={`${ghost} cursor-default !border-transparent !bg-t-soft !text-t-muted !shadow-none`} aria-disabled="true" data-going-chat>
          Chat opens {clock12(opensAt)}
        </span>
      ) : (
        <Link href={href} className={ghost} data-going-chat>
          Event chat
        </Link>
      )}
    </div>
  );
}

/** "South Social's", "Rooftop Sessions'". */
const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`);

/** "The Halloween Edition chat opens at 7:00 PM." */
function chatLine(title: string, state: string | null, opensAt: string | null): string {
  if (state === "open") return `The ${title} chat is open now.`;
  if (state === "upcoming" && opensAt) return `The ${title} chat opens at ${clock12(opensAt)}.`;
  if (state === "closed") return `The ${title} chat has closed.`;
  return "";
}

function Logo({ room }: { room: RoomSummary }) {
  return room.logo_url ? (
    <img src={room.logo_url} alt="" className="h-[52px] w-[52px] flex-none rounded-hz bg-t-solid object-cover" />
  ) : (
    <span aria-hidden className="grid h-[52px] w-[52px] flex-none place-items-center rounded-hz bg-t-accent font-display text-[20px] font-extrabold text-t-on">
      {room.name.trim()[0]?.toUpperCase() ?? "R"}
    </span>
  );
}

/**
 * B6, the join-room card. Open room: Join room, at once. Ask to join: a request that tells the host they bought a ticket. Already a member:
 * the card goes quiet and Open the chat is the main action. An invite only room, or a request the host declined: no card.
 */
function RoomCard({ event, roomId, opensAt, state }: { event: R1Event; roomId: string; opensAt: string | null; state: string | null }) {
  const api = useR1Api();
  const { data: room } = useR1Query((a) => a.rooms.get(roomId), [roomId]);
  // General is readable by visitors of an open room only: an ask room keeps it for its members, so its card has no messages.
  const { data: lines } = useR1Query(
    (a) => (room && !room.joined && room.join_mode === "open" ? a.rooms.messages(roomId, "general") : Promise.resolve([] as RoomMessage[])),
    [roomId, room?.joined, room?.join_mode]
  );
  const [done, setDone] = useState<null | "in" | "asked">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!room) return null;
  const line = chatLine(event.title, state, opensAt);
  const online = showCount(room.online) ? (
    <span className="inline-flex items-center gap-[5px]">
      <i aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-[#2FD35C]" />
      {room.online.toLocaleString("en-NG")} online
    </span>
  ) : null;
  const toastEl = toast ? (
    <div role="status" className="fixed left-1/2 top-3.5 z-[80] w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-hz bg-t-text px-3.5 py-2.5 font-body text-[14px] font-bold text-t-bg shadow-[0_14px_34px_rgba(0,0,0,.35)]">
      {toast}
    </div>
  ) : null;

  const member = room.joined || done === "in";
  if (member) {
    const href = state === "open" || state === "closed" ? (chatHref(event) ?? roomPath(room)) : `${roomPath(room)}?ch=general`;
    return (
      <div className="grid gap-3 rounded-hz border border-t-line bg-t-tile p-4" data-room-card="member">
        {toastEl}
        <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
          <Logo room={room} />
          <div className="min-w-0">
            <b className="block text-balance font-display text-[17px] font-extrabold leading-[1.2]">You&apos;re in {room.name}</b>
            <small className="flex flex-wrap gap-x-2.5 gap-y-1 font-body text-[13px] text-t-muted">
              {online}
              {line && <span>{line}</span>}
            </small>
          </div>
        </div>
        <Link href={href} className={room.joined && !done ? "lip w-full" : "lip-ghost !min-h-[44px] w-full"} data-room-open>
          Open the chat
        </Link>
      </div>
    );
  }

  if (done === "asked" || room.request === "pending") {
    return (
      <div className="grid gap-3 rounded-hz border border-t-line bg-t-tile p-4" data-room-card="asked">
        {toastEl}
        <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
          <Logo room={room} />
          <div className="min-w-0">
            <b className="block text-balance font-display text-[17px] font-extrabold leading-[1.2]">Request sent to {room.name}</b>
            <small className="block font-body text-[13px] text-t-muted">They can see you&apos;re going to {event.title}. You get a Pop when you&apos;re in.</small>
          </div>
        </div>
        <p className="m-0 font-body text-[13.5px] text-t-muted">Until then, your event chat still works from the ticket.</p>
      </div>
    );
  }

  if (room.join_mode === "invite" || room.request === "declined") return null;

  const ask = room.join_mode === "ask";
  const peek = (lines ?? []).filter((m) => m.body.trim()).slice(-2);
  const join = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const out = await api.rooms.join(room.id, { forEvent: event.id });
      if (out === "requested") {
        setDone("asked");
        setToast(`Request sent to ${room.name}.`);
      } else {
        setDone("in");
        setToast(`You're in ${room.name}. Say hi in General.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-hz border-2 border-t-accent bg-t-tile bg-[linear-gradient(140deg,var(--t-soft),var(--t-tile)_70%)] p-4" data-room-card={ask ? "ask" : "open"}>
      {toastEl}
      <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
        <Logo room={room} />
        <div className="min-w-0">
          <b className="block text-balance font-display text-[17px] font-extrabold leading-[1.2]">Join {possessive(room.name)} room</b>
          <small className="flex flex-wrap gap-x-2.5 gap-y-1 font-body text-[13px] text-t-muted">
            <span>{isNewRoom(room) ? "New room" : `${room.members.toLocaleString("en-NG")} Hoppers`}</span>
            {online}
          </small>
        </div>
      </div>
      {peek.length > 0 && (
        <div className="grid gap-2 rounded-hz border border-t-line bg-t-bg px-3 py-2.5" data-room-peek>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-t-muted">In General now</span>
          {peek.map((m) => (
            <div key={m.id} className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-2 font-body text-[13.5px] leading-[1.35]">
              <span aria-hidden className="grid h-[26px] w-[26px] place-items-center rounded-full font-display text-[11px] font-extrabold text-[#140f0d]" style={{ background: avatarColor(m.author_name) }}>
                {m.author_name.trim()[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 break-words">
                <b className="mr-1 text-[13px]">{m.author_name}</b>
                <span>{m.body}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="m-0 font-body text-[13.5px] text-t-muted">{[line, "It lives in the room, with everyone going. Stay for the next one."].filter(Boolean).join(" ")}</p>
      <button type="button" className="lip w-full" disabled={busy || !api} onClick={() => void join()} data-room-join>
        {busy ? "One moment" : ask ? "Ask to join" : "Join room"}
      </button>
      {ask && <p className="-mt-1 mb-0 text-center font-body text-[13.5px] text-t-muted">{room.name} approves members. Your ticket shows them you&apos;re coming.</p>}
      {error && (
        <p role="alert" className="m-0 font-body text-[13px] text-[#E5484D]">
          {error}
        </p>
      )}
    </div>
  );
}
