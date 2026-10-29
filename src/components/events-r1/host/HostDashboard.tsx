"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { ChevronLeft, Eye, Grid3x3, Home, LayoutPanelTop, Megaphone, Pencil, Ticket, Users, Wallet } from "lucide-react";
import TintShell, { usePictureTint } from "@/components/host/TintShell";
import SalesTab from "@/components/events-r1/pay/SalesTab";
import { usePaidOn } from "@/components/events-r1/pay/usePay";
import { fallbackCover } from "@/components/events-r1/page/HostStory";
import { eventUrl, shareOrCopy } from "@/components/events-r1/page/share";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api, useR1Auth, useR1Event, useR1Query, useRegistrations } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event } from "@/lib/events-r1/types";
import { themeForEvent } from "@/lib/theme";
import DetailsTab from "./DetailsTab";
import GuestsTab from "./GuestsTab";
import OverviewTab from "./OverviewTab";
import PopsTab from "./PopsTab";
import RoomPopup from "./RoomPopup";
import RoomTab from "./RoomTab";
import TicketsTab from "./TicketsTab";
import TwoDTab from "./TwoDTab";
import { countsOf } from "./words";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;

export const TABS = [
  { id: "overview", label: "Overview", icon: Home as Icon },
  { id: "details", label: "Details", icon: Pencil as Icon },
  { id: "tickets", label: "Tickets", icon: Ticket as Icon },
  { id: "guests", label: "Guests", icon: Users as Icon },
  { id: "pops", label: "Pops", icon: Megaphone as Icon },
  { id: "twod", label: "2D room", icon: Grid3x3 as Icon },
  { id: "room", label: "Room", icon: LayoutPanelTop as Icon },
  { id: "payouts", label: "Payouts", icon: Wallet as Icon },
] as const;
export type TabId = (typeof TABS)[number]["id"];

/** The old ?tab= ids (before the dashboard was rebuilt) and where they go now, so a saved link still lands somewhere sensible. */
export const LEGACY_TABS: Record<string, TabId> = {
  audience: "guests",
  registration: "tickets",
  sales: "payouts",
  roomz: "room",
  more: "details",
};

export const tabFromParam = (raw: string | null): TabId => TABS.find((t) => t.id === raw)?.id ?? (raw ? LEGACY_TABS[raw] : undefined) ?? "overview";

const SUB: Partial<Record<TabId, string>> = {
  details: "Changes save as you type.",
  tickets: "Free or paid, spots, the waitlist and the questions we ask.",
  pops: "Messages to your guests. They land in the app; also in your room when you have one.",
  twod: "A walkable space for this event. Guests show up as avatars, chat with people near them and join the voice stage.",
  payouts: "What you have earned, what you can withdraw, and every order.",
};

/** "Fri 30 Oct · 8:00 PM" in the event's own time zone. */
function whenShort(e: R1Event): string {
  const t = Date.parse(e.starts_at);
  if (!Number.isFinite(t)) return "";
  let f: Intl.DateTimeFormat;
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true };
  try {
    f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: e.timezone || "Africa/Lagos" });
  } catch {
    f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "Africa/Lagos" });
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`;
}

const STATUS_WORD: Record<R1Event["status"], string> = { live: "Live", cancelled: "Cancelled", ended: "Ended" };
const STATUS_DOT: Record<R1Event["status"], string> = { live: "bg-[#1FA847]", cancelled: "bg-[#E5484D]", ended: "bg-t-muted" };

/**
 * Release 1 host dashboard at /host/<id>. Only the host and staff get in: anyone else goes to the event page, and someone signed
 * out gets the sign-in sheet first. The tab lives in the URL (?tab=) so a refresh stays put; the old tab ids still work.
 * The whole dashboard wears the event's look, the same way the event page does: a top bar and a 232px nav on a wide screen, a
 * tab strip on a phone.
 */
export default function HostDashboard({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const api = useR1Api();
  useR1Auth(); // re-render on sign in and sign out
  const event = useR1Event(id);
  const regs = useRegistrations(id);
  const savedLook = useR1Query((a) => a.looks.get("event", id), [id]);
  const [asked, setAsked] = useState(true);
  const [said, setSaid] = useState("");
  const strip = useRef<HTMLDivElement>(null);
  // Payouts shows only while paid tickets are on.
  const paidOn = usePaidOn();
  const tabs = TABS.filter((t) => t.id !== "payouts" || paidOn);

  const signedIn = api ? !!api.auth.current() : null;
  const denied = signedIn === true && regs.error?.message === "Not allowed";
  useEffect(() => {
    if (denied) router.replace(`/event/${encodeURIComponent(id)}`);
  }, [denied, id, router]);

  const rawTab = search.get("tab");
  const [chosen, setTab] = useState<TabId>(tabFromParam(rawTab));
  // With paid tickets off a ?tab=payouts (or ?tab=sales) address, or a tab left open, falls back to Overview.
  const tab: TabId = tabs.some((t) => t.id === chosen) ? chosen : "overview";
  const fresh = search.get("new") === "1";
  // The tab is kept in the address bar (?tab=) without a trip to the server, so switching is instant and a refresh stays put.
  const go = useCallback((t: TabId) => {
    setTab(t);
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", t);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
  }, []);
  // An old tab id in the address is rewritten to the new one.
  useEffect(() => {
    if (rawTab && !TABS.some((t) => t.id === rawTab) && LEGACY_TABS[rawTab]) go(LEGACY_TABS[rawTab]);
  }, [rawTab, go]);

  // Keep the chosen tab in view on a phone.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab, event.data?.id]);

  // The look: what was saved, or (an older event) the cover's colour. Edits show at once and are saved by the Details tab.
  const e = event.data;
  const [edited, setEdited] = useState<Look | null>(null);
  const cover = e ? e.flyer_url || fallbackCover(e.id) : null;
  const look: Look = edited ?? savedLook.data ?? { ...DEFAULT_LOOK, mood: e && themeForEvent(e.starts_at) === "day" ? "day" : "night", auto: true };
  const tint = usePictureTint(cover, look);
  // Where the dashboard sits: inside a room (its owner or admin sees "‹ Room name", back to the room admin) or in Personal.
  const homeRoom = useR1Query((a) => (e?.room_id ? a.rooms.get(e.room_id) : Promise.resolve(null)), [e?.room_id]);
  const me = api?.auth.current()?.id;
  const inRoom = e?.room_id ? homeRoom.data : null;
  const workspace: { label: string; href: string } | null =
    e && e.room_id
      ? inRoom && (inRoom.my_role === "owner" || inRoom.my_role === "admin")
        ? { label: inRoom.name, href: `/rooms/${encodeURIComponent(inRoom.slug)}/admin?tab=events` }
        : null
      : e && me && e.host.id === me
        ? { label: "Personal", href: "/host" }
        : null;

  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(""), 2000);
    return () => window.clearTimeout(t);
  }, [said]);

  const back = () => {
    // A new event came from the create page: back goes home, not to an empty form.
    if (fresh) return router.replace("/");
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace(`/event/${encodeURIComponent(id)}`);
  };

  const plain = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full min-w-0 max-w-2xl">{children}</div>
    </div>
  );

  if (signedIn === null) return plain(<p className="hint pad-top">Loading</p>);

  if (!signedIn) {
    return plain(
      <div className="pad-top">
        <h1 className="font-display text-[26px] font-black leading-tight">Manage your event</h1>
        <p className="hint mt-1">Sign in to see your event.</p>
        <button type="button" className="btn mt-4 px-5 normal-case" onClick={() => setAsked(true)}>
          Sign in
        </button>
        <SignInSheet open={asked} reason="Manage your event" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
      </div>
    );
  }

  if (denied) return plain(<p className="hint pad-top">Taking you to the event page</p>);
  if (!e) {
    return plain(
      event.loading || regs.loading ? (
        <p className="hint pad-top">Loading</p>
      ) : (
        <div className="pad-top">
          <h1 className="font-display text-[26px] font-black leading-tight">We can&apos;t find this event</h1>
          <Link href="/" className="btn mt-4 px-5 normal-case">
            Back to events
          </Link>
        </div>
      )
    );
  }

  const people = regs.data ?? null;
  const pending = countsOf(people).pending;
  const noRoom = !e.room_id;
  const label = TABS.find((t) => t.id === tab)?.label ?? "Overview";
  const sub = tab === "tickets" && paidOn ? "Payouts go to your bank after the event. Hoppaz fee is inside the price." : SUB[tab];

  const share = async () => {
    const r = await shareOrCopy({ title: e.title, text: e.title, url: eventUrl(e) });
    if (r === "copied") setSaid("Link copied");
    else if (r === "failed") setSaid("Could not copy");
  };

  const badge = (t: TabId) => (t === "guests" && pending > 0 ? String(pending) : t === "room" && noRoom ? "New" : "");

  return (
    <div className="h-full overflow-y-auto">
      <TintShell look={look} tint={tint} className="min-h-full">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-t-line bg-t-bg px-4 py-2.5 lg:px-5 lg:py-3">
          {workspace ? (
            <Link href={workspace.href} aria-label={`Back to ${workspace.label}`} className="lip-ghost flex-none !min-h-[40px] max-w-[42vw] !gap-1 !px-3" data-workspace-back>
              <ChevronLeft size={16} strokeWidth={2.4} aria-hidden />
              <span className="truncate">{workspace.label}</span>
            </Link>
          ) : (
            <button type="button" onClick={back} aria-label="Back" className="-ml-2 grid h-10 w-8 flex-none place-items-center text-t-text">
              <ChevronLeft size={22} strokeWidth={2.2} aria-hidden />
            </button>
          )}
          {cover && <img src={cover} alt="" className="h-10 w-10 flex-none rounded-hz border border-t-line object-cover lg:h-12 lg:w-12" />}
          <div className="min-w-0 flex-1">
            <h1 className="t-title truncate text-[15px] font-extrabold leading-tight lg:text-[19px]">{e.title}</h1>
            <p className="flex items-center gap-1.5 truncate font-body text-[12.5px] text-t-muted lg:text-[13.5px]">
              <span className="truncate">{whenShort(e)}</span>
              <span className="flex flex-none items-center gap-1 font-bold">
                <span className={clsx("h-2 w-2 rounded-full", STATUS_DOT[e.status])} aria-hidden />
                {STATUS_WORD[e.status]}
              </span>
            </p>
          </div>
          <Link href={`/event/${encodeURIComponent(e.id)}`} className="lip-ghost hidden flex-none lg:inline-flex">
            <Eye size={16} aria-hidden /> View page
          </Link>
          <button type="button" onClick={() => void share()} className="lip !min-h-[40px] flex-none !px-4 !py-2">
            Share
          </button>
        </header>

        <div className="lg:grid lg:min-h-[calc(100dvh-73px)] lg:grid-cols-[232px_minmax(0,1fr)]">
          <nav aria-label="Event dashboard" className="hidden border-r border-t-line lg:block">
            <div role="tablist" aria-orientation="vertical" className="sticky top-[73px] flex flex-col gap-1 p-4">
              {tabs.map((t) => {
                const Icon = t.icon;
                const on = tab === t.id;
                const b = badge(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={on}
                    aria-controls="host-panel"
                    onClick={() => go(t.id)}
                    className={clsx("flex min-h-[44px] items-center gap-3 rounded-hz px-3 text-left font-body text-[15px] font-semibold", on ? "bg-t-soft text-t-text" : "text-t-muted hover:text-t-text")}
                  >
                    <Icon size={18} aria-hidden />
                    <span className="flex-1">{t.label}</span>
                    {b && <span className="rounded-full bg-t-accent px-2 py-0.5 font-body text-[11px] font-extrabold text-t-on">{b}</span>}
                  </button>
                );
              })}
              <div className="my-2 h-px bg-t-line" />
              <Link href={`/event/${encodeURIComponent(e.id)}`} className="flex min-h-[44px] items-center gap-3 rounded-hz px-3 font-body text-[15px] font-semibold text-t-muted hover:text-t-text">
                <Eye size={18} aria-hidden /> View page
              </Link>
            </div>
          </nav>

          <main className="min-w-0 px-4 pb-28 lg:px-8 lg:pb-16">
            <div ref={strip} role="tablist" aria-label="Event dashboard" className="sticky top-[61px] z-20 -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-t-line bg-t-bg px-4 py-2 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
              {tabs.map((t) => {
                const b = badge(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`mtab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls="host-panel"
                    onClick={() => go(t.id)}
                    className={clsx("flex min-h-[40px] flex-none items-center gap-1.5 rounded-hz px-3 font-body text-[14.5px] font-semibold", tab === t.id ? "bg-t-soft text-t-text" : "text-t-muted")}
                  >
                    {t.label}
                    {b && <span className="rounded-full bg-t-accent px-1.5 text-[10.5px] font-extrabold text-t-on">{b}</span>}
                  </button>
                );
              })}
            </div>

            <div className="t-adopt mx-auto w-full max-w-[860px] lg:mx-0 lg:pt-6">
              <h2 className="t-title mb-1 text-[26px] font-extrabold leading-tight lg:text-[32px]">{label}</h2>
              {sub && <p className="mb-4 font-body text-[14.5px] text-t-muted">{sub}</p>}
              <div role="tabpanel" id="host-panel" aria-labelledby={`tab-${tab}`} className={sub ? "" : "mt-4"}>
                {tab === "overview" && <OverviewTab event={e} regs={people} fresh={fresh} onTab={go} />}
                {tab === "details" && <DetailsTab key={e.id} event={e} look={look} cover={cover} onLook={setEdited} />}
                {tab === "tickets" && <TicketsTab key={e.id} event={e} />}
                {tab === "guests" && <GuestsTab event={e} regs={people} loading={regs.loading} />}
                {tab === "pops" && <PopsTab eventId={e.id} />}
                {tab === "twod" && <TwoDTab key={e.id} event={e} look={look} onLook={setEdited} />}
                {tab === "room" && <RoomTab event={e} regs={people} />}
                {tab === "payouts" && <SalesTab event={e} />}
              </div>
            </div>
          </main>
        </div>

        {said && (
          <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
            {said}
          </div>
        )}
        {noRoom && <RoomPopup event={e} going={people ? countsOf(people).going : e.going} />}
      </TintShell>
    </div>
  );
}
