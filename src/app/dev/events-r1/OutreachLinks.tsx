"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Organiser, ScoutBatch, ScoutEvent, Transfer } from "@/lib/events-r1/types";

type Made = { org: string; link: string; transfer: Transfer };

/**
 * Dev panel: make claim links for the seeded organisers (the staff desk's Create link), open them, cancel them.
 * "Add a listed organiser" runs a small scout batch and approves it, so there is a room and listings to hand over.
 * An expired link: make one, then move the clock forward 15 days. Fake data only.
 */
const DAY = 864e5;
let seq = 0;

function batch(name: string, handle: string): ScoutBatch {
  const n = ++seq + Date.now().toString(36);
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * DAY);
    d.setUTCHours(hour - 1, 0, 0, 0);
    return d.toISOString().replace("Z", "+00:00");
  };
  const ev = (i: number, title: string, days: number): ScoutEvent => ({
    source_site: "Tix",
    source_id: `dev-${n}-${i}`,
    name: title,
    starts_at: at(days, 20),
    ends_at: null,
    venue: "Landmark Centre",
    area: "Victoria Island",
    lat: 6.4281,
    lng: 3.4219,
    pin_by: "venues",
    description: `${title} by ${name}. A night of music and people.`,
    tickets: [{ name: "Regular", price_naira: 5000, sold_out: false }],
    sold_out: false,
    ticket_url: `https://example.com/tix/${n}-${i}`,
    flyer_url: null,
    category: "party",
    organiser_name: name,
    organiser_handle: handle,
    event_handle: null,
    organiser_email: null,
    organiser_phone: null,
    lineup: [],
    capacity: null,
    last_seen: new Date().toISOString(),
    confidence: "confirmed",
  });
  return { run_id: `dev-${n}`, scouted_at: new Date().toISOString(), sources_covered: [], events: [ev(1, `${name} Friday`, 5), ev(2, `${name} Saturday`, 12)] };
}

export default function OutreachLinks() {
  const api = useR1Api();
  const [orgs, setOrgs] = useState<Organiser[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [email, setEmail] = useState("organiser@example.com");
  const [days, setDays] = useState("14");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    if (!api) return;
    api.outreach.organisers().then(setOrgs, (e) => setNote(e instanceof Error ? e.message : "Could not load organisers"));
  }, [api]);
  useEffect(load, [load]);
  useEffect(() => api?.events.subscribe(load), [api, load]);

  const make = async (o: Organiser) => {
    if (!api) return;
    setNote("");
    try {
      const n = Number(days);
      const r = await api.outreach.createTransfer(o.id, email.trim(), "dev panel", Number.isFinite(n) ? n : undefined);
      setMade((m) => [{ org: o.name, link: r.link, transfer: r.transfer }, ...m]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work");
    }
  };
  const revoke = async (t: Transfer) => {
    if (!api) return;
    try {
      await api.outreach.revokeTransfer(t.id, "dev panel");
      setNote("Link cancelled.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work");
    }
  };
  const seed = async () => {
    if (!api) return;
    setNote("");
    try {
      const k = orgs.length + 1;
      const name = `Dev Collective ${k}`;
      await api.outreach.importBatch(batch(name, `dev.collective${k}`), { dryRun: false });
      const rows = (await api.outreach.queue()).filter((r) => r.fields.organiser_name === name && r.status === "new");
      for (const r of rows) await api.outreach.approve(r.id, "dev panel");
      setNote(`${name} listed with ${rows.length} events.`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work");
    }
  };
  const later = async () => {
    const m = await import("@/lib/events-r1/fake");
    m.fakeDev.advance(15 * DAY);
    setNote("Clock moved 15 days on. Use Reset time in the Clock section to undo.");
  };
  const path = (link: string) => {
    try {
      return new URL(link).pathname;
    } catch {
      return link;
    }
  };

  return (
    <section className="card mt-4">
      <h2 className="seclabel">Organiser claim links</h2>
      <p className="hint mt-2">Make a link for an organiser, then open it. The link is for the email you type. </p>
      <div className="mt-3 grid grid-cols-[1fr_5rem] gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email the link is for" placeholder="email" />
        <input value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days the link stays open" inputMode="numeric" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="chip" onClick={() => void seed()}>
          Add a listed organiser
        </button>
        <button type="button" className="chip" onClick={() => void later()}>
          Clock +15 days
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {orgs.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 font-body text-[14px]">
            <span className="min-w-0 flex-1 truncate">
              {o.name} <span className="hint">({o.stage})</span>
            </span>
            <button type="button" className="chip" onClick={() => void make(o)} disabled={o.stage === "claimed"}>
              Make link
            </button>
          </li>
        ))}
      </ul>
      {made.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2" data-made-links>
          {made.map((m) => (
            <li key={m.transfer.id} className="font-body text-[13px]">
              {m.org} for {m.transfer.to_email}:{" "}
              <Link href={path(m.link)} className="text-orange underline underline-offset-4">
                {path(m.link)}
              </Link>{" "}
              <button type="button" className="chip ml-1" onClick={() => void revoke(m.transfer)}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="hint mt-2">{note}</p>}
    </section>
  );
}
