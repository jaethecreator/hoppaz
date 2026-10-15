"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useEventSheet, useFeatured } from "@/lib/crew-room/featured";
import { useLeaveStore } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { ExplorePopover } from "./Explore";
import css from "./Places.module.css";

/**
 * The in-room sheet for the featured event: flyer, day, ribbon, OPEN ON MAP (design section 11.3).
 *
 * SCREEN CHROME, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 *
 * The modal layer (z 9 to 11) of the room lives in this one file, so there is a single place that draws over the world:
 *   the event sheet      opened by the sticker or the fountain pill (useEventSheet in featured.ts). Closes on the X, the
 *                        scrim, a swipe down or Escape. OPEN ON MAP goes to /?e=<event id>; while a Game Time is on
 *                        (roomStore.huntActive) the button area turns into "Leave the hunt?" with STAY and OPEN ON MAP
 *   the Explore popover  (Explore.tsx) from the logo badge in the header
 *   the leave card       "Leave the hunt?" for every other way out: the door, the pill, the Explore rows (useGoOut in
 *                        rails.ts, which the header's back arrow and the tab bar should call too)
 * No price anywhere on the sheet: the ribbon is the owner's words, and the event's own page has the price.
 */
export type EventSheetProps = { crewId: string; layout: CampaignLayout };

export default function EventSheet({ crewId, layout }: EventSheetProps) {
  void layout;
  return (
    <>
      <Sheet crewId={crewId} />
      <ExplorePopover crewId={crewId} />
      <LeaveHunt />
    </>
  );
}

function Sheet({ crewId }: { crewId: string }) {
  const open = useEventSheet((s) => s.open);
  const hide = useEventSheet((s) => s.hide);
  const { featured } = useFeatured(crewId);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [drag, setDrag] = useState(0);
  const [gripped, setGripped] = useState(false);
  const [entered, setEntered] = useState(false);
  const start = useRef<{ y: number; at: number } | null>(null);
  const visible = open && !!featured;

  // A sheet that closes always opens fresh; the room closes it (no event, or the screen goes).
  useEffect(() => {
    if (!visible) {
      setAsking(false);
      setDrag(0);
      setEntered(false);
      return;
    }
    // The rise animation holds a transform of its own, so it is dropped once it has played and the swipe can move the sheet.
    const t = setTimeout(() => setEntered(true), 340);
    return () => clearTimeout(t);
  }, [visible]);
  useEffect(() => () => useEventSheet.getState().hide(), []);
  useEffect(() => {
    if (open && !featured) hide();
  }, [open, featured, hide]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, hide]);

  if (!visible || !featured) return null;
  const go = () => router.push(`/?e=${featured.id}`);
  const openOnMap = () => (useRoomStore.getState().huntActive ? setAsking(true) : go());

  return (
    <>
      <div className={css.scrim} onClick={hide} aria-hidden />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={featured.title}
        tabIndex={-1}
        className={`${css.sheet} ${entered ? "" : "animate-rise"}`}
        style={entered ? { transform: `translateY(${drag}px)`, transition: gripped ? "none" : "transform 0.2s ease" } : undefined}
      >
        {/* The handle strip is the swipe-down grip, and the X is a full 44 px target. */}
        <div
          className="relative flex-none touch-none px-4 pb-1 pt-3"
          onPointerDown={(e) => {
            start.current = { y: e.clientY, at: performance.now() };
            setGripped(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current && setDrag(Math.max(0, e.clientY - start.current.y))}
          onPointerUp={(e) => {
            const s = start.current;
            start.current = null;
            setGripped(false);
            const dy = s ? e.clientY - s.y : 0;
            const fast = s ? dy / Math.max(1, performance.now() - s.at) > 0.6 : false;
            if (dy > 90 || (fast && dy > 30)) hide();
            else setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setGripped(false);
            setDrag(0);
          }}
        >
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
          <button
            type="button"
            onClick={hide}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Close"
            className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-dim hover:text-cream"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1">
          <div className="flex justify-center">
            <div className={css.sheetFlyer}>
              {featured.flyerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- an event flyer, uploaded by its organiser
                <img src={featured.flyerUrl} alt={`${featured.title} flyer`} decoding="async" draggable={false} />
              ) : (
                <div className="grid h-[200px] w-[150px] place-items-center rounded-[6px] bg-ink-3 p-3 text-center font-display text-[14px] font-black uppercase">{featured.title}</div>
              )}
              {featured.ribbon && (
                <span className={css.sheetRibbon} data-ribbon>
                  {featured.ribbon}
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] font-medium uppercase leading-[14px] tracking-[0.08em] text-dim">{featured.day}</p>
          <h2 className="mt-1 line-clamp-2 font-display text-[22px] font-black leading-6">{featured.title}</h2>
          <p className="mt-1 font-body text-[14px] leading-5 text-dim">{[featured.venue, featured.area].filter(Boolean).join(" · ")}</p>
          {asking ? (
            <div className="mt-4" role="alert">
              <p className="font-display text-[18px] font-black leading-6">Leave the hunt?</p>
              <p className="mt-1 font-body text-[14px] leading-5 text-dim">The clock keeps running. You can walk back in.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-ghost flex-1" autoFocus onClick={() => setAsking(false)}>
                  STAY
                </button>
                <button type="button" className="btn flex-1" onClick={go}>
                  OPEN ON MAP
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn mt-4 w-full" onClick={openOnMap} data-open-on-map>
              OPEN ON MAP
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** "Leave the hunt?": the card useGoOut() (rails.ts) asks while a Game Time is on. STAY is the default focus. */
function LeaveHunt() {
  const pending = useLeaveStore((s) => s.pending);
  const stay = useLeaveStore((s) => s.stay);
  const router = useRouter();

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stay();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, stay]);
  useEffect(() => () => useLeaveStore.getState().stay(), []);

  if (!pending) return null;
  return (
    <>
      <div className={css.scrim} style={{ zIndex: 10 }} onClick={stay} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-label="Leave the hunt?" className={`${css.leave} animate-pop`}>
        <p className="font-display text-[18px] font-black leading-6">Leave the hunt?</p>
        <p className="mt-1 font-body text-[14px] leading-5 text-dim">The clock keeps running. You can walk back in.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-ghost flex-1" autoFocus onClick={stay}>
            STAY
          </button>
          <button
            type="button"
            className="btn flex-1"
            onClick={() => {
              const to = pending;
              stay();
              router.push(to);
            }}
          >
            LEAVE
          </button>
        </div>
      </div>
    </>
  );
}
