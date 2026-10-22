"use client";

import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, MapPin, Ticket, Users, Video } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useViewerState } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { eventTitle } from "@/lib/geo";
import { registerLabel } from "./labels";
import { isOnline, placeLine, priceWord, whenRange } from "./words";

/**
 * Release 1: the Luma style block at the top of the event card (the map panel, the Events sheet and the event page).
 * Name, who hosts it, when, where, the price, how many are going, a short description and two buttons.
 * The cover is the card's own flyer art, above this. Check-in, quests, the drop and photos follow below it, as before.
 *
 * Register opens the event page with ?register=1 (the event page does the real registering). The label follows the
 * viewer: Register, Request to join, Join waitlist, You're in, Pending, Closed; a paid event shows Get ticket, off.
 */
export default function EventBlock({ event, placement }: { event: R1Event; placement: "sheet" | "side" | "page" }) {
  const side = placement === "side";
  const page = placement === "page";
  const { data: viewer } = useViewerState(event.id);
  const reg = registerLabel(viewer, event);

  const online = isOnline(event);
  const hybrid = event.kind === "hybrid";
  // Someone who can have the link (registered, or the host) needs no reminder that it comes after registering.
  const linkNote = hybrid && !viewer?.canSeeOnlineLink ? "Online link after you register" : null;

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
            {placeLine(event) || "Place to be announced"}
            {linkNote && <span className="block text-[13px] text-dim">{linkNote}</span>}
          </span>
        </li>
        <li className={row}>
          <Ticket size={16} className={icon} aria-hidden />
          <span>{priceWord(event)}</span>
        </li>
        {event.going > 0 && (
          <li className={row}>
            <Users size={16} className={icon} aria-hidden />
            <span>{event.going} going</span>
          </li>
        )}
      </ul>

      {event.description && <p className="mt-3.5 line-clamp-2 font-body text-[14px] leading-snug text-dim">{event.description}</p>}

      <div className={clsx("mt-4 gap-2", side ? "grid" : "flex")}>
        {reg.disabled ? (
          <button type="button" disabled className={clsx("btn normal-case", !side && "flex-1")}>
            {reg.text}
          </button>
        ) : (
          <Link
            href={`/event/${encodeURIComponent(event.id)}?register=1`}
            className={clsx("btn normal-case", reg.status && "btn-ghost border-keke text-keke", !side && "flex-1")}
          >
            {reg.text}
          </Link>
        )}
        {!page && (
          <Link href={`/event/${encodeURIComponent(event.id)}`} className={clsx("btn btn-ghost normal-case", !side && "flex-1")}>
            Open event page
          </Link>
        )}
      </div>
    </div>
  );
}
