"use client";

import clsx from "clsx";
import type { R1Event } from "@/lib/events-r1/types";
import { listedByLine, priceLine, soldAtLine, ticketButtonLabel, ticketHref } from "@/lib/events-r1/listing";
import { ClaimLink } from "./ClaimSheet";

/**
 * The pieces every screen uses for a listing (an event whose tickets are sold on the organiser's page): the Get tickets link,
 * the small notes under it and the Listed by line with "Is this your event?". The words come from lib/events-r1/listing.ts,
 * so no screen has its own. `tone` is the colours the screen already has: "tint" is the event's own look (t-* colours),
 * "dark" is the app's dark cards.
 */
type Tone = "tint" | "dark";
type Listed = Pick<R1Event, "id" | "title" | "listing">;

const MUTED: Record<Tone, string> = { tint: "text-t-muted", dark: "text-dim" };
const LINK: Record<Tone, string> = {
  tint: "min-h-[44px] text-left font-body text-[13px] text-t-muted underline underline-offset-4",
  dark: "min-h-[44px] text-left font-body text-[13px] text-dim underline underline-offset-4",
};

/** The Get tickets link: the organiser's page in a new tab. Nothing when the listing has no page to send anyone to. */
export function TicketLink({ event, className, onClick }: { event: Listed; className: string; onClick?: (e: React.MouseEvent) => void }) {
  const href = ticketHref(event);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick} data-ticket-link>
      {ticketButtonLabel(event)}
    </a>
  );
}

/** "Tickets are sold on Tix" or "Sold out at the source", as a small note under the button. */
export function SoldAt({ event, tone, className }: { event: Listed; tone: Tone; className?: string }) {
  const line = soldAtLine(event);
  if (!line) return null;
  return <span className={clsx("font-body text-[12px]", MUTED[tone], className)}>{line}</span>;
}

/** "Listed by Hoppaz" (or "Hosted by <name>" after a claim) and, while it is unclaimed, "Is this your event?". */
export function ListedBy({ event, tone, className }: { event: Listed; tone: Tone; className?: string }) {
  const l = event.listing;
  if (!l) return null;
  return (
    <div className={clsx("grid justify-items-start gap-0", className)}>
      <span className={clsx("font-body text-[13px] font-semibold", MUTED[tone])}>{listedByLine(event)}</span>
      {!l.claimed && <ClaimLink eventId={event.id} eventTitle={event.title} className={LINK[tone]} />}
    </div>
  );
}

/** The event page's card under the cover: the price, the Get tickets link, where the tickets are sold. No count, no list, no stepper. */
export function ListingCard({ event, anchor }: { event: R1Event; anchor?: React.RefObject<HTMLDivElement | null> }) {
  const href = ticketHref(event);
  return (
    <div ref={anchor} className="scroll-mt-4 overflow-hidden rounded-hz border border-t-line bg-t-tile" data-listing-card>
      <div className="flex items-baseline justify-between border-b border-t-line px-4 py-3">
        <b className="font-body text-[14px]">Tickets</b>
        <span className="font-body text-[12px] text-t-muted">Sold by the organiser</span>
      </div>
      <div className="grid gap-2.5 px-4 py-3">
        <b className="font-display text-[22px] font-extrabold leading-tight tabular-nums">{priceLine(event)}</b>
        {href ? <TicketLink event={event} className="lip w-full" /> : <span className="font-body text-[13px] text-t-muted">{soldAtLine(event)}</span>}
        {href && <SoldAt event={event} tone="tint" className="text-center text-[11.5px]" />}
      </div>
    </div>
  );
}

/** Phone only: the bar that follows you on the event page. The price on the left, the link on the right. */
export function ListingBar({ event, line }: { event: R1Event; line: string }) {
  const href = ticketHref(event);
  return (
    <div className="sticky bottom-0 z-30 flex items-center gap-3.5 border-t border-t-line bg-t-bar px-[22px] pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3.5 backdrop-blur-md lg:hidden" data-listing-bar>
      <div className="min-w-0">
        <b className="block font-display text-[17px] font-extrabold leading-tight tabular-nums">{priceLine(event)}</b>
        <span className="block truncate font-body text-[12.5px] text-t-muted">{event.listing?.sold_out ? "Sold out at the source" : line}</span>
      </div>
      {href && <TicketLink event={event} className="lip ml-auto !px-5" />}
    </div>
  );
}
