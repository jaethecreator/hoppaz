"use client";

/* eslint-disable @next/next/no-img-element -- room logos and covers are data URLs or bucket links of unknown size */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fallbackCover } from "@/components/events-r1/page/HostStory";
import { useLookStyle, usePictureTint } from "@/components/host/TintShell";
import { initialsOf } from "@/components/events-r1/workspace/desk";
import type { Desk, Workspace } from "@/components/events-r1/workspace/desk";
import { useR1Query } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event } from "@/lib/events-r1/types";
import { themeForEvent } from "@/lib/theme";

/**
 * Hosting on Me (CHANGE-003, mock-up host-entry-me-final.html). Me stays on the loud Hoppaz layer; only the Tonight strip wears the event's tint.
 *   TonightStrip   only on the day of an event you host: cover, "Tonight, you're hosting", title and going, Door scanner.
 *   HostingLine    one line of workspace icons (Personal, each room you run, + New event), or, never hosted, one slim "Host something" row.
 */

const CREATE = "/create?mode=event";

/** The section label, with "Swipe ›" on the right for a carousel. The same label as the shelf's. */
export function SwipeLabel({ label, swipe }: { label: string; swipe: boolean }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <p className="seclabel">{label}</p>
      {swipe && (
        <span aria-hidden className="seclabel">
          SWIPE ›
        </span>
      )}
    </div>
  );
}

/** One slim strip in the event's own colours, above the Hosting line. Gone once the event ends (useHostDesk stops naming it). */
export function TonightStrip({ event }: { event: R1Event }) {
  const cover = event.flyer_url || fallbackCover(event.id);
  const { data: saved } = useR1Query((a) => a.looks.get("event", event.id), [event.id]);
  const look: Look = saved ?? { ...DEFAULT_LOOK, mood: themeForEvent(event.starts_at) === "day" ? "day" : "night", auto: true };
  const tint = usePictureTint(cover, look);
  const style = useLookStyle(look, tint);
  return (
    <section
      aria-label="Tonight, you're hosting"
      className="tint-ui mt-7 grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-t-accent bg-t-bg py-2 pl-2.5 pr-2 text-t-text"
      style={style}
      data-mood={look.mood}
      data-tonight
    >
      <img src={cover} alt="" className="h-10 w-10 rounded-hz object-cover" />
      <span className="min-w-0">
        <span className="block truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-t-accent">Tonight, you&apos;re hosting</span>
        <b className="block truncate font-body text-[14.5px] font-bold">
          {event.title} · {event.going.toLocaleString("en-NG")} going
        </b>
      </span>
      <Link href={`/host/${encodeURIComponent(event.id)}/door`} className="lip min-h-[44px] whitespace-nowrap px-3 py-2 text-[13.5px]">
        Door scanner
      </Link>
    </section>
  );
}

const ICON = "relative grid h-14 w-14 place-items-center rounded-[16px] border transition-[border-radius] duration-150 group-hover:rounded-[12px]";

function WorkspaceIcon({ w, personalName }: { w: Workspace; personalName: string }) {
  const name = w.key === "personal" ? personalName : w.name;
  const label = [w.name, w.role, w.waiting ? `${w.waiting} waiting` : "", w.live ? "Live now" : ""].filter(Boolean).join(", ");
  return (
    <li className="flex-none snap-start">
      <Link href={w.href} aria-label={label} className="group grid w-[68px] justify-items-center gap-1.5 text-center" data-workspace={w.key}>
        <span className={`${ICON} border-line bg-ink-2 font-display text-[20px] font-black`}>
          {w.logo ? <img src={w.logo} alt="" className="h-full w-full rounded-[inherit] object-cover" /> : <span aria-hidden>{initialsOf(name).slice(0, 1)}</span>}
          {w.waiting > 0 && (
            <span aria-hidden className="absolute -right-1.5 -top-1.5 h-[22px] min-w-[22px] rounded-full border-2 border-ink bg-orange px-1.5 text-center font-body text-[11.5px] font-extrabold leading-[18px] text-brand-ink">
              {w.waiting > 99 ? "99+" : w.waiting}
            </span>
          )}
          {w.live && <span aria-hidden className="absolute -bottom-[3px] -right-[3px] h-4 w-4 rounded-full border-[3px] border-ink bg-keke" />}
        </span>
        <span className="max-w-[68px] font-body text-[12px] font-semibold leading-[1.2] text-dim">
          <span className="block truncate">{w.name}</span>
          {w.role && <span className="mt-0.5 block font-mono text-[9.5px] font-medium uppercase tracking-[0.1em]">{w.role}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Hosting: the carousel, or the never hosted row. Nothing while it loads (no flash of the wrong one). */
export function HostingLine({ desk, personalName }: { desk: Desk; personalName: string }) {
  if (!desk.hosted) {
    return (
      <section aria-label="Hosting" className="mt-7" data-hosting="never">
        <SwipeLabel label="HOSTING" swipe={false} />
        <Link href={CREATE} className="grid min-h-[72px] w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-line bg-ink-2 py-2 pl-2 pr-3">
          <span aria-hidden className="grid h-14 w-14 place-items-center rounded-[16px] border-[1.5px] border-dashed border-line font-display text-[22px] font-black text-orange">
            +
          </span>
          <span className="min-w-0">
            <b className="block font-display text-[15px] font-extrabold">Host something</b>
            <span className="block font-body text-[13px] text-dim">Make an event in a minute</span>
          </span>
          <ChevronRight size={18} aria-hidden className="text-dim" />
        </Link>
      </section>
    );
  }
  return (
    <section aria-label="Hosting" className="mt-7" data-hosting="line">
      <SwipeLabel label="HOSTING" swipe />
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1.5 pt-0.5 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {desk.workspaces.map((w) => (
          <WorkspaceIcon key={w.key} w={w} personalName={personalName} />
        ))}
        <li className="flex-none snap-start">
          <Link href={CREATE} className="group grid w-[68px] justify-items-center gap-1.5 text-center" data-workspace="new">
            <span aria-hidden className={`${ICON} border-[1.5px] border-dashed border-line font-display text-[20px] font-black text-orange`}>
              +
            </span>
            <span className="max-w-[68px] truncate font-body text-[12px] font-semibold leading-[1.2] text-dim">New event</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
