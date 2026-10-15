"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Share2, Ticket, X } from "lucide-react";
import { deviceTier } from "@/lib/deviceTier";
import { closeWin } from "@/lib/game-time/controller";
import { useGameTime, type GtWin } from "@/lib/game-time/store";
import { useToast } from "@/lib/store";
import TicketStorySheet from "./TicketStorySheet";
import css from "./GameTime.module.css";

/**
 * The win, full screen over the room (design 13.5): a ticket with the code, COPY, confetti. The sound, the buzz and the burst on the
 * object were already played by the controller when the sheet rose. The code is saved to Me under "Your tickets" by the
 * database, so closing this loses nothing; the banner opens it again.
 */

const COLOURS = ["#5B2EFF", "#D8B468", "#F5EBDD", "#FF4D00", "#9D81FF"];

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Copies text. The clipboard API where the browser has it, else a hidden field and the old command. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way (an http page, a webview) */
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

function Confetti({ count }: { count: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (n: number) => ((i * 7919 + n * 104729) % 1000) / 1000;
        return {
          x: `${Math.round(r(1) * 100)}%`,
          s: `${9 + Math.round(r(2) * 8)}px`,
          c: COLOURS[i % COLOURS.length],
          dur: `${(2.2 + r(3) * 1.8).toFixed(2)}s`,
          delay: `${(r(4) * 1.1).toFixed(2)}s`,
          drift: `${Math.round((r(5) - 0.5) * 200)}px`,
          spin: `${Math.round((r(6) - 0.5) * 1080)}deg`,
        };
      }),
    [count],
  );
  return (
    <div className={css.confetti} aria-hidden data-gt-confetti>
      {pieces.map((p, i) => (
        <i key={i} className={css.piece} style={{ "--x": p.x, "--s": p.s, "--c": p.c, "--dur": p.dur, "--delay": p.delay, "--drift": p.drift, "--spin": p.spin } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Card({ win }: { win: GtWin }) {
  const say = useToast((s) => s.say);
  const done = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const brand = useGameTime((s) => s.game?.brand);
  const crewId = useGameTime((s) => s.game?.crew_id ?? s.crewId);
  // SHARE TO STORY: the picture for the story sheet. It never carries the code (see ticketStory.ts).
  const [sharing, setSharing] = useState(false);
  // Confetti plays once, a bit under five seconds, then the page is still.
  const [rain, setRain] = useState(win.fresh && !reduced());
  useEffect(() => {
    if (!rain) return;
    const t = setTimeout(() => setRain(false), 5200);
    return () => clearTimeout(t);
  }, [rain]);
  useEffect(() => {
    done.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeWin();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (await copyText(win.code)) setCopied(true);
    else say("Couldn't copy. Press and hold the code.", "error");
  };

  return (
    <div className={css.win} role="dialog" aria-modal="true" aria-label="You found a box" data-gt-win>
      {rain && <Confetti count={deviceTier() === "low" ? 28 : 96} />}
      <button type="button" className={css.winClose} onClick={closeWin} aria-label="Close">
        <X size={20} aria-hidden />
      </button>
      <div className={css.winBody}>
        <div className={css.winHead}>
          <span className={css.winPill}>
            <Ticket size={13} aria-hidden /> TICKET
          </span>
          <h2 className={css.winTitle}>{win.fresh ? "You found it." : "You got one."}</h2>
          <p className={css.winLine}>First to the box. It&apos;s yours.</p>
        </div>
        <div className={css.winActions}>
          <div className={css.ticket} data-gt-ticket>
            <div className={css.ticketTop}>
              <span className={css.ticketBrand}>{brand || "360Playlist"}</span>
              <span className={css.ticketTitle}>{win.title || "Game Time"}</span>
            </div>
            <div className={css.ticketCut} aria-hidden />
            <div className={css.ticketBottom}>
              <span className={css.codeKicker}>Your code</span>
              <span className={css.code} data-gt-code>
                {win.code}
              </span>
            </div>
          </div>
          <button type="button" className="btn w-full" onClick={copy} data-gt-copy>
            {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
            {copied ? "COPIED" : "COPY CODE"}
          </button>
          <button type="button" className="btn w-full" onClick={() => setSharing(true)} data-gt-share>
            <Share2 size={18} aria-hidden />
            SHARE TO STORY
          </button>
          <p className={css.winSaved}>Saved in Me, Your tickets.</p>
          <button ref={done} type="button" className="btn btn-ghost w-full" onClick={closeWin} data-gt-done>
            DONE
          </button>
        </div>
      </div>
      {sharing && <TicketStorySheet title={win.title || "Game Time"} brand={brand || "360Playlist"} crewId={crewId} onClose={() => setSharing(false)} />}
    </div>
  );
}

export default function WinSheet() {
  const win = useGameTime((s) => s.win);
  return win ? <Card key={`${win.gameId}:${win.code}`} win={win} /> : null;
}
