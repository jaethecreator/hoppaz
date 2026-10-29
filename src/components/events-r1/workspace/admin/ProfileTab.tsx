"use client";

/* eslint-disable @next/next/no-img-element -- logos are data URLs or bucket links of unknown size */

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logoFromFile, uploadRoomLogo } from "@/components/events-r1/create/cover";
import { Banner, ColourCard } from "@/components/events-r1/create/RoomParts";
import { useR1Api } from "@/lib/events-r1/hooks";
import { PACKS } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import { cleanSlugInput, normalizeLinks, slugShapeOk, SLUG_HELP } from "@/lib/events-r1/roomRules";
import type { RoomLinks, RoomSummary } from "@/lib/events-r1/types";
import { ABOUT_MAX } from "@/lib/events-r1/types";
import { Card, Err, errText, initials } from "./ui";

const LINK_FIELDS: Array<{ key: keyof RoomLinks; label: string; ph: string }> = [
  { key: "instagram", label: "Instagram", ph: "@yourroom" },
  { key: "x", label: "X", ph: "@yourroom" },
  { key: "website", label: "Website", ph: "yourroom.com" },
  { key: "whatsapp", label: "WhatsApp channel", ph: "Paste the channel link" },
];

type SlugState = "idle" | "checking" | "free" | "taken" | "bad";

/**
 * Profile: logo (tap to change), banner pack, colour from the logo or five swatches, Day or Night, name, link, about and links, and
 * View as visitor. Everything saves as you type (after a short rest) with a quiet "Saved".
 */
export default function ProfileTab({ room, look, onLook }: { room: RoomSummary; look: Look; onLook: (l: Look) => void }) {
  const api = useR1Api();
  const [name, setName] = useState(room.name);
  const [slug, setSlug] = useState(room.slug);
  const [about, setAbout] = useState(room.about);
  const [links, setLinks] = useState<RoomLinks>(room.links);
  const [slugState, setSlugState] = useState<SlugState>("idle");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const flashTimer = useRef<number | undefined>(undefined);

  const flash = () => {
    setSaved(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSaved(false), 2000);
  };
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // The address: checked as it is typed (not for the room's own).
  useEffect(() => {
    if (!api || slug === room.slug) return setSlugState("idle");
    if (!slugShapeOk(slug)) return setSlugState("bad");
    setSlugState("checking");
    let live = true;
    const t = window.setTimeout(() => void api.rooms.slugAvailable(slug, room.id).then((ok) => live && setSlugState(ok ? "free" : "taken")), 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [api, slug, room.slug, room.id]);

  // Saves as you type: the words after a short rest. A name that is too short or an address that is taken waits, and says so.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!api) return;
    const patch: Record<string, unknown> = {};
    if (name.trim() !== room.name && name.trim().length >= 2) patch.name = name.trim();
    if (about.trim() !== room.about) patch.about = about.trim();
    if (slug !== room.slug && slugState === "free") patch.slug = slug;
    const nextLinks = normalizeLinks(links);
    if (JSON.stringify(nextLinks) !== JSON.stringify(room.links)) patch.links = nextLinks;
    if (!Object.keys(patch).length) return;
    const t = window.setTimeout(() => {
      setError("");
      api.rooms.update(room.id, patch).then(
        (r) => {
          flash();
          if (patch.slug) window.history.replaceState(null, "", `/rooms/${encodeURIComponent(r.slug)}/admin${window.location.search}`);
        },
        (e) => setError(errText(e))
      );
    }, 700);
    return () => window.clearTimeout(t);
    // Only what is typed starts a save; the room moving on after a save must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, about, slug, links, slugState]);

  // The look (pack, colour, mood) saves after a short rest as well.
  const lookTimer = useRef<number | undefined>(undefined);
  const setLook = (next: Look) => {
    onLook(next);
    if (!api) return;
    window.clearTimeout(lookTimer.current);
    lookTimer.current = window.setTimeout(() => {
      setError("");
      api.looks.set("room", room.id, next).then(flash, (e) => setError(errText(e)));
    }, 400);
  };
  useEffect(() => () => window.clearTimeout(lookTimer.current), []);

  const pickLogo = async (f: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!f || !api) return;
    setLogoBusy(true);
    setError("");
    try {
      const data = await logoFromFile(f);
      const url = api.mode === "real" ? await uploadRoomLogo(data) : data;
      await api.rooms.update(room.id, { logo_url: url });
      flash();
    } catch (e) {
      setError(errText(e));
    } finally {
      setLogoBusy(false);
    }
  };

  const slugNote = slugState === "taken" ? "That address is taken. Pick another." : slugState === "bad" ? `${SLUG_HELP}.` : "";
  const nameNote = name.trim().length < 2 ? "Give your room a name (2 or more letters)." : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 h-4 font-body text-[13px] font-bold text-t-muted" aria-live="polite" data-saved>
        {saved ? "Saved" : ""}
      </p>

      <Card label="Name and logo">
        <div className="grid gap-4 sm:grid-cols-[132px_minmax(0,1fr)]">
          <button type="button" onClick={() => file.current?.click()} aria-label={room.logo_url ? "Change the logo" : "Add your logo"} className="relative h-[132px] w-[132px] flex-none overflow-hidden rounded-hz border border-t-line bg-t-solid" data-logo-button>
            {room.logo_url ? (
              <img src={room.logo_url} alt="Room logo" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center bg-t-accent font-display text-[44px] font-black text-t-on">{initials(room.name)}</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center font-body text-[12px] font-bold text-white">{logoBusy ? "Adding" : "Tap to change"}</span>
          </button>
          <div className="grid content-start gap-3">
            <label className="grid gap-1">
              <span className="font-body text-[12.5px] text-t-muted">Room name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="off" aria-label="Room name" data-name />
              {nameNote && <span className="font-body text-[12.5px] text-fireant">{nameNote}</span>}
            </label>
            <div className="grid gap-1">
              <span className="font-body text-[12.5px] text-t-muted">Room link</span>
              <div className="flex items-baseline gap-0.5 font-mono text-[14px]">
                <span className="text-t-muted">hoppaz.fun/r/</span>
                <input value={slug} onChange={(e) => setSlug(cleanSlugInput(e.target.value))} aria-label="Room link" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} className="min-w-0 flex-1 font-mono" data-slug />
                {slugState === "checking" && <span className="ml-2 font-body text-[12px] text-t-muted">Checking</span>}
                {slugState === "free" && <Check size={14} className="ml-2 self-center text-t-accent" aria-label="Free" />}
              </div>
              {slugNote && (
                <span role="alert" className="font-body text-[12.5px] text-fireant">
                  {slugNote}
                </span>
              )}
            </div>
          </div>
        </div>
        <label className="mt-4 grid gap-1">
          <span className="font-body text-[12.5px] text-t-muted">About</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value.slice(0, ABOUT_MAX))} rows={3} maxLength={ABOUT_MAX} placeholder="What is your room about? One or two lines is plenty." aria-label="About" data-about />
          {about.length > ABOUT_MAX - 100 && <span className="text-right font-body text-[12px] text-t-muted">{about.length}/{ABOUT_MAX}</span>}
        </label>
        <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pickLogo(e.target.files?.[0])} />
      </Card>

      <Card title="Look" aside="Colour can follow your logo">
        <div className="overflow-hidden rounded-hz border border-t-line">
          <Banner look={look} wide={false} />
        </div>
        <p className="mb-2 mt-3 font-body text-[12.5px] text-t-muted">Banner</p>
        <div role="radiogroup" aria-label="Banner" className="flex flex-wrap gap-2">
          {PACKS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={look.pack === p.id} onClick={() => setLook({ ...look, pack: p.id })} className="chip min-h-[40px] flex-none px-4 font-body text-[14px] normal-case tracking-normal" data-pack={p.id}>
              {p.name}
            </button>
          ))}
        </div>
      </Card>
      <ColourCard look={look} setLook={setLook} />

      <Card title="Links" aside="Shown under your name">
        <div className="grid gap-3 sm:grid-cols-2">
          {LINK_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1">
              <span className="font-body text-[12.5px] text-t-muted">{f.label}</span>
              <input value={links[f.key] ?? ""} onChange={(e) => setLinks({ ...links, [f.key]: e.target.value })} placeholder={f.ph} aria-label={f.label} autoComplete="off" autoCapitalize="none" maxLength={300} />
            </label>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/rooms/${encodeURIComponent(room.slug)}?as=visitor`} className="lip" data-view-visitor>
          View as visitor
        </Link>
        <span className="font-body text-[13px] text-t-muted">See your room page the way someone who has not joined sees it.</span>
      </div>
      <Err>{error}</Err>
    </div>
  );
}
