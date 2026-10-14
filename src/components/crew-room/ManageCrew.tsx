"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ImagePlus, RefreshCw, Share2, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { CrewLogo } from "@/components/crew-room/HubHeader";
import { ROOM_TEMPLATES } from "@/lib/campaign/templates";
import { inviteLink, shareInvite, type CrewCard } from "@/lib/crew-room/hub";
import {
  MAX_HEADERS,
  RIBBON_MAX,
  forgetCrewImage,
  lookError,
  saveFeatured,
  saveLook,
  saveTemplate,
  toJpeg,
  uploadCrewImage,
  useUpcomingEvents,
} from "@/lib/crew-room/look";
import { dayLabel } from "@/lib/filters";
import { useToast } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

/**
 * MANAGE CREW: the owner's dashboard, a panel over the hub (the bottom nav stays). Header pictures, the round logo,
 * the featured event and its ribbon, the meeting room template, the invite link. Every change saves the moment it is
 * made and the hub behind it updates; the server checks the owner on each call, so this screen is a convenience, not
 * the lock. Only an owner is ever shown the button that opens it.
 */
export default function ManageCrew({ card, onClose, onChange }: { card: CrewCard; onClose: () => void; onChange: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const work = useWork();
  const [look, setLook] = useState<Look>({ logo: card.logo_url, headers: card.header_images });
  const latest = useRef(look);

  // What the server holds is the truth: follow the card, except in the middle of one of our own saves.
  useEffect(() => {
    if (work.what) return;
    const held = { logo: card.logo_url, headers: card.header_images };
    latest.current = held;
    setLook(held);
  }, [card.logo_url, card.header_images, work.what]);

  /** Saves the logo and the header pictures together, so two sections never overwrite each other with a stale half. */
  const commitLook = async (patch: Partial<Look>): Promise<Look> => {
    const next = { ...latest.current, ...patch };
    const out = await saveLook(card.id, next.logo, next.headers);
    if (!out.card) throw new Error(out.error);
    const saved = { logo: out.card.logo_url, headers: out.card.header_images };
    latest.current = saved;
    setLook(saved);
    onChange();
    return saved;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={`Manage ${card.brand}`}
      tabIndex={-1}
      data-manage-crew
      className="absolute inset-0 z-40 flex animate-rise flex-col bg-ink outline-none"
    >
      <div className="pad-top flex flex-none items-center gap-2 border-b border-line bg-ink-2 px-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="seclabel">Manage crew</p>
          <h2 className="truncate font-display text-[20px] font-black leading-tight">{card.brand}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid h-11 w-11 flex-none place-items-center text-dim">
          <X size={22} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <Pictures card={card} look={look} setLook={setLook} commit={commitLook} work={work} />
          <Logo card={card} look={look} commit={commitLook} work={work} />
          <Featured card={card} onChange={onChange} work={work} />
          <Rooms card={card} onChange={onChange} work={work} />
          <Invite card={card} onChange={onChange} work={work} />
          <button type="button" className="btn btn-ghost w-full" onClick={onClose}>
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={`m-${id}`} data-manage={id}>
      <h3 id={`m-${id}`} className="seclabel">
        {title}
      </h3>
      {hint && <p className="hint mt-1">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

type Look = { logo: string | null; headers: string[] };
type Work = ReturnType<typeof useWork>;

/** One owner action at a time: a double tap never sends two writes over each other. */
function useWork() {
  const [what, setWhat] = useState("");
  const say = useToast((s) => s.say);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (what) return;
    setWhat(label);
    try {
      await fn();
    } catch (e) {
      say(e instanceof Error && e.message ? e.message : "Couldn't save that. Try again.", "error");
    } finally {
      setWhat("");
    }
  };
  return { what, run };
}

/* ----------------------------------------------------------- header pictures --- */

function Pictures({
  card,
  look,
  setLook,
  commit: save,
  work: { what, run },
}: {
  card: CrewCard;
  look: Look;
  setLook: (l: Look) => void;
  commit: (patch: Partial<Look>) => Promise<Look>;
  work: Work;
}) {
  const say = useToast((s) => s.say);
  const file = useRef<HTMLInputElement>(null);
  const images = look.headers;

  const commit = async (next: string[], dropped: string[] = []) => {
    const saved = await save({ headers: next });
    // A picture nothing shows any more leaves the bucket; the owner's own folder stays tidy.
    for (const url of dropped) if (!saved.headers.includes(url) && saved.logo !== url) void forgetCrewImage(url);
  };

  const add = (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, MAX_HEADERS - images.length);
    if (file.current) file.current.value = "";
    if (!picked.length) return;
    void run("add", async () => {
      let next = images;
      for (const f of picked) {
        const blob = await toJpeg(f, { max: 1600 });
        const url = await uploadCrewImage(card.id, blob);
        next = [...next, url];
        try {
          await commit(next);
        } catch (e) {
          void forgetCrewImage(url);
          throw e;
        }
      }
      say(picked.length > 1 ? "Pictures added." : "Picture added.", "ok");
    });
  };

  const move = (i: number, to: number) => {
    const next = [...images];
    [next[i], next[to]] = [next[to], next[i]];
    const before = look;
    setLook({ ...look, headers: next });
    void run("move", async () => {
      try {
        await commit(next);
      } catch (e) {
        setLook(before);
        throw e;
      }
    });
  };

  const remove = (i: number) => {
    const gone = images[i];
    const next = images.filter((_, k) => k !== i);
    void run("remove", async () => {
      await commit(next, [gone]);
      say("Picture removed.", "ok");
    });
  };

  return (
    <Section id="headers" title="Header pictures" hint={`Up to ${MAX_HEADERS}. They swipe in this order. We shrink them so they load fast on data.`}>
      {images.length === 0 ? (
        <p className="rounded-hz border border-dashed border-line px-3 py-4 text-center font-body text-[14px] text-dim">
          No pictures yet. The hub shows the room until you add some.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {images.map((url, i) => (
            <li key={url} className="flex items-center gap-2 rounded-hz border border-line bg-ink-3 p-2" data-header-row={i}>
              {/* eslint-disable-next-line @next/next/no-img-element -- crew upload */}
              <img src={url} alt="" width={96} height={60} className="h-[60px] w-[96px] flex-none rounded-[4px] object-cover" />
              <span className="min-w-0 flex-1 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
                {i + 1} / {images.length}
              </span>
              <IconBtn label={`Move picture ${i + 1} earlier`} disabled={!!what || i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp size={18} aria-hidden />
              </IconBtn>
              <IconBtn label={`Move picture ${i + 1} later`} disabled={!!what || i === images.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown size={18} aria-hidden />
              </IconBtn>
              <IconBtn label={`Remove picture ${i + 1}`} disabled={!!what} onClick={() => remove(i)} danger>
                <Trash2 size={18} aria-hidden />
              </IconBtn>
            </li>
          ))}
        </ol>
      )}
      <input ref={file} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => add(e.target.files)} data-file="headers" />
      <button
        type="button"
        className="btn btn-ghost mt-3 w-full"
        disabled={!!what || images.length >= MAX_HEADERS}
        onClick={() => file.current?.click()}
      >
        <ImagePlus size={17} aria-hidden />
        {what === "add" ? "SHRINKING AND SENDING…" : images.length >= MAX_HEADERS ? `${MAX_HEADERS} OF ${MAX_HEADERS} ADDED` : `ADD A PICTURE (${images.length} OF ${MAX_HEADERS})`}
      </button>
    </Section>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx("grid h-11 w-11 flex-none place-items-center rounded-hz border border-line disabled:opacity-35", danger ? "text-fireant" : "text-cream")}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------- logo --- */

function Logo({ card, look, commit, work: { what, run } }: { card: CrewCard; look: Look; commit: (patch: Partial<Look>) => Promise<Look>; work: Work }) {
  const say = useToast((s) => s.say);
  const file = useRef<HTMLInputElement>(null);

  const set = (f: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!f) return;
    void run("logo", async () => {
      const url = await uploadCrewImage(card.id, await toJpeg(f, { max: 512, square: true }));
      const old = look.logo;
      let saved: Look;
      try {
        saved = await commit({ logo: url });
      } catch (e) {
        void forgetCrewImage(url);
        throw e;
      }
      if (old && old !== url && !saved.headers.includes(old)) void forgetCrewImage(old);
      say("Logo changed.", "ok");
    });
  };

  const clear = () =>
    void run("logo", async () => {
      const old = look.logo;
      const saved = await commit({ logo: null });
      if (old && !saved.headers.includes(old)) void forgetCrewImage(old);
      say("Logo removed.", "ok");
    });

  return (
    <Section id="logo" title="Logo" hint="The round badge at the right end of your header. A square picture works best.">
      <div className="flex items-center gap-3">
        <CrewLogo url={look.logo} name={card.brand} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => set(e.target.files?.[0])} data-file="logo" />
          <button type="button" className="btn btn-ghost w-full" disabled={!!what} onClick={() => file.current?.click()}>
            <ImagePlus size={17} aria-hidden /> {what === "logo" ? "SENDING…" : look.logo ? "CHANGE LOGO" : "ADD A LOGO"}
          </button>
          {look.logo && (
            <button type="button" className="btn btn-ghost w-full text-fireant" disabled={!!what} onClick={clear}>
              <Trash2 size={16} aria-hidden /> REMOVE LOGO
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ featured event --- */

const RIBBON_IDEAS = ["FREE", "SOLD OUT", "TICKETS"];

function Featured({ card, onChange, work: { what, run } }: { card: CrewCard; onChange: () => void; work: Work }) {
  const say = useToast((s) => s.say);
  const { events, ready } = useUpcomingEvents(true);
  const [pick, setPick] = useState<string | null>(card.featured_event_id);
  const [ribbon, setRibbon] = useState(card.featured_ribbon);
  const [find, setFind] = useState("");

  // What the server holds is the truth: after a save (or a reload) the form follows it.
  useEffect(() => {
    setPick(card.featured_event_id);
    setRibbon(card.featured_ribbon);
  }, [card.featured_event_id, card.featured_ribbon]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    const rows = q ? events.filter((e) => `${e.title} ${e.venue_name}`.toLowerCase().includes(q)) : events;
    // The current pick stays in the list even when it is past the window or filtered out.
    const cur = card.featured_event;
    return cur && !rows.some((e) => e.id === cur.id) && !q ? [cur, ...rows] : rows;
  }, [events, find, card.featured_event]);

  const chosen = events.find((e) => e.id === pick) ?? (card.featured_event?.id === pick ? card.featured_event : null);
  const dirty = pick !== card.featured_event_id || (pick !== null && ribbon.trim() !== card.featured_ribbon);

  const save = () =>
    void run("featured", async () => {
      const err = await saveFeatured(card.id, pick, pick ? ribbon : "");
      if (err) throw new Error(err);
      onChange();
      say(pick ? "Sticker set. It's on the fountain." : "Sticker cleared.", "ok");
    });

  return (
    <Section
      id="featured"
      title="Featured event"
      hint="This is the sticker on the fountain in your room. The ribbon is yours: type FREE only when it is free."
    >
      <label className="sr-only" htmlFor="m-find">
        Find an event
      </label>
      <input id="m-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an event" autoComplete="off" enterKeyHint="search" />
      <div role="radiogroup" aria-label="Featured event" className="mt-2 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto overscroll-contain pr-0.5">
        <Radio on={pick === null} onClick={() => setPick(null)} title="No featured event" line="The room finds your crew's next event on its own." />
        {!ready && <p className="hint px-1 py-2">Loading events…</p>}
        {ready && shown.length === 0 && <p className="hint px-1 py-2">Nothing matches. Try another word.</p>}
        {shown.map((e) => (
          <Radio
            key={e.id}
            on={pick === e.id}
            onClick={() => setPick(e.id)}
            title={e.title}
            line={`${dayLabel(e.starts_at)} · ${e.venue_name}`}
            thumb={e.flyer_url}
            eventId={e.id}
          />
        ))}
      </div>

      {pick && (
        <div className="mt-3">
          <label className="label" htmlFor="m-ribbon">
            Ribbon under the sticker
          </label>
          <input
            id="m-ribbon"
            value={ribbon}
            maxLength={RIBBON_MAX}
            onChange={(e) => setRibbon(e.target.value.replace(/[\r\n\t]/g, " ").toUpperCase())}
            placeholder="Nothing, or FREE, SOLD OUT"
            autoComplete="off"
            autoCapitalize="characters"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {RIBBON_IDEAS.map((t) => (
              <button key={t} type="button" className="chip min-h-[44px] px-4" aria-pressed={ribbon === t} onClick={() => setRibbon(ribbon === t ? "" : t)}>
                {t}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10.5px] tracking-[0.1em] text-dim">
              {ribbon.length}/{RIBBON_MAX}
            </span>
          </div>
          {chosen && <StickerPreview title={chosen.title} flyer={chosen.flyer_url} ribbon={ribbon} />}
        </div>
      )}
      <button type="button" className="btn mt-3 w-full" disabled={!!what || !dirty} onClick={save}>
        {what === "featured" ? "SAVING…" : dirty ? "SAVE STICKER" : "STICKER SAVED"}
      </button>
    </Section>
  );
}

function Radio({
  on,
  onClick,
  title,
  line,
  thumb,
  eventId,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  line: string;
  thumb?: string | null;
  eventId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={clsx(
        "flex min-h-[56px] w-full items-center gap-3 rounded-hz border px-2.5 py-2 text-left transition-colors",
        on ? "border-orange bg-ink-3" : "border-line"
      )}
      data-event={eventId}
    >
      {thumb !== undefined && (
        <span className="grid h-10 w-8 flex-none place-items-center overflow-hidden rounded-[3px] bg-ink-3">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element -- an event flyer, already sized by the organiser's upload
            <img src={thumb} alt="" width={32} height={40} loading="lazy" className="h-full w-full object-cover" />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <b className="line-clamp-2 block font-display text-[14px] font-semibold leading-tight">{title}</b>
        <span className="hint line-clamp-2 block">{line}</span>
      </span>
      <span
        aria-hidden
        className={clsx("grid h-5 w-5 flex-none place-items-center rounded-full border", on ? "border-orange bg-orange text-brand-ink" : "border-line")}
      >
        {on && <Check size={13} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A small mock of the fountain's sticker: the flyer with the ribbon across the foot, as the room draws it. */
function StickerPreview({ title, flyer, ribbon }: { title: string; flyer: string | null; ribbon: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-hz border border-dashed border-line p-2.5" aria-label="How the sticker looks">
      <span className="relative block h-[84px] w-[64px] flex-none overflow-hidden rounded-[4px] bg-ink-3 ring-2 ring-cream/80">
        {flyer && (
          // eslint-disable-next-line @next/next/no-img-element -- an event flyer
          <img src={flyer} alt="" width={64} height={84} className="h-full w-full object-cover" />
        )}
        {ribbon.trim() && (
          <span className="absolute inset-x-0 bottom-1.5 bg-orange px-1 py-0.5 text-center font-display text-[9px] font-black uppercase leading-none tracking-[0.04em] text-brand-ink">
            {ribbon.trim()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="seclabel block">Sticker preview</span>
        <b className="line-clamp-2 block font-display text-[14px] font-semibold leading-tight">{title}</b>
        <span className="hint block">{ribbon.trim() ? "Ribbon on." : "No ribbon."}</span>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------- rooms --- */

function Rooms({ card, onChange, work: { what, run } }: { card: CrewCard; onChange: () => void; work: Work }) {
  const say = useToast((s) => s.say);
  const choose = (key: string) => {
    if (key === card.template) return;
    void run("room", async () => {
      const err = await saveTemplate(card.id, key);
      if (err) throw new Error(err);
      onChange();
      say("Meeting room changed. Everyone walks back to the door.", "ok");
    });
  };
  return (
    <Section id="room" title="Meeting room" hint="Where your crew meets.">
      <div role="radiogroup" aria-label="Meeting room" className="grid grid-cols-2 gap-2">
        {ROOM_TEMPLATES.map((t) => {
          const on = t.key === card.template;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!!what}
              onClick={() => choose(t.key)}
              data-template={t.key}
              className={clsx("relative overflow-hidden rounded-hz border text-left", on ? "border-orange" : "border-line")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- our own picture under /public */}
              <img src={t.thumbnail} alt="" width={320} height={205} loading="lazy" className="aspect-[16/10] w-full object-cover" />
              <span className="block p-2">
                <b className="block font-display text-[14px] font-semibold leading-tight">{t.name}</b>
                <span className="hint line-clamp-3 block">{t.description}</span>
              </span>
              {on && (
                <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-orange text-brand-ink" aria-label="Your room">
                  <Check size={15} strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
        <div className="grid min-h-[150px] place-items-center rounded-hz border border-dashed border-line p-3 text-center" aria-disabled="true">
          <span>
            <b className="block font-display text-[14px] font-semibold">More rooms soon</b>
            <span className="hint block">A lounge and event rooms are on the way.</span>
          </span>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- invite --- */

function Invite({ card, onChange, work: { what, run } }: { card: CrewCard; onChange: () => void; work: Work }) {
  const say = useToast((s) => s.say);
  const [confirming, setConfirming] = useState(false);
  const code = card.invite_code ?? "";
  const link = code ? inviteLink(code) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      say("Invite link copied.", "ok");
    } catch {
      say("Couldn't copy. Hold the link to copy it.", "error");
    }
  };
  const share = async () => {
    const how = await shareInvite(card.brand, code);
    if (how === "copied") say("Invite link copied.", "ok");
    else if (how === "failed") say("Couldn't share. Copy the link instead.", "error");
  };
  const reset = () =>
    void run("invite", async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("No connection. Try again.");
      const { error } = await sb.rpc("crew_invite_reset", { p_crew: card.id });
      setConfirming(false);
      if (error) throw new Error(lookError(error, "Couldn't make a new link. Try again."));
      onChange();
      say("New link made. The old one is dead.", "ok");
    });

  return (
    <Section id="invite" title="Invite link" hint="Send it and they land in your room. A new link kills the old one.">
      <p className="select-all break-all rounded-hz border border-dashed border-line px-3 py-2.5 font-mono text-[12px] text-cream" data-invite-link={link}>
        {link || "Loading the link…"}
      </p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className="btn flex-1 px-3" onClick={share} disabled={!code}>
          <Share2 size={15} aria-hidden /> SEND IT
        </button>
        <button type="button" className="btn btn-ghost flex-none px-3 text-[12px]" onClick={copy} disabled={!code} aria-label="Copy the invite link">
          <Copy size={14} aria-hidden /> COPY
        </button>
        <button
          type="button"
          className="btn btn-ghost min-w-[44px] flex-none px-3"
          onClick={() => setConfirming((v) => !v)}
          aria-expanded={confirming}
          aria-label="Make a new invite link"
          disabled={!code}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {confirming && (
        <div className="mt-2.5">
          <p className="hint">The old link stops working at once. Everyone already in the crew stays in.</p>
          <button type="button" className="btn btn-ghost mt-2 w-full" disabled={!!what} onClick={reset}>
            {what === "invite" ? "ONE SEC…" : "MAKE A NEW LINK"}
          </button>
        </div>
      )}
    </Section>
  );
}
