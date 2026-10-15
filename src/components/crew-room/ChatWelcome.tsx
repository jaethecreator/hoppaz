"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import css from "./ChatWelcome.module.css";

/**
 * The first visit (design section 16): a welcome card in the room, once per Hopper per crew. It pops 2.7 s after the
 * room opens (after the zoom has landed), says the brand's welcome line with two tips, and goes on LET'S GO, a tap
 * anywhere outside it, 8 s, or 4 s after the Hopper starts walking. It never blocks a tap outside its own box. After
 * that the same words live on as the "How this works" row at the top of General chat.
 *
 * "Seen" is the key hz:room-seen:<crew id> in localStorage (inside try/catch); with storage blocked it is once per tab.
 */
export const roomTips = ["Tap the floor to walk.", "Tap anyone to wave or vibe."];
export const welcomeLine = (brand: string) => `Welcome to ${brand}'s community center`;

const blocked = new Set<string>();
const seenKey = (crew: string) => `hz:room-seen:${crew}`;
function wasSeen(crew: string) {
  if (blocked.has(crew)) return true;
  try {
    return localStorage.getItem(seenKey(crew)) === "1";
  } catch {
    return false;
  }
}
function markSeen(crew: string) {
  blocked.add(crew);
  try {
    localStorage.setItem(seenKey(crew), "1");
  } catch {
    /* once per tab, then */
  }
}

const OPEN_AFTER = 2700;
const STAY = 8000;
const FADE_AFTER_WALK = 4000;

export default function ChatWelcome({ crewId, brand, top }: { crewId: string; brand: string; top: number }) {
  const [shown, setShown] = useState(false);
  const [dim, setDim] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const me = useRoomStore((s) => s.me);
  const start = useRef<{ x: number; y: number } | null>(null);

  // Pop it, once.
  useEffect(() => {
    if (wasSeen(crewId)) return;
    const open = setTimeout(() => {
      if (wasSeen(crewId)) return;
      markSeen(crewId);
      setShown(true);
    }, OPEN_AFTER);
    return () => clearTimeout(open);
  }, [crewId]);

  // Eight seconds, or a tap outside it.
  useEffect(() => {
    if (!shown) return;
    const off = setTimeout(() => setShown(false), STAY);
    const outside = (e: PointerEvent) => {
      if (card.current && e.target instanceof Node && card.current.contains(e.target)) return;
      setShown(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      clearTimeout(off);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [shown]);

  // Walking dims it, then takes it down.
  useEffect(() => {
    if (!shown) {
      start.current = null;
      return;
    }
    if (!me) return;
    if (!start.current) {
      start.current = { x: me.x, y: me.y };
      return;
    }
    if (start.current.x === me.x && start.current.y === me.y) return;
    const timer = setTimeout(() => setShown(false), FADE_AFTER_WALK);
    setDim(true);
    return () => clearTimeout(timer);
  }, [shown, me]);

  useEffect(() => {
    if (!shown) setDim(false);
  }, [shown]);

  if (!shown) return null;
  // With reduced motion the room opens already zoomed to you, so the third tip says where the whole room is.
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tips = reduced ? [...roomTips, "Tap the arrows button to see every room."] : roomTips;
  return (
    <div className={css.wrap} style={{ top }}>
      <div ref={card} className={`${css.card} ${dim ? css.dim : ""}`} role="status">
        <h2>{welcomeLine(brand)}</h2>
        <ol>
          {tips.map((tip, i) => (
            <li key={tip}>
              <b>{i + 1}</b>
              {tip}
            </li>
          ))}
        </ol>
        <button type="button" className="btn w-full" onClick={() => setShown(false)}>
          Let&apos;s go
        </button>
      </div>
    </div>
  );
}
