"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useR1Api, useR1Auth, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import { isListing, listedByLine } from "@/lib/events-r1/listing";
import type { R1Event, ViewerState } from "@/lib/events-r1/types";
import { naira } from "../pay/words";
import { usePaidOn, useSales } from "../pay/usePay";
import JoinCall from "./JoinCall";
import { hasOnline } from "./link";
import { copyText, eventUrl, shareOrCopy } from "./share";
import { endOf } from "./time";

/**
 * "Manage event bar" (mock-up manage-bar/index.html, approved by Jae). Host chrome pinned to the top of the host's own event
 * page: the event's colours inverted, so it never reads as part of the event. It has no lip button, the page keeps its one main
 * action. It shows for the host, a room owner or admin and staff (ViewerState.isHost), and never in "View as visitor".
 * Under it, on a Personal event with no room, a thin nudge to make a room; closing it is remembered per event.
 */

type Stage = "up" | "now" | "ended" | "cx";

const HOUR = 3.6e6;
const DAY = 24 * HOUR;

function stageOf(e: R1Event, now: number): Stage {
  if (e.status === "cancelled") return "cx";
  if (e.status === "ended" || now >= endOf(e)) return "ended";
  return now >= Date.parse(e.starts_at) ? "now" : "up";
}

/** "2 days", "5 hours", "40 minutes". */
function inWords(e: R1Event, now: number): string {
  const diff = Math.max(0, Date.parse(e.starts_at) - now);
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (diff >= DAY) return p(Math.floor(diff / DAY), "day");
  if (diff >= HOUR) return p(Math.floor(diff / HOUR), "hour");
  return p(Math.max(1, Math.ceil(diff / 60_000)), "minute");
}

const NUDGE_KEY = (id: string) => `hz.r1.roomNudge.${id}`;
function nudgeClosed(id: string): boolean {
  try {
    return window.localStorage.getItem(NUDGE_KEY(id)) === "1";
  } catch {
    return false;
  }
}
function closeNudge(id: string) {
  try {
    window.localStorage.setItem(NUDGE_KEY(id), "1");
  } catch {
    /* storage is blocked: the nudge comes back next visit, the page still works */
  }
}

const B1 = "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-hz bg-t-bg px-3 font-display text-[14px] font-extrabold text-t-text lg:min-h-[40px] lg:px-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-t-bg";
const B2 = "hidden min-h-[40px] items-center justify-center whitespace-nowrap rounded-hz border border-[color-mix(in_srgb,var(--t-bg)_32%,transparent)] px-3.5 font-body text-[14px] font-bold text-t-bg lg:inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-t-bg";
const ITEM = "flex min-h-[44px] w-full items-center rounded-hz px-3 text-left font-body text-[14.5px] font-semibold hover:bg-t-soft";

export default function ManageBar({ event, viewer }: { event: R1Event; viewer: ViewerState }) {
  const api = useR1Api();
  const router = useRouter();
  const { user } = useR1Auth();
  const now = useR1Now();
  const [menu, setMenu] = useState(false);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(true);

  useEffect(() => setClosed(nudgeClosed(event.id)), [event.id]);
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(""), 2200);
    return () => window.clearTimeout(t);
  }, [said]);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest("[data-mb-menu],[data-mb-more]")) setMenu(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  const stage = stageOf(event, now);
  const id = encodeURIComponent(event.id);
  const dash = `/host/${id}`;

  const counts = useR1Query((a) => a.door.counts(event.id), [event.id, event.going]);
  const paidOn = usePaidOn();
  const priced = event.ticket_types.some((t) => t.price_naira > 0);
  const sales = useSales(event.id, paidOn && priced).data;
  const going = counts.data?.going ?? event.going;
  const checked = counts.data?.checked_in ?? 0;
  const gross = sales?.totals.gross_naira ?? null;

  const url = eventUrl(event);
  const share = async () => {
    setMenu(false);
    const r = await shareOrCopy({ title: event.title, text: event.title, url });
    if (r === "copied") setSaid("Link copied");
    else if (r === "failed") setSaid("Could not copy");
  };
  const copy = async () => {
    setMenu(false);
    setSaid((await copyText(url)) ? "Link copied" : "Could not copy");
  };
  // Duplicate: the data layer's own clone (everything but the guests, a week on), then straight to the copy's dashboard like Details does.
  const duplicate = async () => {
    setMenu(false);
    if (!api || busy) return;
    setBusy(true);
    try {
      const made = await api.events.clone(event.id);
      router.push(`/host/${encodeURIComponent(made.id)}?new=1`);
    } catch {
      setSaid("Could not duplicate");
      setBusy(false);
    }
  };

  const num = (v: React.ReactNode, rest: string) => (
    <span className="whitespace-nowrap text-[color-mix(in_srgb,var(--t-bg)_72%,transparent)]">
      <b className="tabular-nums text-t-bg">{v}</b> {rest}
    </span>
  );
  const sold = gross !== null ? num(naira(gross), "in sales") : null;

  let dot = "bg-[#2FD35C]";
  let pulse = false;
  let status: React.ReactNode;
  let nums: React.ReactNode;
  let acts: React.ReactNode;
  let phoneMain: React.ReactNode;
  let items: Array<{ key: string; label: string; href?: string; on?: () => void }>;
  const mgmt = { key: "manage", label: "Manage event", href: dash };
  const vis = { key: "vis", label: "View as visitor", href: "?as=visitor" };
  const shareI = { key: "share", label: "Share", on: () => void share() };
  const copyI = { key: "copy", label: "Copy link", on: () => void copy() };
  const dupI = { key: "dup", label: "Duplicate event", on: () => void duplicate() };

  const visBtn = (
    <Link href="?as=visitor" className={B2} data-view-visitor>
      View as visitor
    </Link>
  );
  const btn2 = (label: string, on: () => void) => (
    <button type="button" onClick={on} className={B2}>
      {label}
    </button>
  );

  if (stage === "up") {
    status = (
      <>
        <span className="lg:hidden">In {inWords(event, now)}</span>
        <span className="hidden lg:inline">Live · starts in {inWords(event, now)}</span>
      </>
    );
    nums = (
      <>
        {num(going, "going")}
        <span className="hidden lg:contents">{sold}</span>
      </>
    );
    phoneMain = (
      <Link href={dash} className={`${B1} lg:hidden`}>
        Manage
      </Link>
    );
    acts = (
      <>
        {visBtn}
        {btn2("Share", () => void share())}
        <Link href={dash} className={`${B1} hidden lg:inline-flex`}>
          Manage event
        </Link>
      </>
    );
    items = [vis, shareI, copyI, dupI];
  } else if (stage === "now") {
    dot = "bg-[#2FD35C]";
    pulse = true;
    status = (
      <>
        <span className="lg:hidden">Now</span>
        <span className="hidden lg:inline">Happening now</span>
      </>
    );
    nums = (
      <>
        <span className="whitespace-nowrap text-[color-mix(in_srgb,var(--t-bg)_72%,transparent)]">
          <b className="tabular-nums text-t-bg">{checked}</b>
          <span className="lg:hidden">/{going} in</span>
          <span className="hidden lg:inline"> of {going} checked in</span>
        </span>
        <span className="hidden lg:contents">{sold}</span>
      </>
    );
    phoneMain = (
      <Link href={`${dash}/door`} className={`${B1} lg:hidden`}>
        Door scanner
      </Link>
    );
    acts = (
      <>
        {visBtn}
        <Link href={dash} className={B2}>
          Manage event
        </Link>
        <Link href={`${dash}/door`} className={`${B1} hidden lg:inline-flex`}>
          Open door scanner
        </Link>
      </>
    );
    items = [mgmt, vis, shareI, copyI];
  } else if (stage === "ended") {
    dot = "bg-[color-mix(in_srgb,var(--t-bg)_55%,transparent)]";
    status = "Ended";
    nums = (
      <>
        <span className="whitespace-nowrap text-[color-mix(in_srgb,var(--t-bg)_72%,transparent)]">
          <b className="tabular-nums text-t-bg">{checked}</b>
          <span className="lg:hidden"> came</span>
          <span className="hidden lg:inline"> came of {going}</span>
        </span>
        <span className="hidden lg:contents">{sold}</span>
      </>
    );
    phoneMain = (
      <Link href={dash} className={`${B1} lg:hidden`}>
        How it went
      </Link>
    );
    acts = (
      <>
        {visBtn}
        {btn2("Duplicate event", () => void duplicate())}
        <Link href={dash} className={`${B1} hidden lg:inline-flex`}>
          See how it went
        </Link>
      </>
    );
    items = [dupI, vis, mgmt, copyI];
  } else {
    dot = "bg-[#E5484D]";
    status = "Cancelled";
    const refunded = sales?.totals.refunded_naira ?? 0;
    nums = refunded > 0 ? num(naira(refunded), "refunded") : null;
    phoneMain = (
      <Link href={dash} className={`${B1} lg:hidden`}>
        Manage
      </Link>
    );
    acts = (
      <>
        {visBtn}
        <Link href={dash} className={`${B1} hidden lg:inline-flex`}>
          Manage event
        </Link>
      </>
    );
    items = [vis, dupI];
  }

  // A listing is ticketed on the organiser's page: no going, checked in or sales numbers, and no door.
  if (isListing(event)) {
    nums = null;
    if (stage === "now") {
      phoneMain = (
        <Link href={dash} className={`${B1} lg:hidden`}>
          Manage
        </Link>
      );
    }
  }

  // An unclaimed listing is run by staff (the Hoppaz Listings account owns it): say so, and point at the Outreach tracker.
  const staffListing = isListing(event) && !event.listing?.claimed;
  const by = isListing(event)
    ? listedByLine(event)
    : user && event.host.id !== user.id
      ? `${event.host.name} posted this${event.host.roomName && event.host.roomName !== event.host.name ? ` for ${event.host.roomName}` : ""}`
      : "";
  const tracker = staffListing ? (
    <Link href="/admin?s=outreach" className="whitespace-nowrap font-bold underline underline-offset-[3px]">
      Outreach tracker
    </Link>
  ) : null;
  const personal = !event.room_id && !event.host.roomId;
  const nudge = personal && !closed && (stage === "up" || stage === "now");

  return (
    <>
      <div
        role="region"
        aria-label="Manage your event"
        data-manage-bar
        data-stage={stage}
        className="sticky top-0 z-40 flex flex-nowrap items-center gap-x-4 gap-y-2 bg-t-text py-2 pl-3.5 pr-2.5 text-[14px] text-t-bg lg:flex-wrap lg:px-[30px] lg:py-2.5"
      >
        <span className="inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-hz bg-[color-mix(in_srgb,var(--t-bg)_12%,transparent)] px-2 py-1 font-body text-[12.5px] font-extrabold lg:px-2.5 lg:py-[5px] lg:text-[13.5px]">
          <i className={`h-2 w-2 flex-none rounded-full ${dot} ${pulse ? "motion-safe:animate-pulse" : ""}`} aria-hidden />
          {status}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-[13px] lg:flex-none lg:text-[14px]">{nums}</div>
        {by && (
          <span className="hidden whitespace-nowrap text-[12.5px] text-[color-mix(in_srgb,var(--t-bg)_70%,transparent)] lg:inline">
            {by}
            {tracker && <> · {tracker}</>}
          </span>
        )}
        <div className="flex flex-none items-center gap-1.5 lg:ml-auto lg:gap-2">
          {acts}
          {phoneMain}
          <button
            type="button"
            data-mb-more
            aria-label="More actions"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu((m) => !m)}
            className="grid h-11 w-11 flex-none place-items-center rounded-hz border border-[color-mix(in_srgb,var(--t-bg)_32%,transparent)] text-[20px] font-extrabold leading-none text-t-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-t-bg lg:hidden"
          >
            ⋯
          </button>
        </div>
        {menu && (
          <div role="menu" data-mb-menu className="absolute right-3 top-full mt-1.5 grid w-[230px] gap-0.5 rounded-hz border border-t-line bg-t-solid p-1.5 text-t-text shadow-[0_18px_40px_-12px_rgba(0,0,0,.5)] lg:hidden">
            {items.map((m) =>
              m.href ? (
                <Link key={m.key} role="menuitem" href={m.href} onClick={() => setMenu(false)} className={ITEM} {...(m.key === "vis" ? { "data-view-visitor": true } : {})}>
                  {m.label}
                </Link>
              ) : (
                <button key={m.key} type="button" role="menuitem" onClick={m.on} className={ITEM}>
                  {m.label}
                </button>
              )
            )}
          </div>
        )}
      </div>
      {by && (
        <p className="m-0 border-b border-t-line bg-t-tile px-3.5 py-2 font-body text-[13.5px] text-t-muted lg:hidden">
          {by}
          {tracker && <> · {tracker}</>}
        </p>
      )}
      {nudge && (
        <div data-room-nudge className="flex items-center gap-x-3 border-b border-t-line bg-t-soft py-2 pl-3.5 pr-2 font-body text-[13.5px] lg:px-[30px] lg:text-[14px]">
          <span className="min-w-0 flex-1 lg:min-w-[220px]">Your guests have no chat yet. A room gives them one, and keeps them for your next event.</span>
          <Link href="/create?mode=room&from=event" className="inline-flex min-h-[44px] flex-none items-center whitespace-nowrap font-body text-[14px] font-bold text-t-accent underline underline-offset-[3px]">
            Make a room
          </Link>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              closeNudge(event.id);
              setClosed(true);
            }}
            className="grid h-11 w-11 flex-none place-items-center rounded-hz text-t-muted"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      )}
      {said && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
          {said}
        </div>
      )}
    </>
  );
}

/**
 * What the old "You host this event" strip also held and the bar does not: the "Your event is live" line after a new event
 * (?new=1) and Join call for an online event. Sits in the side column where the strip sat; nothing when there is neither.
 */
export function HostExtras({ event, viewer }: { event: R1Event; viewer: ViewerState }) {
  const now = useR1Now();
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    setFresh(new URLSearchParams(window.location.search).get("new") === "1");
  }, []);
  const online = hasOnline(event);
  if (!fresh && !online) return null;
  return (
    <div>
      {fresh && (
        <p className="mb-2 flex items-center gap-1.5 font-body text-[14px] text-t-text">
          <Check size={15} strokeWidth={3} className="text-t-accent" aria-hidden /> Your event is live
        </p>
      )}
      {online && (
        <div className="rounded-hz border border-t-line bg-t-tile p-3">
          <JoinCall event={event} viewer={viewer} now={now} />
        </div>
      )}
    </div>
  );
}
