"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, Settings2 } from "lucide-react";
import { useFeatured } from "@/lib/crew-room/featured";
import { useExploreStore, useGoOut, useRoomRails, type RailEvent } from "@/lib/crew-room/rails";
import OwnerPanel from "./OwnerPanel";
import { dayLabel } from "@/lib/filters";
import { eventTitle } from "@/lib/geo";
import css from "./Places.module.css";

/**
 * Trending this week (each opens /?e=<id>) (design section 10). Owned by PLACES.
 *
 * It used to carry an OTHER CREWS tab too. A room is a place and a crew is your friends, so the owner's logo no longer
 * lists other crews: it opens the owner and admins (OwnerPanel.tsx). Other open rooms are found by name on ROOMZ.
 *
 * Two things live here:
 *   <Explore crewId />          this week's nights on their own, for the chat sheet's EXPLORE control (no fixed positioning)
 *   <ExplorePopover crewId />   the popover from the logo badge in the header (EventSheet.tsx mounts it, the badge opens it
 *                               with useExploreStore().toggle() in rails.ts). It draws the OWNER AND ADMINS panel.
 *
 * Nothing is read until the list is first on screen (room_rails, kept 5 minutes). A row leaves the room, so it goes
 * through useGoOut(): during a Game Time it asks "Leave the hunt?" first. The owner gets a ROOM SETTINGS row at the foot.
 */
export type ExploreProps = { crewId: string };

export default function Explore({ crewId }: ExploreProps) {
  return <ExploreBody crewId={crewId} />;
}

/** The popover that drops from the logo badge. Closes on any outside tap, on Escape and on a row. */
export function ExplorePopover({ crewId }: ExploreProps) {
  const open = useExploreStore((s) => s.open);
  const hide = useExploreStore((s) => s.hide);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  // Gone when the room is: a popover never outlives its screen.
  useEffect(() => () => useExploreStore.getState().hide(), []);

  if (!open) return null;
  return (
    <>
      <div className={css.scrim} style={{ background: "transparent" }} onPointerDown={hide} aria-hidden />
      <div ref={box} role="dialog" aria-label="Owner and admins" tabIndex={-1} className={`${css.popover} animate-pop`}>
        <OwnerPanel crewId={crewId} />
      </div>
    </>
  );
}

function ExploreBody({ crewId }: ExploreProps) {
  const rails = useRoomRails(crewId, true);
  const { isOwner } = useFeatured(crewId);
  const goOut = useGoOut();
  const loading = rails.status === "idle" || rails.status === "loading";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-explore>
      <p className="seclabel flex-none px-3 pb-2 pt-3">This week</p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}>
        {loading ? (
          <Skeleton />
        ) : rails.status === "error" ? (
          <div className="flex flex-col items-start gap-3 px-3 py-4">
            <p className="hint">Couldn&apos;t load.</p>
            <button type="button" className="chip" onClick={rails.retry}>
              RETRY
            </button>
          </div>
        ) : rails.trending.length ? (
          rails.trending.map((e) => <NightRow key={e.id} event={e} onGo={() => goOut(`/?e=${e.id}`)} />)
        ) : (
          <p className="hint px-3 py-4">Nothing big this week yet. Check the map.</p>
        )}
      </div>
      {isOwner && (
        <a
          href={`/crew/${crewId}?manage=1`}
          onClick={(e) => {
            e.preventDefault();
            goOut(`/crew/${crewId}?manage=1`);
          }}
          className="flex min-h-[48px] flex-none items-center gap-3 border-t border-line px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream active:bg-ink-3"
        >
          <Settings2 size={16} aria-hidden />
          <span className="flex-1">ROOM SETTINGS</span>
          <ChevronRight size={16} className="text-dim" aria-hidden />
        </a>
      )}
    </div>
  );
}

const row = "flex w-full items-center gap-3 border-b border-line px-3 text-left active:bg-ink-3";

function NightRow({ event, onGo }: { event: RailEvent; onGo: () => void }) {
  const day = dayLabel(event.starts_at).split(" · ")[0];
  return (
    <a
      href={`/?e=${event.id}`}
      onClick={(e) => {
        e.preventDefault();
        onGo();
      }}
      className={`${row} min-h-[64px] py-2`}
      data-explore-event={event.id}
    >
      <span className="relative block h-[52px] w-10 flex-none overflow-hidden rounded-[4px] bg-ink-3">
        {event.flyer_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an event flyer, uploaded by its organiser
          <img src={event.flyer_url} alt="" width={40} height={52} loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
        ) : (
          // No flyer: a ticket stub with the day, in the app's orange, so the row is never a dark hole.
          <span className="grid h-full w-full place-items-center bg-orange text-center font-display text-[11px] font-black leading-[1.05] text-brand-ink" aria-hidden>
            {day.split(" ").slice(0, 2).map((w, i) => (
              <span key={i} className="block">
                {w}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <b className="line-clamp-2 font-body text-[14px] font-semibold leading-[18px]">{eventTitle(event)}</b>
        <span className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-dim">
          {day}
          {event.going > 0 ? ` · ${event.going} GOING` : ""}
        </span>
      </span>
      <ChevronRight size={16} className="flex-none text-dim" aria-hidden />
    </a>
  );
}

function Skeleton() {
  return (
    <div aria-busy aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${row} ${css.skeleton} h-[60px]`}>
          <span className="h-10 w-10 flex-none rounded-full bg-ink-3" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-2/3 rounded-[3px] bg-ink-3" />
            <span className="block h-2.5 w-1/3 rounded-[3px] bg-ink-3" />
          </span>
        </div>
      ))}
    </div>
  );
}
