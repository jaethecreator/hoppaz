"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { getSupabase } from "@/lib/supabase/client";
import { useRoomStore } from "./roomStore";
import type { RailCrew, RailEvent } from "./hub";

export type { RailCrew, RailEvent } from "./hub";

/**
 * The ways out of the room, and what the room tells you about outside it (design sections 10 and 12.3).
 *
 *   OTHER CREWS and THIS WEEK   room_rails() in supabase/crew_rails.sql, read the first time Explore opens (not when the
 *                               room opens: the Hopper who never taps it never pays for it), kept five minutes.
 *   useGoOut()                  every way out of the room goes through this one call. Outside a Game Time it just goes.
 *                               While one is scheduled or live (roomStore.huntActive) it asks "Leave the hunt?" first.
 *                               The door, the pill, the Explore rows and the event sheet use it; so should the header's
 *                               back arrow and the tab bar's tabs other than CREW.
 *   useExploreStore             whether the Explore popover is open. The logo badge in the header opens it.
 */

const TTL = 5 * 60_000;

type Rails = { crews: RailCrew[]; trending: RailEvent[] };
const cache = new Map<string, { at: number; rails: Rails }>();
const inflight = new Map<string, Promise<Rails | null>>();

/** Verified crews first, then the bigger ones. The server already sorts like this; this keeps a stale answer honest. */
export const verifiedFirst = (crews: RailCrew[]): RailCrew[] =>
  [...crews].sort((a, b) => Number(b.verified) - Number(a.verified) || b.members - a.members);

/** One read of room_rails. Null when the call fails or the rails are not in the database. */
export function loadRails(crewId: string, force = false): Promise<Rails | null> {
  const hit = cache.get(crewId);
  if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.rails);
  const running = inflight.get(crewId);
  if (running) return running;
  const sb = getSupabase();
  if (!sb) return Promise.resolve(null);
  const p = Promise.resolve(sb.rpc("room_rails", { p_crew: crewId }))
    .then(({ data, error }) => {
      if (error || !data) return null;
      const d = data as { crews?: RailCrew[]; trending?: RailEvent[] };
      const rails = { crews: verifiedFirst(d.crews ?? []).slice(0, 8), trending: (d.trending ?? []).slice(0, 8) };
      cache.set(crewId, { at: Date.now(), rails });
      return rails;
    })
    .catch(() => null)
    .finally(() => inflight.delete(crewId));
  inflight.set(crewId, p);
  return p;
}

export type RailsState = { status: "idle" | "loading" | "ready" | "error"; crews: RailCrew[]; trending: RailEvent[]; retry: () => void };

/** The rails for Explore. Nothing is read until `enabled` turns true (the first time Explore is opened). */
export function useRoomRails(crewId: string, enabled: boolean): RailsState {
  const [state, setState] = useState<Omit<RailsState, "retry">>(() => {
    const hit = cache.get(crewId);
    return hit ? { status: "ready", ...hit.rails } : { status: "idle", crews: [], trending: [] };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const fresh = cache.get(crewId);
    if (attempt === 0 && fresh && Date.now() - fresh.at < TTL) {
      setState({ status: "ready", ...fresh.rails });
      return;
    }
    setState((s) => (s.status === "ready" ? s : { status: "loading", crews: [], trending: [] }));
    void loadRails(crewId, attempt > 0).then((rails) => {
      if (!live) return;
      setState(rails ? { status: "ready", ...rails } : { status: "error", crews: [], trending: [] });
    });
    return () => {
      live = false;
    };
  }, [crewId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** Whether the Explore popover is open. Opened by the logo badge in the header; drawn by Explore.tsx (ExplorePopover). */
export const useExploreStore = create<{ open: boolean; show: () => void; hide: () => void; toggle: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

/** Where the "Leave the hunt?" card will take me if I say LEAVE, or null while it is not asking. */
export const useLeaveStore = create<{ pending: string | null; ask: (href: string) => void; stay: () => void }>((set) => ({
  pending: null,
  ask: (pending) => set({ pending }),
  stay: () => set({ pending: null }),
}));

/**
 * The one way out of the room. Pass a path ("/", "/crew/<id>", "/?e=<id>"). While a Game Time is scheduled or live it
 * opens the "Leave the hunt?" card (drawn by LeaveHunt in EventSheet.tsx) and goes only on LEAVE; otherwise it goes at
 * once. Walking never calls this: only a tap on the door, the pill, a row or an arrow does.
 */
export function useGoOut() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      useExploreStore.getState().hide();
      if (useRoomStore.getState().huntActive) {
        useLeaveStore.getState().ask(href);
        return;
      }
      router.push(href);
    },
    [router],
  );
}
