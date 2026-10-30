"use client";

/* eslint-disable @next/next/no-img-element -- logos and covers are data URLs or bucket links of unknown size */

import { ChevronLeft, ChevronRight, Link2, Plus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { PackLayer } from "@/components/host/TintShell";
import { TwoDThumb } from "@/components/host/TwoDRoomCard";
import { JOIN_MODES } from "@/lib/events-r1/roomRules";
import { PACKS } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { JoinMode, R1Event, RoomLinks } from "@/lib/events-r1/types";
import { SWATCHES, swatchColor } from "@/lib/tint";
import { shortDay, clockOf, minutesOf, dayKeyOf } from "../dateTime";
import { Seg } from "./CreateEvent";

/* ------------------------------------------------------------------ banner and logo -- */

/** The banner: the pack's look in the page's colour, with the look rotator while editing (Minimal, Glow, Confetti, Detty December, Owambe). */
export function Banner({ look, setLook, wide }: { look: Look; setLook?: (l: Look) => void; wide: boolean }) {
  const i = Math.max(0, PACKS.findIndex((p) => p.id === look.pack));
  const step = (k: number) => setLook?.({ ...look, pack: PACKS[(i + k + PACKS.length) % PACKS.length].id });
  const arrow = "grid h-9 w-9 place-items-center rounded-hz border border-t-line bg-t-solid text-t-text shadow-[0_3px_0_var(--t-line)] active:translate-y-[3px] active:shadow-none";
  return (
    <div
      className={`relative isolate overflow-hidden ${wide ? "h-[200px] rounded-hz" : "h-[120px]"}`}
      style={{ background: "linear-gradient(180deg, var(--t-soft), var(--t-bg))" }}
      data-banner
      data-pack={look.pack}
      data-mood={look.mood}
    >
      <PackLayer pack={look.pack} mood={look.mood} tint={look.tint} />
      {setLook && (
        <>
          <span className="absolute left-3 top-3 rounded-hz bg-black/55 px-2.5 py-1 font-body text-[12.5px] font-bold text-white">Banner</span>
          {wide ? (
            <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-hz border border-t-line bg-t-bar p-1.5 backdrop-blur">
              <button type="button" aria-label="Previous look" className={arrow} onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="grid min-w-[104px] text-center leading-tight">
                <small className="font-body text-[11px] text-t-muted">Look</small>
                <b className="font-body text-[15px]" data-look-name>{PACKS[i].name}</b>
              </span>
              <button type="button" aria-label="Next look" className={arrow} onClick={() => step(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <button type="button" aria-label="Previous look" className={`${arrow} absolute bottom-3 left-3`} onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Next look" className={`${arrow} absolute bottom-3 right-3`} onClick={() => step(1)}>
                <ChevronRight size={16} />
              </button>
              <span className="absolute right-3 top-3 rounded-hz bg-black/55 px-2.5 py-1 font-body text-[12.5px] font-bold text-white" data-look-name>
                {PACKS[i].name}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The logo square. Editing: the random LOGO placeholder with "Tap to add yours", or the uploaded logo with "Change". Visitor: just the picture. */
export function LogoTile({
  logo, placeholder, name, size, onPick, busy, visitor,
}: { logo: string | null; placeholder: string; name: string; size: number; onPick?: () => void; busy?: boolean; visitor?: boolean }) {
  const shown = logo ?? (visitor ? null : placeholder);
  const initial = (name.trim()[0] ?? "R").toUpperCase();
  const inner = (
    <>
      {shown ? (
        <img src={shown} alt={logo ? "Room logo" : "Placeholder logo"} className="block h-full w-full object-cover" data-logo-img={logo ? "uploaded" : "placeholder"} />
      ) : (
        <span className="grid h-full w-full place-items-center bg-t-accent font-display text-[44px] font-black text-t-on">{initial}</span>
      )}
      {!visitor && (
        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center font-body text-[12px] font-bold text-white">
          {busy ? "Adding" : logo ? "Change" : "Tap to add yours"}
        </span>
      )}
    </>
  );
  const box = "relative flex-none overflow-hidden rounded-hz border-4 border-t-bg bg-t-solid shadow-[0_18px_36px_-18px_rgba(0,0,0,.6)]";
  if (visitor || !onPick)
    return (
      <div className={box} style={{ width: size, height: size }}>
        {inner}
      </div>
    );
  return (
    <button type="button" onClick={onPick} aria-label={logo ? "Change the logo" : "Add your logo"} className={`${box} cursor-pointer`} style={{ width: size, height: size }} data-logo-button>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ settings -- */

export function ColourCard({ look, setLook }: { look: Look; setLook: (l: Look) => void }) {
  const ring = "ring-2 ring-t-text ring-offset-2 ring-offset-[var(--t-tile)]";
  const which = look.auto ? "From the logo" : `Colour ${Math.max(0, SWATCHES.findIndex((s) => Math.abs(s.hue - look.tint.hue) < 0.5)) + 1}`;
  return (
    <div className="t-card grid gap-3 p-4">
      <b className="font-body text-[15px]">Colour</b>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          aria-pressed={look.auto}
          aria-label="Colour from the logo"
          onClick={() => setLook({ ...look, auto: true })}
          className={`h-9 w-9 rounded-hz ${look.auto ? ring : ""}`}
          style={{ background: "conic-gradient(#f66,#fd4,#6d6,#4af,#c6f,#f66)" }}
        />
        {SWATCHES.map((s, k) => {
          const on = !look.auto && Math.abs(look.tint.hue - s.hue) < 0.5;
          return (
            <button key={k} type="button" aria-pressed={on} aria-label={`Colour ${k + 1}`} onClick={() => setLook({ ...look, auto: false, tint: s })} className={`h-9 w-9 rounded-hz ${on ? ring : ""}`} style={{ background: swatchColor(s) }} />
          );
        })}
      </div>
      <span className="-mt-1 font-body text-[12.5px] text-t-muted" data-colour-label>{which}</span>
      <div className="flex items-center gap-3">
        <span className="font-body text-[13px] text-t-muted">Mood</span>
        <Seg label="Day or night" value={look.mood} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} onChange={(m) => setLook({ ...look, mood: m })} />
      </div>
    </div>
  );
}

export function JoinCards({ value, onChange }: { value: JoinMode; onChange: (m: JoinMode) => void }) {
  return (
    <div className="t-card grid gap-3 p-4">
      <b className="font-body text-[15px]">Who can join</b>
      <div role="radiogroup" aria-label="Who can join" className="grid gap-2">
        {JOIN_MODES.map((m) => {
          const on = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(m.value)}
              className={`grid grid-cols-[20px_1fr] gap-2.5 rounded-hz border p-3 text-left ${on ? "border-t-accent" : "border-t-line"} bg-t-bg`}
              data-join-mode={m.value}
            >
              <span className={`mt-0.5 h-[18px] w-[18px] rounded-full ${on ? "border-[5px] border-t-accent" : "border-2 border-t-line"}`} />
              <span>
                <b className="block font-body text-[14.5px]">{m.label}</b>
                <span className="block font-body text-[12.5px] text-t-muted">{m.line}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LINK_FIELDS: Array<{ key: keyof RoomLinks; label: string; ph: string }> = [
  { key: "instagram", label: "Instagram", ph: "@yourroom" },
  { key: "x", label: "X", ph: "@yourroom" },
  { key: "website", label: "Website", ph: "yourroom.com" },
  { key: "whatsapp", label: "WhatsApp channel", ph: "Paste the channel link" },
];

/** Optional links: Instagram, X, website, WhatsApp channel. Closed until asked for. */
export function LinksCard({ links, onChange }: { links: RoomLinks; onChange: (l: RoomLinks) => void }) {
  const [open, setOpen] = useState(() => Object.values(links).some(Boolean));
  return (
    <div className="t-card grid gap-3 p-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[28px] items-center gap-2 text-left">
        <Link2 size={16} className="text-t-muted" aria-hidden />
        <b className="flex-1 font-body text-[15px]">Links</b>
        <span className="font-body text-[12.5px] text-t-muted">{open ? "Optional" : "Add Instagram, X, website"}</span>
      </button>
      {open && (
        <div className="grid gap-2">
          {LINK_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1">
              <span className="font-body text-[12.5px] text-t-muted">{f.label}</span>
              <input value={links[f.key] ?? ""} onChange={(e) => onChange({ ...links, [f.key]: e.target.value })} placeholder={f.ph} aria-label={f.label} autoComplete="off" autoCapitalize="none" maxLength={300} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the page body -- */

export type RoomEventRow = Pick<R1Event, "id" | "title" | "starts_at" | "venue_name" | "flyer_url" | "going"> & { past: boolean };

function EventLine({ e, checked, onToggle }: { e: RoomEventRow; checked?: boolean; onToggle?: (on: boolean) => void }) {
  const ms = Date.parse(e.starts_at);
  const day = dayKeyOf(ms);
  const d = new Date(`${day}T12:00:00Z`);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const t = clockOf(minutesOf(ms));
  const [hh, mm] = t.split(":").map(Number);
  const clock = `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  const meta = [shortDay(day).split(" ")[0] + " · " + clock, e.venue_name, e.going ? `${e.going} going` : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 border-b border-t-line py-3" data-room-event>
      {onToggle && (
        <input type="checkbox" checked={!!checked} onChange={(ev) => onToggle(ev.target.checked)} aria-label={`Put ${e.title} in the room`} className="h-5 w-5 flex-none accent-[var(--t-accent)]" />
      )}
      <span className="grid h-[52px] w-[52px] flex-none overflow-hidden rounded-hz border border-t-line bg-t-tile text-center leading-none">
        <span className="bg-t-soft py-1 font-body text-[10.5px] font-bold uppercase text-t-muted">{mon}</span>
        <b className="grid place-items-center font-display text-[20px]">{d.getUTCDate()}</b>
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-body text-[16px]">{e.title}</b>
        <span className="block truncate font-body text-[13px] text-t-muted">{meta}</span>
      </span>
      {e.flyer_url && <img src={e.flyer_url} alt="" className="h-[52px] w-[42px] flex-none rounded-hz border border-t-line object-cover" loading="lazy" />}
    </div>
  );
}

const TABS = ["Events", "Members", "Chat", "Quests"] as const;
const TAB_NOTE: Record<Exclude<(typeof TABS)[number], "Events">, string> = {
  Members: "People show up here as they join. You and your admins and hosts come first.",
  Chat: "General, and a chat for every event you post here.",
  Quests: "Quests that run across your events. Set them up from your room once it is live.",
};

/** Events, Members, Chat, Quests. Editing: the host's events as themselves (each can stay out) and the ghost "Your next event" row. */
export function RoomTabs({
  events, picked, onPick, editing, empty,
}: { events: RoomEventRow[]; picked: Record<string, boolean>; onPick?: (id: string, on: boolean) => void; editing: boolean; empty?: ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Events");
  const shown = editing ? events : events.filter((e) => picked[e.id] !== false);
  const up = shown.filter((e) => !e.past);
  const past = shown.filter((e) => e.past);
  return (
    <div>
      <div role="tablist" aria-label="Room sections" className="flex gap-1 border-b border-t-line">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px min-h-[44px] border-b-2 px-4 font-body text-[15px] font-bold ${tab === t ? "border-t-accent text-t-text" : "border-transparent text-t-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Events" ? (
        <div className="pt-3" role="tabpanel">
          <div className="flex items-center justify-between gap-3 pb-1">
            <b className="font-body text-[13.5px] text-t-muted">Upcoming</b>
            <span className="text-right font-body text-[12.5px] text-t-muted">{editing && events.length ? "Ticked events move into the room when you create it" : "Every event you post here shows up for members"}</span>
          </div>
          {up.map((e) => (
            <EventLine key={e.id} e={e} checked={picked[e.id] !== false} onToggle={editing && onPick ? (on) => onPick(e.id, on) : undefined} />
          ))}
          {editing && (
            <div className="flex items-center gap-3 border-b border-dashed border-t-line py-3 opacity-70" data-ghost-event>
              <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-hz border border-dashed border-t-line text-t-muted">
                <Plus size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-body text-[16px] text-t-muted">Your next event</b>
                <span className="block font-body text-[13px] text-t-muted">Create it from this room and members get a Pop</span>
              </span>
            </div>
          )}
          {!up.length && !editing && <p className="py-3 font-body text-[14px] text-t-muted">{empty ?? "No events yet. Check back soon."}</p>}
          <b className="block pb-1 pt-5 font-body text-[13.5px] text-t-muted">Past</b>
          {past.length ? past.map((e) => <EventLine key={e.id} e={e} checked={picked[e.id] !== false} onToggle={editing && onPick ? (on) => onPick(e.id, on) : undefined} />) : <p className="font-body text-[14px] text-t-muted">Past events collect here and become your room&apos;s history.</p>}
        </div>
      ) : (
        <p className="py-4 font-body text-[14px] text-t-muted" role="tabpanel">
          {TAB_NOTE[tab]}
        </p>
      )}
    </div>
  );
}

/** The "Walk into the room" block visitors see when the room has a 2D room. */
export function WalkBlock({ template }: { template: string }) {
  return (
    <div className="t-card flex items-center gap-4 p-3" data-walk-block>
      <div className="w-[96px] flex-none overflow-hidden rounded-hz">
        <TwoDThumb kind={template} />
      </div>
      <span className="min-w-0 flex-1">
        <b className="block font-body text-[16px]">Walk into the room</b>
        <span className="block font-body text-[13px] text-t-muted">{template[0].toUpperCase() + template.slice(1)}</span>
      </span>
      <span className="lip-ghost whitespace-nowrap opacity-80">Enter room</span>
    </div>
  );
}
