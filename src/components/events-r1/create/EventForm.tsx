"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { AREAS, areaByName } from "@/lib/geo";
import { useR1Api, useR1Auth, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { EventDraft, EventKind, LinkType, Visibility } from "@/lib/events-r1/types";
import { Choice, Row, Toggle } from "./Fields";
import { cleanLink, DEFAULT_LENGTH, defaultStart, detectLinkType, fromLagosInput, LINK_LABEL, TIMEZONE, toLagosInput } from "./helpers";

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
export default function EventForm() {
  const router = useRouter();
  const api = useR1Api();
  const { user } = useR1Auth();
  const clock = useR1Now();

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => toLagosInput(defaultStart(Date.now())));
  const [end, setEnd] = useState(() => toLagosInput(defaultStart(Date.now()) + DEFAULT_LENGTH));
  const touched = useRef(false);
  const [kind, setKind] = useState<EventKind>("in_person");
  const [place, setPlace] = useState("");
  const [area, setArea] = useState("");
  const [linkType, setLinkType] = useState<LinkType | null>(null);
  const [link, setLink] = useState("");
  const [about, setAbout] = useState("");
  const [approval, setApproval] = useState(false);
  const [capacity, setCapacity] = useState("");
  const capAuto = useRef(false);
  const [waitlist, setWaitlist] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [addToRoom, setAddToRoom] = useState(true);
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
    setStart(toLagosInput(defaultStart(clock)));
    setEnd(toLagosInput(defaultStart(clock) + DEFAULT_LENGTH));
    // Once, when the clock first answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // The host's room (if any) comes from their own events: the data layer has no "my room" call yet.
  const mine = useR1Query((a) => a.events.listMine(), [user?.id ?? null]);
  const room = mine.data?.find((e) => e.host.roomId)?.host ?? null;
  const roomName = room?.roomName ?? null;
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
    const a = fromLagosInput(start);
    const b = fromLagosInput(end);
    setStart(v);
    const n = fromLagosInput(v);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(n) && b > a) setEnd(toLagosInput(n + (b - a)));
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
      starts_at: Number.isFinite(fromLagosInput(start)) ? new Date(fromLagosInput(start)).toISOString() : undefined,
      ends_at: Number.isFinite(fromLagosInput(end)) ? new Date(fromLagosInput(end)).toISOString() : null,
      timezone: TIMEZONE,
      kind,
      description: about.trim(),
      capacity: cap,
      requires_approval: approval,
      waitlist_on: waitlist,
      visibility,
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
      router.push(`/event/${made.id}?new=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again later");
      setBusy(false);
    }
  };

  const submit = () => {
    if (!api || busy || !title.trim()) return;
    if (!api.auth.current()) {
      setSheet(true);
      return;
    }
    void create();
  };

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
        <TimeRow label="Starts" value={start} onChange={changeStart} />
        <div className="h-px bg-line" />
        <TimeRow label="Ends" value={end} onChange={changeEnd} />
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
          {effLink === "whatsapp" && <p className="font-body text-[14px] text-danfo">WhatsApp calls hold up to 32 people. Capacity set to 32.</p>}
          <p className="hint px-1">Guests see the link after they register.</p>
        </div>
      )}

      <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} placeholder="Description" aria-label="Description" maxLength={2000} />

      <div className="flex flex-col gap-2">
        <Row label="Tickets" value="Free" open={open === "tickets"} onToggle={() => setOpen(open === "tickets" ? null : "tickets")}>
          <div className="flex min-h-[44px] items-center justify-between font-body text-[15px]">
            <span>General</span>
            <span className="text-cream">Free</span>
          </div>
          <p className="hint">Paid tickets come later.</p>
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
        <button type="button" className="btn w-full normal-case" onClick={submit} disabled={busy || !title.trim() || !api}>
          {busy ? "Creating" : "Create event"}
        </button>
        {error && (
          <p ref={errorRef} role="alert" className="px-1 font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
      </div>

      <SignInSheet
        open={sheet}
        reason="Create your event"
        onClose={() => setSheet(false)}
        onSignedIn={() => {
          setSheet(false);
          void create();
        }}
      />
    </div>
  );
}

function TimeRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-h-[52px] items-center justify-between gap-3">
      <span className="w-14 flex-none font-body text-[15px] text-dim">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} (${TIMEZONE})`}
        className="!w-auto min-w-0 flex-1 !border-0 !bg-transparent !px-0 text-right"
      />
    </label>
  );
}
