"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { AREAS, areaByName } from "@/lib/geo";
import { useMyRooms, useR1Api, useR1Auth, useR1Now } from "@/lib/events-r1/hooks";
import type { EventDraft, EventKind, LinkType, Visibility } from "@/lib/events-r1/types";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import { Choice, Row, Toggle } from "./Fields";
import { usePaidGate } from "../pay/usePay";
import { hostPayError } from "../pay/words";
import Tickets, { newTicket, ticketsDraft, ticketsError, ticketsSummary } from "./Tickets";
import type { TicketForm } from "./Tickets";
import DateTimePicker from "../DateTimePicker";
import { endError, lagosIso, moveEnd } from "../dateTime";
import GlowButton from "./GlowButton";
import { bool, clearDraft, patchDraft, readDraft, str } from "./draft";
import { cleanLink, DEFAULT_LENGTH, defaultStart, detectLinkType, LINK_LABEL, TIMEZONE } from "./helpers";

const KINDS: Array<{ value: EventKind; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Both" },
];
const LINKS: Array<{ value: LinkType; label: string }> = (["zoom", "meet", "whatsapp", "other"] as const).map((v) => ({ value: v, label: LINK_LABEL[v] }));
const WHO: Array<{ value: Visibility; label: string; line: string }> = [
  { value: "public", label: "Public", line: "everyone can find it" },
  { value: "community", label: "Community", line: "only your room's members" },
  { value: "invite", label: "Invite only", line: "only people with the link" },
];
const WHO_NAME: Record<Visibility, string> = { public: "Public", community: "Community", invite: "Invite only" };
const WA_MAX = 32;

/** Release 1 one page create, event side. A name is enough; every other field has a default (see the data layer). */
export default function EventForm({ cover }: { cover: string | null }) {
  const router = useRouter();
  const api = useR1Api();
  const clock = useR1Now();

  // What was typed before a reload or a trip out to Google (see draft.ts). Read once.
  const [saved] = useState(() => readDraft());
  const [d0] = useState<Record<string, unknown>>(() => saved.event ?? {});
  const resume = useRef(saved.pending === "event");
  const resumed = useRef(false);
  const { user } = useR1Auth();

  const [title, setTitle] = useState(() => str(d0.title));
  const [start, setStart] = useState(() => (d0.touched === true && str(d0.start) ? str(d0.start) : lagosIso(defaultStart(Date.now()))));
  const [end, setEnd] = useState(() => (d0.touched === true && str(d0.end) ? str(d0.end) : lagosIso(defaultStart(Date.now()) + DEFAULT_LENGTH)));
  const touched = useRef(d0.touched === true);
  const [kind, setKind] = useState<EventKind>(() => (KINDS.some((k) => k.value === d0.kind) ? (d0.kind as EventKind) : "in_person"));
  const [place, setPlace] = useState(() => str(d0.place));
  const [area, setArea] = useState(() => str(d0.area));
  const [linkType, setLinkType] = useState<LinkType | null>(() => (LINKS.some((k) => k.value === d0.linkType) ? (d0.linkType as LinkType) : null));
  const [link, setLink] = useState(() => str(d0.link));
  const [about, setAbout] = useState(() => str(d0.about));
  const [approval, setApproval] = useState(() => bool(d0.approval));
  const [capacity, setCapacity] = useState(() => str(d0.capacity));
  const capAuto = useRef(d0.capAuto === true);
  const [waitlist, setWaitlist] = useState(() => bool(d0.waitlist));
  const [paid, setPaid] = useState(() => bool(d0.paid));
  const [tickets, setTickets] = useState<TicketForm[]>(() => {
    const t = d0.tickets;
    if (Array.isArray(t) && t.length > 0) {
      const rows = t.map((x: Record<string, unknown>) => {
        const row = newTicket(str(x?.name));
        row.price = str(x?.price);
        row.capacity = str(x?.capacity);
        return row;
      });
      return rows;
    }
    return [newTicket("General")];
  });
  const [visibility, setVisibility] = useState<Visibility>(() => (WHO.some((w) => w.value === d0.visibility) ? (d0.visibility as Visibility) : "public"));
  const [addToRoom, setAddToRoom] = useState(() => bool(d0.addToRoom, true));
  const [open, setOpen] = useState<"tickets" | "approval" | "who" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The line sits under the button, which can be below the fold on a phone.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  const [sheet, setSheet] = useState(false);

  // The fake clock may be moved by a tester: when the data layer is ready, default from its time (until the host edits a time).
  useEffect(() => {
    if (touched.current) return;
    setStart(lagosIso(defaultStart(clock)));
    setEnd(lagosIso(defaultStart(clock) + DEFAULT_LENGTH));
    // Once, when the clock first answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Keep the draft as it is typed.
  useEffect(() => {
    patchDraft({
      mode: "event",
      event: {
        title, start, end, touched: touched.current, kind, place, area, linkType, link, about, approval, capacity,
        capAuto: capAuto.current, waitlist, paid, tickets, visibility, addToRoom,
      },
    });
  }, [title, start, end, kind, place, area, linkType, link, about, approval, capacity, waitlist, paid, tickets, visibility, addToRoom]);

  // The host's room (if any): the first room they own.
  const mine = useMyRooms();
  const room = mine.data?.[0] ?? null;
  const roomName = room?.name ?? null;
  const roomOn = !!room && addToRoom;

  const online = kind !== "in_person";
  const inPerson = kind !== "online";
  const effLink: LinkType | null = online ? linkType : null;

  /** WhatsApp calls hold up to 32 people: choosing it sets the capacity; leaving it clears what it set. */
  const syncCapacity = (t: LinkType | null) => {
    if (t === "whatsapp") {
      setCapacity(String(WA_MAX));
      capAuto.current = true;
    } else if (capAuto.current) {
      setCapacity("");
      capAuto.current = false;
    }
  };

  const pickKind = (k: EventKind) => {
    setKind(k);
    syncCapacity(k === "in_person" ? null : linkType);
  };
  const pickLink = (t: LinkType) => {
    setLinkType(t);
    syncCapacity(t);
  };
  const pasteLink = (v: string) => {
    setLink(v);
    const t = detectLinkType(v);
    if (t) pickLink(t);
  };
  const changeStart = (v: string) => {
    touched.current = true;
    // Keep the length: the end moves with the start.
    setEnd(moveEnd(start, end, v));
    setStart(v);
  };
  const changeEnd = (v: string) => {
    touched.current = true;
    setEnd(v);
  };
  const changeCapacity = (v: string) => {
    capAuto.current = false;
    const d = v.replace(/\D/g, "").slice(0, 5);
    setCapacity(effLink === "whatsapp" && Number(d) > WA_MAX ? String(WA_MAX) : d);
  };
  const pickWho = (v: Visibility) => setVisibility(v);
  const changeAddToRoom = (on: boolean) => {
    setAddToRoom(on);
    // Community lives in the room: leaving the room leaves Community.
    if (!on && visibility === "community") setVisibility("public");
  };

  const draft = (): EventDraft => {
    const a = inPerson ? areaByName(area) : undefined;
    const cap = capacity ? Number(capacity) : null;
    const d: EventDraft = {
      title: title.trim(),
      starts_at: Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : undefined,
      ends_at: Number.isFinite(Date.parse(end)) ? new Date(end).toISOString() : null,
      timezone: TIMEZONE,
      kind,
      description: about.trim(),
      capacity: cap,
      requires_approval: approval,
      waitlist_on: waitlist,
      visibility,
      tickets: ticketsDraft(paid, tickets),
      cover_url: cover,
    };
    if (inPerson) {
      d.place_name = place.trim();
      if (a) {
        d.area = a.name;
        d.lat = a.lat;
        d.lng = a.lng;
      }
    }
    if (online) {
      d.link_type = linkType ?? (link.trim() ? "other" : null);
      d.online_link = cleanLink(link) || null;
    }
    if (room) d.add_to_room = addToRoom;
    return d;
  };

  const create = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.events.create(draft());
      clearDraft();
      router.push(`/host/${made.id}?new=1`);
    } catch (e) {
      patchDraft({ pending: null });
      setError(paid ? hostPayError(e) : e instanceof Error ? e.message : "Try again later");
      setBusy(false);
    }
  };

  /** Paid with paid tickets off, or before the host can sell: nothing can be made. The button says so. */
  const gate = usePaidGate();
  const blocked = paid && gate.state !== "ready" && gate.state !== "signedout";
  const endBad = endError(start, end);

  const submit = () => {
    if (!api || busy || !title.trim() || blocked || endBad) return;
    const bad = ticketsError(paid, tickets);
    if (bad) {
      setOpen("tickets");
      setError(bad);
      return;
    }
    if (!api.auth.current()) {
      // Sign up wall; the draft is marked so the event is made at once after sign up, even after the trip out to Google.
      patchDraft({ pending: "event" });
      setSheet(true);
      return;
    }
    void create();
  };

  // Back from Google (the page reloaded) with the sign up waiting: make the event now, from the restored draft.
  useEffect(() => {
    if (!resume.current || resumed.current || !api) return;
    if (user) {
      resumed.current = true;
      resume.current = false;
      patchDraft({ pending: null });
      submit();
      return;
    }
    const id = window.setTimeout(() => {
      resume.current = false;
      patchDraft({ pending: null });
    }, 6000);
    return () => window.clearTimeout(id);
    // Only when the sign in state answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, user]);

  const capacityText = capacity ? capacity : "None";

  return (
    <div className="flex flex-col gap-4">
      <label className="block">
        <span className="sr-only">Event name</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event name"
          autoComplete="off"
          maxLength={120}
          className="!rounded-none !border-0 !border-b !bg-transparent !px-0 py-2 font-display text-[28px] font-black leading-tight placeholder:text-dim/60"
        />
      </label>

      <div className="rounded-hz border border-line bg-ink-2 px-4">
        <DateTimePicker label="Starts" value={start} onChange={changeStart} min={lagosIso(clock)} now={clock} />
        <div className="h-px bg-line" />
        <DateTimePicker label="Ends" value={end} onChange={changeEnd} min={start} error={endBad} now={clock} />
      </div>
      <p className="hint -mt-2 px-1">{TIMEZONE}</p>

      <Choice label="Where" value={kind} options={KINDS} onChange={pickKind} />

      {inPerson && (
        <div className="flex flex-col gap-2">
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place" aria-label="Place" autoComplete="off" />
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="">Area</option>
            {AREAS.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <p className="hint px-1">{area ? "It shows on the map in this area." : "Pick an area to put it on the map."}</p>
        </div>
      )}

      {online && (
        <div className="flex flex-col gap-2">
          <p className="hint px-1">Join with</p>
          <Choice label="Join with" value={linkType} options={LINKS} onChange={pickLink} />
          <input value={link} onChange={(e) => pasteLink(e.target.value)} placeholder="Paste your call link" aria-label="Call link" inputMode="url" autoComplete="off" autoCapitalize="none" />
          {effLink === "whatsapp" && <p className="font-body text-[14px] text-cream">WhatsApp calls hold up to 32 people. Capacity set to 32.</p>}
          <p className="hint px-1">Guests see the link after they register.</p>
        </div>
      )}

      <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} placeholder="Description" aria-label="Description" maxLength={2000} />

      <div className="flex flex-col gap-2">
        <Row label="Tickets" value={ticketsSummary(paid, tickets)} open={open === "tickets"} onToggle={() => setOpen(open === "tickets" ? null : "tickets")}>
          <Tickets paid={paid} onPaid={setPaid} types={tickets} onTypes={setTickets} />
        </Row>

        <Row
          label="Approval"
          value={`${approval ? "On" : "Off"} · Capacity: ${capacityText}`}
          open={open === "approval"}
          onToggle={() => setOpen(open === "approval" ? null : "approval")}
        >
          <Toggle on={approval} onChange={setApproval} label="Require approval" hint="You say yes to each person." />
          <label className="flex min-h-[48px] items-center justify-between gap-3 py-1">
            <span className="font-body text-[15px]">Capacity</span>
            <input
              value={capacity}
              onChange={(e) => changeCapacity(e.target.value)}
              inputMode="numeric"
              placeholder="None"
              aria-label="Capacity"
              className="!w-28 text-right"
            />
          </label>
          <Toggle on={waitlist} onChange={setWaitlist} label="Waitlist when full" />
        </Row>

        <Row label="Who can see it" value={WHO_NAME[visibility]} open={open === "who"} onToggle={() => setOpen(open === "who" ? null : "who")}>
          <div role="radiogroup" aria-label="Who can see it" className="flex flex-col">
            {WHO.map((w) => {
              const off = w.value === "community" && !roomOn;
              return (
                <button
                  key={w.value}
                  type="button"
                  role="radio"
                  aria-checked={visibility === w.value}
                  disabled={off}
                  onClick={() => pickWho(w.value)}
                  className="flex min-h-[48px] items-center gap-3 py-2 text-left disabled:opacity-50"
                >
                  <span className={`grid h-5 w-5 flex-none place-items-center rounded-full border ${visibility === w.value ? "border-orange" : "border-dim"}`} aria-hidden>
                    {visibility === w.value && <span className="h-2.5 w-2.5 rounded-full bg-orange" />}
                  </span>
                  <span className="min-w-0 font-body text-[15px]">
                    <span className="text-cream">{w.label}</span>
                    <span className="text-dim">: {w.line}</span>
                    {off && <span className="hint block">Needs a room</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Row>
      </div>

      {room && roomName && <Toggle on={addToRoom} onChange={changeAddToRoom} label={`Add to ${roomName}`} />}

      <div className="flex flex-col gap-2 pb-2">
        <GlowButton ready={!busy && !!title.trim() && !!api && !blocked} className="btn w-full normal-case" onClick={submit} disabled={busy || !title.trim() || !api || blocked}>
          {blocked && gate.state === "off" ? PAID_UNAVAILABLE : blocked && gate.state === "needs" ? "Set up payouts first" : busy ? "Creating" : "Create event"}
        </GlowButton>
        {error && (
          <p ref={errorRef} role="alert" className="px-1 font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
      </div>

      <SignInSheet
        open={sheet}
        reason="Sign up to create your event"
        onClose={() => {
          setSheet(false);
          patchDraft({ pending: null });
        }}
        onSignedIn={() => {
          setSheet(false);
          void create();
        }}
      />
    </div>
  );
}
