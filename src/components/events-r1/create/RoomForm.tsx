"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import TintShell, { useLookStyle, usePictureTint } from "@/components/host/TintShell";
import TwoDRoomCard from "@/components/host/TwoDRoomCard";
import { useR1Api, useR1Auth } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import { cleanSlugInput, normalizeLinks, slugFromName, slugShapeOk, SLUG_HELP } from "@/lib/events-r1/roomRules";
import type { JoinMode, R1Event, RoomLinks, RoomSummary } from "@/lib/events-r1/types";
import { ABOUT_MAX } from "@/lib/events-r1/types";
import { readTint } from "@/lib/tint";
import { logoFromFile, uploadRoomLogo } from "./cover";
import { useWide } from "./CreateEvent";
import { patchDraft, readDraft, readLogo, str, writeLogo } from "./draft";
import RoomDone from "./RoomDone";
import { Banner, ColourCard, JoinCards, LinksCard, LogoTile, RoomTabs, WalkBlock } from "./RoomParts";
import type { RoomEventRow } from "./RoomParts";
import { PLACEHOLDER_LOGOS, randomPlaceholder } from "./roomLogos";

type SlugState = "idle" | "checking" | "free" | "taken" | "bad";

const STARTING_LOOK: Look = { ...DEFAULT_LOOK, pack: "glow" };

/** What the draft remembers of the look (the same shape as a saved look, read back field by field). */
function lookFrom(v: unknown): Look {
  if (!v || typeof v !== "object") return STARTING_LOOK;
  const o = v as Partial<Look>;
  return {
    ...STARTING_LOOK,
    ...(o.pack ? { pack: o.pack } : {}),
    ...(o.mood === "day" || o.mood === "night" ? { mood: o.mood } : {}),
    ...(typeof o.auto === "boolean" ? { auto: o.auto } : {}),
    ...(o.tint && typeof o.tint.hue === "number" && typeof o.tint.chroma === "number" ? { tint: o.tint } : {}),
    ...(o.two_d && typeof o.two_d.template === "string" ? { two_d: { on: o.two_d.on !== false, template: o.two_d.template } } : {}),
  };
}

const joinModeOf = (v: unknown): JoinMode => (v === "ask" || v === "invite" ? v : "open");

/**
 * Create a room (build brief section 13, mock-up claude/create-room-final.html, wireframe E1 to E3). The page is the room's profile in
 * edit mode, tinted from the logo the way Create an event is tinted from its cover: the banner with its look arrows, the logo square (a
 * random LOGO placeholder with "Tap to add yours"; tapping uploads, and the uploaded logo tints the page), the name and its
 * hoppaz.fun/r/<slug> address, about, and the tabs preview with the host's own events listed. Settings: colour and mood, who can join,
 * the walkable 2D room. "View as visitor" hides the editing. On a phone the settings come before the about and tabs. Create room makes
 * the room and its look, then the done sheet ("Bring your N guests in", the to-do list, Open my room).
 * Every Release 1 rule of the old form is kept: the sign up wall, the draft, and making the room at once after sign up.
 */
export default function RoomForm({ onSwitch, fromEvent }: { onSwitch: () => void; fromEvent?: boolean }) {
  const router = useRouter();
  const api = useR1Api();
  // What was typed before a reload or a trip out to Google (see draft.ts). Read once.
  const [saved] = useState(() => readDraft());
  const resume = useRef(saved.pending === "room");
  const resumed = useRef(false);
  const { user } = useR1Auth();
  const wide = useWide();

  const r0 = saved.room ?? {};
  const [name, setName] = useState(() => str(r0.name));
  const [about, setAbout] = useState(() => str(r0.about));
  const [slug, setSlug] = useState(() => str(r0.slug));
  const [slugTouched, setSlugTouched] = useState(() => r0.slugTouched === true);
  const [slugState, setSlugState] = useState<SlugState>("idle");
  const [join, setJoin] = useState<JoinMode>(() => joinModeOf(r0.join));
  const [links, setLinks] = useState<RoomLinks>(() => (r0.links && typeof r0.links === "object" ? (r0.links as RoomLinks) : {}));
  const [look, setLookState] = useState<Look>(() => lookFrom(r0.look));
  const [ph] = useState(() => (typeof r0.ph === "number" && PLACEHOLDER_LOGOS[r0.ph] ? r0.ph : randomPlaceholder()));
  const [logo, setLogoState] = useState<string | null>(() => readLogo());
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState("");
  const [visitor, setVisitor] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const [made, setMade] = useState<{ room: RoomSummary; logo: string | null; guests: number; event: R1Event | null } | null>(null);
  const [toast, setToast] = useState("");
  const [events, setEvents] = useState<RoomEventRow[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const file = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const two = look.two_d ?? { on: true, template: "clubhouse" };
  const picture = logo ?? PLACEHOLDER_LOGOS[ph];
  const tint = usePictureTint(picture, look);
  const fullLook: Look = { ...look, tint };
  const lookStyle = useLookStyle(fullLook, tint);
  const setLook = (l: Look) => setLookState(l);

  // The page opens tinted: wait for the picture's colour (a placeholder reads in a few ms), never for long.
  useEffect(() => {
    let live = true;
    const go = () => live && setReady(true);
    const t = window.setTimeout(go, 700);
    if (look.auto) void readTint(picture).then(go);
    else go();
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // Only the first paint waits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The draft: everything but the logo picture (its own key, like the event's cover).
  useEffect(() => {
    patchDraft({ mode: "room", room: { name, about, slug, slugTouched, join, links, look, ph } });
  }, [name, about, slug, slugTouched, join, links, look, ph]);
  useEffect(() => writeLogo(logo), [logo]);

  // From the event's "Set up my room": the name starts as the host's own.
  useEffect(() => {
    if (fromEvent && user && !name.trim() && !r0.name) setName(user.name);
    // Once, when the host is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromEvent, user?.id]);

  // The address builds itself from the name until the host edits it, and moves to -2, -3 when it is taken. A typed one is checked as it is.
  useEffect(() => {
    if (!api) return;
    if (slugTouched) {
      if (!slug) return setSlugState("idle");
      if (!slugShapeOk(slug)) return setSlugState("bad");
      setSlugState("checking");
      let live = true;
      const t = window.setTimeout(() => {
        void api.rooms.slugAvailable(slug).then((ok) => live && setSlugState(ok ? "free" : "taken"));
      }, 350);
      return () => {
        live = false;
        window.clearTimeout(t);
      };
    }
    if (!name.trim()) {
      setSlug("");
      return setSlugState("idle");
    }
    setSlugState("checking");
    let live = true;
    const t = window.setTimeout(() => {
      void (async () => {
        const base = slugFromName(name);
        for (let n = 1; n < 12; n++) {
          const c = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
          if (await api.rooms.slugAvailable(c)) {
            if (live) {
              setSlug(c);
              setSlugState("free");
            }
            return;
          }
        }
        if (live) setSlugState("taken");
      })();
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [api, name, slug, slugTouched]);

  // The host's own events, posted as themselves: they are listed on the Events tab and move into the room on Create room.
  useEffect(() => {
    if (!api || !user) return setEvents([]);
    let live = true;
    void api.events
      .listMine()
      .then((all) => {
        if (!live) return;
        const t = api.clock.now();
        setEvents(
          all
            .filter((e) => !e.room_id && e.status !== "cancelled")
            .map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, venue_name: e.venue_name, flyer_url: e.flyer_url, going: e.going, past: Date.parse(e.ends_at ?? e.starts_at) < t }))
            .sort((a, b) => (a.past === b.past ? Date.parse(a.starts_at) - Date.parse(b.starts_at) : a.past ? 1 : -1))
        );
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [api, user]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const setLogo = (l: string | null) => {
    setLogoState(l);
    writeLogo(l);
  };
  const pickLogo = async (f: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!f) return;
    setLogoBusy(true);
    setLogoErr("");
    try {
      setLogo(await logoFromFile(f));
    } catch (e) {
      setLogoErr(e instanceof Error ? e.message : "That picture won't open. Try another.");
    } finally {
      setLogoBusy(false);
    }
  };

  const missing: string[] = [];
  if (!name.trim()) missing.push("a name");
  else if (slugState === "taken" || slugState === "bad") missing.push("a free address");
  const canCreate = !!api && !busy && missing.length === 0 && slugState !== "checking";
  const steps = [!!name.trim(), !!logo];
  const left = steps.filter((s) => !s).length;
  const buttonText = busy ? "Creating" : missing.length ? `Add ${missing.join(" and ")}` : "Create room";
  const hint = missing.length
    ? `Add ${missing.join(" and ")} to create your room`
    : slugState === "checking"
      ? "Checking the address"
      : logo
        ? "Ready. Everything else can be added later."
        : "Ready. Add your logo now or later.";

  const create = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const logoUrl = logo ? (api.mode === "real" ? await uploadRoomLogo(logo) : logo) : null;
      const ids = events.filter((e) => picked[e.id] !== false).map((e) => e.id);
      const room = await api.rooms.create({
        name: name.trim(), about: about.trim(), slug: slug || undefined, logo_url: logoUrl, links: normalizeLinks(links), join_mode: join, event_ids: ids,
      });
      // The look is the room's own (pack, tint, mood, 2D room). Quiet if it cannot be kept: the page then reads the logo.
      await api.looks.set("room", room.id, { ...look, tint, two_d: two });
      const g = await api.rooms.guestsNotJoined(room.id).catch(() => ({ count: 0, guests: [] }));
      const latest = ids.length
        ? (await Promise.all(ids.map((id) => api.events.get(id)))).filter((e): e is R1Event => !!e && Date.parse(e.ends_at ?? e.starts_at) > api.clock.now()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] ?? null
        : null;
      // Only the room's own part of the draft is cleared: a half-made event stays.
      patchDraft({ room: undefined, pending: null });
      writeLogo(null);
      setMade({ room, logo: room.logo_url ?? logoUrl, guests: g.count, event: latest });
      setBusy(false);
    } catch (e) {
      patchDraft({ pending: null });
      setError(e instanceof Error ? e.message : "Try again later");
      setBusy(false);
    }
  };

  const submit = () => {
    if (!api || busy) return;
    if (missing.length || slugState === "checking") {
      if (!name.trim()) nameInput.current?.focus();
      return;
    }
    if (!api.auth.current()) {
      // Sign up wall; the draft is marked so the room is made at once after sign up, even after the trip out to Google.
      patchDraft({ pending: "room" });
      setSheet(true);
      return;
    }
    void create();
  };

  // Back from Google (the page reloaded) with the sign up waiting: make the room now, from the restored draft.
  useEffect(() => {
    if (!resume.current || resumed.current || !api) return;
    if (user) {
      // Wait for the address check, then go.
      if (slugState === "checking" || (!!name.trim() && slugState === "idle")) return;
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
    // Only when the sign in state (and the address check) answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, user, slugState]);

  if (!ready) return <div className="h-full bg-ink" />;

  /* ---------------------------------------------------------------- pieces -- */

  const logoBox = (size: number, v?: boolean) => (
    <LogoTile logo={logo} placeholder={PLACEHOLDER_LOGOS[ph]} name={name} size={size} onPick={v ? undefined : () => file.current?.click()} busy={logoBusy} visitor={v} />
  );
  const errorLine = error && (
    <p ref={errorRef} role="alert" className="font-body text-[14px] text-[#E5484D]">
      {error}
    </p>
  );
  const slugLine = (
    <div className={`flex flex-wrap items-baseline gap-x-0.5 font-mono text-[14px] ${wide ? "" : "justify-center"}`}>
      <span className="text-t-muted">hoppaz.fun/r/</span>
      <input
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(cleanSlugInput(e.target.value));
        }}
        aria-label="Room address"
        placeholder="your-room"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={40}
        style={{ width: `${Math.max(slug.length, 9) + 1}ch` }}
        className="!min-w-0 !rounded-none !border-0 !border-b !border-dashed !bg-transparent !px-0 !py-0.5 font-mono text-[14px] text-t-text"
        data-slug
      />
      {slugState === "checking" && <span className="ml-2 font-body text-[12px] text-t-muted">Checking</span>}
      {slugState === "free" && <Check size={14} className="ml-2 self-center text-t-accent" aria-label="Free" />}
    </div>
  );
  const slugProblem =
    slugState === "taken" ? "That address is taken. Pick another." : slugState === "bad" ? `${SLUG_HELP}.` : "";
  const nameBox = (
    <input
      ref={nameInput}
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Room name"
      aria-label="Room name"
      autoComplete="off"
      maxLength={50}
      className={`!rounded-none !border-0 !border-b !border-dashed !bg-transparent !px-0 !py-1 t-title font-black leading-tight ${wide ? "text-[44px]" : "text-center text-[34px]"}`}
      data-room-name
    />
  );
  const aboutBox = (
    <div className="grid gap-1">
      <textarea
        value={about}
        onChange={(e) => setAbout(e.target.value.slice(0, ABOUT_MAX))}
        rows={wide ? 3 : 3}
        maxLength={ABOUT_MAX}
        placeholder="What is your room about? One or two lines is plenty."
        aria-label="About"
        className="!border-dashed"
        data-about
      />
      {about.length > ABOUT_MAX - 100 && <span className="text-right font-body text-[12px] text-t-muted">{about.length}/{ABOUT_MAX}</span>}
    </div>
  );
  const settings = (
    <div className="grid content-start gap-4">
      <ColourCard look={fullLook} setLook={setLook} />
      <JoinCards value={join} onChange={setJoin} />
      <TwoDRoomCard on={two.on} template={two.template} onChange={(v) => setLook({ ...look, two_d: v })} sub="A space your members can walk into any time" />
      <LinksCard links={links} onChange={setLinks} />
    </div>
  );
  const stepper = (
    <div className="flex items-center gap-2" aria-label={left ? `${left} left` : "Ready"}>
      {steps.map((s, i) => (
        <i key={i} className={`h-1.5 flex-1 rounded-full ${s ? "bg-t-accent" : "bg-t-soft"}`} />
      ))}
    </div>
  );
  const createButton = (
    <button type="button" className="lip w-full !min-h-[52px] !text-[16px]" aria-disabled={!canCreate} onClick={submit} data-create-room>
      {buttonText}
    </button>
  );
  const tabs = <RoomTabs events={events} picked={picked} onPick={(id, on) => setPicked({ ...picked, [id]: on })} editing />;

  /* ---------------------------------------------------------------- visitor -- */

  const joinWord = join === "ask" ? "Ask to join" : "Join room";
  const visitorLinks = Object.entries(normalizeLinks(links));
  const visitorView = (
    <div>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-t-accent px-4 py-2.5 text-t-on" data-visitor-bar>
        <span className="font-body text-[14px] font-bold">View as visitor: this is what visitors see</span>
        <button type="button" className="min-h-[40px] flex-none rounded-hz bg-t-bg px-3 font-body text-[14px] font-bold text-t-text shadow-[0_3px_0_var(--t-line)]" onClick={() => setVisitor(false)}>
          Back to my view
        </button>
      </div>
      <div className={wide ? "mx-auto max-w-[1180px] px-8 pb-16 pt-6" : "pb-10"}>
        <Banner look={fullLook} wide={wide} />
        <div className={wide ? "pointer-events-none [&_button]:pointer-events-auto relative z-10 -mt-[62px] flex items-end gap-6 px-1" : "pointer-events-none relative z-10 -mt-[52px] [&_button]:pointer-events-auto grid justify-items-center gap-2 px-4"}>
          {logoBox(wide ? 124 : 104, true)}
          <div className={`min-w-0 flex-1 ${wide ? "pb-2" : "text-center"}`}>
            <h1 className={`t-title font-black leading-tight ${wide ? "text-[44px]" : "text-[32px]"}`}>{name.trim() || "Your room"}</h1>
            <p className="font-mono text-[14px] text-t-muted">hoppaz.fun/r/<span className="text-t-text">{slug || "your-room"}</span></p>
          </div>
          <button type="button" className="lip flex-none" onClick={() => setToast("This is the visitor view. The button works once your room is live.")} data-visitor-join>
            {joinWord}
          </button>
        </div>
        <div className={`grid gap-5 ${wide ? "px-1 pt-6" : "px-4 pt-5"}`}>
          {join === "invite" && <p className="font-body text-[13px] text-t-muted">Invite only: visitors need your link. Everyone else cannot find this room.</p>}
          {join === "ask" && <p className="font-body text-[13px] text-t-muted">Visitors ask to join and you approve each one.</p>}
          {about.trim() && <p className="whitespace-pre-line font-body text-[17px]">{about.trim()}</p>}
          {visitorLinks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {visitorLinks.map(([k, v]) => (
                <span key={k} className="rounded-hz border border-t-line px-2.5 py-1 font-body text-[12.5px] font-bold text-t-muted" title={v}>
                  {k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)}
                </span>
              ))}
            </div>
          )}
          {two.on && <WalkBlock template={two.template} />}
          <RoomTabs events={events} picked={picked} editing={false} empty="No events yet. Check back soon." />
        </div>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- the screen -- */

  const wideEdit = (
    <div className="mx-auto max-w-[1180px] px-8 pb-16 pt-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <b className="font-display text-[18px] font-extrabold">New room</b>
        <button type="button" onClick={onSwitch} className="min-h-[40px] font-body text-[13.5px] font-bold text-t-accent">
          Create an event instead
        </button>
      </div>
      <Banner look={fullLook} setLook={setLook} wide />
      <div className="pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto relative z-10 -mt-[62px] flex items-end gap-6 px-1">
        {logoBox(124)}
        <div className="grid min-w-0 flex-1 gap-1 pb-2">
          {nameBox}
          {slugLine}
          {slugProblem && (
            <span role="alert" className="font-body text-[13px] text-[#E5484D]">
              {slugProblem}
            </span>
          )}
        </div>
        <span className="lip-ghost mb-2 flex-none opacity-80" aria-hidden>
          {join === "ask" ? "Ask to join" : "Join room"}
        </span>
      </div>
      {logoErr && (
        <p role="alert" className="px-1 pt-2 font-body text-[13px] text-[#E5484D]">
          {logoErr}
        </p>
      )}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_380px] gap-8">
        <div className="grid content-start gap-6">
          {aboutBox}
          {tabs}
        </div>
        <div className="grid content-start gap-4">
          {settings}
          {stepper}
          <button type="button" className="lip-ghost w-full" onClick={() => setVisitor(true)} data-view-visitor>
            View as visitor
          </button>
          {createButton}
          <span className="font-body text-[12.5px] text-t-muted">{hint}</span>
          {errorLine}
        </div>
      </div>
    </div>
  );

  const phoneEdit = (
    <div>
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-t-line bg-t-bar px-4 py-3 backdrop-blur">
        <button type="button" aria-label="Close" onClick={() => router.push("/")} className="grid h-9 w-9 place-items-center rounded-hz border border-t-line">
          <X size={18} />
        </button>
        <b className="font-display text-[17px] font-extrabold">New room</b>
        <button type="button" className="lip-ghost ml-auto !min-h-[38px]" onClick={() => setVisitor(true)} data-view-visitor>
          View as visitor
        </button>
      </div>
      <Banner look={fullLook} setLook={setLook} wide={false} />
      <div className="pointer-events-none relative z-10 -mt-[52px] [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto grid justify-items-center gap-2 px-4">
        {logoBox(104)}
        {logoErr && (
          <p role="alert" className="font-body text-[13px] text-[#E5484D]">
            {logoErr}
          </p>
        )}
        <div className="grid w-full gap-1.5 text-center">
          {nameBox}
          {slugLine}
          {slugProblem && (
            <span role="alert" className="font-body text-[13px] text-[#E5484D]">
              {slugProblem}
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-4 px-4 pb-6 pt-5">
        {settings}
        {aboutBox}
        {tabs}
        <button type="button" onClick={onSwitch} className="min-h-[44px] justify-self-start font-body text-[14px] font-bold text-t-accent">
          Making an event instead? Create an event
        </button>
        {errorLine}
      </div>
      <div className="sticky bottom-0 z-30 border-t border-t-line bg-t-bar px-4 pb-3 pt-3 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex-1">{stepper}</div>
          <span className="ml-1 font-body text-[12px] text-t-muted">{left ? `${left} left` : "Ready"}</span>
        </div>
        {createButton}
      </div>
    </div>
  );

  return (
    <TintShell look={{ ...fullLook, pack: "minimal" }} className="min-h-full">
      <div style={lookStyle}>{visitor ? visitorView : wide ? wideEdit : phoneEdit}</div>
      <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pickLogo(e.target.files?.[0])} />
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-t-text px-4 py-2.5 font-body text-[13.5px] font-bold text-t-bg shadow-xl">
          {toast}
        </div>
      )}
      <SignInSheet
        open={sheet}
        reason="Sign up to create your Roomz"
        onClose={() => {
          setSheet(false);
          patchDraft({ pending: null });
        }}
        onSignedIn={() => {
          setSheet(false);
          void create();
        }}
      />
      {made && <RoomDone room={made.room} logo={made.logo} guests={made.guests} event={made.event} />}
    </TintShell>
  );
}
