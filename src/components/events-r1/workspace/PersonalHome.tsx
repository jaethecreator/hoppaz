"use client";

import Link from "next/link";
import { Calendar, Plus, Sparkles, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PayoutsScreen from "@/components/events-r1/pay/PayoutsScreen";
import { usePaidOn } from "@/components/events-r1/pay/usePay";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { readDraft, str } from "@/components/events-r1/create/draft";
import { useR1Api, useR1Auth, useR1Now, useR1Query, useRooms } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { R1Event } from "@/lib/events-r1/types";
import { roomPath } from "../rooms/words";
import EventList from "./EventList";
import type { DraftRow } from "./EventList";
import Frame from "./Frame";
import Switcher, { roomLine } from "./Switcher";
import { roleLabel } from "./words";

const NAV = [
  { id: "events", label: "Events", icon: Calendar },
  { id: "payouts", label: "Payouts", icon: Wallet },
];

/** How many different people are going to these events (the ones to bring into a room). */
function useGuestCount(events: R1Event[] | null): number {
  const api = useR1Api();
  const [n, setN] = useState(0);
  const key = (events ?? []).map((e) => `${e.id}:${e.going}`).join(",");
  useEffect(() => {
    if (!api || !events || !events.length) return setN(0);
    let live = true;
    void Promise.all(events.map((e) => api.registrations.list(e.id).catch(() => [])))
      .then((all) => {
        const ids = new Set<string>();
        for (const regs of all) for (const r of regs) if (r.status === "going" || r.status === "checked_in") ids.add(r.user_id);
        if (live) setN(ids.size);
      })
      .catch(() => live && setN(0));
    return () => {
      live = false;
    };
    // The events' own key stands for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return n;
}

/**
 * /host: the Personal workspace. Your own events that are not in a room (upcoming, drafts, past), the "Give your N guests a room" card,
 * and the rooms you are in. It works for someone with no room at all. Payouts (?tab=payouts, paid tickets on): your balance, bank and
 * withdrawals, and what your own events earned.
 */
export default function PersonalHome() {
  const api = useR1Api();
  const { user } = useR1Auth();
  const now = useR1Now();
  const mine = useR1Query((a) => a.events.listMine(), [user?.id]);
  const rooms = useRooms();
  const [asked, setAsked] = useState(true);
  const search = useSearchParams();
  const paidOn = usePaidOn();
  const [chosen, setChosen] = useState(search.get("tab") === "payouts" ? "payouts" : "events");
  const tab = chosen === "payouts" && paidOn ? "payouts" : "events";
  const nav = NAV.filter((t) => t.id !== "payouts" || paidOn);
  const go = useCallback((t: string) => {
    setChosen(t);
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", t);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    window.scrollTo?.({ top: 0 });
  }, []);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  useEffect(() => {
    const d = readDraft().event;
    const title = d ? str(d.title).trim() : "";
    setDraft(title ? { title, starts_at: null } : null);
  }, []);

  const own = (mine.data ?? []).filter((e) => !e.room_id);
  const live = own.filter((e) => e.status !== "cancelled");
  const guests = useGuestCount(live);
  const roomsIn = rooms.data?.mine ?? [];

  const frame = (body: React.ReactNode, actions?: React.ReactNode) => (
    <Frame
      look={DEFAULT_LOOK}
      switcher={<Switcher current="personal" />}
      actions={actions}
      nav={nav}
      tab={tab}
      onTab={go}
      title={tab === "payouts" ? "Payouts" : "Your events"}
      sub={tab === "payouts" ? "Everything your events have earned" : "Events you post as yourself. They don't belong to a room yet."}
      label="Personal workspace"
    >
      {body}
    </Frame>
  );

  if (!api) return <div className="h-full" />;
  if (!user) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-24">
        <div className="mx-auto w-full max-w-2xl pad-top">
          <h1 className="font-display text-[26px] font-black leading-tight">Your events and rooms</h1>
          <p className="hint mt-1">Sign in to see what you host.</p>
          <button type="button" className="btn mt-4 px-5 normal-case" onClick={() => setAsked(true)}>
            Sign in
          </button>
          <SignInSheet open={asked} reason="Manage your events" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
        </div>
      </div>
    );
  }

  const newEvent = (
    <Link href="/create?mode=event" className="lip !min-h-[44px] !px-4" data-new-event>
      <Plus size={16} strokeWidth={3} aria-hidden /> New event
    </Link>
  );
  if (tab === "payouts") return frame(<PayoutsScreen events={mine.data ? own : null} name="Personal" newEventHref="/create?mode=event" />, newEvent);

  return frame(
    <div className="flex flex-col gap-4">
      {guests > 0 && (
        <section className="t-card flex items-center gap-4 border-2 !border-t-accent p-4 shadow-lip" aria-label="Give your guests a room" data-give-room>
          <span className="grid h-12 w-12 flex-none place-items-center rounded-hz bg-t-accent text-t-on">
            <Sparkles size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="t-title text-[17px] font-extrabold leading-tight text-t-accent">
              Give your {guests.toLocaleString("en-NG")} {guests === 1 ? "guest" : "guests"} a room
            </h3>
            <p className="mt-0.5 font-body text-[13.5px] text-t-muted">Make a room and move your event into it. Your guests get one invite.</p>
          </div>
          <Link href="/create?mode=room" className="lip flex-none !px-5">
            Start
          </Link>
        </section>
      )}

      <section className="t-card p-4 lg:p-5" aria-label="Your events">
        {mine.loading && !mine.data ? (
          <p className="font-body text-[14px] text-t-muted">Loading</p>
        ) : (
          <EventList events={own} now={now} href={(e) => `/host/${encodeURIComponent(e.id)}`} draft={draft} empty="You have no events yet. Make your first one and share the link." />
        )}
        {!own.length && !draft && !mine.loading && (
          <Link href="/create?mode=event" className="lip mt-3 !px-5">
            New event
          </Link>
        )}
      </section>

      <section className="t-card p-4 lg:p-5" aria-label="Rooms you're in">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-body text-[16px] font-extrabold">Rooms you&apos;re in</h3>
          <p className="font-body text-[13.5px] text-t-muted">Switch at the top left</p>
        </div>
        {roomsIn.length ? (
          <ul className="mt-2">
            {roomsIn.map((r) => {
              const manage = r.my_role === "owner" || r.my_role === "admin";
              return (
                <li key={r.id} className="border-t border-t-line first:border-t-0">
                  <Link href={manage ? `/rooms/${encodeURIComponent(r.slug)}/admin` : roomPath(r)} className="flex min-h-[52px] items-center gap-4 py-2" data-ws-room={r.slug}>
                    <span className="w-16 flex-none font-mono text-[13px] text-t-accent">{roleLabel(r.my_role)}</span>
                    <span className="min-w-0 flex-1 truncate font-body text-[15px]">
                      {r.name} <span className="text-t-muted">· {roomLine(r)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 font-body text-[14px] text-t-muted">You are not in a room yet. Rooms keep your guests for the next night.</p>
        )}
        {!roomsIn.length && (
          <Link href="/create?mode=room" className="lip-ghost mt-3">
            Make a room
          </Link>
        )}
      </section>
    </div>,
    newEvent
  );
}
