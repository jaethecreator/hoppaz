"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Ticket } from "lucide-react";
import { lagosWhen } from "@/lib/game-time/clock";
import type { GtTicket } from "@/lib/game-time/types";
import { useToast } from "@/lib/store";
import { copyText } from "./copyText";

/** The anchor: /me#tickets. The win sheet and the crew page's Game Time card link here. */
export const TICKETS_ANCHOR = "tickets";

/**
 * "Your tickets" at the very top of Me: every code this Hopper has won in a Game Time, newest first, each with COPY. A win in
 * the room saves its code here at once (the database keeps it, my_game_time_wins), so a dropped connection or a closed sheet
 * loses nothing. Draws nothing until there is a ticket. Me reads the tickets (useTickets) and hands them in, because it
 * needs to know whether this block is there to space the header under it.
 *
 * Arriving by /me#tickets (the win sheet, the crew page) scrolls here once the tickets have loaded and flashes the border.
 * The scroll cannot be left to the browser or the router: the block does not exist until the database has answered.
 */
export default function YourTickets({ tickets, top = false }: { tickets: GtTicket[]; top?: boolean }) {
  const say = useToast((s) => s.say);
  const root = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const has = tickets.length > 0;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!has) return;
    const arrive = () => {
      if (window.location.hash !== `#${TICKETS_ANCHOR}`) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      setFlash(true);
      // Spent: take the hash off so the same link works again next time (the same way #earn is handled on this page).
      try {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      } catch {
        /* the scroll already happened */
      }
    };
    arrive();
    // A client-side visit to /me#tickets can land a tick before the address bar updates.
    const t = setTimeout(arrive, 60);
    window.addEventListener("hashchange", arrive);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", arrive);
    };
  }, [has]);

  if (!has) return null;

  const copy = async (id: string, code: string) => {
    if (await copyText(code)) setCopied(id);
    else say("Couldn't copy. Press and hold the code.", "error");
  };

  return (
    <section
      ref={root}
      id={TICKETS_ANCHOR}
      aria-label="Your tickets"
      className={top ? "pad-top" : "mt-7"}
      data-your-tickets
    >
      <p className="seclabel mb-2.5">
        YOUR TICKETS{tickets.length > 1 ? ` · ${tickets.length}` : ""}
      </p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {tickets.map((t) => (
          <li
            key={t.id}
            className={`stub flex min-w-0 items-center gap-3 px-4 py-3 transition-colors duration-500 ${flash ? "!border-violet" : ""}`}
          >
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
            <button type="button" onClick={() => void copy(t.id, t.code)} aria-label={`Copy code ${t.code}`} className="btn btn-ghost flex-none px-3 text-[12px]">
              {copied === t.id ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied === t.id ? "COPIED" : "COPY"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
