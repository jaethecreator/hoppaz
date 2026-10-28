"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, Check, ChevronLeft, Globe, MapPin, Share2 } from "lucide-react";
import TintShell, { usePictureTint } from "@/components/host/TintShell";
import { useR1Api, useR1Auth, useR1Now, useR1Query, useViewerState } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event, ReportReason } from "@/lib/events-r1/types";
import { useQuests } from "@/lib/game";
import { COVERS } from "@/lib/host/covers";
import { themeForEvent } from "@/lib/theme";
import { peekTint, readTint } from "@/lib/tint";
import { LINK_LABEL } from "../create/helpers";
import SignInSheet from "../SignInSheet";
import { isOnline } from "../words";
import { downloadIcs, googleCalendarUrl } from "./calendar";
import HostStrip from "./HostStrip";
import { eventUrl, shareOrCopy } from "./share";
import StatusCard from "./StatusCard";
import { CheckoutSheet, TicketBar, TicketCard, useStoryTickets } from "./StoryTickets";
import { startsIn } from "./time";
import { useFreshEvent } from "./useFreshEvent";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const LONG_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The date and clock of an instant in the event's own time zone. */
function at(iso: string, tz: string) {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  } catch {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  }
  const p = Object.fromEntries(f.formatToParts(new Date(Date.parse(iso))).map((x) => [x.type, Number(x.value)]));
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const h = p.hour % 24;
  const time = `${h % 12 || 12}:${String(p.minute).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  return { day: p.day, month: p.month, dow, time, key: `${p.year}-${p.month}-${p.day}` };
}

/** The words of the date row and the big date: "Friday, 30 October" and "8:00 PM to 11:00 PM · GMT+1". */
function whenWords(e: R1Event) {
  const tz = e.timezone || "Africa/Lagos";
  const a = at(e.starts_at, tz);
  const b = e.ends_at && Date.parse(e.ends_at) > Date.parse(e.starts_at) ? at(e.ends_at, tz) : null;
  const zone = tz === "Africa/Lagos" ? "GMT+1" : tz;
  const end = b ? (b.key === a.key || Date.parse(e.ends_at as string) - Date.parse(e.starts_at) < 20 * 3.6e6 ? ` to ${b.time}` : ` to ${LONG_DAY[b.dow].slice(0, 3)} ${b.day} ${LONG_MON[b.month - 1].slice(0, 3)}, ${b.time}`) : " till late";
  return {
    a,
    dayLine: `${LONG_DAY[a.dow]}, ${a.day} ${LONG_MON[a.month - 1]}`,
    timeLine: `${a.time}${end} · ${zone}`,
    short: `${LONG_DAY[a.dow].slice(0, 3)} ${a.day} ${LONG_MON[a.month - 1].slice(0, 3)}`,
  };
}

/** A cover for an event that has none: one of the Hoppaz templates, the same one every time for that event. */
function fallbackCover(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length].src;
}

const REASONS: Array<{ id: ReportReason; text: string }> = [
  { id: "fake_or_scam", text: "Fake or scam" },
  { id: "wrong_place", text: "Wrong place" },
  { id: "offensive", text: "Offensive" },
  { id: "other", text: "Other" },
];

/* ------------------------------------------------------------------ small parts -- */

function Tile({ children }: { children: React.ReactNode }) {
  return <span className="grid h-11 w-11 flex-none place-items-center rounded-hz border border-t-line bg-t-tile lg:h-10 lg:w-10 [&_svg]:h-[19px] [&_svg]:w-[19px]">{children}</span>;
}

function Sec({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex justify-between gap-2.5 border-b border-t-line pb-2.5 font-body text-[12.5px] font-semibold text-t-muted">
        <span>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Report({ event }: { event: R1Event }) {
  const api = useR1Api();
  const { data: viewer } = useViewerState(event.id);
  const [open, setOpen] = useState(false);
  const [signin, setSignin] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (viewer?.isHost) return null;
  if (sent)
    return (
      <span role="status" className="flex items-center gap-1.5">
        <Check size={14} aria-hidden /> Thanks. We&apos;ll look at it.
      </span>
    );
  const send = async () => {
    if (!api || !reason || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.reports.report(event.id, reason, "");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" className="text-left underline-offset-4 hover:underline" aria-expanded={open} onClick={() => (viewer && !viewer.signedIn ? setSignin(true) : setOpen(!open))}>
        Report event
      </button>
      {open && (
        <div className="mt-2 grid gap-1.5" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={reason === r.id}
              onClick={() => setReason(r.id)}
              className={`min-h-[40px] rounded-hz border px-3 text-left font-body text-[14px] text-t-text ${reason === r.id ? "border-t-accent" : "border-t-line"}`}
            >
              {r.text}
            </button>
          ))}
          <button type="button" className="lip mt-1" aria-disabled={!reason} disabled={busy} onClick={() => void send()}>
            Send report
          </button>
          {error && <span className="text-[#E5484D]">{error}</span>}
        </div>
      )}
      <SignInSheet
        open={signin}
        reason="Report this event"
        onClose={() => setSignin(false)}
        onSignedIn={() => {
          setSignin(false);
          setOpen(true);
        }}
      />
    </div>
  );
}

function Quests({ event }: { event: R1Event }) {
  const { user } = useR1Auth();
  const { quests, claims } = useQuests(user?.id ?? null);
  const mine = quests.filter((q) => q.event_id === event.id);
  if (!mine.length) return null;
  const xp = mine.reduce((a, q) => a + q.xp_reward, 0);
  const done = mine.filter((q) => claims[q.id]).length;
  const badge = mine.find((q) => q.badge_key)?.title ?? `${event.title} badge`;
  const mark = event.title.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "HZ";
  return (
    <Sec title="Quests" aside={<span className="font-mono text-[12.5px] text-t-accent">{xp} XP</span>}>
      <div className="grid gap-3 rounded-hz border border-t-line bg-t-tile p-[18px] lg:p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full border-2 border-dashed border-t-accent font-display text-[13px] font-extrabold text-t-accent">{mark}</span>
          <div className="min-w-0 flex-1">
            <b className="block font-body text-[15.5px]">{badge}</b>
            <small className="block font-body text-[12.5px] text-t-muted">
              Finish all {mine.length} quest{mine.length === 1 ? "" : "s"} at the event
            </small>
          </div>
          <span className="font-mono text-[12.5px] text-t-accent">
            {done} / {mine.length}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-t-soft">
          <i className="block h-full bg-t-accent" style={{ width: `${(done / mine.length) * 100}%` }} />
        </div>
        {mine.map((q) => (
          <div key={q.id} className="flex justify-between gap-2.5 border-t border-t-line pt-2.5 font-body text-[14px]">
            <div className="min-w-0">
              {q.title}
              {q.description && <small className="block text-[12.5px] text-t-muted">{q.description}</small>}
            </div>
            <span className="whitespace-nowrap font-mono text-[12.5px] text-t-accent">{claims[q.id] ? "Done" : `+${q.xp_reward} XP`}</span>
          </div>
        ))}
      </div>
    </Sec>
  );
}

function MoreFromHost({ event }: { event: R1Event }) {
  const room = event.host.roomId;
  const { data } = useR1Query((a) => (room ? a.events.listForRoom(room) : a.events.list()), [room]);
  const more = (data ?? []).filter((e) => e.id !== event.id && e.host.id === event.host.id && e.status !== "cancelled").slice(0, 4);
  if (!more.length) return null;
  return (
    <Sec title={`More from ${event.host.roomName ?? event.host.name}`}>
      {more.map((e) => {
        const w = at(e.starts_at, e.timezone || "Africa/Lagos");
        return (
          <Link key={e.id} href={`/event/${encodeURIComponent(e.slug || e.id)}`} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 py-[7px]">
            <span className="overflow-hidden rounded-hz border border-t-line bg-t-tile text-center">
              <i className="block bg-t-soft py-0.5 font-body text-[9px] font-bold not-italic text-t-muted">{MON[w.month - 1]}</i>
              <b className="block font-body text-[15px] leading-normal">{w.day}</b>
            </span>
            <span className="min-w-0">
              <b className="block truncate font-body text-[14px] leading-snug">{e.title}</b>
              <span className="block truncate font-body text-[12.5px] text-t-muted">{[e.venue_name || (isOnline(e) ? "Online" : ""), w.time].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="font-body text-[13.5px] font-semibold text-t-accent">View</span>
          </Link>
        );
      })}
    </Sec>
  );
}

/* ------------------------------------------------------------------ the page -- */

/**
 * The event page, "Host Story" (build brief sections 9 and 10, mock-up event-page-final.html, approved by Jae). The host band
 * on top; the big date in its own column; title, date row and venue row; the cover at its true shape on the right with the
 * tickets under it and Hosted by under them; About, quests and more from this host below. A landscape cover runs across the
 * top. On a phone: date, title and rows, cover, tickets, hosts, the rest, and a ticket bar at the bottom.
 *
 * The whole page wears the event's look (pack, Day or Night, tint from the cover, saved when the event was made; an older event
 * with no look takes its colour from the cover). Tickets, status, check-in and the host's tools are the Release 1 pieces.
 */
export default function HostStory({ event: given, extra }: { event: R1Event; extra?: React.ReactNode }) {
  const event = useFreshEvent(given);
  const router = useRouter();
  const now = useR1Now();
  const { data: viewer } = useViewerState(event.id);
  const { data: saved, loading: lookLoading } = useR1Query((a) => a.looks.get("event", event.id), [event.id]);
  const cover = event.flyer_url || fallbackCover(event.id);
  const look: Look = saved ?? { ...DEFAULT_LOOK, mood: themeForEvent(event.starts_at) === "day" ? "day" : "night", auto: true };
  const tint = usePictureTint(cover, look);
  const [wide, setWide] = useState(false);
  const [said, setSaid] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  const t = useStoryTickets(event);
  const w = useMemo(() => whenWords(event), [event]);
  const online = isOnline(event);

  // Paint once the look is read and the cover's colour is known, so the page never opens in the wrong colour. Never wait long.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown || lookLoading) return;
    if (!look.auto || peekTint(cover)) return setShown(true);
    let live = true;
    const go = () => live && setShown(true);
    const id = window.setTimeout(go, 700);
    void readTint(cover).then(go);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [shown, lookLoading, look.auto, cover]);

  useEffect(() => {
    if (!said) return;
    const id = window.setTimeout(() => setSaid(""), 2000);
    return () => window.clearTimeout(id);
  }, [said]);

  if (!shown) return <div className="h-full bg-ink" />;

  const share = async () => {
    const r = await shareOrCopy({ title: event.title, text: event.title, url: eventUrl(event) });
    if (r === "copied") setSaid("Link copied");
    else if (r === "failed") setSaid("Could not copy");
  };
  const back = () => {
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace("/");
  };
  const lead = (event.description || "").split(/\n+/)[0].trim();
  const desc = lead.length > 160 ? `${lead.slice(0, 157).trimEnd()}...` : lead;
  const about = (event.description || "").trim();
  const room = event.host.roomId;
  const kick = startsIn(event, now);
  const initial = (event.host.roomName ?? event.host.name).trim()[0]?.toUpperCase() ?? "H";
  const hostName = event.host.roomName ?? event.host.name;
  const placeName = online ? (event.link_type ? `Online · ${LINK_LABEL[event.link_type]}` : "Online") : event.venue_name || event.area || "Place to be announced";
  const placeSub = online ? "The link shows once you're in" : [event.venue_name && event.area && !event.venue_name.includes(event.area) ? event.area : "", "Lagos"].filter(Boolean).join(", ");

  const coverEl = (
    <div className={`overflow-hidden rounded-hz leading-[0] order-3 lg:order-none shadow-[0_24px_48px_-26px_rgba(0,0,0,.7)] ${wide ? "lg:mb-[22px]" : ""}`}>
      <img
        src={cover}
        alt={`${event.title} cover`}
        className="block h-auto w-full"
        onLoad={(e) => setWide(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) > 1.3)}
      />
    </div>
  );

  let action: React.ReactNode;
  if (viewer?.isHost) action = <div className="t-adopt"><HostStrip event={event} viewer={viewer} /></div>;
  else if (viewer?.registration) action = <div className="t-adopt"><StatusCard event={event} viewer={viewer} /></div>;
  else action = <TicketCard t={t} anchor={anchor} />;

  return (
    <div className="h-full overflow-y-auto">
      <TintShell look={look} tint={tint} className="min-h-full">
        {/* host band */}
        <div className="flex items-center gap-3 bg-t-soft px-[22px] py-3.5 lg:px-[30px] lg:py-4">
          <button type="button" onClick={back} aria-label="Back" className="-ml-2 grid h-10 w-8 flex-none place-items-center text-t-muted">
            <ChevronLeft size={20} />
          </button>
          <span className="grid h-11 w-11 flex-none place-items-center rounded-hz bg-t-accent font-display text-[17px] font-extrabold text-t-on">{initial}</span>
          <b className="min-w-0 truncate font-body text-[15.5px] font-bold leading-tight">{hostName}</b>
          <div className="ml-auto flex flex-none items-center gap-2">
            <button type="button" onClick={() => void share()} aria-label="Share" className="grid h-9 w-9 place-items-center rounded-hz border border-t-line bg-t-bg shadow-[0_3px_0_var(--t-line)]">
              <Share2 size={16} />
            </button>
            {room && (
              <Link href={`/rooms/${encodeURIComponent(room)}`} className="whitespace-nowrap rounded-hz border border-t-line bg-t-bg px-[15px] py-[7px] font-body text-[13px] font-bold shadow-[0_3px_0_var(--t-line)]">
                Join room
              </Link>
            )}
          </div>
        </div>
        {said && (
          <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
            {said}
          </div>
        )}

        <div
          className={`mx-auto flex max-w-[1240px] flex-col gap-5 lg:grid px-[22px] pb-10 pt-[26px] lg:grid-cols-[118px_minmax(0,1fr)_31%] lg:gap-x-7 lg:gap-y-1.5 lg:px-[30px] lg:pb-9 lg:pt-7 ${
            wide
              ? "lg:grid-rows-[auto_auto_1fr] lg:[grid-template-areas:'date_cover_cover'_'date_head_side'_'date_rest_side']"
              : "lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'date_head_side'_'date_rest_side']"
          }`}
        >
          {/* the big date */}
          <div className="hidden font-display font-extrabold leading-[.86] tracking-[-0.02em] text-t-accent [grid-area:date] lg:sticky lg:top-5 lg:block lg:self-start">
            <span className="block text-[58px] lg:text-[80px]">{w.a.day}</span>
            <span className="block text-[22px] lg:mt-2">{MON[w.a.month - 1]}</span>
            <span className="block font-body text-[13px] font-semibold leading-snug tracking-normal text-t-muted lg:mt-2.5">
              {LONG_DAY[w.a.dow].slice(0, 3)} · {w.a.time}
            </span>
          </div>

          {/* title and the two rows */}
          <div className="contents min-w-0 content-start gap-5 [grid-area:head] lg:grid lg:gap-4">
            <span className="font-body text-[13px] font-semibold text-t-accent order-1 lg:order-none">{event.status === "cancelled" ? "This event is cancelled" : kick}</span>
            <h1 className="t-title m-0 text-balance text-[30px] font-extrabold leading-[1.06] tracking-[-0.02em] order-2 lg:order-none lg:text-[38px] lg:leading-[1.02]">{event.title}</h1>
            {desc && <p className="m-0 max-w-[56ch] font-body text-[15px] leading-relaxed text-t-muted order-5 lg:order-none">{desc}</p>}
            <div className="grid gap-[18px] order-4 lg:order-none lg:gap-3">
              <div className="grid grid-cols-[44px_1fr] items-start gap-3.5 lg:grid-cols-[40px_1fr_auto] lg:items-center lg:gap-3">
                <Tile>
                  <Calendar />
                </Tile>
                <div className="min-w-0">
                  <b className="block font-body text-[15.5px] leading-snug">{w.dayLine}</b>
                  <span className="block font-body text-[13.5px] text-t-muted">{w.timeLine}</span>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 justify-self-start lg:col-start-3 lg:justify-self-end">
                  <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-body text-[13.5px] font-semibold text-t-accent">
                    Add to calendar
                  </a>
                  <button type="button" onClick={() => downloadIcs(event)} className="whitespace-nowrap font-body text-[12.5px] text-t-muted underline underline-offset-4">
                    or download .ics
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[44px_1fr] items-start gap-3.5 lg:grid-cols-[40px_1fr_auto] lg:items-center lg:gap-3">
                <Tile>{online ? <Globe /> : <MapPin />}</Tile>
                <div className="min-w-0">
                  <b className="block font-body text-[15.5px] leading-snug">{placeName}</b>
                  {placeSub && <span className="block font-body text-[13.5px] text-t-muted">{placeSub}</span>}
                </div>
                {!online && event.venue_name && (
                  <Link href={`/?e=${encodeURIComponent(event.id)}`} className="col-start-2 inline-flex items-center gap-1 justify-self-start whitespace-nowrap font-body text-[13.5px] font-semibold text-t-accent lg:col-start-3">
                    See on map <ArrowRight size={15} aria-hidden />
                  </Link>
                )}
              </div>
            </div>
          </div>

          {wide && <div className="min-w-0 [grid-area:cover] order-3 lg:order-none">{coverEl}</div>}

          {/* cover, tickets, hosts */}
          <div className="contents min-w-0 content-start gap-7 [grid-area:side] lg:grid lg:gap-[18px]">
            {!wide && coverEl}
            <div className="order-6 lg:order-none mt-2.5 lg:mt-0">{action}</div>
            <div className="order-7 lg:order-none mt-2.5 lg:mt-0">
              <div className="font-body text-[12px] font-semibold text-t-muted">Hosted by</div>
              <div className="mt-2 grid gap-3.5 lg:gap-2.5">
                <div className="flex items-center gap-2.5 font-body text-[14.5px] font-semibold leading-tight">
                  <i className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-t-soft font-body text-[12px] font-bold not-italic text-t-accent">{event.host.name.trim()[0]?.toUpperCase() ?? "H"}</i>
                  {event.host.name}
                  <span className="ml-auto font-body text-[12px] font-medium text-t-muted">{event.host.verified ? "Verified host" : "Host"}</span>
                </div>
              </div>
              <div className="mt-2.5 grid gap-[5px] font-body text-[13px] text-t-muted">
                {room && (
                  <Link href={`/rooms/${encodeURIComponent(room)}`} className="underline-offset-4 hover:underline">
                    Message the host in their room
                  </Link>
                )}
                <Report event={event} />
              </div>
            </div>
          </div>

          {/* the rest */}
          <div className="grid min-w-0 content-start gap-10 [grid-area:rest] order-8 lg:order-none mt-5 lg:mt-0 lg:gap-[30px] lg:pt-[26px]">
            {about && (
              <Sec title="About">
                <p className="m-0 max-w-[62ch] whitespace-pre-line font-body text-[15.5px] leading-relaxed">{about}</p>
              </Sec>
            )}
            {extra}
            <Quests event={event} />
            <MoreFromHost event={event} />
          </div>
        </div>

        <TicketBar t={t} anchor={anchor} line={`${w.short} · ${online ? "Online" : event.venue_name || event.area || "Lagos"}`} />
        <CheckoutSheet t={t} cover={cover} when={`${w.short} · ${w.a.time}${online ? "" : ` · ${event.venue_name || event.area}`}`} />
      </TintShell>
    </div>
  );
}
