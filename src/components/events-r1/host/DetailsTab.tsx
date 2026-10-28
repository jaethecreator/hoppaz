"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { coverFromFile, uploadCoverFile } from "@/components/events-r1/create/cover";
import { LookCard, Seg } from "@/components/events-r1/create/CreateEvent";
import { Toggle } from "@/components/events-r1/create/Fields";
import { cleanLink, detectLinkType, LINK_LABEL } from "@/components/events-r1/create/helpers";
import DateTimePicker from "@/components/events-r1/DateTimePicker";
import { endError, lagosIso, moveEnd } from "@/components/events-r1/dateTime";
import { AREAS, areaByName } from "@/lib/geo";
import { useR1Api, useR1Now } from "@/lib/events-r1/hooks";
import type { Look } from "@/lib/events-r1/looks";
import type { EventDraft, EventKind, LinkType, R1Event, Visibility } from "@/lib/events-r1/types";
import { COVERS } from "@/lib/host/covers";
import { primeTint, readTint } from "@/lib/tint";
import { ErrorLine, useFlash } from "./ui";
import { errWord } from "./words";

const KINDS: Array<{ value: EventKind; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Both" },
];
const LINKS = (["zoom", "meet", "whatsapp", "other"] as const).map((v) => ({ value: v as LinkType, label: LINK_LABEL[v] }));
const WHO: Array<{ value: Visibility; label: string; line: string }> = [
  { value: "public", label: "Public", line: "Anyone can find it on the map" },
  { value: "community", label: "Room members", line: "Only people in your room" },
  { value: "invite", label: "Invite only", line: "Only people with the link" },
];

function Card({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="t-card grid gap-3 p-4 lg:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-body text-[13.5px] font-bold text-t-muted">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Details (the old More, plus editing): name, time, place, description, cover and look, who can see it, then Duplicate and Cancel.
 * Text fields save by themselves a moment after you stop typing (api.events.update); the look saves the moment you change it
 * (api.looks.set); a quiet "Saved" shows each time.
 */
export default function DetailsTab({ event, look, cover, onLook }: { event: R1Event; look: Look; cover: string | null; onLook: (l: Look) => void }) {
  const router = useRouter();
  const api = useR1Api();
  const clock = useR1Now();
  const [saved, flash] = useFlash(2400);
  const [error, setError] = useState("");

  const startIso = lagosIso(Date.parse(event.starts_at));
  const endIso = event.ends_at ? lagosIso(Date.parse(event.ends_at)) : null;
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(startIso);
  const [end, setEnd] = useState<string | null>(endIso);
  const [kind, setKind] = useState<EventKind>(event.kind);
  const [place, setPlace] = useState(event.venue_name);
  const [area, setArea] = useState(event.area ?? "");
  const [linkType, setLinkType] = useState<LinkType | null>(event.link_type);
  const [link, setLink] = useState(event.online_link ?? "");
  const [about, setAbout] = useState(event.description);
  const [visibility, setVisibility] = useState<Visibility>(event.visibility);
  const [approval, setApproval] = useState(event.requires_approval);

  const paid = event.ticket_types.some((t) => t.price_naira > 0);
  const timeBad = end ? endError(start, end) : "";

  // What was last saved, per field: a change is whatever differs from it.
  const base = useRef({ title: event.title, start: startIso, end: endIso, kind: event.kind, place: event.venue_name, area: event.area ?? "", linkType: event.link_type, link: event.online_link ?? "", about: event.description, visibility: event.visibility, approval: event.requires_approval });

  useEffect(() => {
    if (!api) return;
    const b = base.current;
    const patch: Partial<EventDraft> = {};
    if (title.trim() && title.trim() !== b.title) patch.title = title.trim();
    if (start !== b.start || (end ?? "") !== (b.end ?? "")) {
      if (!timeBad) {
        patch.starts_at = start;
        patch.ends_at = end;
      }
    }
    if (kind !== b.kind) patch.kind = kind;
    if (place.trim() !== b.place.trim() || area !== b.area || kind !== b.kind) {
      if (kind !== "online") {
        patch.place_name = place.trim();
        patch.area = area || null;
        const a = areaByName(area);
        if (area && area === event.area && kind === b.kind) {
          patch.lat = event.lat;
          patch.lng = event.lng;
        } else if (a) {
          patch.lat = a.lat;
          patch.lng = a.lng;
        }
      }
    }
    if (link !== b.link || linkType !== b.linkType || kind !== b.kind) {
      if (kind !== "in_person") {
        patch.link_type = linkType ?? (link.trim() ? "other" : null);
        patch.online_link = cleanLink(link) || null;
      }
    }
    if (about.trim() !== b.about.trim()) patch.description = about.trim();
    if (visibility !== b.visibility) patch.visibility = visibility;
    if (approval !== b.approval && !paid) patch.requires_approval = approval;
    if (Object.keys(patch).length === 0) return;

    const snapshot = { title: title.trim() || b.title, start: patch.starts_at ? start : b.start, end: patch.starts_at ? end : b.end, kind, place, area, linkType, link, about, visibility, approval };
    const id = window.setTimeout(() => {
      // Counted as saved at once, so the reload the save causes does not send it again; put back if it fails.
      const before = base.current;
      base.current = { ...before, ...snapshot };
      api.events.update(event.id, patch).then(
        () => {
          setError("");
          flash("Saved");
        },
        (e) => {
          base.current = before;
          setError(errWord(e));
        }
      );
    }, 800);
    return () => window.clearTimeout(id);
  }, [api, event.id, event.area, event.lat, event.lng, title, start, end, timeBad, kind, place, area, linkType, link, about, visibility, approval, paid, flash]);

  const saveLook = (next: Look) => {
    onLook(next);
    if (!api) return;
    api.looks.set("event", event.id, next).then(
      () => flash("Saved"),
      (e) => setError(errWord(e))
    );
  };

  const setCover = (url: string | null) => {
    if (!api) return;
    api.events.update(event.id, { cover_url: url }).then(
      () => flash("Saved"),
      (e) => setError(errWord(e))
    );
  };

  // Cover upload, the same way the create page does it.
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pick = async (x: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!x) return;
    setUploading(true);
    setError("");
    try {
      if (api?.mode === "real") {
        // The bucket link may not allow a canvas read, so the colour is read from the file on this device first.
        const local = URL.createObjectURL(x);
        try {
          const tint = await readTint(local);
          const url = await uploadCoverFile(x);
          primeTint(url, tint);
          setCover(url);
        } finally {
          URL.revokeObjectURL(local);
        }
      } else setCover(await coverFromFile(x));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture won't open. Try another.");
    } finally {
      setUploading(false);
    }
  };

  const [busy, setBusy] = useState<"clone" | "cancel" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const clone = async () => {
    if (!api || busy) return;
    setBusy("clone");
    setError("");
    try {
      const made = await api.events.clone(event.id);
      router.push(`/host/${encodeURIComponent(made.id)}?new=1`);
    } catch (e) {
      setError(errWord(e));
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!api || busy) return;
    setBusy("cancel");
    setError("");
    try {
      await api.events.cancel(event.id);
      setConfirm(false);
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 h-4 font-body text-[13px] font-bold text-t-muted" aria-live="polite">
        {saved}
      </p>

      <Card label="Event name">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event name" maxLength={120} autoComplete="off" />
        <div className="rounded-hz border border-t-line bg-t-bg px-4">
          <DateTimePicker label="Starts" value={start} onChange={(v) => { if (end) setEnd(moveEnd(start, end, v)); setStart(v); }} now={clock} />
          {end ? (
            <>
              <div className="h-px bg-t-line" />
              <DateTimePicker label="Ends" value={end} onChange={setEnd} min={start} error={timeBad} now={clock} />
              <button type="button" onClick={() => setEnd(null)} className="min-h-[44px] font-body text-[13.5px] font-bold text-t-muted underline underline-offset-4">
                Remove the end time
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEnd(lagosIso(Date.parse(start) + 3 * 3.6e6))} className="min-h-[44px] font-body text-[13.5px] font-bold text-t-accent">
              + Add an end time
            </button>
          )}
        </div>
        <span className="font-body text-[12px] text-t-muted">Lagos time, GMT+1</span>
      </Card>

      <Card label="Where">
        <Seg label="Where" value={kind} options={KINDS} onChange={setKind} />
        {kind !== "online" && (
          <div className="grid gap-2">
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place" aria-label="Place" autoComplete="off" />
            <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
              <option value="">Area</option>
              {AREAS.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
            <span className="font-body text-[12.5px] text-t-muted">Shows on the map. Guests get &quot;See on map&quot;.</span>
          </div>
        )}
        {kind !== "in_person" && (
          <div className="grid gap-2">
            <div role="radiogroup" aria-label="Join with" className="flex flex-wrap gap-2">
              {LINKS.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={linkType === o.value} onClick={() => setLinkType(o.value)} className="chip min-h-[40px] px-4 font-body text-[14px] normal-case tracking-normal">
                  {o.label}
                </button>
              ))}
            </div>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                const t = detectLinkType(e.target.value);
                if (t) setLinkType(t);
              }}
              placeholder="Paste your call link"
              aria-label="Call link"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
            />
            <span className="font-body text-[12.5px] text-t-muted">Only people who register see the link.</span>
          </div>
        )}
      </Card>

      <Card label="Description">
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={5} maxLength={2000} placeholder="What's it about? Lineup, dress code, what to bring." aria-label="Description" />
      </Card>

      <Card label="Cover and look" aside={<span className="font-body text-[12.5px] text-t-muted">Dresses your event page and this dashboard</span>}>
        <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="flex items-start gap-4">
          {cover ? <img src={cover} alt="Event cover" className="aspect-[4/5] w-24 flex-none rounded-hz border border-t-line object-cover lg:w-28" /> : <div className="aspect-[4/5] w-24 flex-none rounded-hz border border-t-line bg-t-soft" />}
          <div className="min-w-0 flex-1">
            <button type="button" className="lip-ghost" disabled={uploading} onClick={() => file.current?.click()}>
              <ImagePlus size={15} aria-hidden /> {uploading ? "Uploading" : "Upload new"}
            </button>
            <p className="mb-1.5 mt-3 font-body text-[12.5px] text-t-muted">Or pick a Hoppaz cover</p>
            <div className="grid grid-cols-5 gap-1.5">
              {COVERS.map((c) => (
                <button key={c.id} type="button" aria-label={c.name} aria-pressed={cover === c.src} onClick={() => setCover(c.src)} className={`overflow-hidden rounded-[5px] border-2 ${cover === c.src ? "border-t-accent" : "border-transparent"}`}>
                  <img src={c.src} alt="" className="block aspect-[4/5] w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <LookCard look={look} setLook={saveLook} />
      </Card>

      <Card label="Who can see it">
        <div role="radiogroup" aria-label="Who can see it" className="grid gap-2 sm:grid-cols-3">
          {WHO.map((w) => (
            <button
              key={w.value}
              type="button"
              role="radio"
              aria-checked={visibility === w.value}
              onClick={() => setVisibility(w.value)}
              className={`rounded-hz border-2 px-3 py-2.5 text-left ${visibility === w.value ? "border-t-accent bg-t-bg" : "border-t-line"}`}
            >
              <b className="block font-body text-[14.5px]">{w.label}</b>
              <span className="block font-body text-[12.5px] text-t-muted">{w.line}</span>
            </button>
          ))}
        </div>
        {paid ? (
          <p className="font-body text-[13.5px] text-t-muted">Approving guests is for free tickets only. On a paid ticket, paying is the way in.</p>
        ) : (
          <Toggle on={approval} onChange={setApproval} label="Approve guests" hint="You say yes to each person before they are in." />
        )}
      </Card>

      <Card label="Event page">
        <Link href={`/event/${encodeURIComponent(event.id)}`} className="font-body text-[15px] font-bold text-t-accent underline underline-offset-4">
          Open event page
        </Link>
      </Card>

      <Card label="Duplicate event">
        <p className="font-body text-[13.5px] text-t-muted">Same details, a week later. No guests.</p>
        <button type="button" onClick={() => void clone()} disabled={!!busy} className="lip-ghost justify-self-start">
          {busy === "clone" ? "Duplicating" : "Duplicate event"}
        </button>
      </Card>

      {event.status === "cancelled" ? (
        <p className="t-card p-4 font-body text-[15px]">This event is cancelled.</p>
      ) : event.status === "live" ? (
        <Card label="Cancel event">
          {confirm ? (
            <div role="group" aria-label="Cancel event" className="grid gap-2">
              <p className="font-body text-[15px] font-bold">Cancel this event?</p>
              <p className="font-body text-[13.5px] text-t-muted">Guests are told. Registrations stay as a record.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirm(false)} disabled={!!busy} className="lip-ghost flex-1">
                  Keep event
                </button>
                <button type="button" onClick={() => void cancel()} disabled={!!busy} className="lip flex-1">
                  {busy === "cancel" ? "Cancelling" : "Yes, cancel"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-body text-[13.5px] text-t-muted">Guests are told. Registrations stay as a record.</p>
              <button type="button" onClick={() => setConfirm(true)} className="lip-ghost justify-self-start !text-[#E5484D]">
                Cancel event
              </button>
            </>
          )}
        </Card>
      ) : null}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
