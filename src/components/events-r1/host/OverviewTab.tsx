"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Sparkles } from "lucide-react";
import { copyText, eventUrl, shareOrCopy } from "@/components/events-r1/page/share";
import { popWhen } from "@/components/events-r1/page/time";
import GetPaidCard from "@/components/events-r1/pay/GetPaidCard";
import { usePaidOn, useSales } from "@/components/events-r1/pay/usePay";
import { naira } from "@/components/events-r1/pay/words";
import { useR1Api, useR1Now, usePops } from "@/lib/events-r1/hooks";
import type { R1Event, Registration } from "@/lib/events-r1/types";
import type { TabId } from "./HostDashboard";
import { autoLabel } from "./pops/words";
import { useFlash } from "./ui";
import { countsOf } from "./words";

const freeKey = (id: string) => `hz.r1.host.free.${id}`;
function readFree(id: string): boolean {
  try {
    return window.localStorage.getItem(freeKey(id)) === "1";
  } catch {
    return false;
  }
}

const LAGOS = 3.6e6;
const DAY = 864e5;
const lagosDay = (t: number) => Math.floor((t + LAGOS) / DAY);

function Tile({ n, label, extra }: { n: string; label: string; extra?: string }) {
  return (
    <div className="t-card p-4">
      <p className="num text-[28px] lg:text-[32px]">{n}</p>
      <p className="mt-1.5 font-body text-[13.5px] text-t-muted">
        {label}
        {extra && <b className="ml-1.5 font-bold text-[#1FA847]">{extra}</b>}
      </p>
    </div>
  );
}

/** The QR of the event link, drawn in black on white so any phone reads it. */
function Qr({ url, title }: { url: string; title: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: "M" }).then(
      (d) => live && setSrc(d),
      () => live && setSrc("")
    );
    return () => {
      live = false;
    };
  }, [url]);
  if (!src) return null;
  return (
    <div className="mt-3 flex items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made here */}
      <img src={src} alt={`QR code for ${title}`} width={140} height={140} className="rounded-hz border border-t-line bg-white p-1.5" />
      <a href={src} download={`${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`} className="lip-ghost">
        Download QR
      </a>
    </div>
  );
}

/**
 * Overview: a room card while the event has none, the counts, the link and the ways to share it, the "Make it shine" list (every
 * line jumps to the tab where it is done) and what is coming up. Page views and saves are not counted by the data layer yet,
 * so they are not shown.
 */
export default function OverviewTab({ event, regs, fresh, onTab }: { event: R1Event; regs: Registration[] | null; fresh: boolean; onTab: (t: TabId) => void }) {
  const api = useR1Api();
  const now = useR1Now();
  const paidOn = usePaidOn();
  const sales = useSales(event.id, paidOn);
  const pops = usePops(event.id, "host");
  const [said, say] = useFlash();
  const [qr, setQr] = useState(false);
  // "Keep it free" is remembered in this browser: the data layer has no field for it.
  const [keptFree, setKeptFree] = useState(false);
  useEffect(() => setKeptFree(readFree(event.id)), [event.id]);

  const c = countsOf(regs);
  const going = regs ? c.going : event.going;
  const checkedIn = regs ? c.checkedIn : (event.checkins ?? 0);
  const isPaid = event.ticket_types.some((t) => t.price_naira > 0);
  const today = (regs ?? []).filter((r) => (r.status === "going" || r.status === "checked_in") && lagosDay(Date.parse(r.created_at)) === lagosDay(now)).length;
  const sold = isPaid && paidOn && sales.data ? sales.data.totals.sold : going;
  const noRoom = !event.room_id;
  const spots = event.spots_left === null ? "No limit" : `${event.spots_left} ${event.spots_left === 1 ? "spot" : "spots"} left`;

  const url = eventUrl(event);
  const shown = url.replace(/^https?:\/\//, "");
  const copy = async () => say((await copyText(url)) ? "Copied" : "Could not copy");
  const text = `${event.title}: ${url}`;
  const invite = async () => {
    const target = api ? eventUrl(event, api.registrations.inviteRef(event.id)) : url;
    const res = await shareOrCopy({ title: event.title, text: `Come to ${event.title} with me`, url: target });
    if (res === "copied") say("Invite link copied");
    else if (res === "failed") say("Could not copy");
  };
  const story = async () => {
    // Instagram has no web link into the story camera: the link is copied to paste as a sticker.
    say((await copyText(url)) ? "Link copied. Paste it as a link sticker in your story" : "Could not copy");
  };

  const online = event.kind !== "in_person";
  const inPerson = event.kind !== "online";
  const items: Array<{ id: string; label: string; done: boolean; tab: TabId; action: string }> = [
    { id: "room", label: event.room_id ? "Connected to your room" : "Invite your room", done: !!event.room_id, tab: "room", action: event.room_id ? "Open" : "Start" },
    { id: "about", label: "Write a description", done: !!event.description.trim(), tab: "details", action: event.description.trim() ? "Edit" : "Add" },
    { id: "cover", label: "Add a cover", done: !!event.flyer_url, tab: "details", action: event.flyer_url ? "Edit" : "Add" },
    { id: "place", label: online && !inPerson ? "Add the online link" : "Add the place or link", done: (inPerson && !!event.venue_name.trim()) || (online && !!event.online_link), tab: "details", action: "Edit" },
    { id: "price", label: "Set ticket tiers and prices", done: isPaid || keptFree, tab: "tickets", action: isPaid || keptFree ? "Edit" : "Set" },
  ];
  const done = items.filter((i) => i.done).length;

  const keepFree = () => {
    try {
      window.localStorage.setItem(freeKey(event.id), "1");
    } catch {
      /* not saved: it shows done until the page is left */
    }
    setKeptFree(true);
  };

  // Coming up: scheduled Pops (yours and the automatic ones that are on), then the doors.
  const coming = (pops.data ?? [])
    .filter((p) => p.status === "scheduled" && p.enabled !== false && p.send_at)
    .sort((a, b) => Date.parse(a.send_at ?? "") - Date.parse(b.send_at ?? ""));
  const doorsAt = popWhen(event.starts_at);

  return (
    <div className="flex flex-col gap-4">
      {fresh && (
        <p className="flex items-center gap-1.5 font-body text-[14px]">
          <Check size={15} strokeWidth={3} className="text-[#1FA847]" aria-hidden /> Your event is live
        </p>
      )}

      {noRoom && event.status === "live" && (
        <section className="t-card flex items-center gap-4 border-2 !border-t-accent p-4 shadow-lip" aria-label="Give your guests a room">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-hz bg-t-accent text-t-on">
            <Sparkles size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="t-title text-[17px] font-extrabold leading-tight text-t-accent">{going > 0 ? `Give your ${going.toLocaleString("en-NG")} ${going === 1 ? "guest" : "guests"} a room` : "Give your guests a room"}</h3>
            <p className="mt-0.5 font-body text-[13.5px] text-t-muted">They&apos;re here for one night. A room keeps them for the next one.</p>
          </div>
          {event.host.roomId ? (
            <button type="button" className="lip flex-none !px-5" onClick={() => onTab("room")}>
              Start
            </button>
          ) : (
            <Link href="/create?mode=room" className="lip flex-none !px-5">
              Start
            </Link>
          )}
        </section>
      )}

      <GetPaidCard returnPath={`/host/${encodeURIComponent(event.id)}?tab=overview`} quietWhenReady={!isPaid} />

      <section aria-label="Counts" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile n={sold.toLocaleString("en-NG")} label={isPaid && paidOn ? "tickets sold" : "registered"} extra={today > 0 ? `+${today} today` : undefined} />
        {isPaid ? (
          paidOn && sales.data ? <Tile n={naira(sales.data.totals.gross_naira)} label="in sales" /> : null
        ) : (
          <Tile n="Free" label="entry" />
        )}
        <Tile n={String(checkedIn)} label="checked in" />
      </section>
      <p className="-mt-2 font-body text-[13.5px] text-t-muted">
        {spots}
        {regs && c.pending > 0 ? ` · ${c.pending} pending` : ""}
        {regs && c.waitlist > 0 ? ` · ${c.waitlist} on the waitlist` : ""}
      </p>

      <section className="t-card p-4 lg:p-5" aria-label="Share your event">
        <h3 className="font-body text-[16px] font-extrabold">Share your event</h3>
        <div className="mt-3 flex items-stretch gap-2">
          <p className="flex min-h-[44px] min-w-0 flex-1 items-center truncate rounded-hz border border-t-line bg-t-bg px-3 font-mono text-[13.5px]">{shown}</p>
          <button type="button" onClick={() => void copy()} className="lip-ghost flex-none !px-4">
            Copy
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="lip-ghost">
            WhatsApp
          </a>
          <button type="button" className="lip-ghost" onClick={() => void story()}>
            Instagram story
          </button>
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(event.title)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" className="lip-ghost" aria-label="Share on X">
            X
          </a>
          <button type="button" className="lip-ghost" aria-expanded={qr} onClick={() => setQr(!qr)}>
            QR code
          </button>
          <button type="button" className="lip-ghost" onClick={() => void invite()}>
            Invite link
          </button>
        </div>
        {qr && <Qr url={url} title={event.title} />}
        <p className={clsx("font-body text-[13px] text-t-muted", said && "mt-2")} aria-live="polite">
          {said}
        </p>
      </section>

      <section className="t-card p-4 lg:p-5" aria-label="Make it shine">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-body text-[16px] font-extrabold">Make it shine</h3>
          <p className="font-body text-[13.5px] text-t-muted">
            {done} of {items.length} done
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-t-soft" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Setup progress">
          <i className="block h-full rounded-full bg-t-accent transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-hz border border-t-line bg-t-bg pr-1">
              <button type="button" onClick={() => onTab(it.tab)} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-3 text-left">
                <span className={clsx("grid h-6 w-6 flex-none place-items-center rounded-[5px] border-2", it.done ? "border-t-accent bg-t-accent text-t-on" : "border-t-line text-transparent")} aria-hidden>
                  <Check size={14} strokeWidth={3.5} />
                </span>
                <span className={clsx("min-w-0 flex-1 font-body text-[15px] font-bold", it.done && "text-t-muted line-through")}>{it.label}</span>
                <span className="flex-none font-body text-[14px] font-extrabold text-t-accent">{it.action}</span>
              </button>
              {it.id === "price" && !it.done && (
                <button type="button" onClick={keepFree} className="flex-none px-2 font-body text-[13px] font-bold text-t-muted underline underline-offset-4">
                  Keep it free
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="t-card p-4 lg:p-5" aria-label="Coming up">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-body text-[16px] font-extrabold">Coming up</h3>
          <p className="font-body text-[13.5px] text-t-muted">Times in Lagos</p>
        </div>
        <ul className="mt-2 divide-y divide-t-line">
          {coming.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onTab("pops")} className="flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left">
                <span className="min-w-0">
                  <span className="block truncate font-body text-[14.5px] font-bold">{p.auto ? `${autoLabel(p.auto, event.kind)} reminder` : "Scheduled Pop"}</span>
                  <span className="block truncate font-body text-[13px] text-t-muted">{p.body}</span>
                </span>
                <span className="flex-none font-body text-[13px] text-t-muted">{popWhen(p.send_at)}</span>
              </button>
            </li>
          ))}
          <li className="flex min-h-[52px] items-center justify-between gap-3 py-2">
            <span className="font-body text-[14.5px] font-bold">{event.kind === "online" ? "Call starts" : "Doors"}</span>
            <span className="font-body text-[13px] text-t-muted">{doorsAt}</span>
          </li>
        </ul>
        {coming.length === 0 && <p className="font-body text-[13px] text-t-muted">No Pops scheduled. Automatic reminders are switched off or already sent.</p>}
      </section>
    </div>
  );
}
