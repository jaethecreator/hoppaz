"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Share2, X } from "lucide-react";
import { shareEvent } from "@/components/event/share";
import { useLookStyle, usePictureTint } from "@/components/host/TintShell";
import { QUESTS_ON } from "@/lib/events-r1/flags";
import { useR1Auth, useR1Query } from "@/lib/events-r1/hooks";
import { isListing, listedByLine, priceLine } from "@/lib/events-r1/listing";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event } from "@/lib/events-r1/types";
import { useQuests } from "@/lib/game";
import { useToast } from "@/lib/store";
import { themeForEvent } from "@/lib/theme";
import { ClaimLink } from "./page/ClaimSheet";
import { fallbackCover, whenWords } from "./page/HostStory";
import RegisterButton from "./page/RegisterButton";
import { useFreshEvent } from "./page/useFreshEvent";
import { naira } from "./pay/words";
import { eventChatHref } from "./rooms/words";
import { isOnline } from "./words";

/** "4.2 km away", "450 m away". Null when we do not know where the person is. */
function distanceWord(m: number | null): string | null {
  if (m === null || !Number.isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m away`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km away`;
}

/** An Instagram or X link as "@name", a website as its host. Anything else is left out. */
export function handleOf(kind: "instagram" | "x" | "website", url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (kind === "website") return u.hostname.replace(/^www\./, "");
    const name = u.pathname.split("/").filter(Boolean)[0];
    return name ? `@${name.replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}

/** The quest lines of this event, one per quest, with the reward in the event's tint. Only mounted when quests are on. */
export function QuestLines({ eventId }: { eventId: string }) {
  const { user } = useR1Auth();
  const { quests, claims } = useQuests(user?.id ?? null);
  const mine = quests.filter((q) => q.event_id === eventId);
  if (!mine.length) return null;
  return (
    <div className="col-span-2">
      {mine.map((q) => (
        <div key={q.id} className="flex justify-between gap-2.5 border-t border-t-line py-1.5 font-body text-[12px]">
          <span className="min-w-0">{q.title}</span>
          <span className="whitespace-nowrap font-mono text-t-accent">{claims[q.id] ? "Done" : `+${q.xp_reward} XP`}</span>
        </div>
      ))}
    </div>
  );
}

const ROUND = "grid h-11 w-11 flex-none place-items-center";
const FACE =
  "grid h-9 w-9 place-items-center rounded-full bg-t-solid text-t-text shadow-[0_4px_12px_rgba(0,0,0,.35)] transition-transform active:translate-y-px [button:disabled_&]:opacity-50";

/**
 * The map pop-up for an event (build brief, "Map pop-up", mock-up event-page-final.html): the round 2 ticket stub in the event's
 * tint. A cover in a fixed 200px band (a landscape cover runs the full width), then the kicker, title, host, handles, the
 * perforation, the four facts, the one lip button, Go to event page, the quest lines (when quests are on) and a footer with the
 * code, Share and Event chat. Prev and next arrows and the close button float above it on the map.
 *
 * The register flow is RegisterButton's (sign in, the host's questions, the paid gate, approval and waitlist wording); this
 * only dresses it. `children` (check-in, the drop, photos) scroll under the stub.
 */
export default function MapStub({
  event: given,
  placement,
  distanceM,
  onClose,
  onPrev,
  onNext,
  children,
}: {
  event: R1Event;
  placement: "sheet" | "side";
  /** Metres from the person to the event, when their position is known. */
  distanceM: number | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  children?: React.ReactNode;
}) {
  const side = placement === "side";
  const event = useFreshEvent(given);
  const say = useToast((s) => s.say);
  const shell = useRef<HTMLDivElement>(null);

  // The event's look (saved with the event), else its own colour from the cover; Day or Night from the start time.
  const { data: saved } = useR1Query((a) => a.looks.get("event", event.id), [event.id]);
  const cover = event.flyer_url || fallbackCover(event.id);
  const look: Look = saved ?? { ...DEFAULT_LOOK, mood: themeForEvent(event.starts_at) === "day" ? "day" : "night", auto: true };
  const tint = usePictureTint(cover, look);
  const style = useLookStyle(look, tint);
  const [wide, setWide] = useState(false);

  // The host's room gives the logo and the handles.
  const roomId = event.host.roomId;
  const { data: room } = useR1Query((a) => (roomId ? a.rooms.get(roomId) : Promise.resolve(null)), [roomId]);
  const hostName = event.listing?.organiser_name || (event.host.roomName ?? event.host.name);
  const logo = room?.logo_url ?? null;
  const handles = useMemo(() => {
    const l = room?.links ?? {};
    return [l.instagram && handleOf("instagram", l.instagram), l.x && handleOf("x", l.x), l.website && handleOf("website", l.website)].filter((h): h is string => !!h).slice(0, 3);
  }, [room]);

  useEffect(() => {
    shell.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const w = useMemo(() => whenWords(event), [event]);
  const online = isOnline(event);
  const venue = online ? "Online" : event.venue_name || event.area || "To be announced";
  // A listing says the organiser's real price (From, a price, Free or Check listing); a Hoppaz event, its lowest ticket.
  const listing = isListing(event);
  const ticket = listing ? priceLine(event) : event.price_naira > 0 ? `From ${naira(event.price_naira)}` : "Free";
  const kicker = event.status === "cancelled" ? "This event is cancelled" : [w.short, online ? "Online" : distanceWord(distanceM)].filter(Boolean).join(" · ");
  // A listing has no guests on Hoppaz, so no event chat; its way in for the organiser sits there instead.
  const chat = listing ? null : eventChatHref(event);
  // The short link's tail is the closest thing an event has to a code.
  const code = `HZ-${(event.slug.split("-").pop() || event.id.slice(0, 3)).toUpperCase()}`;

  const share = async () => {
    const res = await shareEvent(event, listing ? 0 : event.going);
    if (res === "copied") say("Link copied", "ok");
    else if (res === "failed") say("Couldn't share that. Try again.", "error");
  };

  return (
    <div
      ref={shell}
      role="dialog"
      aria-label={event.title}
      tabIndex={-1}
      className={clsx(
        "pointer-events-none absolute z-40 flex flex-col outline-none",
        // A phone: a full-width card (10px gutters) low on the map, the arrows and close floating above its top edge, the map and
        // pin in the strip above. From lg up: the docked card on the right, as before (the same numbers as event/side.ts).
        side
          ? "hz-slide-in inset-x-2.5 bottom-2.5 top-[var(--hz-side-top,140px)] justify-end lg:inset-x-auto lg:bottom-2 lg:right-2 lg:w-[min(58%,320px)] lg:justify-start"
          : "inset-x-2 bottom-0 mx-auto max-h-[85%] max-w-[600px] animate-rise"
      )}
      style={style}
    >
      <div className="pointer-events-auto relative z-10 flex h-11 flex-none items-center">
        {side && (onPrev || onNext) && (
          <>
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Nearest event to the left" className={ROUND}>
              <span className={FACE}>
                <ChevronLeft size={20} strokeWidth={2.6} aria-hidden />
              </span>
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label="Nearest event to the right" className={ROUND}>
              <span className={FACE}>
                <ChevronRight size={20} strokeWidth={2.6} aria-hidden />
              </span>
            </button>
          </>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className={clsx(ROUND, "ml-auto")}>
          <span className={FACE}>
            <X size={16} aria-hidden />
          </span>
        </button>
      </div>

      <div
        data-evt-scroll
        className="pointer-events-auto -mt-2 flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-hz text-t-text shadow-[0_30px_60px_-24px_rgba(0,0,0,.6)]"
      >
        {/* cover band: 200px, the flyer contained; a landscape cover goes full width at its own height */}
        <div
          className={clsx(
            "flex items-center justify-center bg-t-solid bg-[radial-gradient(circle_at_50%_40%,var(--t-soft),var(--t-solid)_75%)]",
            // 200px, and only on a screen too short for the whole stub does it give up some height (never below 120px).
            wide ? "flex-none p-0" : "min-h-[120px] flex-[0_1_200px] p-3"
          )}
        >
          <img
            src={cover}
            alt={`${event.title} cover`}
            className={clsx("block", wide ? "h-auto w-full" : "h-auto max-h-full w-auto max-w-full rounded-hz shadow-[0_16px_32px_-18px_rgba(0,0,0,.55)]")}
            onLoad={(e) => setWide(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) > 1.3)}
          />
        </div>

        <div className="grid flex-none gap-1.5 bg-t-solid px-[18px] pb-0.5 pt-3">
          <span className="font-body text-[12px] font-semibold text-t-accent">{kicker}</span>
          <h2 className="t-title m-0 break-words text-[22px] font-extrabold leading-[1.05]">{event.title}</h2>
          <div className="flex items-center gap-2.5 pt-1.5">
            {logo ? (
              <img src={logo} alt="" className="h-[34px] w-[34px] flex-none rounded-hz object-cover" />
            ) : (
              <span aria-hidden className="grid h-[34px] w-[34px] flex-none place-items-center rounded-hz bg-t-accent font-display font-extrabold text-t-on">
                {hostName.trim()[0]?.toUpperCase() ?? "H"}
              </span>
            )}
            <div className="min-w-0">
              <b className="block break-words font-body text-[14px] leading-tight">{hostName}</b>
              <small className="block font-body text-[12px] text-t-muted">{listing && !event.listing?.claimed ? listedByLine(event) : event.host.verified ? "Verified host" : "Host"}</small>
            </div>
          </div>
          {handles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {handles.map((h) => (
                <span key={h} className="break-all rounded-full border border-t-line px-2 py-[3px] font-body text-[11px] text-t-muted">
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>

        <div aria-hidden className="stub-perf relative h-[22px] flex-none">
          <span className="absolute inset-x-[18px] top-1/2 border-t-2 border-dashed border-t-line" />
        </div>

        <div className="grid flex-none grid-cols-2 gap-x-3.5 gap-y-2 bg-t-solid px-[18px] pb-1 pt-0">
          <div className="min-w-0">
            <small className="block font-body text-[11px] font-semibold text-t-muted">Date</small>
            <b className="font-body text-[14px] leading-[1.25]">{w.short}</b>
          </div>
          <div className="min-w-0">
            <small className="block font-body text-[11px] font-semibold text-t-muted">Time</small>
            <b className="font-body text-[14px] leading-[1.25]">{w.timeLine.split(" · ")[0]}</b>
          </div>
          <div className="min-w-0">
            <small className="block font-body text-[11px] font-semibold text-t-muted">Venue</small>
            <b className="break-words font-body text-[14px] leading-[1.25]">{venue}</b>
          </div>
          <div className="min-w-0">
            <small className="block font-body text-[11px] font-semibold text-t-muted">Ticket</small>
            <b className="font-body text-[14px] leading-[1.25]">{ticket}</b>
          </div>

          {/* The register flow keeps its own sign-in sheet, questions, paid gate and wording; `lip` only dresses its button. */}
          <div className="tint-ui col-span-2 -mt-3 bg-t-solid">
            <div className="t-adopt">
              <RegisterButton
                event={event}
                placement={placement}
                lip
                trailing={
                  <Link href={`/event/${encodeURIComponent(event.id)}`} className="lip-ghost min-h-[44px] w-full">
                    Go to event page
                  </Link>
                }
              />
            </div>
          </div>

          {QUESTS_ON && <QuestLines eventId={event.id} />}

          <div className="col-span-2 -mt-1 flex items-center justify-between gap-2 border-t border-t-line font-mono text-[12px] text-t-muted">
            <span className="min-w-0 truncate">{code}</span>
            <span className="flex flex-none items-center">
              <button type="button" onClick={() => void share()} aria-label="Share this event" className="grid h-11 w-11 place-items-center text-t-text">
                <Share2 size={16} aria-hidden />
              </button>
              {listing && !event.listing?.claimed && (
                <ClaimLink eventId={event.id} eventTitle={event.title} className="inline-flex min-h-[44px] items-center pl-1 font-body text-[12px] text-t-text underline underline-offset-4" />
              )}
              {chat && (
                <Link href={chat} className="inline-flex min-h-[44px] items-center pl-1 text-t-text">
                  Event chat →
                </Link>
              )}
            </span>
          </div>
        </div>

        {children && (
          <div className="tint-ui flex-none bg-t-solid">
            <div className="t-adopt border-t border-dashed border-t-line pb-3 empty:hidden">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}
