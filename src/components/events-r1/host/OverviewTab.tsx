"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Send, Share2, UserPlus } from "lucide-react";
import CoverPicker from "@/components/events-r1/create/CoverPicker";
import { Choice } from "@/components/events-r1/create/Fields";
import DateTimePicker from "@/components/events-r1/DateTimePicker";
import { endError, lagosIso, moveEnd } from "@/components/events-r1/dateTime";
import { cleanLink, detectLinkType, LINK_LABEL } from "@/components/events-r1/create/helpers";
import { copyText, eventUrl, shareOrCopy } from "@/components/events-r1/page/share";
import { AREAS, areaByName } from "@/lib/geo";
import { useR1Api, useR1Now } from "@/lib/events-r1/hooks";
import type { EventDraft, LinkType, R1Event, Registration } from "@/lib/events-r1/types";
import type { TabId } from "./HostDashboard";
import { CARD, ErrorLine, useFlash } from "./ui";
import { countsOf, errWord } from "./words";

type ItemId = "name" | "place" | "about" | "cover" | "price";

const freeKey = (id: string) => `hz.r1.host.free.${id}`;
function readFree(id: string): boolean {
  try {
    return window.localStorage.getItem(freeKey(id)) === "1";
  } catch {
    return false;
  }
}

const LINKS = (["zoom", "meet", "whatsapp", "other"] as const).map((v) => ({ value: v as LinkType, label: LINK_LABEL[v] }));

/**
 * Overview: what is left to set up, the three big actions, the short link and the counts. Nothing here is forced:
 * every checklist line opens a small edit right under it.
 */
export default function OverviewTab({ event, regs, fresh, onTab }: { event: R1Event; regs: Registration[] | null; fresh: boolean; onTab: (t: TabId) => void }) {
  const api = useR1Api();
  const [said, say] = useFlash();
  const [open, setOpen] = useState<ItemId | null>(null);
  const [showList, setShowList] = useState(false);
  // "Keep it free" is remembered in this browser: the data layer has no field for it.
  const [keptFree, setKeptFree] = useState(false);
  useEffect(() => setKeptFree(readFree(event.id)), [event.id]);

  const online = event.kind !== "in_person";
  const inPerson = event.kind !== "online";
  const items: Array<{ id: ItemId; label: string; done: boolean }> = [
    { id: "name", label: "Name and time", done: !!event.title.trim() && !!event.starts_at },
    { id: "place", label: online && !inPerson ? "Online link" : "Place or online link", done: (inPerson && !!event.venue_name.trim()) || (online && !!event.online_link) },
    { id: "about", label: "Description", done: !!event.description.trim() },
    { id: "cover", label: "Cover", done: !!event.flyer_url },
    { id: "price", label: "Price (or keep it free)", done: event.ticket_types.some((t) => t.price_naira > 0) || keptFree },
  ];
  const done = items.filter((i) => i.done).length;
  const allSet = done === items.length;

  const url = eventUrl(event);
  const shown = url.replace(/^https?:\/\//, "");
  const copy = async () => say((await copyText(url)) ? "Copied" : "Could not copy");
  const share = async (invite: boolean) => {
    const target = invite && api ? eventUrl(event, api.registrations.inviteRef(event.id)) : url;
    const res = await shareOrCopy({ title: event.title, text: invite ? `Come to ${event.title} with me` : event.title, url: target });
    if (res === "copied") say("Copied");
    else if (res === "failed") say("Could not copy");
  };

  const c = countsOf(regs);
  const going = regs ? c.going : event.going;
  const checkedIn = regs ? c.checkedIn : (event.checkins ?? 0);
  const spots = event.spots_left === null ? "No limit" : `${event.spots_left} ${event.spots_left === 1 ? "spot" : "spots"} left`;

  const keepFree = () => {
    try {
      window.localStorage.setItem(freeKey(event.id), "1");
    } catch {
      /* not saved: it shows done until the page is left */
    }
    setKeptFree(true);
    setOpen(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {fresh && (
          <p className="flex items-center gap-1.5 font-body text-[14px] text-keke">
            <Check size={15} strokeWidth={3} aria-hidden /> Your event is live
          </p>
        )}

        <section className={CARD} aria-label="Finish setting up">
          {allSet && !showList ? (
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-display text-[16px] font-black">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-keke text-keke" aria-hidden>
                  <Check size={14} strokeWidth={3} />
                </span>
                All set
              </p>
              <button type="button" onClick={() => setShowList(true)} className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4">
                Edit details
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-[16px] font-black">Finish setting up</h2>
                <p className="font-body text-[14px] text-dim">
                  {done} of {items.length} done
                </p>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      aria-expanded={open === it.id}
                      onClick={() => setOpen(open === it.id ? null : it.id)}
                      className="flex min-h-[48px] w-full items-center gap-3 text-left"
                    >
                      <span
                        className={clsx("grid h-6 w-6 flex-none place-items-center rounded-full border", it.done ? "border-keke text-keke" : "border-dim text-transparent")}
                        aria-hidden
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                      <span className={clsx("min-w-0 flex-1 font-body text-[15px]", it.done && "text-dim")}>{it.label}</span>
                      <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open === it.id && "rotate-180")} />
                    </button>
                    {open === it.id && (
                      <div className="pb-3 pl-9">
                        {it.id === "price" ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <button type="button" onClick={keepFree} className="btn btn-ghost px-4 normal-case">
                              Keep it free
                            </button>
                            <button type="button" onClick={() => onTab("registration")} className="min-h-[44px] font-body text-[15px] text-orange">
                              Set a price
                            </button>
                          </div>
                        ) : (
                          <Edit event={event} item={it.id} onDone={() => { setOpen(null); say("Saved"); }} />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="grid grid-cols-3 gap-2">
          <Big icon={<UserPlus size={20} aria-hidden />} label="Invite" onClick={() => void share(true)} />
          <Big icon={<Send size={20} aria-hidden />} label="Send a Pop" onClick={() => onTab("pops")} />
          <Big icon={<Share2 size={20} aria-hidden />} label="Share" onClick={() => void share(false)} />
        </div>

        <div className={CARD}>
          <p className="seclabel">Link</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-body text-[15px]">{shown}</p>
            <button type="button" onClick={() => void copy()} className="btn btn-ghost flex-none px-4 normal-case">
              Copy
            </button>
          </div>
          <p className="mt-1 h-4 font-body text-[13px] text-dim" aria-live="polite">
            {said}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <section className={CARD} aria-label="Counts">
          <div className="grid grid-cols-3 gap-2">
            <Stat n={going} label="going" />
            <Stat n={regs ? c.pending : 0} label="pending" />
            <Stat n={checkedIn} label="checked in" />
          </div>
          <p className="mt-3 font-body text-[14px] text-dim">
            {spots}
            {regs && c.waitlist > 0 ? ` · ${c.waitlist} on the waitlist` : ""}
          </p>
        </section>
        <Link href={`/host/${encodeURIComponent(event.id)}/door`} className="btn w-full normal-case">
          Check in
        </Link>
      </div>
    </div>
  );
}

function Big({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-hz border border-line bg-ink-2 px-2 font-body text-[15px] text-cream active:bg-ink-3">
      <span className="text-orange">{icon}</span>
      {label}
    </button>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="num text-[30px]">{n}</p>
      <p className="mt-1 font-body text-[14px] text-dim">{label}</p>
    </div>
  );
}

/** The small edit under a checklist line. Name, place or link, description, cover. */
function Edit({ event, item, onDone }: { event: R1Event; item: Exclude<ItemId, "price">; onDone: () => void }) {
  const api = useR1Api();
  const clock = useR1Now();
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(() => lagosIso(Date.parse(event.starts_at)));
  const [end, setEnd] = useState(() => lagosIso(event.ends_at ? Date.parse(event.ends_at) : Date.parse(event.starts_at) + 3 * 3.6e6));
  const [place, setPlace] = useState(event.venue_name);
  const [area, setArea] = useState(event.area ?? "");
  const [linkType, setLinkType] = useState<LinkType | null>(event.link_type);
  const [link, setLink] = useState(event.online_link ?? "");
  const [about, setAbout] = useState(event.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const timeBad = endError(start, end);

  const save = async (patch: Partial<EventDraft>) => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.events.update(event.id, patch);
      onDone();
    } catch (e) {
      setError(errWord(e));
      setBusy(false);
    }
  };

  const savePlace = () => {
    const patch: Partial<EventDraft> = {};
    if (event.kind !== "online") {
      patch.place_name = place.trim();
      patch.area = area || null;
      const a = areaByName(area);
      if (area && area === event.area) {
        // Same area: keep the pin where it is.
        patch.lat = event.lat;
        patch.lng = event.lng;
      } else if (a) {
        patch.lat = a.lat;
        patch.lng = a.lng;
      }
    }
    if (event.kind !== "in_person") {
      patch.link_type = linkType ?? (link.trim() ? "other" : null);
      patch.online_link = cleanLink(link) || null;
    }
    void save(patch);
  };

  return (
    <div className="flex flex-col gap-2">
      {item === "name" && (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event name" maxLength={120} autoComplete="off" />
          <div className="rounded-hz border border-line bg-ink-3/40 px-4">
            <DateTimePicker label="Starts" value={start} onChange={(v) => { setEnd(moveEnd(start, end, v)); setStart(v); }} now={clock} />
            <div className="h-px bg-line" />
            <DateTimePicker label="Ends" value={end} onChange={setEnd} min={start} error={timeBad} now={clock} />
          </div>
          <SaveRow busy={busy} disabled={!title.trim() || !!timeBad} onSave={() => void save({ title: title.trim(), starts_at: start, ends_at: end })} />
        </>
      )}
      {item === "place" && (
        <>
          {event.kind !== "online" && (
            <>
              <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place" aria-label="Place" autoComplete="off" />
              <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
                <option value="">Area</option>
                {AREAS.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {event.kind !== "in_person" && (
            <>
              <Choice label="Join with" value={linkType} options={LINKS} onChange={setLinkType} />
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
            </>
          )}
          <SaveRow busy={busy} onSave={savePlace} />
        </>
      )}
      {item === "about" && (
        <>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={4} placeholder="Description" aria-label="Description" maxLength={2000} />
          <SaveRow busy={busy} onSave={() => void save({ description: about.trim() })} />
        </>
      )}
      {item === "cover" && <CoverPicker cover={event.flyer_url} onChange={(url) => void save({ cover_url: url })} />}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

function SaveRow({ busy, disabled, onSave }: { busy: boolean; disabled?: boolean; onSave: () => void }) {
  return (
    <button type="button" onClick={onSave} disabled={busy || disabled} className="btn self-start px-5 normal-case">
      {busy ? "Saving" : "Save"}
    </button>
  );
}
