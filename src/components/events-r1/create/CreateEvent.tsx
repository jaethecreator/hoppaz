"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Globe, ImagePlus, Lock, MapPin, Shuffle, Ticket, Users, X, AlignLeft, Grid3x3 } from "lucide-react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import TintShell, { usePictureTint } from "@/components/host/TintShell";
import TwoDRoomCard from "@/components/host/TwoDRoomCard";
import { AREAS } from "@/lib/geo";
import { useR1Api } from "@/lib/events-r1/hooks";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import { DEFAULT_LOOK, PACKS } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { EventKind, LinkType, Visibility } from "@/lib/events-r1/types";
import { COVERS, randomCover } from "@/lib/host/covers";
import { SWATCHES, swatchColor } from "@/lib/tint";
import PayoutNeeded from "../pay/PayoutNeeded";
import { naira } from "../pay/words";
import { platformFeeNaira, processingFeeNaira } from "@/lib/events-r1/payFee";
import { lagosIso } from "../dateTime";
import { coverFromFile, uploadCoverFile } from "./cover";
import { readCover, writeCover } from "./draft";
import { LINK_LABEL, TIMEZONE } from "./helpers";
import { MAX_TICKET_TYPES, newTicket, ticketsSummary } from "./Tickets";
import type { TicketForm } from "./Tickets";
import { useEventForm } from "./useEventForm";
import type { EventFormState } from "./useEventForm";
import DoneSheet from "./DoneSheet";

const LOOK_KEY = "hz-create-look";
const KINDS: Array<{ value: EventKind; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Both" },
];
const LINKS: LinkType[] = ["zoom", "meet", "whatsapp", "other"];
const WHO: Array<{ value: Visibility; label: string; line: string }> = [
  { value: "public", label: "Public", line: "Anyone can find it on the map" },
  { value: "community", label: "Room members", line: "Only people in your room" },
  { value: "invite", label: "Invite only", line: "Only people with the link" },
];

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-12-20T18:00:00+01:00" in Lagos: parts for the big date column. */
function parts(iso: string) {
  const d = iso.slice(0, 10), t = iso.slice(11, 16);
  const [y, m, day] = d.split("-").map(Number);
  const wd = new Date(Date.UTC(y, (m || 1) - 1, day || 1)).getUTCDay();
  const [h0, min] = t.split(":").map(Number);
  let h = h0;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { day: String(day || "--"), mon: MON[(m || 1) - 1] ?? "---", wd: DOW[wd] ?? "", time: `${h}:${String(min || 0).padStart(2, "0")} ${ap}` };
}
const withDate = (iso: string, d: string) => (d ? `${d}T${iso.slice(11, 16)}:00+01:00` : iso);
const withTime = (iso: string, t: string) => (t ? `${iso.slice(0, 10)}T${t}:00+01:00` : iso);
const digits = (v: string, max = 9) => v.replace(/\D/g, "").slice(0, max);

function readLook(): Look {
  try {
    const raw = window.sessionStorage.getItem(LOOK_KEY);
    if (raw) return { ...DEFAULT_LOOK, ...(JSON.parse(raw) as Partial<Look>) };
  } catch {
    /* storage blocked */
  }
  return DEFAULT_LOOK;
}

/* ------------------------------------------------------------------ small parts -- */

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-hz border border-t-line bg-t-bg p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[34px] rounded-[4px] px-3 font-body text-[13.5px] font-bold ${value === o.value ? "bg-t-accent text-t-on" : "text-t-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 border-t border-t-line py-2 first:border-t-0">
      <span className="min-w-0">
        <span className="block font-body text-[14.5px]">{label}</span>
        {hint && <span className="block font-body text-[12.5px] text-t-muted">{hint}</span>}
      </span>
      <span className="relative h-6 w-[42px] flex-none">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 cursor-pointer opacity-0" />
        <span className="absolute inset-0 rounded-full bg-t-line transition-colors peer-checked:bg-t-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" />
        <span className="pointer-events-none absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-t-bg transition-transform peer-checked:translate-x-[18px]" />
      </span>
    </label>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return <span className="grid h-10 w-10 flex-none place-items-center rounded-hz border border-t-line bg-t-tile text-t-muted [&_svg]:h-[18px] [&_svg]:w-[18px]">{children}</span>;
}

/* ------------------------------------------------------------------ sections -- */

function CoverBlock({ cover, setCover, phone }: { cover: string | null; setCover: (c: string | null) => void; phone?: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const [lib, setLib] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const f = useR1Api()?.mode ?? null;
  const pick = async (x: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!x) return;
    setBusy(true);
    setErr("");
    try {
      setCover(await (f === "real" ? uploadCoverFile(x) : coverFromFile(x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That picture won't open. Try another.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="relative overflow-hidden rounded-hz border border-t-line bg-t-soft">
        {cover ? <img src={cover} alt="Event cover" className={`block aspect-[4/5] w-full object-cover ${phone ? "max-h-[62vh]" : ""}`} /> : <div className="aspect-[4/5]" />}
        <div className="absolute inset-x-0 bottom-0 flex flex-nowrap gap-2 p-3">
          <button type="button" className="lip-ghost whitespace-nowrap !min-h-[36px] !px-2.5 !py-1.5" onClick={() => setCover(randomCover(cover).src)}>
            <Shuffle size={15} aria-hidden /> Shuffle
          </button>
          {phone && (
            <button type="button" className="lip-ghost whitespace-nowrap !min-h-[36px] !px-2.5 !py-1.5" aria-expanded={lib} onClick={() => setLib(!lib)}>
              <Grid3x3 size={15} aria-hidden /> Covers
            </button>
          )}
          <button type="button" className="lip-ghost ml-auto whitespace-nowrap !min-h-[36px] !px-2.5 !py-1.5" disabled={busy} onClick={() => file.current?.click()}>
            <ImagePlus size={15} aria-hidden /> {busy ? "Uploading" : phone ? "Upload" : "Upload yours"}
          </button>
        </div>
      </div>
      {err && (
        <p role="alert" className="font-body text-[13.5px] text-[#E5484D]">
          {err}
        </p>
      )}
      {(lib || !phone) && (
        <div>
          <p className="mb-1.5 font-body text-[12.5px] text-t-muted">Or pick another Hoppaz cover</p>
          <div className="grid grid-cols-5 gap-2">
            {COVERS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.name}
                aria-pressed={cover === c.src}
                onClick={() => {
                  setCover(c.src);
                  setLib(false);
                }}
                className={`overflow-hidden rounded-hz border-2 ${cover === c.src ? "border-t-accent" : "border-transparent"}`}
              >
                <img src={c.src} alt="" className="block aspect-[4/5] w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LookCard({ look, setLook }: { look: Look; setLook: (l: Look) => void }) {
  const i = PACKS.findIndex((p) => p.id === look.pack);
  const step = (k: number) => setLook({ ...look, pack: PACKS[(i + k + PACKS.length) % PACKS.length].id });
  return (
    <div className="t-card grid gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-[13px] font-bold text-t-muted">Pack</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous pack" onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-hz border border-t-line">
            <ChevronLeft size={16} />
          </button>
          <b className="min-w-[120px] text-center font-body text-[14px]">{PACKS[i]?.name}</b>
          <button type="button" aria-label="Next pack" onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-hz border border-t-line">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-body text-[13px] font-bold text-t-muted">Colour</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={look.auto}
            aria-label="Colour from the cover"
            title="From the cover"
            onClick={() => setLook({ ...look, auto: true })}
            className={`h-7 w-7 rounded-full ${look.auto ? "ring-2 ring-t-text ring-offset-2 ring-offset-[var(--t-tile)]" : ""}`}
            style={{ background: "conic-gradient(#f66,#fd4,#6d6,#4af,#c6f,#f66)" }}
          />
          {SWATCHES.map((s, k) => {
            const on = !look.auto && Math.abs(look.tint.hue - s.hue) < 0.5;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                aria-label={`Colour ${k + 1}`}
                onClick={() => setLook({ ...look, auto: false, tint: s })}
                className={`h-7 w-7 rounded-full ${on ? "ring-2 ring-t-text ring-offset-2 ring-offset-[var(--t-tile)]" : ""}`}
                style={{ background: swatchColor(s) }}
              />
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-[13px] font-bold text-t-muted">Mood</span>
        <Seg label="Day or night" value={look.mood} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} onChange={(m) => setLook({ ...look, mood: m })} />
      </div>
    </div>
  );
}

function BigDate({ iso }: { iso: string }) {
  const p = parts(iso);
  return (
    <div className="leading-none">
      <span className="block font-display text-[64px] font-black tracking-tight">{p.day}</span>
      <span className="mt-1 block font-display text-[20px] font-extrabold text-t-accent">{p.mon}</span>
      <span className="mt-2 block font-body text-[13px] text-t-muted">
        {p.wd} · {p.time}
      </span>
    </div>
  );
}

function WhenFields({ f }: { f: EventFormState }) {
  const min = lagosIso(f.clock).slice(0, 10);
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[1fr_7rem] items-center gap-2 sm:grid-cols-[64px_1fr_7.5rem]">
        <span className="col-span-2 font-body text-[13px] text-t-muted sm:col-span-1">Starts</span>
        <input type="date" value={f.start.slice(0, 10)} min={min} onChange={(e) => f.changeStart(withDate(f.start, e.target.value))} aria-label="Start date" />
        <input type="time" value={f.start.slice(11, 16)} step={900} onChange={(e) => f.changeStart(withTime(f.start, e.target.value))} aria-label="Start time" />
      </div>
      {f.endShown ? (
        <div className="grid grid-cols-[1fr_7rem] items-center gap-2 sm:grid-cols-[64px_1fr_7.5rem]">
          <span className="col-span-2 font-body text-[13px] text-t-muted sm:col-span-1">Ends</span>
          <input type="date" value={f.end.slice(0, 10)} min={f.start.slice(0, 10)} onChange={(e) => f.changeEnd(withDate(f.end, e.target.value))} aria-label="End date" />
          <input type="time" value={f.end.slice(11, 16)} step={900} onChange={(e) => f.changeEnd(withTime(f.end, e.target.value))} aria-label="End time" />
        </div>
      ) : (
        <button type="button" onClick={() => f.setEndShown(true)} className="justify-self-start font-body text-[13.5px] font-bold text-t-accent">
          + Add an end time
        </button>
      )}
      {f.endBad && <p className="font-body text-[13px] text-[#E5484D]">{f.endBad}</p>}
      <span className="font-body text-[12px] text-t-muted">Lagos time · GMT+1 ({TIMEZONE})</span>
    </div>
  );
}

function WhereFields({ f }: { f: EventFormState }) {
  return (
    <div className="grid gap-2">
      <Seg label="Where" value={f.kind} options={KINDS} onChange={f.pickKind} />
      {f.inPerson && (
        <div className="grid gap-2">
          <input value={f.place} onChange={(e) => f.setPlace(e.target.value)} placeholder="Venue name and address" aria-label="Venue" autoComplete="off" maxLength={120} />
          <select value={f.area} onChange={(e) => f.setArea(e.target.value)} aria-label="Area">
            <option value="">Area (puts it on the map)</option>
            {AREAS.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {f.online && (
        <div className="grid gap-2">
          <input value={f.link} onChange={(e) => f.pasteLink(e.target.value)} placeholder="Paste a Zoom, Meet or WhatsApp call link" aria-label="Call link" inputMode="url" autoComplete="off" autoCapitalize="none" />
          <div className="flex flex-wrap gap-1.5">
            {LINKS.map((l) => (
              <button key={l} type="button" aria-pressed={f.linkType === l} onClick={() => f.pickLink(l)} className={`rounded-hz border px-2.5 py-1 font-body text-[12.5px] font-bold ${f.linkType === l ? "border-t-accent text-t-accent" : "border-t-line text-t-muted"}`}>
                {LINK_LABEL[l]}
              </button>
            ))}
          </div>
          {f.effLink === "whatsapp" && <p className="font-body text-[13px]">WhatsApp calls hold up to 32 people. Spots set to 32.</p>}
          <span className="font-body text-[12.5px] text-t-muted">Only people who register see the link.</span>
        </div>
      )}
    </div>
  );
}

function DescField({ f, alwaysOpen }: { f: EventFormState; alwaysOpen?: boolean }) {
  const [open, setOpen] = useState(alwaysOpen || !!f.about);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="justify-self-start font-body text-[14.5px] font-bold text-t-accent">
        + Add a description <span className="ml-1 font-normal text-t-muted">Optional</span>
      </button>
    );
  return <textarea value={f.about} onChange={(e) => f.setAbout(e.target.value)} rows={4} maxLength={2000} placeholder="What's it about? Lineup, dress code, what to bring." aria-label="Description" autoFocus={!alwaysOpen} />;
}

function receives(price: string): number | null {
  const gross = Number(price);
  if (!Number.isInteger(gross) || gross < 2) return null;
  return gross - platformFeeNaira(gross) - processingFeeNaira(gross, "card");
}

function TicketsFields({ f }: { f: EventFormState }) {
  const edit = (key: string, patch: Partial<TicketForm>) => f.setTickets(f.tickets.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const [limit, setLimit] = useState(!!f.capacity);
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Seg label="Free or paid" value={f.paid ? "paid" : "free"} options={[{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} onChange={(v) => f.setPaid(v === "paid")} />
        <span className="font-body text-[12.5px] text-t-muted">{f.paid ? "Fee is inside the price" : "Free unless you add a price"}</span>
      </div>
      <div className="grid gap-2">
        {f.tickets.map((t, i) => (
          <div key={t.key} className={`grid items-center gap-2 ${f.paid ? "grid-cols-[1fr_6.5rem_5rem_2rem]" : "grid-cols-[1fr_5rem_2rem]"}`}>
            <input value={t.name} onChange={(e) => edit(t.key, { name: e.target.value })} placeholder="Regular" aria-label={`Ticket name ${i + 1}`} maxLength={60} autoComplete="off" />
            {f.paid && <input value={t.price} onChange={(e) => edit(t.key, { price: digits(e.target.value) })} inputMode="numeric" placeholder="₦ price" aria-label={`Price ${i + 1}`} />}
            <input value={t.capacity} onChange={(e) => edit(t.key, { capacity: digits(e.target.value, 5) })} inputMode="numeric" placeholder="Spots" aria-label={`Spots ${i + 1}`} />
            {f.tickets.length > 1 ? (
              <button type="button" aria-label={`Remove ticket ${i + 1}`} onClick={() => f.setTickets(f.tickets.filter((x) => x.key !== t.key))} className="grid h-8 w-8 place-items-center text-t-muted">
                <X size={16} />
              </button>
            ) : (
              <span />
            )}
            {f.paid && receives(t.price) !== null && f.gate.state !== "off" && (
              <span className="col-span-full -mt-1 font-body text-[12px] text-t-muted">You get about {naira(receives(t.price) as number)} per ticket</span>
            )}
          </div>
        ))}
      </div>
      {f.tickets.length < MAX_TICKET_TYPES && (
        <button type="button" onClick={() => f.setTickets([...f.tickets, newTicket()])} className="justify-self-start font-body text-[14px] font-bold text-t-accent">
          + Add a ticket type
        </button>
      )}
      {f.paid && f.gate.state === "off" && <p className="font-body text-[13.5px]">{PAID_UNAVAILABLE}</p>}
      {f.paid && f.gate.state === "needs" && <PayoutNeeded />}
      <div>
        <Switch on={f.approval} onChange={f.setApproval} label="Ask me to approve guests" />
        <Switch
          on={limit}
          onChange={(v) => {
            setLimit(v);
            if (!v) f.changeCapacity("");
          }}
          label="Limit spots"
        />
        {limit && (
          <div className="flex items-center justify-between gap-3 pb-2">
            <span className="font-body text-[13.5px] text-t-muted">Total spots</span>
            <input value={f.capacity} onChange={(e) => f.changeCapacity(e.target.value)} inputMode="numeric" placeholder="100" aria-label="Total spots" className="!w-28 text-right" />
          </div>
        )}
        {limit && <Switch on={f.waitlist} onChange={f.setWaitlist} label="Waitlist when full" />}
      </div>
    </div>
  );
}

function WhoFields({ f }: { f: EventFormState }) {
  return (
    <div role="radiogroup" aria-label="Who can see it" className="grid gap-2">
      {WHO.map((w) => {
        const off = w.value === "community" && !f.roomOn;
        const on = f.visibility === w.value;
        return (
          <button
            key={w.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            onClick={() => f.setVisibility(w.value)}
            className={`grid grid-cols-[20px_1fr] gap-2.5 rounded-hz border p-3 text-left disabled:opacity-50 ${on ? "border-t-accent" : "border-t-line"} bg-t-bg`}
          >
            <span className={`mt-0.5 h-[18px] w-[18px] rounded-full ${on ? "border-[5px] border-t-accent" : "border-2 border-t-line"}`} />
            <span>
              <b className="block font-body text-[14.5px]">{w.label}</b>
              <span className="block font-body text-[12.5px] text-t-muted">{off ? "Needs a room" : w.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PostAs({ f, onNewRoom }: { f: EventFormState; onNewRoom: () => void }) {
  const name = f.user?.name ?? "you";
  return (
    <label className="flex items-center gap-2">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-hz bg-t-accent font-display text-[14px] font-black text-t-on">{(f.roomOn ? f.room?.name : name)?.[0]?.toUpperCase() ?? "H"}</span>
      <span className="sr-only">Post as</span>
      <select
        value={f.roomOn ? "room" : "me"}
        onChange={(e) => {
          if (e.target.value === "new") onNewRoom();
          else f.changeAddToRoom(e.target.value === "room");
        }}
        className="!w-auto !border-0 !bg-transparent !px-1 !py-1 font-body text-[14px] font-bold"
      >
        <option value="me">Personal · {name}</option>
        {f.room && <option value="room">{f.room.name} room</option>}
        <option value="new">+ New room</option>
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ the screen -- */

/**
 * Create an event (build brief section 11, mock-up claude/create-event-final.html). The page opens with a random Hoppaz cover
 * and is already tinted from it. Desktop: the event page in edit mode (big date, title, when, where, description on the left;
 * cover, look, tickets and the 2D room on the right). Phone: cover first, look, big date and title, then rows that open, and a
 * bar at the bottom with what is left and Create. Every rule (draft, sign up wall, paid gate) is the Release 1 one, in
 * useEventForm.
 */
export default function CreateEvent({ onNewRoom }: { onNewRoom: () => void }) {
  const router = useRouter();
  const [cover, setCoverState] = useState<string | null>(null);
  const [look, setLookState] = useState<Look>(DEFAULT_LOOK);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setCoverState(readCover() ?? randomCover().src);
    setLookState(readLook());
    setReady(true);
  }, []);
  const setCover = (c: string | null) => {
    setCoverState(c);
    writeCover(c);
  };
  const tint = usePictureTint(cover, look);
  const fullLook: Look = { ...look, tint };
  const setLook = (l: Look) => {
    setLookState(l);
    try {
      window.sessionStorage.setItem(LOOK_KEY, JSON.stringify(l));
    } catch {
      /* storage blocked */
    }
  };
  const f = useEventForm({ cover, look: fullLook });
  const [open, setOpen] = useState<string | null>("when");
  const two = look.two_d ?? { on: true, template: "clubhouse" };
  const setTwo = (v: { on: boolean; template: string }) => setLook({ ...look, two_d: v });

  if (!ready) return <div className="h-full bg-ink" />;

  const canCreate = !!f.title.trim() && !!f.api && !f.blocked && !f.busy && !f.endBad;
  const steps = [!!f.title.trim(), true, !f.inPerson || !!f.place.trim(), !!cover];
  const left = steps.filter((s) => !s).length;
  const buttonText = f.blocked && f.gate.state === "off" ? PAID_UNAVAILABLE : f.blocked && f.gate.state === "needs" ? "Set up payouts first" : f.busy ? "Creating" : "Create event";
  const leftText = f.missing.length ? `Add ${f.missing.join(", ").replace(/, ([^,]*)$/, " and $1")}` : "Ready. Everything else can be added after.";
  const submit = () => f.submit(() => setOpen("tickets"));
  const errorLine = f.error && (
    <p role="alert" className="font-body text-[14px] text-[#E5484D]">
      {f.error}
    </p>
  );

  const rows: Array<{ id: string; icon: ReactNode; label: string; sum: string; done: boolean; optional?: boolean; body: ReactNode }> = [
    { id: "when", icon: <Calendar />, label: "Date and time", sum: `${parts(f.start).wd} ${parts(f.start).day} ${parts(f.start).mon.toLowerCase()} · ${parts(f.start).time}`, done: true, body: <WhenFields f={f} /> },
    {
      id: "where",
      icon: <MapPin />,
      label: "Where",
      sum: f.inPerson ? f.place || "Add a place" : f.link ? LINK_LABEL[f.linkType ?? "other"] : "Online",
      done: f.inPerson ? !!f.place.trim() : !!f.link.trim(),
      body: <WhereFields f={f} />,
    },
    { id: "desc", icon: <AlignLeft />, label: "Description", sum: f.about ? `${f.about.slice(0, 28)}${f.about.length > 28 ? "…" : ""}` : "", done: !!f.about.trim(), optional: true, body: <DescField f={f} alwaysOpen /> },
    { id: "tickets", icon: <Ticket />, label: "Tickets", sum: ticketsSummary(f.paid, f.tickets), done: true, optional: true, body: <TicketsFields f={f} /> },
    { id: "who", icon: f.visibility === "public" ? <Globe /> : f.visibility === "invite" ? <Lock /> : <Users />, label: "Who can see it", sum: WHO.find((w) => w.value === f.visibility)?.label ?? "", done: true, body: <WhoFields f={f} /> },
    { id: "twod", icon: <Grid3x3 />, label: "2D room", sum: two.on ? `On · ${two.template[0].toUpperCase()}${two.template.slice(1)} · Free` : "Off", done: two.on, optional: true, body: <TwoDRoomCard on={two.on} template={two.template} onChange={setTwo} sub="Guests walk in from 1 hour before" /> },
  ];

  return (
    <TintShell look={fullLook} className="min-h-full">
      {/* ---------------- phone ---------------- */}
      <div className="lg:hidden">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-t-line bg-t-bar px-4 py-3 backdrop-blur">
          <button type="button" aria-label="Close" onClick={() => router.push("/")} className="grid h-9 w-9 place-items-center rounded-hz border border-t-line">
            <X size={18} />
          </button>
          <b className="font-display text-[17px] font-extrabold">New event</b>
          <div className="ml-auto">
            <PostAs f={f} onNewRoom={onNewRoom} />
          </div>
        </div>
        <div className="grid gap-4 px-4 pb-6 pt-4">
          <CoverBlock cover={cover} setCover={setCover} phone />
          <LookCard look={fullLook} setLook={setLook} />
          <div className="grid grid-cols-[auto_1fr] items-end gap-4">
            <BigDate iso={f.start} />
            <label className="block">
              <span className="sr-only">Event name</span>
              <textarea
                value={f.title}
                onChange={(e) => f.setTitle(e.target.value.replace(/\n/g, ""))}
                rows={2}
                placeholder="Event name"
                maxLength={120}
                className="!resize-none !border-0 !bg-transparent !px-0 font-display text-[28px] font-black leading-tight"
              />
            </label>
          </div>
          <div className="grid gap-2">
            {rows.map((r) => (
              <div key={r.id} className="t-card overflow-hidden">
                <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left">
                  <IconTile>{r.icon}</IconTile>
                  <span className="min-w-0 flex-1">
                    <b className="block font-body text-[14.5px]">{r.label}</b>
                    <span className="block truncate font-body text-[12.5px] text-t-muted">{r.sum || (r.optional ? "Optional" : "")}</span>
                  </span>
                  {r.done && <Check size={16} className="text-t-accent" aria-label="Done" />}
                  <ChevronDown size={18} className={`text-t-muted transition-transform ${open === r.id ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {open === r.id && <div className="border-t border-t-line p-3">{r.body}</div>}
              </div>
            ))}
          </div>
          {errorLine}
        </div>
        <div className="sticky bottom-0 z-30 border-t border-t-line bg-t-bar px-4 pb-3 pt-3 backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            {steps.map((s, i) => (
              <i key={i} className={`h-1.5 flex-1 rounded-full ${s ? "bg-t-accent" : "bg-t-soft"}`} />
            ))}
            <span className="ml-1 font-body text-[12px] text-t-muted">{left ? `${left} left` : "Ready"}</span>
          </div>
          <button type="button" className="lip w-full !min-h-[52px] !text-[16px]" aria-disabled={!canCreate} onClick={submit}>
            {buttonText}
          </button>
        </div>
      </div>

      {/* ---------------- desktop ---------------- */}
      <div className="mx-auto hidden max-w-[1180px] px-8 pb-16 pt-6 lg:block">
        <div className="mb-6 flex items-center justify-between gap-4">
          <PostAs f={f} onNewRoom={onNewRoom} />
          <label className="flex items-center gap-2">
            <span className="font-body text-[13px] text-t-muted">Who can see it</span>
            <select value={f.visibility} onChange={(e) => f.setVisibility(e.target.value as Visibility)} className="!w-auto font-body text-[14px]">
              {WHO.map((w) => (
                <option key={w.value} value={w.value} disabled={w.value === "community" && !f.roomOn}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-[110px_minmax(0,1fr)_380px] gap-8">
          <BigDate iso={f.start} />
          <div className="grid content-start gap-6">
            <div>
              <input
                value={f.title}
                onChange={(e) => f.setTitle(e.target.value)}
                placeholder="Event name"
                aria-label="Event name"
                autoComplete="off"
                maxLength={120}
                className="!rounded-none !border-0 !border-b !border-dashed !bg-transparent !px-0 !py-1 font-display text-[40px] font-black leading-tight"
              />
              <p className="mt-1.5 font-body text-[12.5px] text-t-muted">This is the name people see on the map and on their ticket.</p>
            </div>
            <div className="grid grid-cols-[40px_1fr] gap-3">
              <IconTile>
                <Calendar />
              </IconTile>
              <div className="t-card p-3">
                <WhenFields f={f} />
              </div>
            </div>
            <div className="grid grid-cols-[40px_1fr] gap-3">
              <IconTile>
                <MapPin />
              </IconTile>
              <WhereFields f={f} />
            </div>
            <div className="grid grid-cols-[40px_1fr] gap-3">
              <IconTile>
                <AlignLeft />
              </IconTile>
              <div className="grid">
                <DescField f={f} />
              </div>
            </div>
            <div className="grid gap-2">
              <button type="button" className="lip !min-h-[52px] !text-[16px]" aria-disabled={!canCreate} onClick={submit}>
                {buttonText}
              </button>
              <span className="text-center font-body text-[12.5px] text-t-muted">{leftText}</span>
              {errorLine}
            </div>
          </div>
          <div className="grid content-start gap-4">
            <CoverBlock cover={cover} setCover={setCover} />
            <LookCard look={fullLook} setLook={setLook} />
            <div className="t-card grid gap-3 p-4">
              <b className="font-body text-[15px]">Tickets</b>
              <TicketsFields f={f} />
            </div>
            <TwoDRoomCard on={two.on} template={two.template} onChange={setTwo} sub="Guests walk in from 1 hour before" />
          </div>
        </div>
      </div>

      <SignInSheet open={f.signIn} reason="Sign up to create your event" onClose={f.closeSignIn} onSignedIn={f.signedIn} />
      {f.made && <DoneSheet event={f.made} roomName={f.roomOn ? (f.room?.name ?? null) : null} onNewRoom={onNewRoom} />}
    </TintShell>
  );
}
