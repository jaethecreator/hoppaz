"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ChevronLeft, Compass } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import GameTimeLayer from "@/components/game-time/GameTimeLayer";
import ActionButton from "@/components/crew-room/ActionButton";
import ChatSheet from "@/components/crew-room/ChatSheet";
import EventSheet from "@/components/crew-room/EventSheet";
import HopperMenu from "@/components/crew-room/HopperMenu";
import RoomVoice from "@/components/crew-room/RoomVoice";
import { ChatButton, HudPill } from "@/components/crew-room/Hud";
import { useChatDock } from "@/lib/crew-room/chatStore";
import { useFeatured } from "@/lib/crew-room/featured";
import { crewImageSrc } from "@/lib/crew-room/images";
import { useExploreStore, useGoOut } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection, SocialWorld } from "@/lib/crew-room/types";
import { clubhouseWidth, validCampaignUrl, type CampaignContent, type CampaignLayout } from "@/lib/campaign/layout";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import CampaignSettings from "./CampaignSettings";
import CampaignWorld, { type OpenPhase } from "./CampaignWorld";
import ZoneSheet, { type ZoneSheetKind } from "./ZoneSheet";
import { roomName } from "./brand";
import { firstVisit, useZoneCards } from "./useZoneCards";
import css from "./Campaign.module.css";

/** The crew's next event, for the Stage (lib/crew-room/crewEvents.ts). */
export type StageEvent = { id: string; title: string; starts_at: string; venue_name: string };

export type CrewCampaign = {
  id: string;
  name: string;
  verified: boolean;
  content: CampaignContent;
  width: 30 | 36;
  /** I own this crew: the HUD shows the room settings button. */
  editable: boolean;
  connected: boolean;
  world: SocialWorld;
  /** Everyone in the room, me included: "12 HERE". */
  here: number;
  /** A line said once over the world (a tab that took over), or null. */
  notice?: React.ReactNode;
  nextEvent?: StageEvent | null;
  /** The one room connection and my user id, for the chat sheet and the bubbles (a second useCrewRoom would take the walker over). */
  room: CrewRoomConnection;
  userId: string;
  onSave: (content: CampaignContent, width: 30 | 36) => Promise<string | null>;
};

/** Game Time's chrome mount: over the room, outside the scaled world (banner, countdown, win sheet). Screen pixels. */
function GameTimeChrome({ crewId, layout, watching, ready }: { crewId: string; layout: CampaignLayout; watching: boolean; ready: boolean }) {
  const me = useRoomStore((state) => state.me);
  const walkTo = useRoomStore((state) => state.walkTo);
  const none = useCallback(() => {}, []);
  return (
    <div className={css.gameTimeChrome} data-game-time-layer="chrome">
      <GameTimeLayer crewId={crewId} roomId={crewId} layout={layout} me={me} isMember isWatcher={watching} walkTo={walkTo ?? none} worldLayer={false} ready={ready} />
    </div>
  );
}

/**
 * The header's title: the crew's name at 22 px on ONE line, with the verified tick. A longer name steps down 20, 18, 16 until
 * it fits, and only then wraps to two lines; past 28 characters it ellipsises. "360Playlist" always fits at 22.
 */
function RoomTitle({ name, verified }: { name: string; verified: boolean }) {
  const block = useRef<HTMLDivElement>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(22);
  const [wrap, setWrap] = useState(false);
  const long = name.length > 28;

  useLayoutEffect(() => {
    const el = h1.current;
    if (!el || long) return;
    if (el.scrollWidth > el.clientWidth + 0.5) {
      if (size > 16) setSize(size - 2);
      else if (!wrap) setWrap(true);
    }
  }, [size, wrap, name, long]);

  // A new name or a new width (turning the phone) starts again from 22.
  useEffect(() => {
    const el = block.current;
    if (!el) return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) < 1) return;
      last = el.clientWidth;
      setSize(22);
      setWrap(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setSize(long ? 16 : 22);
    setWrap(false);
  }, [name, long]);

  return (
    <div className={css.nameRow + (wrap ? ` ${css.wrap}` : "")} ref={block}>
      <h1 ref={h1} style={{ fontSize: size, lineHeight: wrap ? 1.1 : `${size + 2}px` }}>
        {name}
      </h1>
      {verified && <VerifiedBadge size={18} />}
    </div>
  );
}

/**
 * The crew's round logo at the right end of the header. It opens the owner and admins panel, with the announcements
 * (crew-room/OwnerPanel.tsx, through Explore), never other crews. While a member has an announcement they have not seen it
 * beats and wears an orange "!" (AnnouncementBeam.tsx draws that on `data-room-logo`).
 */
function LogoBadge({ crewId, name, pulse }: { crewId: string; name: string; pulse: boolean }) {
  const { logoUrl: stored } = useFeatured(crewId);
  const logoUrl = crewImageSrc(stored);
  const [failed, setFailed] = useState<string | null>(null);
  const open = useExploreStore((s) => s.open);
  const show = !!logoUrl && failed !== logoUrl;
  return (
    <button
      type="button"
      className={`${css.badge} ${pulse ? css.badgePulse : ""}`}
      aria-label="Owner and admins"
      aria-expanded={open}
      aria-haspopup="dialog"
      data-room-logo
      onClick={() => useExploreStore.getState().toggle()}
    >
      <span className={css.badgeFace}>
        {show ? (
          // eslint-disable-next-line @next/next/no-img-element -- the crew's own upload or a /brands/ path, already sized for a badge
          <img src={logoUrl} alt="" width={36} height={36} onError={() => setFailed(logoUrl)} draggable={false} />
        ) : (
          <span className={css.badgeLetter} aria-hidden>
            {name.trim().charAt(0).toUpperCase() || "H"}
          </span>
        )}
      </span>
      <span className={css.compass} aria-hidden>
        <Compass size={10} strokeWidth={2.4} />
      </span>
    </button>
  );
}

export default function CampaignExperience({ crew }: { crew: CrewCampaign }) {
  const look = useHoppaz((state) => state.look);
  const { profile } = useSession();
  const content = crew.content;
  const width = crew.width;
  const layout = useMemo(() => clubhouseWidth(width), [width]);
  const name = roomName(content.brand || crew.name);
  const audio = validCampaignUrl(content.audioUrl);
  const watching = crew.world.watching;
  const goOut = useGoOut();
  const hasAction = useRoomStore((s) => !!s.action);
  // A zone the owner has not filled in says so on its card (design section 19).
  const hasMusic = !!validCampaignUrl(content.musicUrl);
  const hasAwards = content.awards.length > 0;
  const zoneLines = useMemo(() => {
    const lines: Record<string, string> = {};
    if (!hasMusic) lines.studio = "Next session loading. Pull up a seat.";
    if (!hasAwards) lines.awards = "Shelves are empty for now. Awards land soon.";
    return lines;
  }, [hasMusic, hasAwards]);

  const [phase, setPhase] = useState<OpenPhase | "init">("init");
  const [sheetKind, setSheetKind] = useState<ZoneSheetKind | null>(null);
  const [settings, setSettings] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [coach, setCoach] = useState(false);
  const closeSheet = useCallback(() => setSheetKind(null), []);
  const closeSettings = useCallback(() => setSettings(false), []);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);
  // In the room feedback is in the world; a toast is only for a failure. Lift it clear of the CHAT button and the action pill.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--hz-toast-lift", "64px");
    return () => void root.style.removeProperty("--hz-toast-lift");
  }, []);

  // The open sequence is over: the logo pulses once. On a first visit the welcome card (ChatWelcome, inside the chat sheet's
  // layer) is up for about 8 s, and one coach mark at the logo follows it. Every later visit is silent.
  const newHere = useRef<boolean | null>(null);
  if (newHere.current === null) newHere.current = firstVisit(crew.id);
  const opened = useCallback((next: OpenPhase) => {
    setPhase(next);
    if (next !== "done") return;
    const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
    setPulse(true);
    later(() => setPulse(false), 700);
    if (!newHere.current) return;
    newHere.current = false;
    later(() => setCoach(true), 8400);
    later(() => setCoach(false), 11400);
  }, []);

  useZoneCards({ layout, content, nextEvent: crew.nextEvent ?? null, ready: phase === "done", openSheet: setSheetKind });

  // Esc closes the zone sheet.
  useEffect(() => {
    if (!sheetKind) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheetKind(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetKind]);

  // What the chrome pieces need to know about the stage: the chat sheet's height (the bottom row rides on it), the docked
  // chat panel's width (a landscape phone or a desktop) and where the HUD pill ends (the voice control sits under it).
  const sheetHeight = useRoomStore((s) => s.sheetHeight);
  const dock = useChatDock((s) => s.dock);
  const hudButtons = 1 + (watching ? 0 : 1) + (crew.editable ? 1 : 0);
  const stageVars = {
    "--room-sheet": `${sheetHeight}px`,
    "--room-dock": `${dock}px`,
    "--room-hud-bottom": `${8 + hudButtons * 44 + (hudButtons - 1) + 2}px`,
  } as React.CSSProperties;

  const backHref = `/crew/${crew.id}`;
  const chatUp = useRoomStore((s) => s.sheet !== "closed");
  const hint = phase === "hold" && !chatUp ? "6 ROOMS. TAP ONE." : "";

  return (
    <div className={css.experience}>
      <header className={css.header}>
        <Link
          href={backHref}
          className={css.back}
          aria-label="Back to the crew"
          onClick={(e) => {
            if (useRoomStore.getState().huntActive) {
              e.preventDefault();
              goOut(backHref);
            }
          }}
        >
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </Link>
        <div className={css.titleBlock}>
          <RoomTitle name={name} verified={crew.verified} />
          <p className={css.sub}>
            <i className={`${css.dot} ${crew.connected ? "" : css.dotOff}`} aria-hidden />
            <span>{watching ? `Full · ${crew.here} walking` : `${crew.here} here`}</span>
          </p>
        </div>
        <LogoBadge crewId={crew.id} name={name} pulse={pulse} />
      </header>

      <div className={css.stage} style={stageVars}>
        <CampaignWorld
          key={width}
          crewId={crew.id}
          layout={layout}
          look={profile?.avatar ?? look}
          brand={name}
          social={crew.world}
          room={crew.room}
          userId={crew.userId}
          zoneLines={zoneLines}
          onPhase={opened}
        />
        <p className={`${css.hint} ${hint ? "" : css.hintOut}`} aria-hidden>
          {hint || " "}
        </p>
        {coach && !chatUp && (
          <p className={css.coach} aria-hidden>
            <ArrowUp size={12} aria-hidden />
            Other crews and nights
          </p>
        )}
        {watching && (
          <p className={css.watchChip} role="status">
            <i aria-hidden />
            <span>Full. Watching. You walk in when a spot opens.</span>
          </p>
        )}
        {crew.notice && <div className={css.noticeSlot}>{crew.notice}</div>}
        <HudPill audio={audio} owner={crew.editable} watching={watching} onSettings={() => setSettings(true)} />
        <ChatButton compact={hasAction} />
        <div className={css.chromeLayer}>
          <ChatSheet crewId={crew.id} layout={layout} room={crew.room} userId={crew.userId} />
          <HopperMenu crewId={crew.id} layout={layout} />
          <ActionButton crewId={crew.id} layout={layout} />
          <EventSheet crewId={crew.id} layout={layout} />
          <RoomVoice crewId={crew.id} layout={layout} />
        </div>
        <GameTimeChrome crewId={crew.id} layout={layout} watching={watching} ready={phase === "done"} />
        {sheetKind && <ZoneSheet kind={sheetKind} content={content} link={validCampaignUrl(content.musicUrl)} onClose={closeSheet} />}
      </div>

      {settings && <CampaignSettings crewName={crew.name} content={content} width={width} onClose={closeSettings} onSave={crew.onSave} />}
    </div>
  );
}
