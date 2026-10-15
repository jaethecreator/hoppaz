"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, DoorOpen } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { clockShort } from "@/lib/geo";
import { useCrewCard } from "@/lib/crew-room/hub";
import type { CrewGroup } from "@/lib/game";
import { isMystery } from "@/lib/game-time/drops";
import type { GtListGame } from "@/lib/game-time/types";
import CrewPanel, { type Rsvp } from "./CrewPanel";

/**
 * One of my rooms on the Rooms tab: its badge, its name (to the hub), how many are in the room right now, and the one big
 * button, ENTER ROOM. The invite code and the planned moves fold away under "INVITE AND MOVES" (CrewPanel, as it was).
 * A Game Time for this room says so on the card. Drop 2 onward of a mystery series (lib/game-time/drops.ts) says SOON, never
 * a time.
 */
export default function RoomCard({
  group,
  game,
  events,
  moving,
  onPlan,
  onSubmit,
  onRsvp,
}: {
  group: CrewGroup;
  game: GtListGame | null;
  events: { id: string; title: string }[];
  moving: boolean;
  onPlan: () => void;
  onSubmit: (move: { title: string; meetup: string | null; starts_at: string; note: string; event_id: string | null }) => void;
  onRsvp: (moveId: string, status: Rsvp) => Promise<boolean>;
}) {
  const { card } = useCrewCard({ crewId: group.id });
  const [open, setOpen] = useState(false);
  const moves = group.crew_moves?.length ?? 0;
  const here = card?.in_room ?? 0;
  const live = game?.status === "live";
  return (
    <div className="card mb-2 p-3">
      <div className="flex items-center gap-3">
        <Link href={`/crew/${group.id}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${group.name}, room details`}>
          <span className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full border border-line bg-ink-3 font-display text-lg font-black">
            {card?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              group.name.trim().charAt(0).toUpperCase() || "R"
            )}
          </span>
          <span className="min-w-0 flex-1">
            <b className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
              <span className="truncate">{group.name}</span>
              {group.verified && <VerifiedBadge size={15} />}
            </b>
            <span className="hint block">{here > 0 ? `${here} in the room now` : group.visibility === "open" ? "Open room" : "Private room"}</span>
          </span>
        </Link>
        {game && (
          <span className={live ? "pill pill-lagoon flex-none" : "pill flex-none"}>{live ? "GAME TIME LIVE" : isMystery(game) ? "GAME TIME SOON" : `GAME TIME ${clockShort(game.opens_at)}`}</span>
        )}
      </div>
      <Link href={`/crew/${group.id}/room`} className="btn mt-3 w-full text-[14px] lg:w-auto lg:px-10">
        <DoorOpen size={18} aria-hidden /> ENTER ROOM
      </Link>
      <button
        type="button"
        className="mt-2 flex min-h-[44px] w-full items-center justify-between font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Invite and moves{moves > 0 ? ` · ${moves}` : ""}</span>
        <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : undefined} />
      </button>
      {open && <CrewPanel bare group={group} events={events} moving={moving} onPlan={onPlan} onSubmit={onSubmit} onRsvp={onRsvp} />}
    </div>
  );
}
