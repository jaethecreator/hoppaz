"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import { useState } from "react";
import Link from "next/link";
import Sheet from "@/components/Sheet";
import { PrizeCodeCard } from "@/components/game-time/YourTickets";
import { fallbackCover } from "@/components/events-r1/page/HostStory";
import type { GtTicket } from "@/lib/game-time/types";
import type { MyRegistration } from "@/lib/events-r1/types";
import { SwipeLabel } from "./MeHosting";

/**
 * Your tickets on Me (CHANGE-003): one line of small stubs, upcoming event tickets first (soonest first), then Game Time prize codes.
 * An event ticket opens the event page, where the full ticket and its QR show. A prize code opens its card with COPY and SHARE (what
 * "Your tickets" was before). Hidden when there are none.
 */

const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** "Sun 1 Nov · 6 PM" (minutes only when they are not :00). */
export function stubWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const clock = `${p.hour}${p.minute && p.minute !== "00" ? `:${p.minute}` : ""} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim();
  return `${p.weekday} ${p.day} ${p.month} · ${clock}`;
}

/** "Sat 24 Oct", for when a code was won. */
const dayOnly = (iso: string) => stubWhen(iso).split(" · ")[0];

const STUB = "grid w-[150px] flex-none overflow-hidden rounded-hz border border-line bg-ink-2 text-left";

function Stub({ cover, kind, title, when }: { cover: React.ReactNode; kind: string; title: string; when: string }) {
  return (
    <>
      <span className="grid h-[84px] place-items-center overflow-hidden bg-ink-3">{cover}</span>
      <span className="relative grid gap-0.5 px-2.5 pb-2.5 pt-2 before:absolute before:inset-x-2 before:top-0 before:border-t-2 before:border-dashed before:border-line">
        <span className="mt-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-orange">{kind}</span>
        <b className="truncate font-body text-[13.5px] font-bold leading-[1.25]">{title}</b>
        <span className="truncate font-body text-[12px] text-dim">{when}</span>
      </span>
    </>
  );
}

export default function MeTickets({ tickets, codes }: { tickets: MyRegistration[]; codes: GtTicket[] }) {
  const [open, setOpen] = useState<GtTicket | null>(null);
  if (!tickets.length && !codes.length) return null;
  return (
    <section aria-label="Your tickets" className="mt-7" data-your-tickets>
      <SwipeLabel label="YOUR TICKETS" swipe />
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1.5 pt-0.5 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {tickets.map(({ event: e }) => (
          <li key={e.id} className="flex-none snap-start">
            <Link href={`/event/${encodeURIComponent(e.slug || e.id)}`} className={STUB} aria-label={`Ticket: ${e.title}, ${stubWhen(e.starts_at)}. Open your ticket`} data-ticket-stub={e.id}>
              <Stub cover={<img src={e.flyer_url || fallbackCover(e.id, e.title)} alt="" className="h-full w-full object-cover" />} kind="Ticket" title={e.title} when={stubWhen(e.starts_at)} />
            </Link>
          </li>
        ))}
        {codes.map((c) => (
          <li key={c.id} className="flex-none snap-start">
            <button type="button" onClick={() => setOpen(c)} className={STUB} aria-label={`Prize code: ${c.brand} · ${c.title}. Open the code`} data-prize-stub={c.id}>
              <Stub
                cover={<span className="max-w-full truncate px-2 font-mono text-[18px] font-medium tracking-[0.08em] text-orange">{c.code}</span>}
                kind="Prize code"
                title={`${c.brand} · ${c.title}`}
                when={`Won ${dayOnly(c.won_at)}`}
              />
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!open} onClose={() => setOpen(null)} label="Prize code">
        {open && <PrizeCodeCard ticket={open} />}
      </Sheet>
    </section>
  );
}
