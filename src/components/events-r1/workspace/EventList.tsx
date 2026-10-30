"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import Link from "next/link";
import { Plus } from "lucide-react";
import type { R1Event } from "@/lib/events-r1/types";
import { isPast, tileOf, whenLine } from "./words";

export type DraftRow = { title: string; starts_at: string | null };

function Row({ e, now, href, label }: { e: R1Event; now: number; href: string; label: string }) {
  const t = tileOf(e.starts_at);
  const past = isPast(e, now);
  return (
    <li className="flex items-center gap-3 border-t border-t-line py-3 first:border-t-0" data-ws-event={e.id}>
      <span className="grid h-[52px] w-[52px] flex-none overflow-hidden rounded-hz border border-t-line bg-t-tile text-center leading-none">
        <span className="bg-t-soft py-1 font-body text-[10.5px] font-bold uppercase text-t-muted">{t.mon}</span>
        <b className="grid place-items-center font-display text-[20px]">{t.day}</b>
      </span>
      {e.flyer_url && <img src={e.flyer_url} alt="" className="hidden h-[52px] w-[42px] flex-none rounded-hz border border-t-line object-cover sm:block" loading="lazy" />}
      <span className="min-w-0 flex-1">
        <b className={`block truncate font-body text-[16px] ${past ? "text-t-muted" : ""}`}>{e.title}</b>
        <span className="block truncate font-body text-[13px] text-t-muted">{whenLine(e)}</span>
      </span>
      {e.status !== "cancelled" && (
        <span className="flex-none text-right leading-tight">
          <b className="num block text-[17px]">{e.going.toLocaleString("en-NG")}</b>
          <span className="font-body text-[12px] text-t-muted">going</span>
        </span>
      )}
      <Link href={href} className="lip-ghost flex-none !min-h-[40px] !px-4" aria-label={`${label} ${e.title}`}>
        {label}
      </Link>
    </li>
  );
}

/**
 * Events in three groups: Upcoming, Drafts, Past (the design's order). A draft is the half-made form the create page keeps in this
 * browser; the data layer has no saved drafts. `href` is where Manage goes (the event dashboard).
 */
export default function EventList({
  events, now, href, draft, empty,
}: { events: R1Event[]; now: number; href: (e: R1Event) => string; draft?: DraftRow | null; empty: string }) {
  const up = events.filter((e) => !isPast(e, now) && e.status !== "cancelled").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = events.filter((e) => isPast(e, now) || e.status === "cancelled").filter((e) => !up.includes(e)).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  const group = "pb-1 pt-4 font-body text-[13.5px] font-bold text-t-muted first:pt-0";
  if (!up.length && !past.length && !draft) return <p className="font-body text-[14.5px] text-t-muted">{empty}</p>;
  return (
    <div>
      <p className={group}>Upcoming</p>
      {up.length ? (
        <ul>
          {up.map((e) => (
            <Row key={e.id} e={e} now={now} href={href(e)} label="Manage" />
          ))}
        </ul>
      ) : (
        <p className="py-2 font-body text-[14px] text-t-muted">Nothing coming up.</p>
      )}
      {draft && (
        <>
          <p className={group}>Drafts</p>
          <ul>
            <li className="flex items-center gap-3 border-t border-t-line py-3 first:border-t-0" data-ws-draft>
              <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-hz border border-dashed border-t-line text-t-muted" aria-hidden>
                <Plus size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-body text-[16px]">{draft.title || "Untitled event"}</b>
                <span className="block font-body text-[13px] text-t-muted">Draft · not posted</span>
              </span>
              <Link href="/create?mode=event" className="lip-ghost flex-none !min-h-[40px] !px-4">
                Finish
              </Link>
            </li>
          </ul>
        </>
      )}
      {past.length > 0 && (
        <>
          <p className={group}>Past</p>
          <ul>
            {past.map((e) => (
              <Row key={e.id} e={e} now={now} href={href(e)} label="Manage" />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
