"use client";

import Link from "next/link";
import { DoorOpen, Ticket } from "lucide-react";
import { clockText, lagosWhen, useServerNow } from "@/lib/game-time/clock";
import { useHubGame } from "@/lib/game-time/hooks";
import type { GtOverReason } from "@/lib/game-time/types";

/**
 * The crew hub's Game Time card (design 13.1): GAME TIME and the countdown before it opens, LIVE NOW while it runs, and
 * the end state for half an hour after. Nothing at all when the crew has no Game Time to show. One mount line in CrewHub.
 */

const OVER_WORD: Record<GtOverReason, string> = { all_found: "ALL FOUND", time_up: "TIME UP", closed: "CLOSED" };

export default function HubGameTime({ crewId, isMember }: { crewId: string; isMember: boolean }) {
  const { state } = useHubGame(crewId);
  const now = useServerNow(1000);
  const game = state?.game;
  if (!state || !game) return null;
  const me = state.me;
  const room = `/crew/${crewId}/room`;
  const live = game.status === "live";
  const over = game.status === "over";
  const openIn = Date.parse(game.opens_at) - now;
  const soon = game.status === "upcoming" && openIn <= 10 * 60_000;
  const left = `${game.boxes_left} of ${game.boxes_total} ${game.boxes_total === 1 ? "box" : "boxes"} left`;

  return (
    <section
      className={`card mt-3 ${soon ? "!border-danfo" : ""}`}
      aria-label="Game Time"
      data-gt-hub={game.status}
    >
      <div className="flex items-start gap-3">
        <Ticket size={20} aria-hidden className="mt-0.5 flex-none text-violet" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-dim">
            {live && <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-keke" />}
            {live ? "GAME TIME · LIVE NOW" : over ? `GAME TIME · ${OVER_WORD[game.over_reason ?? "closed"]}` : soon ? "GAME TIME · STARTING SOON" : "GAME TIME"}
          </p>
          <p className="mt-0.5 font-display text-[17px] font-black leading-tight">{game.title}</p>
          <p className="hint mt-1">
            {over
              ? `${game.boxes_total - game.boxes_left} of ${game.boxes_total} found.`
              : live
                ? `${left}. First to find one wins a ticket.`
                : `Opens ${lagosWhen(game.opens_at)}. ${game.boxes_total} ${game.boxes_total === 1 ? "box" : "boxes"} hiding in the room.`}
          </p>
        </div>
        {!over && (
          <p className="flex-none text-right font-display text-[22px] font-black leading-none tabular-nums" aria-label={live ? "Time left" : "Opens in"}>
            {clockText(live ? Date.parse(game.closes_at) - now : openIn)}
          </p>
        )}
      </div>
      {!over && (isMember ? (
        <Link href={room} className="btn mt-3 w-full text-[14px]" data-gt-hub-enter>
          <DoorOpen size={18} aria-hidden /> {live && !me.won ? "ENTER ROOM AND HUNT" : "ENTER ROOM"}
        </Link>
      ) : (
        <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream" data-gt-hub-join>
          JOIN THE CREW TO HUNT
        </p>
      ))}
      {me.won && (
        <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-violet">You got a ticket. It is in Me, Your tickets.</p>
      )}
    </section>
  );
}
