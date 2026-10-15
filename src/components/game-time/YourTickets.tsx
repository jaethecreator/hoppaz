"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2, Ticket } from "lucide-react";
import { lagosWhen } from "@/lib/game-time/clock";
import { useTickets } from "@/lib/game-time/hooks";
import { useToast } from "@/lib/store";
import type { GtTicket } from "@/lib/game-time/types";
import TicketStorySheet from "./TicketStorySheet";

/**
 * "Your tickets" on Me: every code this Hopper has won in a Game Time, newest first, each with COPY. A win in the room saves
 * its code here at once (the database keeps it, my_game_time_wins), so a dropped connection or a closed sheet loses nothing.
 * Draws nothing until there is a ticket. One mount line in Me.
 */
export default function YourTickets({ enabled = true }: { enabled?: boolean }) {
  const { tickets, loaded } = useTickets(enabled);
  const say = useToast((s) => s.say);
  const [copied, setCopied] = useState<string | null>(null);
  // SHARE: the ticket whose story picture is open. The picture never carries the code (see ticketStory.ts).
  const [sharing, setSharing] = useState<GtTicket | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (!loaded || tickets.length === 0) return null;

  const copy = async (id: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(id);
    } catch {
      say("Couldn't copy. Press and hold the code.", "error");
    }
  };

  return (
    <section aria-label="Your tickets" className="mt-7" data-your-tickets>
      <p className="seclabel mb-2.5">YOUR TICKETS</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {tickets.map((t) => (
          <li key={t.id} className="stub flex min-w-0 items-center gap-3 px-4 py-3">
            <Ticket size={20} aria-hidden className="flex-none text-violet" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-display text-[14px] font-black leading-tight">
                {t.brand} · {t.title}
              </p>
              <p className="mt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-dim">{lagosWhen(t.won_at)}</p>
              <p className="mt-1 select-all break-all font-mono text-[17px] font-medium tracking-[0.08em]" data-ticket-code>
                {t.code}
              </p>
            </div>
            <div className="flex flex-none flex-col gap-1.5">
              <button type="button" onClick={() => void copy(t.id, t.code)} aria-label={`Copy code ${t.code}`} className="btn btn-ghost px-3 text-[12px]">
                {copied === t.id ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                {copied === t.id ? "COPIED" : "COPY"}
              </button>
              <button
                type="button"
                onClick={() => setSharing(t)}
                aria-label={`Share ${t.title} to your story`}
                className="btn btn-ghost px-3 text-[12px]"
                data-ticket-share
              >
                <Share2 size={16} aria-hidden />
                SHARE
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sharing && <TicketStorySheet title={sharing.title} brand={sharing.brand} crewId={sharing.crew_id} onClose={() => setSharing(null)} />}
    </section>
  );
}
