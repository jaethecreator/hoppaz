"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { haptics } from "@/lib/haptics";
import { backoff, jitter } from "@/lib/idle";
import { sfx } from "@/lib/sound/sfx";
import { getSupabase } from "@/lib/supabase/client";
import { fetchState, searchObject, type StateResult } from "./api";
import { noteServerTime, serverNow } from "./clock";
import { NO_ME, useGameTime, type GtChip } from "./store";
import type { GtAnswer, GtFound, GtGame, GtMe, GtReason } from "./types";

/**
 * The Game Time controller: keeps the store (store.ts) true to the database for one room.
 *
 *   POLL       game_time_state about every 3.5 s while live and the feed is connected (2.5 s when it is not), about every 15 s
 *              before it opens (6 s in the last two minutes, 1.5 to 2.5 s in the last 20 s, and once at opens_at minus half a
 *              second and once just after, so GO and the server agree), every 45 s with no game. Each phone adds jitter, and
 *              the opening kicks add a spread of their own per phone, so 60 of them do not knock together. Nothing polls in
 *              a hidden tab, and a search answer (which already carries the count) pushes the next poll 3 s out.
 *   REALTIME   game_time_feed INSERT for this game: "Ada found a box" and the count drops at once. Polling is the net
 *              under it: a find missed by Realtime shows within a poll.
 *   SEARCH     one at a time; the answer is held for the 2 second animation; the gap is the server's retry_ms (3 s).
 *
 * One controller at a time: the room's chrome mount starts it and stops it. Everything else reads the store.
 */

const SEARCH_ANIMATION_MS = 2000;
const CHIP_MS = 2500;
const FEED_MS = 2500;
/** After my win the sheet rises when the burst has played. */
const WIN_SHEET_AT = 700;

type Ctl = {
  crewId: string;
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  kicks: ReturnType<typeof setTimeout>[];
  timers: Set<ReturnType<typeof setTimeout>>;
  inFlight: boolean;
  again: boolean;
  failures: number;
  sig: string;
  /** The phone's clock when this phone last changed the story itself (my win). A poll sent before it is stale. */
  localAt: number;
  seen: Set<number>;
  seenGame: string | null;
  recent: number[];
  /** Finds that arrived while my own search was out: one of them may be mine, so they wait for the answer. */
  held: GtFound[];
  channel: RealtimeChannel | null;
  channelGame: string | null;
  /** The feed channel is SUBSCRIBED: finds arrive by themselves, so polling can be slower. */
  feedLive: boolean;
  /** When the poll timer is due (phone clock), so an answer that already carries the count can push it out. */
  nextAt: number;
  /** A search answer carried the count and the feed tail: no scheduled poll before this (phone clock). */
  holdUntil: number;
  /** Where this phone lands in the 1.2 s after an opening or closing moment, set once per session. */
  spread: number;
  coolTimer: ReturnType<typeof setTimeout> | undefined;
  poll: () => void;
  /** Tell the room about the finds that waited for my answer (all but mine, which the caller has marked seen). */
  release: () => void;
};

let current: Ctl | null = null;
let seq = 0;

/**
 * Has this device shown the win sheet for this code? A win is claimed on the server before the answer travels back, so on
 * a bad connection the phone can miss it. A poll that later brings `me.code` opens the sheet once, unless this device
 * has shown it already (here or on an earlier visit). Keyed by game and code, so a second account on one phone still gets its own.
 */
const shown = new Set<string>();
const sheetKey = (gameId: string, code: string) => `hz-gt-won-${gameId}-${code}`;
function sheetSeen(gameId: string, code: string): boolean {
  if (shown.has(sheetKey(gameId, code))) return true;
  try {
    return localStorage.getItem(sheetKey(gameId, code)) === "1";
  } catch {
    return false;
  }
}
function markSheetSeen(gameId: string, code: string) {
  shown.add(sheetKey(gameId, code));
  try {
    localStorage.setItem(sheetKey(gameId, code), "1");
  } catch {
    /* storage blocked: it can open again on the next visit, which only shows the Hopper their own code */
  }
}

/** Change the store without holding on to it. */
const patch = (p: Parameters<ReturnType<typeof useGameTime.getState>["patch"]>[0]) => useGameTime.getState().patch(p);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function startGameTime(crewId: string): () => void {
  const store = useGameTime;
  store.getState().reset(crewId);
  const c: Ctl = {
    crewId,
    stopped: false,
    timer: undefined,
    kicks: [],
    timers: new Set(),
    inFlight: false,
    again: false,
    failures: 0,
    sig: "",
    localAt: 0,
    seen: new Set(),
    seenGame: null,
    recent: [],
    held: [],
    channel: null,
    channelGame: null,
    feedLive: false,
    nextAt: 0,
    holdUntil: 0,
    spread: Math.random() * 1200,
    coolTimer: undefined,
    poll: () => void poll(),
    release: () => {},
  };
  current = c;

  c.release = () => {
    const held = c.held.sort((a, b) => a.id - b.id);
    c.held = [];
    for (const f of held) announce(f);
  };

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      c.timers.delete(t);
      if (!c.stopped) fn();
    }, ms);
    c.timers.add(t);
    return t;
  };

  /* ---------------------------------------------------------------- feed -- */

  /** Someone else found a box (Realtime or a poll): a line under the banner, a puff where it was, the count down. */
  const announce = (f: GtFound) => {
    if (c.seen.has(f.id)) return;
    // My own claim is in the feed before my answer comes back. Hold every find until the answer says which one is mine.
    if (store.getState().searching) {
      if (!c.held.some((h) => h.id === f.id)) c.held.push(f);
      return;
    }
    c.seen.add(f.id);
    const st = store.getState();
    const now = Date.now();
    c.recent = [...c.recent.filter((t) => now - t < 5000), now];
    const k = ++seq;
    const name = (f.name || "Someone").toUpperCase();
    const last = f.boxes_left <= 0;
    const text = c.recent.length >= 3 ? `${c.recent.length} BOXES FOUND. ${f.boxes_left} LEFT.` : last ? `${name} FOUND THE LAST BOX.` : `${name} FOUND A BOX. ${f.boxes_left} LEFT.`;
    const feed = (c.recent.length >= 3 ? [] : st.feed).concat({ k, text }).slice(-2);
    const game = st.game;
    patch({
      feed,
      poofs: f.object ? [...st.poofs.filter((p) => p.object !== f.object), { k, object: f.object }] : st.poofs,
      game: game && game.status === "live" ? { ...game, boxes_left: Math.min(game.boxes_left, f.boxes_left) } : game,
    });
    later(FEED_MS, () => patch({ feed: store.getState().feed.filter((x) => x.k !== k) }));
    later(1000, () => patch({ poofs: store.getState().poofs.filter((p) => p.k !== k) }));
    if (last) {
      sfx.crowdEhn();
      later(150, () => c.poll());
    }
  };

  const handleFound = (game: GtGame) => {
    if (c.seenGame !== game.id) {
      // A game seen for the first time: what was found before I came is history, not news.
      c.seenGame = game.id;
      c.seen = new Set(game.found.map((f) => f.id));
      c.seen.add(game.feed_tail);
      return;
    }
    if (game.status !== "live") return;
    for (const f of [...game.found].sort((a, b) => a.id - b.id)) announce(f);
  };

  const ensureChannel = (gameId: string | null) => {
    if (gameId === c.channelGame) return;
    const sb = getSupabase();
    if (c.channel && sb) void sb.removeChannel(c.channel);
    c.channel = null;
    c.feedLive = false;
    c.channelGame = gameId;
    if (!sb || !gameId) return;
    c.channel = sb
      .channel(`game-time:${gameId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_time_feed", filter: `game_id=eq.${gameId}` }, (payload) => {
        const row = payload.new as { id?: number; name?: string; object_id?: string; boxes_left?: number; at?: string } | null;
        if (!row || typeof row.id !== "number" || c.stopped) return;
        announce({ id: row.id, at: row.at ?? new Date().toISOString(), name: row.name ?? "", object: row.object_id ?? "", boxes_left: Number(row.boxes_left) || 0 });
      })
      .subscribe((status) => {
        if (c.stopped) return;
        c.feedLive = status === "SUBSCRIBED";
      });
  };

  /* ---------------------------------------------------------------- poll -- */

  const nextDelay = () => {
    const game = store.getState().game;
    if (!game) return jitter(45_000);
    // Live with the feed connected, every find arrives by Realtime (and the last one, a search refusal or an answer with
    // an unseen feed line asks at once), and closes_at has its own kick: the poll is only a safety net. Without the feed
    // it is the only news, so it stays quick.
    if (game.status === "live") return jitter(c.feedLive ? 30_000 : 3000);
    if (game.status === "upcoming") {
      const ms = Date.parse(game.opens_at) - serverNow();
      if (ms <= 20_000) return 1500 + Math.round(Math.random() * 1000);
      if (ms <= 120_000) return jitter(6000);
      // Far from opening, a phone nobody has touched for a while asks less.
      return jitter(backoff(15_000, { max: 30_000 }));
    }
    return jitter(60_000);
  };

  /** Run the next poll after `ms` (not sooner than a later call says). */
  const arm = (ms: number) => {
    clearTimeout(c.timer);
    c.nextAt = Date.now() + ms;
    c.timer = setTimeout(poll, ms);
  };

  const kick = (game: GtGame | null) => {
    c.kicks.forEach(clearTimeout);
    c.kicks = [];
    if (!game) return;
    const at = (iso: string) => Date.parse(iso) - serverNow();
    if (game.status === "upcoming") {
      const ms = at(game.opens_at);
      // Every phone adds its own spread, so 60 of them do not ask in the same 100 ms at opens_at.
      if (ms > 700) c.kicks.push(setTimeout(c.poll, ms - 500 + c.spread));
      if (ms > -300) c.kicks.push(setTimeout(c.poll, Math.max(0, ms + 300 + c.spread)));
    } else if (game.status === "live") {
      const ms = at(game.closes_at);
      if (ms > 0) c.kicks.push(setTimeout(c.poll, ms + 250 + c.spread));
    }
  };

  const apply = (r: Extract<StateResult, { ok: true }>) => {
    const s = r.state;
    if (s) noteServerTime(s.server_now, r.sentAt, r.receivedAt);
    // An answer to a question asked before my own win would put the win back.
    if (r.sentAt < c.localAt) return;
    const game = s?.game ?? null;
    const me = s?.me ?? NO_ME;
    const st = store.getState();
    const sig = JSON.stringify([game, me]);
    if (sig !== c.sig || !st.ready || st.offline) {
      c.sig = sig;
      patch({ game, me, ready: true, offline: false });
    }
    if (game) handleFound(game);
    ensureChannel(game && game.status !== "over" ? game.id : null);
    kick(game);
    recoverWin(game, me);
  };

  /**
   * The database says this Hopper holds a code from this game, and no sheet has shown it on this device: the answer to
   * their winning search was lost on the way (Lagos mobile data). Open the sheet now and clear the "NO SIGNAL" chip.
   */
  const recoverWin = (game: GtGame | null, me: GtMe) => {
    if (!game || !me.code || sheetSeen(game.id, me.code)) return;
    const st = store.getState();
    // A search still out will bring its own answer; a sheet already up needs nothing.
    if (st.searching || st.win) return;
    markSheetSeen(game.id, me.code);
    patch({ win: { code: me.code, title: game.title, object: "", gameId: game.id, over: game.status === "over", fresh: true }, chip: null, cooling: false });
    sfx.motif("full");
    haptics.buzz("burstBig");
  };

  async function poll() {
    if (c.stopped) return;
    if (c.inFlight) {
      c.again = true;
      return;
    }
    clearTimeout(c.timer);
    c.timer = undefined;
    if (typeof document !== "undefined" && document.hidden) return; // the visibility handler wakes it
    c.inFlight = true;
    const r = await fetchState(c.crewId);
    c.inFlight = false;
    if (c.stopped) return;
    if (!r.ok) {
      c.failures += 1;
      patch({ offline: true });
      arm(Math.min(30_000, 3000 * 2 ** Math.min(c.failures - 1, 4)));
      return;
    }
    c.failures = 0;
    apply(r);
    if (c.again) {
      c.again = false;
      arm(100);
      return;
    }
    // A search answered a moment ago already told this phone the count: that poll is not due before its 3 s are up.
    arm(Math.max(nextDelay(), c.holdUntil - Date.now()));
  }

  const onVisible = () => {
    if (!document.hidden) void poll();
  };
  const onOnline = () => void poll();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  void poll();

  return () => {
    c.stopped = true;
    clearTimeout(c.timer);
    clearTimeout(c.coolTimer);
    c.kicks.forEach(clearTimeout);
    c.timers.forEach(clearTimeout);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    const sb = getSupabase();
    if (c.channel && sb) void sb.removeChannel(c.channel);
    if (current === c) {
      current = null;
      store.getState().reset(null);
    }
  };
}

/** Ask the database now (after a search that learned the room moved on). */
export function refreshGameTime() {
  current?.poll();
}

/* ---------------------------------------------------------------- search -- */

const REFUSED: Record<GtReason, { text: string; tone: GtChip["tone"]; refresh?: boolean }> = {
  need_account: { text: "SIGN UP TO HUNT", tone: "warn" },
  need_confirmed: { text: "CONFIRM YOUR EMAIL TO HUNT", tone: "warn", refresh: true },
  joined_late: { text: "YOU JOINED TOO LATE. WATCH.", tone: "info", refresh: true },
  not_in_crew: { text: "JOIN THE CREW TO HUNT", tone: "warn" },
  no_game: { text: "NOTHING IS ON", tone: "info", refresh: true },
  not_open_yet: { text: "NOT OPEN YET", tone: "info", refresh: true },
  all_found: { text: "TOO LATE. IT'S OVER.", tone: "info", refresh: true },
  game_closed: { text: "TOO LATE. IT'S OVER.", tone: "info", refresh: true },
  already_won: { text: "YOU ALREADY GOT ONE.", tone: "info", refresh: true },
  room_changed: { text: "CAN'T SEARCH HERE", tone: "info", refresh: true },
  unknown_object: { text: "CAN'T SEARCH HERE", tone: "info", refresh: true },
  not_in_room: { text: "GET CLOSER", tone: "warn" },
  too_far: { text: "GET CLOSER", tone: "warn" },
  slow_down: { text: "SLOW DOWN", tone: "warn" },
  // Offline and busy ask the database at once: a search that reached it may have won, and the poll brings the code back.
  busy: { text: "BUSY. TRY AGAIN.", tone: "warn", refresh: true },
  offline: { text: "NO SIGNAL. TRY AGAIN.", tone: "warn", refresh: true },
  unknown: { text: "CAN'T SEARCH HERE", tone: "info" },
};

/** A chip over an object that goes by itself. */
export function showChip(object: string, tone: GtChip["tone"], text: string, ms = CHIP_MS) {
  const store = useGameTime;
  const k = ++seq;
  patch({ chip: { k, object, tone, text } });
  const c = current;
  const t = setTimeout(() => {
    if (store.getState().chip?.k === k) patch({ chip: null });
  }, ms);
  c?.timers.add(t);
}

/**
 * The one verb. The caller has already checked that I stand next to the object; the server checks again from its own copy
 * of my tile. Press while a search runs or the gap is on, and it says SLOW DOWN instead of asking the server.
 */
export function pressSearch(object: string) {
  const c = current;
  if (!c || c.stopped) return;
  const st = useGameTime.getState();
  if (st.searching) return;
  if (st.cooling) {
    showChip(object, "warn", "SLOW DOWN", 1500);
    return;
  }
  void run(c, object);
}

async function run(c: Ctl, object: string) {
  clearTimeout(c.coolTimer);
  patch({ searching: { object }, cooling: true, chip: null });
  sfx.swish();
  const t0 = performance.now();
  let callAt = Date.now();
  let a = await searchObject(c.crewId, object);
  // The server's copy of my tile can lag a walk by a moment: ask once more before saying GET CLOSER.
  if (a.kind === "refused" && (a.reason === "too_far" || a.reason === "not_in_room") && !c.stopped) {
    await sleep(400);
    callAt = Date.now();
    a = await searchObject(c.crewId, object);
  }
  if (c.stopped) return;
  const wait = SEARCH_ANIMATION_MS - (performance.now() - t0);
  if (wait > 0) await sleep(wait);
  if (c.stopped) return;
  patch({ searching: null });

  // The gap: the server's retry_ms after a counted search; a refused search does not use the gap up.
  const gap = a.kind === "refused" ? (a.reason === "slow_down" ? a.waitMs || 1500 : a.reason === "offline" || a.reason === "busy" ? 800 : 350) : a.retryMs;
  const remaining = callAt + gap - Date.now();
  if (remaining > 0) c.coolTimer = setTimeout(() => patch({ cooling: false }), remaining);
  else patch({ cooling: false });
  reveal(c, object, a);
}

const HINT = {
  cold: { text: "NOTHING HERE · COLD", sound: () => sfx.tick(0), buzz: "refused" as const },
  warm: { text: "NOTHING HERE · WARM", sound: () => sfx.chime(1), buzz: "snap" as const },
  hot: { text: "NOTHING HERE · HOT", sound: () => sfx.sparkle(), buzz: "quest" as const },
};

function reveal(c: Ctl, object: string, a: GtAnswer) {
  const store = useGameTime;
  const st = store.getState();
  // My win is the newest feed row when the answer was made; it is mine, not news. Everything else waiting is news.
  if (a.kind === "win") c.seen.add(a.tail);
  c.release();

  // A counted search answer carries boxes_left and the feed tail, so the poll that was about to ask the same thing can wait.
  if (a.kind !== "refused") {
    c.holdUntil = Date.now() + 3000;
    if (c.timer && c.nextAt < c.holdUntil) {
      clearTimeout(c.timer);
      c.nextAt = c.holdUntil;
      c.timer = setTimeout(c.poll, 3000);
    }
  }

  if (a.kind === "nothing") {
    const h = HINT[a.hint];
    showChip(a.object || object, a.hint, h.text);
    h.sound();
    haptics.buzz(h.buzz);
    if (st.game && a.boxesLeft < st.game.boxes_left) patch({ game: { ...st.game, boxes_left: a.boxesLeft } });
    // Someone found a box while I was looking: the feed knows more than I do.
    if (a.tail > 0 && !c.seen.has(a.tail)) c.poll();
    return;
  }

  if (a.kind === "win") {
    const k = ++seq;
    c.localAt = Date.now();
    c.seen.add(a.tail);
    markSheetSeen(a.gameId, a.code);
    const game = st.game;
    patch({
      burst: { k, object: a.object },
      chip: null,
      me: { ...st.me, won: true, code: a.code, won_at: a.wonAt, can_search: false },
      game: game
        ? {
            ...game,
            boxes_left: a.boxesLeft,
            ...(a.gameOver ? { status: "over" as const, over_reason: "all_found" as const, ended_at: a.wonAt, objects: [] } : {}),
          }
        : game,
    });
    const title = a.title || game?.title || "Game Time";
    const timer = setTimeout(() => {
      if (c.stopped) return;
      patch({ win: { code: a.code, title, object: a.object, gameId: a.gameId, over: a.gameOver, fresh: true } });
      sfx.motif("full");
      haptics.buzz("burstBig");
    }, WIN_SHEET_AT);
    c.timers.add(timer);
    c.timers.add(setTimeout(() => patch({ burst: null }), 1600));
    c.timers.add(setTimeout(() => c.poll(), 400));
    return;
  }

  const r = REFUSED[a.reason] ?? REFUSED.unknown;
  showChip(object, r.tone, r.text, a.reason === "slow_down" ? 1500 : CHIP_MS);
  if (a.reason === "too_far" || a.reason === "not_in_room") haptics.buzz("refused");
  if (r.refresh) c.poll();
}

/** Close the win sheet. */
export function closeWin() {
  useGameTime.getState().patch({ win: null });
}

/** Open my ticket again from the banner. Nothing to show when this account has no code from this game. */
export function openTicket() {
  const { me, game, win } = useGameTime.getState();
  if (win || !me.code) return;
  if (game) markSheetSeen(game.id, me.code);
  useGameTime.getState().patch({ win: { code: me.code, title: game?.title ?? "Game Time", object: "", gameId: game?.id ?? "", over: game?.status === "over", fresh: false } });
}

/** The countdown reached opening: every star bursts once (the world layer watches `go`). */
export function announceGo() {
  const st = useGameTime.getState();
  st.patch({ go: st.go + 1 });
}
