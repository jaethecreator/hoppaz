"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchList, fetchState, fetchTickets } from "./api";
import { noteServerTime, serverNow } from "./clock";
import type { GtListGame, GtState, GtTicket } from "./types";

/**
 * Reads of Game Time outside the room: the hub's banner, the global ping and Me's "Your tickets". The room itself uses
 * the controller (controller.ts), which polls faster and listens to Realtime.
 */

const DISMISS = "hz-gt-ping";

/** The ping for a Game Time was dismissed (or acted on) on this device. Once per Game Time per device. */
export function pingDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`${DISMISS}-${id}`) === "1";
  } catch {
    return false;
  }
}

export function dismissPing(id: string) {
  try {
    localStorage.setItem(`${DISMISS}-${id}`, "1");
  } catch {
    /* storage blocked: it shows again next visit, which is the safe way to be wrong */
  }
}

/** True while the page is in front: nothing polls in a hidden tab. */
function useVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * The crew hub's view of its Game Time: game_time_state every 12 s while it is upcoming, every 5 s while live, every 30 s
 * with nothing on. `state` is null until the first answer (or for a private crew).
 */
export function useHubGame(crewId: string) {
  const [state, setState] = useState<GtState | null>(null);
  const [ready, setReady] = useState(false);
  const visible = useVisible();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    const run = async () => {
      const r = await fetchState(crewId);
      if (stopped) return;
      let next = 30_000;
      if (r.ok) {
        if (r.state) noteServerTime(r.state.server_now, r.sentAt, r.receivedAt);
        setState(r.state);
        const g = r.state?.game;
        if (g?.status === "live") next = 5000;
        else if (g?.status === "upcoming") next = Math.max(1500, Math.min(12_000, Date.parse(g.opens_at) - serverNow() + 400));
      } else next = 15_000;
      setReady(true);
      timer.current = setTimeout(run, next + Math.round(Math.random() * 600));
    };
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [crewId, visible]);

  return { state, ready };
}

/**
 * The global ping's feed: game_time_list every 60 s while the app is open and in front, and at once when it comes back.
 * `session` gates it: nothing is asked before the Hopper has a session.
 */
export function usePingGames(enabled: boolean) {
  const [games, setGames] = useState<GtListGame[]>([]);
  const visible = useVisible();
  useEffect(() => {
    if (!enabled || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const sent = Date.now();
      const r = await fetchList();
      if (stopped) return;
      if (r.ok) {
        if (r.serverNow) noteServerTime(r.serverNow, sent, Date.now());
        setGames(r.games);
      }
      timer = setTimeout(run, 60_000 + Math.round(Math.random() * 5000));
    };
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, visible]);
  return games;
}

/** My tickets, newest first. `loaded` is true once we know (an empty list included). */
export function useTickets(enabled = true) {
  const [tickets, setTickets] = useState<GtTicket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchTickets();
    if (r.ok) setTickets(r.tickets);
    setFailed(!r.ok);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    void load();
    // Back from the room with a new ticket: Me reads again when the page comes forward.
    const on = () => !document.hidden && !stopped && void load();
    document.addEventListener("visibilitychange", on);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", on);
    };
  }, [enabled, load]);

  return { tickets, loaded, failed, reload: load };
}
