"use client";

import { useEffect, useRef, useState } from "react";
import { timeOf } from "./chatFeed";
import type { CrewRoomConnection } from "./types";

/**
 * Speech bubbles: new messages pop over the speaker's head so people see talk without opening the chat (design 9.8).
 *
 *  - only messages that arrive after the room opened (a thread's first page is history and never bubbles)
 *  - General for everyone; an area message only while I am inside that area, because nobody else receives it
 *  - one bubble per speaker (a new line replaces the last), at most 3 at once, the oldest of other people goes first
 *  - on screen 2.5 s plus 40 ms a character, 6 s at most; long lines are cut at 60 characters
 */
export type Bubble = { id: string; speaker: string; text: string; area: boolean; born: number; until: number; mine: boolean };

export const BUBBLE_MAX = 3;
const CUT = 60;
/** A message older than this (ms) when it shows up is catch-up, not talk. */
const FRESH = 20_000;

export const bubbleText = (body: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > CUT ? `${flat.slice(0, CUT - 1).trimEnd()}…` : flat;
};
export const bubbleLife = (text: string) => Math.min(6000, 2500 + 40 * text.length);

export function useBubbles(room: CrewRoomConnection, userId: string): Bubble[] {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const known = useRef(new Map<string, Set<string>>());
  const circle = room.snapshot?.self?.circle_id ?? null;
  const threads = room.threads;

  useEffect(() => {
    const born = Date.now();
    const fresh: Bubble[] = [];
    for (const [key, thread] of Object.entries(threads)) {
      const seen = known.current.get(key);
      if (!seen) {
        // The first page of a thread is what was said before I got here.
        if (thread.loaded) known.current.set(key, new Set(thread.items.map((m) => m.id)));
        continue;
      }
      for (const m of thread.items) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (born - timeOf(m.created_at) > FRESH) continue;
        if (m.scope === "nearby" && (!circle || m.circle_id !== circle)) continue;
        const text = bubbleText(m.body);
        if (!text) continue;
        fresh.push({ id: m.id, speaker: m.author_id, text, area: m.scope === "nearby", born, until: born + bubbleLife(text), mine: m.author_id === userId });
      }
    }
    if (!fresh.length) return;
    setBubbles((old) => {
      let next = [...old.filter((b) => !fresh.some((f) => f.speaker === b.speaker)), ...fresh];
      while (next.length > BUBBLE_MAX) {
        const drop = next.findIndex((b) => !b.mine) >= 0 ? next.findIndex((b) => !b.mine) : 0;
        next = next.filter((_, i) => i !== drop);
      }
      return next;
    });
  }, [threads, circle, userId]);

  // Take each one down when its time is up.
  const nextUntil = bubbles.length ? Math.min(...bubbles.map((b) => b.until)) : 0;
  useEffect(() => {
    if (!nextUntil) return;
    const timer = setTimeout(() => setBubbles((old) => old.filter((b) => b.until > Date.now() + 20)), Math.max(30, nextUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [nextUntil, bubbles]);

  // A new crew room starts with nothing remembered.
  useEffect(() => {
    const map = known.current;
    return () => map.clear();
  }, []);

  return bubbles;
}
