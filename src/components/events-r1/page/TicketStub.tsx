"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size; the QR is a data URL made here */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useLookStyle, usePictureTint } from "@/components/host/TintShell";
import { QUESTS_ON } from "@/lib/events-r1/flags";
import { useR1Query } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event, Registration, Ticket } from "@/lib/events-r1/types";
import { themeForEvent } from "@/lib/theme";
import { handleOf, QuestLines } from "../MapStub";
import { eventChatHref } from "../rooms/words";
import { isOnline } from "../words";
import { downloadIcs, googleCalendarUrl } from "./calendar";
import { fallbackCover, whenWords } from "./HostStory";

/** One QR block of the stub: the code in white (so it scans), the holder's name, where to show it and the short code for the door. */
function QrBlock({ ticket, count }: { ticket: Ticket; count: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const token = ticket.token;
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(token, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0E0B0A", light: "#FFFFFF" },
    }).then(
      (url) => live && setSrc(url),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [token]);
  const seat =
    count > 1
      ? `Ticket ${ticket.seat_no ?? 1} of ${ticket.seats ?? count}`
      : "";
  const used = ticket.status === "used";
  return (
    <li className="col-span-2 grid grid-cols-[auto_1fr] items-center gap-3.5 rounded-hz border border-t-line bg-t-tile p-3">
      {src ? (
        <img
          src={src}
          alt={seat ? `QR code, ${seat.toLowerCase()}` : "Your ticket QR code"}
          width={120}
          height={120}
          className="h-[120px] w-[120px] rounded-lg bg-white p-1.5"
        />
      ) : (
        <div className="h-[120px] w-[120px] animate-pulse rounded-lg bg-t-line" />
      )}
      <div className="min-w-0">
        {seat && (
          <small className="block font-body text-[11px] font-semibold text-t-muted">
            {seat}
          </small>
        )}
        <b className="block break-words font-body text-[15px] leading-tight">
          {ticket.holder_name}
        </b>
        <small className="mt-0.5 block font-body text-[12px] text-t-muted">
          {used ? "Checked in" : "Show this at the door"}
        </small>
        <small className="mt-1.5 block font-mono text-[12px] tracking-[0.14em] text-t-muted">
          {ticket.code}
        </small>
      </div>
    </li>
  );
}

/**
 * "Your ticket" (build brief section 9, mock-up ticket-round2): the long stub a guest sees once they are going. The cover and
 * "You're going", the host's logo, name and handles under the title, a perforation, date, time, venue and ticket type, the QR code
 * with the holder's name and code (one per ticket in the order), the quests, Add to calendar and Event chat.
 *
 * Inside the event page it takes the page's tint as it finds it. Anywhere else pass `own` and it dresses itself in the event's
 * look (the saved one, else the cover's colour; Day or Night from the start time), as the map pop-up does.
 * `qr` is false for an online-only event, which has no door to scan at.
 */
export default function TicketStub({
  event,
  reg,
  kicker,
  qr = true,
  own = false,
  cover: showCover = true,
  actions = true,
}: {
  event: R1Event;
  reg: Pick<
    Registration,
    "id" | "status" | "quantity" | "ticket_name" | "ticket_type_id"
  >;
  /** The line over the title, after "You're going": the countdown, "Online". */
  kicker?: string;
  qr?: boolean;
  own?: boolean;
  /** The cover band on top. The event page leaves it off: its own cover sits a screen above, so it would show twice. */
  cover?: boolean;
  /** The Add to calendar and Event chat row at the foot. "You're going" leaves it off and puts the two as buttons under the stub. */
  actions?: boolean;
}) {
  const online = isOnline(event);
  const cover = event.flyer_url || fallbackCover(event.id, event.title);
  const { data: saved } = useR1Query(
    (a) => (own ? a.looks.get("event", event.id) : Promise.resolve(null)),
    [event.id, own],
  );
  const look: Look = saved ?? {
    ...DEFAULT_LOOK,
    mood: themeForEvent(event.starts_at) === "day" ? "day" : "night",
    auto: true,
  };
  const tint = usePictureTint(own ? cover : null, look);
  const style = useLookStyle(look, tint);
  const [wide, setWide] = useState(false);

  // The host's room gives the logo and the handles.
  const roomId = event.host.roomId;
  const { data: room } = useR1Query(
    (a) => (roomId ? a.rooms.get(roomId) : Promise.resolve(null)),
    [roomId],
  );
  const hostName = event.host.roomName ?? event.host.name;
  const logo = room?.logo_url ?? null;
  const handles = useMemo(() => {
    const l = room?.links ?? {};
    return [
      l.instagram && handleOf("instagram", l.instagram),
      l.x && handleOf("x", l.x),
      l.website && handleOf("website", l.website),
    ]
      .filter((h): h is string => !!h)
      .slice(0, 3);
  }, [room]);

  const { data: tickets } = useR1Query(
    (a) =>
      qr
        ? a.registrations.ticketsFor(event.id)
        : Promise.resolve([] as Ticket[]),
    [event.id, qr, `${reg.id}:${reg.status}:${reg.quantity}`],
  );
  const list = tickets ?? [];

  const w = useMemo(() => whenWords(event), [event]);
  const venue = online
    ? "Online"
    : event.venue_name || event.area || "To be announced";
  const price =
    event.ticket_types?.find((t) => t.id === reg.ticket_type_id)?.price_naira ??
    event.price_naira;
  const qty = reg.quantity ?? 1;
  const typeLine = `${price > 0 ? "" : "Free · "}${reg.ticket_name || "General"}${qty > 1 ? ` x ${qty}` : ""}`;
  const chat = eventChatHref(event);
  const lead =
    reg.status === "checked_in" ? "You're checked in" : "You're going";

  return (
    <div
      className="overflow-hidden rounded-hz text-t-text shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)]"
      style={own ? style : undefined}
      aria-label="Your ticket"
    >
      {showCover && (
        <div className="bg-t-solid bg-[radial-gradient(circle_at_50%_40%,var(--t-soft),var(--t-solid)_75%)] leading-[0]">
          <img
            src={cover}
            alt={`${event.title} cover`}
            className={
              wide
                ? "block h-auto w-full"
                : "mx-auto block h-auto max-h-[320px] w-auto max-w-full p-3"
            }
            onLoad={(e) =>
              setWide(
                e.currentTarget.naturalWidth /
                  Math.max(1, e.currentTarget.naturalHeight) >
                  1.3,
              )
            }
          />
        </div>
      )}

      <div className="grid gap-1.5 bg-t-solid px-[18px] pb-0.5 pt-3.5">
        <span
          className="font-body text-[12px] font-semibold text-t-accent"
          aria-live="polite"
        >
          {[lead, kicker].filter(Boolean).join(" · ")}
        </span>
        <h3 className="t-title m-0 break-words text-[22px] font-extrabold leading-[1.05]">
          {event.title}
        </h3>
        <div className="flex items-center gap-2.5 pt-1.5">
          {logo ? (
            <img
              src={logo}
              alt=""
              className="h-[34px] w-[34px] flex-none rounded-hz object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="grid h-[34px] w-[34px] flex-none place-items-center rounded-hz bg-t-accent font-display font-extrabold text-t-on"
            >
              {hostName.trim()[0]?.toUpperCase() ?? "H"}
            </span>
          )}
          <div className="min-w-0">
            <b className="block break-words font-body text-[14px] leading-tight">
              {hostName}
            </b>
            <small className="block font-body text-[12px] text-t-muted">
              {event.host.verified ? "Verified host" : "Host"}
            </small>
          </div>
        </div>
        {handles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {handles.map((h) => (
              <span
                key={h}
                className="break-all rounded-full border border-t-line px-2 py-[3px] font-body text-[11px] text-t-muted"
              >
                {h}
              </span>
            ))}
          </div>
        )}
      </div>

      <div aria-hidden className="stub-perf relative h-[22px]">
        <span className="absolute inset-x-[18px] top-1/2 border-t-2 border-dashed border-t-line" />
      </div>

      <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 bg-t-solid px-[18px] pb-3 pt-1">
        <div className="min-w-0">
          <small className="block font-body text-[11px] font-semibold text-t-muted">
            Date
          </small>
          <b className="font-body text-[14px] leading-[1.25]">{w.short}</b>
        </div>
        <div className="min-w-0">
          <small className="block font-body text-[11px] font-semibold text-t-muted">
            Time
          </small>
          <b className="font-body text-[14px] leading-[1.25]">
            {w.timeLine.split(" · ")[0]}
          </b>
        </div>
        <div className="min-w-0">
          <small className="block font-body text-[11px] font-semibold text-t-muted">
            Venue
          </small>
          <b className="break-words font-body text-[14px] leading-[1.25]">
            {venue}
          </b>
        </div>
        <div className="min-w-0">
          <small className="block font-body text-[11px] font-semibold text-t-muted">
            Ticket
          </small>
          <b className="break-words font-body text-[14px] leading-[1.25]">
            {typeLine}
          </b>
        </div>

        {qr && list.length > 0 && (
          <ul
            aria-label="Your tickets"
            className="col-span-2 grid grid-cols-2 gap-2.5"
          >
            {list.map((t) => (
              <QrBlock key={t.id} ticket={t} count={list.length} />
            ))}
          </ul>
        )}

        {QUESTS_ON && <QuestLines eventId={event.id} />}

        {actions && (
          <div className="col-span-2 flex items-center justify-between gap-3 border-t border-t-line pt-1 font-body text-[13px]">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2.5">
              <a
                href={googleCalendarUrl(event)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center font-semibold text-t-accent"
              >
                Add to calendar
              </a>
              <button
                type="button"
                onClick={() => downloadIcs(event)}
                className="min-h-[44px] text-[12px] text-t-muted underline underline-offset-4"
              >
                or download .ics
              </button>
            </span>
            {chat && (
              <Link
                href={chat}
                className="inline-flex min-h-[44px] flex-none items-center text-t-text"
              >
                Event chat →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
