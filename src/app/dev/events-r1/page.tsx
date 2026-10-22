"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import { useR1Api, useR1Auth, useR1Now } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";

type Dev = (typeof import("@/lib/events-r1/fake"))["fakeDev"];
type Person = ReturnType<Dev["users"]>[number];

const MIN = 60_000;
const HOUR = 60 * MIN;

/** "Fri 23 Oct 19:42" in Lagos time. */
function lagosStamp(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Release 1 dev panel for testers: sign in as someone, move the fake clock, reset the fake data, and see every seeded
 * event with a link and a valid ticket token. Only works with NEXT_PUBLIC_EVENTS_R1_FAKE=1.
 */
export default function EventsR1DevPage() {
  if (!EVENTS_R1_FAKE) {
    return (
      <main className="absolute inset-0 overflow-y-auto bg-ink px-4 py-6 text-cream">
        <p className="hint">The Release 1 fake data is off. Start the app with NEXT_PUBLIC_EVENTS_R1_FAKE=1.</p>
      </main>
    );
  }
  return <Panel />;
}

function Panel() {
  const api = useR1Api();
  const { user, signOut } = useR1Auth();
  const now = useR1Now();
  const [dev, setDev] = useState<Dev | null>(null);
  const [events, setEvents] = useState<R1Event[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [offset, setOffset] = useState(0);
  const [ticket, setTicket] = useState<{ id: string; text: string } | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    void import("@/lib/events-r1/fake").then((m) => setDev(m.fakeDev));
  }, []);

  const refresh = useCallback(() => {
    if (!dev) return;
    setEvents(dev.allEvents());
    setPeople(dev.users());
    setOffset(dev.getOffset());
  }, [dev]);

  useEffect(() => {
    refresh();
    return api?.events.subscribe(refresh);
  }, [api, refresh]);

  if (!dev) return <main className="absolute inset-0 bg-ink" />;

  const nextBefore20 = events.find((e) => e.status !== "cancelled" && Date.parse(e.starts_at) - 20 * MIN > now);
  const sign = (id: string) => dev.signInAs(id);

  const makeToken = async (e: R1Event) => {
    const t = await dev.sampleTicket(e.id);
    setTicket({
      id: e.id,
      text: t ? `${t.name}\ncode ${t.code}\n${t.token}` : "No one is going to this event yet.",
    });
  };

  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 pb-16 pt-4 text-cream">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-[26px] font-black">Events Release 1</h1>
        <p className="hint mt-1">Mode: fake data, saved in this browser. Nothing here touches a database.</p>

        <section className="card mt-4">
          <h2 className="seclabel">Signed in</h2>
          <p className="mt-2 font-body text-[15px]">{user ? `${user.name} (${user.email})` : "Nobody. You are a guest."}</p>
          <p className="seclabel mt-4">Sign in as</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {people.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={user?.id === p.id} onClick={() => sign(p.id)}>
                {p.name} ({p.role})
              </button>
            ))}
          </div>
          <button type="button" className="chip mt-3" onClick={() => void signOut()} disabled={!user}>
            Sign out
          </button>
        </section>

        <section className="card mt-4">
          <h2 className="seclabel">Clock</h2>
          <p className="mt-2 font-display text-[20px] font-black">Now: {lagosStamp(now)}</p>
          <p className="hint">{offset === 0 ? "Real time." : `${offset > 0 ? "+" : ""}${Math.round(offset / MIN)} minutes from real time.`}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={() => dev.advance(15 * MIN)}>+15 min</button>
            <button type="button" className="chip" onClick={() => dev.advance(HOUR)}>+1 hour</button>
            <button type="button" className="chip" onClick={() => dev.advance(24 * HOUR)}>+1 day</button>
            <button
              type="button"
              className="chip"
              disabled={!nextBefore20}
              onClick={() => nextBefore20 && dev.jumpTo(Date.parse(nextBefore20.starts_at) - 20 * MIN)}
            >
              To 20 minutes before the next event
            </button>
            <button type="button" className="chip" onClick={() => dev.resetClock()}>Reset time</button>
          </div>
          {nextBefore20 && <p className="hint mt-2">Next event: {nextBefore20.title}, {lagosStamp(Date.parse(nextBefore20.starts_at))}</p>}
        </section>

        <section className="card mt-4">
          <h2 className="seclabel">Fake data</h2>
          <p className="hint mt-2">Clears every event, registration, Pop and report you made, signs you out and resets the clock.</p>
          <button
            type="button"
            className="btn mt-3"
            onClick={() => {
              dev.resetAll();
              setTicket(null);
              setNote("Fake data reset.");
            }}
          >
            Reset all fake data
          </button>
          {note && <p className="hint mt-2">{note}</p>}
        </section>

        <section className="mt-6">
          <h2 className="seclabel">Seeded events ({events.length})</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left font-body text-[13px]">
              <thead>
                <tr className="border-b border-line text-dim">
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Host</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Who sees it</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Going</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      {e.title}
                      {e.price_naira > 0 && <span className="hint"> (paid)</span>}
                      {e.requires_approval && <span className="hint"> (approval)</span>}
                    </td>
                    <td className="py-2 pr-3">{e.host.name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{lagosStamp(Date.parse(e.starts_at))}</td>
                    <td className="py-2 pr-3">{e.kind === "in_person" ? "In person" : e.kind === "online" ? `Online${e.link_type ? ` (${e.link_type})` : ""}` : "Both"}</td>
                    <td className="py-2 pr-3">{e.visibility}</td>
                    <td className="py-2 pr-3">{e.status}</td>
                    <td className="py-2 pr-3">{e.going}{e.capacity !== null ? ` / ${e.capacity}` : ""}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/event/${e.id}`} className="chip">open</Link>
                        <button type="button" className="chip" onClick={() => void makeToken(e)}>ticket token</button>
                      </div>
                      {ticket?.id === e.id && (
                        <textarea
                          readOnly
                          rows={4}
                          value={ticket.text}
                          onFocus={(ev) => ev.currentTarget.select()}
                          className="mt-2 w-full rounded-hz border border-line bg-ink-2 p-2 font-mono text-[11px] text-cream"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-3">
            A token is for one person who is going. Paste it into the door scan to see it check in. Sign in as the host of the event first.
          </p>
        </section>
      </div>
    </main>
  );
}
