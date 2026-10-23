"use client";

import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, MapPin, Ticket, Users, Video } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useViewerState } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { eventTitle } from "@/lib/geo";
import { linkLabel } from "./page/link";
import PageSections from "./page/PageSections";
import RegisterButton from "./page/RegisterButton";
import { useFreshEvent } from "./page/useFreshEvent";
import { isOnline, placeLine, priceWord, whenRange } from "./words";

/**
 * Release 1: the Luma style block at the top of the event card (the map panel, the Events sheet and the event page).
 * Name, who hosts it, when, where, the price, how many are going, a short description and two buttons.
 * The cover is the card's own flyer art, above this. Check-in, quests, the drop and photos follow below it, as before.
 *
 * The button is RegisterButton: a tap runs the flow right here (sign in, the host's questions, register). Its label follows
 * the viewer: Register, Request to join, Join waitlist, You're in, Pending, Closed; a paid event shows Get ticket, off.
 * On the event page the area under the facts is the status card, the host's updates and About this event.
 */
export default function EventBlock({ event: given, placement }: { event: R1Event; placement: "sheet" | "side" | "page" }) {
  const side = placement === "side";
  const page = placement === "page";
  // The list this card came from is older than a Register done a moment ago: read the event again.
  const event = useFreshEvent(given);
  const { data: viewer } = useViewerState(event.id);

  const online = isOnline(event);
  const hybrid = event.kind === "hybrid";
  const hasLink = online || hybrid;
  // The kind of link is public ("Zoom", "WhatsApp call"); the link itself comes after registering.
  const onlineWord = event.link_type ? `Online · ${linkLabel(event)}` : "Online";
  // Someone who can have the link (registered, or the host) needs no reminder that it comes after registering.
  const linkNote = hasLink && !viewer?.canSeeOnlineLink ? "Online link after you register" : null;
  const crowd = [
    event.going > 0 ? `${event.going} going` : "",
    event.capacity !== null ? (event.spots_left === 0 ? "Full" : `${event.spots_left} spot${event.spots_left === 1 ? "" : "s"} left`) : "",
  ].filter(Boolean);

  const row = "flex items-start gap-2.5 text-[14px] leading-snug text-cream";
  const icon = "mt-[3px] flex-none text-dim";

  return (
    <div className="px-5 pt-4">
      <h2 className={clsx("font-display font-black leading-[1.05] tracking-[-0.01em]", side ? "pr-6 text-[22px]" : page ? "text-[34px]" : "text-[30px]")}>{eventTitle(event)}</h2>

      <p className="mt-2 flex items-center gap-1.5 font-body text-[14px] text-dim">
        <span className="min-w-0 truncate">
          Hosted by <span className="text-cream">{event.host.name}</span>
        </span>
        {event.host.verified && <VerifiedBadge size={15} />}
      </p>

      <ul className="mt-3.5 space-y-2.5">
        <li className={row}>
          <CalendarDays size={16} className={icon} aria-hidden />
          <span>{whenRange(event)}</span>
        </li>
        <li className={row}>
          {online ? <Video size={16} className={icon} aria-hidden /> : <MapPin size={16} className={icon} aria-hidden />}
          <span className="min-w-0">
            {online ? onlineWord : placeLine(event) || "Place to be announced"}
            {online && linkNote && <span className="block text-[13px] text-dim">{linkNote}</span>}
          </span>
        </li>
        {hybrid && (
          <li className={row}>
            <Video size={16} className={icon} aria-hidden />
            <span className="min-w-0">
              {onlineWord}
              {linkNote && <span className="block text-[13px] text-dim">{linkNote}</span>}
            </span>
          </li>
        )}
        <li className={row}>
          <Ticket size={16} className={icon} aria-hidden />
          <span>{priceWord(event)}</span>
        </li>
        {crowd.length > 0 && (
          <li className={row}>
            <Users size={16} className={icon} aria-hidden />
            <span>{crowd.join(" · ")}</span>
          </li>
        )}
      </ul>

      {/* On the page the whole description sits under the card (About this event). */}
      {!page && event.description && <p className="mt-3.5 line-clamp-2 font-body text-[14px] leading-snug text-dim">{event.description}</p>}

      <RegisterButton
        event={event}
        placement={placement}
        trailing={
          !page && (
            <Link href={`/event/${encodeURIComponent(event.id)}`} className={clsx("btn btn-ghost normal-case", !side && "flex-1")}>
              Open event page
            </Link>
          )
        }
      />
      {page && <PageSections event={event} />}
    </div>
  );
}
