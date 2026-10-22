"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api, useR1Auth, useR1Event, useRegistrations } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import AudienceTab from "./AudienceTab";
import MoreTab from "./MoreTab";
import OverviewTab from "./OverviewTab";
import PopsTab from "./PopsTab";
import RegistrationTab from "./RegistrationTab";
import RoomzTab from "./RoomzTab";
import { Pill } from "./ui";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "audience", label: "Audience" },
  { id: "registration", label: "Registration" },
  { id: "roomz", label: "Roomz" },
  { id: "pops", label: "Pops" },
  { id: "more", label: "More" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

const STATUS: Record<R1Event["status"], { word: string; tone: string }> = {
  live: { word: "Live", tone: "pill-keke" },
  cancelled: { word: "Cancelled", tone: "pill-fireant" },
  ended: { word: "Ended", tone: "" },
};

/**
 * Release 1 host dashboard at /host/<id>. Only the host and staff get in: anyone else goes to the event page, and
 * someone signed out gets the sign-in sheet first. The tab lives in the URL (?tab=) so a refresh stays put.
 */
export default function HostDashboard({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const api = useR1Api();
  useR1Auth(); // re-render on sign in and sign out
  const event = useR1Event(id);
  const regs = useRegistrations(id);
  const [asked, setAsked] = useState(true);
  const bar = useRef<HTMLDivElement>(null);

  const signedIn = api ? !!api.auth.current() : null;
  const denied = signedIn === true && regs.error?.message === "Not allowed";
  useEffect(() => {
    if (denied) router.replace(`/event/${encodeURIComponent(id)}`);
  }, [denied, id, router]);

  const fromUrl: TabId = TABS.find((t) => t.id === search.get("tab"))?.id ?? "overview";
  const [tab, setTab] = useState<TabId>(fromUrl);
  const fresh = search.get("new") === "1";
  // The tab is kept in the address bar (?tab=) without a trip to the server, so switching is instant and a refresh stays put.
  const go = (t: TabId) => {
    setTab(t);
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", t);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
  };

  // Keep the chosen tab in view on a phone.
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab, event.data?.id]);

  const back = () => {
    // A new event came from the create page: back goes home, not to an empty form.
    if (fresh) return router.replace("/");
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace(`/event/${encodeURIComponent(id)}`);
  };

  const shell = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full min-w-0 max-w-2xl">{children}</div>
    </div>
  );

  if (signedIn === null) return shell(<p className="hint pad-top">Loading</p>);

  if (!signedIn) {
    return shell(
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

  const e = event.data;
  if (denied) return shell(<p className="hint pad-top">Taking you to the event page</p>);
  if (!e) {
    return shell(
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

  const status = STATUS[e.status];
  const people = regs.data ?? null;

  return shell(
    <>
      <header className="pad-top pb-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={back} aria-label="Back" className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream">
            <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-display text-[24px] font-black leading-tight">{e.title}</h1>
          <Pill tone={status.tone}>{status.word}</Pill>
        </div>
        <Link href={`/event/${encodeURIComponent(e.id)}`} className="-mt-0.5 inline-flex min-h-[36px] items-center font-body text-[14px] text-orange underline underline-offset-4">
          View event page
        </Link>
      </header>

      <div ref={bar} role="tablist" aria-label="Event dashboard" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="host-panel"
            onClick={() => go(t.id)}
            className={clsx(
              "min-h-[44px] flex-none border-b-2 px-3 font-body text-[15px] transition-colors",
              tab === t.id ? "border-orange font-bold text-cream" : "border-transparent text-dim"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="host-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <OverviewTab event={e} regs={people} fresh={fresh} onTab={go} />}
        {tab === "audience" && <AudienceTab event={e} regs={people} loading={regs.loading} />}
        {tab === "registration" && <RegistrationTab key={e.id} event={e} />}
        {tab === "roomz" && <RoomzTab event={e} />}
        {tab === "pops" && <PopsTab eventId={e.id} />}
        {tab === "more" && <MoreTab event={e} />}
      </div>
    </>
  );
}
