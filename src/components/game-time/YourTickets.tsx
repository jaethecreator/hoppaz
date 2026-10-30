"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2, Ticket } from "lucide-react";
import { lagosWhen } from "@/lib/game-time/clock";
import { useToast } from "@/lib/store";
import type { GtTicket } from "@/lib/game-time/types";
import TicketStorySheet from "./TicketStorySheet";

/**
 * One Game Time prize code, with COPY and SHARE: what was "Your tickets" on Me, one code per card. Me now lists the codes as small stubs
 * in its tickets carousel (components/me/MeTickets.tsx); tapping one opens this card. A win in the room saves its code at once (the
 * database keeps it, my_game_time_wins), so a dropped connection or a closed sheet loses nothing.
 */
export function PrizeCodeCard({ ticket: t }: { ticket: GtTicket }) {
  const say = useToast((s) => s.say);
  const [copied, setCopied] = useState(false);
  // SHARE: the story picture. The picture never carries the code (see ticketStory.ts).
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.code);
      setCopied(true);
    } catch {
      say("Couldn't copy. Press and hold the code.", "error");
    }
  };

  return (
    <div className="stub flex min-w-0 items-center gap-3 px-4 py-3" data-prize-code>
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
        <button type="button" onClick={() => void copy()} aria-label={`Copy code ${t.code}`} className="btn btn-ghost px-3 text-[12px]">
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? "COPIED" : "COPY"}
        </button>
        <button type="button" onClick={() => setSharing(true)} aria-label={`Share ${t.title} to your story`} className="btn btn-ghost px-3 text-[12px]" data-ticket-share>
          <Share2 size={16} aria-hidden />
          SHARE
        </button>
      </div>
      {sharing && <TicketStorySheet title={t.title} brand={t.brand} crewId={t.crew_id} onClose={() => setSharing(false)} />}
    </div>
  );
}
