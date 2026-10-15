"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { timeOf } from "./chatFeed";
import type { CrewRoomConnection, RoomMessage } from "./types";

/**
 * My messages that have not arrived yet. A message goes in here the moment I press send, so it shows in the list at
 * once (dimmed, with a clock), and the input is free for the next one. The outbox keeps trying for up to 30 s while
 * the room is reconnecting, then marks the message FAILED (tap to retry). When the real message shows up in the
 * thread the outbox copy goes away. Memory only, and per crew room, like the drafts.
 */
export type Outgoing = {
  id: string;
  crew: string;
  /** The thread it belongs to: "general", or the area session (circle id). */
  thread: string;
  scope: "general" | "nearby";
  circle: string | null;
  body: string;
  /** When I pressed send (ms). Also the time printed on the row. */
  at: number;
  status: "sending" | "sent" | "failed";
  /** Why it failed, in a few words. */
  error?: string;
  /** When the server took it (ms). The row stays until the real message arrives, or a few seconds more. */
  sentAt?: number;
};

type OutboxState = {
  items: Outgoing[];
  add: (item: Outgoing) => void;
  patch: (id: string, patch: Partial<Outgoing>) => void;
  remove: (id: string) => void;
};

export const useOutbox = create<OutboxState>((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
  patch: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  remove: (id) => set((s) => (s.items.some((i) => i.id === id) ? { items: s.items.filter((i) => i.id !== id) } : s)),
}));

/** How long a message keeps trying while the room is not connected (ms), and how often (ms). */
const KEEP_TRYING = 30_000;
const RETRY_EVERY = 2_000;
/** The row stays this long (ms) after the server took it, in case the real message is slow to arrive. */
const SENT_LINGER = 6_000;

/** The room's answers that mean "try again in a moment", not "this can never work". */
const TRANSIENT = /reconnecting|still here|finishing your move|could not connect|give the conversation a moment|moment/i;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The real copy of an outgoing message: mine, same words, written after I pressed send. */
export const arrived = (out: Outgoing, items: RoomMessage[], userId: string) =>
  items.some((m) => m.author_id === userId && m.body === out.body && timeOf(m.created_at) >= out.at - 15_000);

/**
 * Send through the outbox. `send(scope, text, circle)` queues and returns at once; the outbox does the rest.
 * `retry(id)` sends a failed one again; `discard(id)` drops it.
 */
export function useChatSender(room: CrewRoomConnection, crewId: string) {
  const sendRef = useRef(room.send);
  sendRef.current = room.send;
  const add = useOutbox((s) => s.add);
  const patch = useOutbox((s) => s.patch);
  const remove = useOutbox((s) => s.remove);

  const run = useCallback(
    async (item: Outgoing) => {
      const started = Date.now();
      for (;;) {
        let problem: string | null;
        try {
          problem = await sendRef.current(item.scope, item.body, item.circle);
        } catch {
          problem = "Could not send.";
        }
        if (!problem) {
          patch(item.id, { status: "sent", sentAt: Date.now() });
          return;
        }
        if (TRANSIENT.test(problem) && Date.now() - started < KEEP_TRYING) {
          await wait(RETRY_EVERY);
          continue;
        }
        patch(item.id, { status: "failed", error: problem });
        return;
      }
    },
    [patch]
  );

  const send = useCallback(
    (scope: "general" | "nearby", body: string, circle: string | null) => {
      const item: Outgoing = {
        id: `out-${crypto.randomUUID()}`,
        crew: crewId,
        thread: scope === "general" ? "general" : (circle ?? "general"),
        scope,
        circle,
        body,
        at: Date.now(),
        status: "sending",
      };
      add(item);
      void run(item);
    },
    [add, crewId, run]
  );

  const retry = useCallback(
    (id: string) => {
      const item = useOutbox.getState().items.find((i) => i.id === id);
      if (!item || item.status !== "failed") return;
      const fresh: Outgoing = { ...item, status: "sending", error: undefined, at: Date.now() };
      patch(id, { status: "sending", error: undefined, at: fresh.at });
      void run(fresh);
    },
    [patch, run]
  );

  return { send, retry, discard: remove };
}

/** Drop outbox rows whose real message has arrived, or that were taken a while ago. Run from the chat list. */
export function useOutboxCleanup(thread: string, items: RoomMessage[], userId: string) {
  const outs = useOutbox((s) => s.items);
  const remove = useOutbox((s) => s.remove);
  useEffect(() => {
    const mine = outs.filter((o) => o.thread === thread && o.status === "sent");
    if (!mine.length) return;
    const done = mine.filter((o) => arrived(o, items, userId));
    done.forEach((o) => remove(o.id));
    const waiting = mine.filter((o) => !done.includes(o));
    if (!waiting.length) return;
    const left = Math.min(...waiting.map((o) => (o.sentAt ?? Date.now()) + SENT_LINGER - Date.now()));
    const timer = setTimeout(() => waiting.forEach((o) => remove(o.id)), Math.max(200, left));
    return () => clearTimeout(timer);
  }, [outs, thread, items, userId, remove]);
}
