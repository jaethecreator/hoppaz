"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, Check, Copy, DoorOpen, Ticket } from "lucide-react";
import { clockText, lagosWhen, useServerNow } from "@/lib/game-time/clock";
import { useHubGame } from "@/lib/game-time/hooks";
import type { GtOverReason } from "@/lib/game-time/types";
import { useToast } from "@/lib/store";
import { copyText } from "./copyText";

/**
 * The crew hub's Game Time card (design 13.1): GAME TIME and the countdown before it opens, LIVE NOW while it runs, and
 * the end state for half an hour after. Nothing at all when the crew has no Game Time to show. One mount line in CrewHub.
 * A member who has won sees their ticket right on the card ("Your ticket: <code>", COPY) and a link to all of them in Me.
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
        <>
          <Link href={room} className="btn mt-3 w-full text-[14px]" data-gt-hub-enter>
            <DoorOpen size={18} aria-hidden /> {live && !me.won && !me.blocked ? "ENTER ROOM AND HUNT" : "ENTER ROOM"}
          </Link>
          {me.blocked && !me.won && (
            <p className="hint mt-2" data-gt-hub-blocked>
              {me.blocked === "need_confirmed" ? "Confirm your email to hunt. Check your inbox. You can still come watch." : "You joined too late to hunt this one. Come watch."}
            </p>
          )}
        </>
      ) : game.join_in_time ? (
        // Not a button: the real one, JOIN AND WALK IN, is the next thing on the page.
        <p className="hint mt-3 flex items-center gap-1.5 text-cream" data-gt-hub-join>
          <ArrowDown size={14} aria-hidden className="flex-none" /> Join the crew below to hunt.
        </p>
      ) : (
        <p className="hint mt-3" data-gt-hub-join>
          This one is for members who joined before it opened. Join for the next one.
        </p>
      ))}
      {me.won && <MyTicket code={me.code} />}
    </section>
  );
}

/**
 * "Your ticket: CODE", COPY, and the way to Me. The code is this game's; a win in another game of the same campaign leaves
 * it null (one win per campaign), and then only the link shows.
 */
function MyTicket({ code }: { code: string | null }) {
  const say = useToast((s) => s.say);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    if (!code) return;
    if (await copyText(code)) setCopied(true);
    else say("Couldn't copy. Press and hold the code.", "error");
  };

  return (
    <div className="mt-3 border-t border-line pt-3" data-gt-hub-ticket>
      {code ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-violet">Your ticket</p>
            <p className="mt-0.5 select-all break-all font-mono text-[17px] font-medium tracking-[0.08em]" data-gt-hub-code>
              {code}
            </p>
          </div>
          <button type="button" onClick={() => void copy()} aria-label={`Copy code ${code}`} className="btn btn-ghost flex-none px-3 text-[12px]">
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
      ) : (
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-violet">You got a ticket</p>
      )}
      <Link
        href="/me#tickets"
        className="mt-2 inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline underline-offset-4"
        data-gt-hub-tickets-link
      >
        {code ? "All your tickets in Me" : "See it in Me, Your tickets"}
      </Link>
    </div>
  );
}
