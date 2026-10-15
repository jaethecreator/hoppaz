"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { getSupabase } from "@/lib/supabase/client";
import { STAGE_FLAG, parseStage } from "./stageRights";

/**
 * Staff on the stage talk to the whole room (docs/ROOM-GAME-DESIGN.md 14.4). DARK by default: nothing here runs unless
 * NEXT_PUBLIC_ROOM_STAGE_VOICE=1 (and, as always for voice, NEXT_PUBLIC_ROOM_VOICE=1 and the server's LIVEKIT_* env).
 *
 * The server decides who is on the stage: crew_room_stage (supabase/crew_stage_voice.sql) answers from the walkers'
 * server-checked tiles and the crew roles. This file only asks, every couple of seconds, and keeps the answer. A phone
 * that lies about it can change what that one phone hears and nothing else.
 */
export { STAGE_FLAG };

export type StageState = {
  /** Staff (owner first, then admins) standing on the stage now: at most three user ids. Blocked people left out. */
  stage: string[];
  /** I am the owner or an admin of this crew. */
  isStaff: boolean;
  isOwner: boolean;
  /** The admins of this crew. Only the owner is told. */
  admins: string[];
  /** The server has answered at least once (the SQL is applied). */
  ready: boolean;
};

const EMPTY: StageState = { stage: [], isStaff: false, isOwner: false, admins: [], ready: false };

export const useStageStore = create<StageState & { put: (next: StageState) => void; clear: () => void }>((set) => ({
  ...EMPTY,
  put: (next) =>
    set((s) =>
      s.ready === next.ready &&
      s.isStaff === next.isStaff &&
      s.isOwner === next.isOwner &&
      same(s.stage, next.stage) &&
      same(s.admins, next.admins)
        ? s
        : next,
    ),
  clear: () => set(EMPTY),
}));

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** One read of crew_room_stage. Null when it failed or the SQL is not applied yet (the caller treats both as "nobody"). */
export async function readStage(crewId: string): Promise<StageState | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("crew_room_stage", { p_crew: crewId });
    if (error || !data) return null;
    return { ...parseStage(data), ready: true };
  } catch {
    return null;
  }
}

const POLL_MS = 2000;
/** After a failed read (or the SQL missing) ask rarely instead. */
const BACKOFF_MS = 30_000;

/** Keeps useStageStore current while the room is open and visible. Only call it behind STAGE_FLAG. */
export function useStagePoll(crewId: string, on: boolean) {
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      timer = null;
      let wait = POLL_MS;
      try {
        if (document.visibilityState === "visible") {
          const next = await readStage(crewId);
          if (!live) return;
          if (next) useStageStore.getState().put(next);
          else {
            useStageStore.getState().clear();
            wait = BACKOFF_MS;
          }
        }
      } finally {
        busy = false;
      }
      if (live) timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    const visible = () => {
      if (document.visibilityState !== "visible" || !live) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      useStageStore.getState().clear();
    };
  }, [crewId, on]);
}
