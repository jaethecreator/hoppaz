"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { backoff, hidden, jitter, useMapShown } from "@/lib/idle";
import { fetchPublicGameTimeList, type PublicGameTimeGame } from "@/lib/publicApi";
import { useSession } from "@/lib/useSession";
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
 * The crew hub's view of its Game Time: game_time_state about every 8 s while it is live, every 3 to 12 s as it gets close
 * to opening, every minute with nothing on. `state` is null until the first answer (or for a private crew). A person who
 * has not touched the screen for a minute is asked for less often, and a failure waits 30 s, then 60, then 120.
 */
export function useHubGame(crewId: string) {
  const [state, setState] = useState<GtState | null>(null);
  const [ready, setReady] = useState(false);
  const visible = useVisible();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** When the last answer for this crew arrived: coming back to the page inside 20 s does not ask again. */
  const last = useRef<{ crewId: string; at: number }>({ crewId: "", at: 0 });

  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let failures = 0;
    const run = async () => {
      const r = await fetchState(crewId);
      if (stopped) return;
      let next = 60_000;
      if (r.ok) {
        failures = 0;
        last.current = { crewId, at: Date.now() };
        if (r.state) noteServerTime(r.state.server_now, r.sentAt, r.receivedAt);
        setState(r.state);
        const g = r.state?.game;
        if (g?.status === "live") next = backoff(8000, { max: 24_000 });
        else if (g?.status === "upcoming") {
          const until = Date.parse(g.opens_at) - serverNow();
          next = Math.max(3000, Math.min(12_000, until + 400));
          // Far from opening nobody needs a fresh answer every 12 s, and a person who has put the phone down needs less.
          if (until > 60_000) next = backoff(next, { max: 30_000 });
        } else next = backoff(60_000, { max: 180_000 });
        next += Math.round(Math.random() * 1000);
      } else {
        failures += 1;
        next = Math.min(120_000, 30_000 * 2 ** (failures - 1));
      }
      setReady(true);
      timer.current = setTimeout(run, next);
    };
    const since = last.current.crewId === crewId ? Date.now() - last.current.at : Infinity;
    if (since < 20_000) timer.current = setTimeout(run, 20_000 - since);
    else void run();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [crewId, visible]);

  return { state, ready };
}

/* ---------------------------------------------------------------- the ping -- */

/** The public list is looked at this often while the app is in front (x2, x4 as the person goes idle, to 3 minutes). */
const PUBLIC_EVERY = 60_000;
const PUBLIC_MAX = 180_000;
/** A per-user answer this young is the truth; older, the public list carries the flags it had. */
const USER_FRESH = 2 * 60_000;
/** A Game Time in a private crew is in no public list, so the per-user list is asked this often regardless. */
const USER_EVERY = 10 * 60_000;
/** Back after this long away: ask the per-user list. */
const AWAY_LONG = 5 * 60_000;
/** Coming back, or restarting, does not read again inside this. */
const REREAD_GAP = 20_000;

type Ping = {
  refs: number;
  account: boolean;
  games: GtListGame[];
  sig: string;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
  inflight: boolean;
  lastReadAt: number;
  lastUser: { at: number; games: GtListGame[] } | null;
  lastUserAt: number;
  forceUser: boolean;
  hiddenAt: number;
  off: (() => void) | null;
};

/** One loop for the whole app: GameTimePing (every page) and the Crew tab used to run one each. */
const ping: Ping = {
  refs: 0,
  account: false,
  games: [],
  sig: "[]",
  listeners: new Set(),
  timer: undefined,
  inflight: false,
  lastReadAt: 0,
  lastUser: null,
  lastUserAt: 0,
  forceUser: false,
  hiddenAt: 0,
  off: null,
};
const NO_GAMES: GtListGame[] = [];

function publish(games: GtListGame[]) {
  const sig = JSON.stringify(games);
  if (sig === ping.sig) return;
  ping.sig = sig;
  ping.games = games;
  ping.listeners.forEach((fn) => fn());
}

/** The list to show: the per-user answer when it is young, otherwise the public games with the flags last known for them. */
function merged(pub: { ok: boolean; games: PublicGameTimeGame[] }): GtListGame[] | null {
  const now = Date.now();
  const user = ping.lastUser;
  if (user && now - user.at < USER_FRESH) return user.games;
  const by = new Map((user?.games ?? []).map((g) => [g.id, g]));
  if (pub.ok && pub.games.length) {
    return pub.games.map((g) => {
      const known = by.get(g.id);
      return {
        ...g,
        is_member: known?.is_member ?? g.is_member ?? false,
        blocked: known?.blocked ?? g.blocked ?? null,
        won: known?.won ?? g.won ?? false,
        join_in_time: known?.join_in_time ?? g.join_in_time ?? true,
      };
    });
  }
  // Nothing public. What the person's own list held (a private crew's game) stays until it closes.
  if (pub.ok) return user ? user.games.filter((g) => Date.parse(g.closes_at) > serverNow()) : [];
  return user ? user.games : null;
}

async function readOnce() {
  if (ping.inflight) return;
  ping.inflight = true;
  try {
    const pub = await fetchPublicGameTimeList();
    const now = Date.now();
    // The person's own list is needed when there is something to be in (a public game), when the public list could not be
    // read, every 10 minutes for an account (private crews), and after a long time away.
    const own = !pub.ok || pub.games.length > 0 || ping.forceUser || (ping.account && now - ping.lastUserAt >= USER_EVERY);
    if (own) {
      ping.forceUser = false;
      ping.lastUserAt = now;
      const sent = Date.now();
      const r = await fetchList();
      // Only this answer knows the server's clock. The public copy can be a minute old.
      if (r.ok) {
        if (r.serverNow) noteServerTime(r.serverNow, sent, Date.now());
        ping.lastUser = { at: Date.now(), games: r.games };
      }
    }
    const games = merged(pub);
    if (games) publish(games);
    ping.lastReadAt = Date.now();
  } finally {
    ping.inflight = false;
  }
}

const gap = () => backoff(jitter(PUBLIC_EVERY), { max: PUBLIC_MAX });

function schedule(ms: number) {
  clearTimeout(ping.timer);
  ping.timer = setTimeout(cycle, ms);
}

async function cycle() {
  ping.timer = undefined;
  if (ping.refs <= 0 || hidden()) return; // the visibility handler wakes it
  await readOnce();
  if (ping.refs > 0 && !hidden()) schedule(gap());
}

function begin() {
  const onVisibility = () => {
    if (hidden()) {
      ping.hiddenAt = Date.now();
      clearTimeout(ping.timer);
      ping.timer = undefined;
      return;
    }
    const away = ping.hiddenAt ? Date.now() - ping.hiddenAt : 0;
    ping.hiddenAt = 0;
    if (away >= AWAY_LONG) ping.forceUser = true;
    const since = Date.now() - ping.lastReadAt;
    schedule(since > REREAD_GAP ? 0 : gap());
  };
  document.addEventListener("visibilitychange", onVisibility);
  ping.off = () => document.removeEventListener("visibilitychange", onVisibility);
  // A restart (a quiet page left or entered) does not read again inside 20 s of the last read.
  if (!hidden()) schedule(ping.lastReadAt ? Math.max(0, REREAD_GAP - (Date.now() - ping.lastReadAt)) : 0);
}

function end() {
  clearTimeout(ping.timer);
  ping.timer = undefined;
  ping.off?.();
  ping.off = null;
}

function acquire(): () => void {
  ping.refs += 1;
  if (ping.refs === 1) begin();
  return () => {
    ping.refs -= 1;
    if (ping.refs === 0) end();
  };
}

const subscribe = (fn: () => void) => {
  ping.listeners.add(fn);
  return () => {
    ping.listeners.delete(fn);
  };
};

/**
 * The global ping's feed, and the Crew tab's: Game Times that are about to open or live. One loop for the whole app (a
 * reference count), started only when the map has shown. Each turn reads the public list (a cached copy, no database);
 * the person's own game_time_list is asked only when a public game is listed, every 10 minutes for an account (private
 * crews), and after 5 minutes away. `enabled` gates it: nothing is asked before the Hopper has a session.
 */
export function usePingGames(enabled: boolean): GtListGame[] {
  const shown = useMapShown();
  const { hasAccount } = useSession();
  useEffect(() => {
    if (!enabled || !shown) return;
    ping.account = hasAccount;
    return acquire();
  }, [enabled, shown, hasAccount]);
  return useSyncExternalStore(
    subscribe,
    () => ping.games,
    () => NO_GAMES
  );
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
