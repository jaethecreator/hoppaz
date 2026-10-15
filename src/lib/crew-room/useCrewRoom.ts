"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useNamedPeers } from "./chatNames";
import type { CampaignContent } from "@/lib/campaign/layout";
import type { Tile } from "@/lib/campaign/geometry";
import type { CrewRoomConnection, PositionReset, RoomMessage, RoomSnapshot, RoomStatus, Thread } from "./types";

/**
 * One crew room, live: the walker, everyone else in the room, and its conversations. The server decides every
 * position, area and audience (supabase/crew_rooms.sql); nothing private travels by client broadcast.
 *
 * Presence. Steps go up in batches of up to 8 tiles; a walker standing still beats every 10 s and the server keeps
 * them 45 s, so a phone screen lock or a quick look at another app keeps the avatar. Coming back to the page beats at
 * once: the same session carries on, or (gone too long) the room is entered again with nothing lost. Closing the page
 * leaves straight away (a keepalive request), so nobody is left standing in the room. A second tab takes the walker
 * over: this one is told ("replaced") and can take it back with one tap. A full room is entered to watch: the room
 * stays live and General works, and a spot is tried for every 15 s.
 *
 * Conversations. General and each area session are separate threads, each read a page at a time (older pages on
 * request). New messages arrive in the Realtime payload (RLS decides who gets an area message) and are added to their
 * thread; a small catch-up read every 20 s, and after every send, covers a dropped event.
 */

const MESSAGE_COLUMNS = "id,crew_id,author_id,author_name,author_look,body,scope,circle_id,created_at";
/** Messages per page of history. */
const PAGE = 40;
/** The movement queue is looked at this often (ms). */
const TICK = 200;
/** A walker standing still beats this often (ms). The server keeps a walker 45 s after the last one (_crew_room_ttl). */
const BEAT = 10_000;
/** The room is read when nothing has brought a snapshot for this long (ms). Not while the page is hidden. */
const READ = 1_500;
/** Someone watching a full room tries for a walking spot this often (ms). */
const WATCH_RETRY = 15_000;
/** Newer messages are read this often (ms), in case Realtime dropped one. */
const CATCH_UP = 20_000;
/** After a failed request, wait this long (ms). */
const BACKOFF = 2_000;

/** A message's thread: "general", or its area session. */
export const threadOf = (scope: "general" | "nearby", circle: string | null) => (scope === "general" ? "general" : circle);

/** The reasons the screen tells apart. */
const CODES = ["not_in_crew", "need_account", "room_session_replaced"];

/** Strict Mode and quick route changes can overlap entries: an old entry (and its matching leave) finishes first. */
const entries = new Map<string, Promise<void>>();

function explain(message = "") {
  if (message.includes("not_in_crew")) return "Join this crew to walk into its room.";
  if (message.includes("need_account")) return "Sign in to enter your crew room.";
  if (message.includes("room_session_replaced")) return "You opened this room in another tab or on another phone, so it paused here.";
  if (message.includes("conversation_changed")) return "You left that conversation area. Walk back in before sending.";
  if (message.includes("slow_down")) return "Give the conversation a moment, then try again.";
  if (message.includes("owner_only")) return "Only the crew owner can change this room.";
  if (/PGRST202|function .*does not exist/.test(message)) return "Crew rooms are not installed on this database yet.";
  return "The room could not connect. Your message is kept, so you can try again.";
}

/**
 * Microseconds since 1970 for a Postgres time, from REST ("2026-10-14T19:31:00.123456+00:00") or a Realtime payload
 * ("2026-10-14 19:31:00.123456+00"), so both sort the same way and a page boundary loses nothing.
 */
function micros(at: string) {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(at);
  if (!m) return Date.parse(at) * 1000;
  let zone = m[4] ?? "Z";
  if (/^[+-]\d\d$/.test(zone)) zone += ":00";
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}${zone}`) * 1000 + Number((m[3] ?? "").padEnd(6, "0"));
}
/** The same instant written for a filter, to the microsecond, in UTC. */
function filterTime(us: number) {
  const seconds = Math.floor(us / 1e6);
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}.${String(us - seconds * 1e6).padStart(6, "0")}+00:00`;
}
const byTime = (a: RoomMessage, b: RoomMessage) => micros(a.created_at) - micros(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const EMPTY_THREAD: Thread = { items: [], more: true, loading: false, loaded: false };

/** Add messages to a thread (no duplicates, oldest first) and change its flags. */
function merge(all: Record<string, Thread>, key: string, add: RoomMessage[], flags: Partial<Thread> = {}) {
  const was = all[key] ?? EMPTY_THREAD;
  const byId = new Map(was.items.map((m) => [m.id, m]));
  add.forEach((m) => byId.set(m.id, m));
  return { ...all, [key]: { ...was, ...flags, items: add.length ? [...byId.values()].sort(byTime) : was.items } };
}

export function useCrewRoom(crewId: string, userId: string | null): CrewRoomConnection {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState<PositionReset>({ x: 15, y: 17, revision: 0 });
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<Tile[]>([]);
  const batch = useRef<{ steps: Tile[]; seq: number } | null>(null);
  /** Steps are taken (a walker, connected). Off while watching, reconnecting or replaced. */
  const walking = useRef(false);
  const sequence = useRef(0);
  const version = useRef(0);
  const current = useRef<RoomSnapshot | null>(null);
  const threadsRef = useRef(threads);
  const readRoom = useRef<() => void>(() => {});
  const applySnapshot = useRef<(data: RoomSnapshot) => void>(() => {});
  const pendingSend = useRef<{ scope: string; text: string; circle: string | null; id: string } | null>(null);
  threadsRef.current = threads;

  // ------------------------------------------------------------ presence --
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) {
      setStatus("error");
      setReason("need_account");
      setError(explain("need_account"));
      return;
    }
    let stopped = false;
    /** This tab's walker session; "" while watching, entering or out. */
    let session = "";
    let watch = false;
    let entering = false;
    let flushing = false;
    let reading = false;
    let lastSnap = 0;
    let lastBeat = 0;
    let lastTry = 0;
    let retryAt = 0;
    /** Where the server last said this walker stands. Steps I have taken but it has not heard of yet are ahead of it. */
    let ack: Tile | null = null;
    /** The steps in hand were thrown away (the server refused them): the next snapshot says where I stand, whatever it is. */
    let resync = false;
    let token: string | null = null;
    walking.current = false;
    queue.current = [];
    batch.current = null;
    version.current = 0;
    sequence.current = 0;
    current.current = null;
    setSnapshot(null);
    setStatus("loading");
    setReason("");
    setError("");
    setWatching(false);

    const stop = (next: RoomStatus, why: string) => {
      session = "";
      walking.current = false;
      setConnected(false);
      setStatus(next);
      setReason(CODES.find((code) => why.includes(code)) ?? "unavailable");
      setError(explain(why));
    };

    const apply = (data: RoomSnapshot, force = false) => {
      if (stopped || !data || data.room.version < version.current) return;
      if (!force && (entering || (current.current && data.observed_at < current.current.observed_at))) return;
      if (session && !data.self) {
        // Gone too long (a locked phone): walk back in. Drafts and threads are untouched.
        session = "";
        walking.current = false;
        void enter();
        return;
      }
      if (session && data.self && data.self.session_id !== session) {
        stop("replaced", "room_session_replaced");
        return;
      }
      if (data.self) {
        const at = data.self;
        // The room's version moves for every owner edit (a caption, the fountain's ribbon), and the server's position is
        // always a little behind mine while I walk. Neither is a reason to move anyone. I am put on the server's tile only
        // when it is not a tile I have walked (or am about to be told I walked): it was moved (a new width or template sends
        // everyone to the entrance), I entered again, or the steps in hand were refused.
        const ahead = (t: Tile) => t.x === at.x && t.y === at.y;
        const known = !!ack && (ahead(ack) || !!batch.current?.steps.some(ahead) || queue.current.some(ahead));
        if (force || resync || !known) {
          queue.current = [];
          batch.current = null;
          resync = false;
          sequence.current = at.seq;
          setReset((old) => ({ x: at.x, y: at.y, revision: old.revision + 1 }));
        }
        ack = { x: at.x, y: at.y };
      }
      version.current = data.room.version;
      current.current = data;
      lastSnap = Date.now();
      setSnapshot(data);
    };
    applySnapshot.current = (data) => apply(data);

    const enter = async () => {
      if (stopped || entering) return;
      entering = true;
      lastTry = Date.now();
      const next = crypto.randomUUID();
      try {
        const { data, error: problem } = await sb.rpc("crew_room_enter", { p_crew: crewId, p_session: next });
        if (stopped) {
          if (data && !problem && (data as RoomSnapshot).self) await sb.rpc("crew_room_leave", { p_crew: crewId, p_session: next });
          return;
        }
        if (problem || !data) {
          const why = problem?.message ?? "";
          // A first entry that fails shows the gate; a rejoin keeps the room on screen and tries again.
          if (!current.current || /not_in_crew|need_account|PGRST202|does not exist/.test(why)) stop("error", why);
          else {
            retryAt = Date.now() + BACKOFF;
            setConnected(false);
          }
          return;
        }
        const snap = data as RoomSnapshot;
        watch = !!snap.watching;
        session = watch ? "" : next;
        walking.current = !watch;
        lastBeat = Date.now();
        entering = false;
        apply(snap, true);
        setWatching(watch);
        if (snap.took_over) setNotice("You had this room open somewhere else. It's here now, and the other one has paused.");
        setConnected(true);
        setStatus("ready");
        setReason("");
        setError("");
      } catch {
        if (stopped) return;
        if (!current.current) stop("error", "");
        else retryAt = Date.now() + BACKOFF;
      } finally {
        entering = false;
      }
    };

    const read = async () => {
      if (stopped || reading || entering || !current.current) return;
      reading = true;
      try {
        const { data, error: problem } = await sb.rpc("crew_room_state", { p_crew: crewId });
        if (stopped) return;
        if (problem) {
          if (/not_in_crew|need_account/.test(problem.message)) stop("error", problem.message);
          return;
        }
        if (data) apply(data as RoomSnapshot);
      } catch {
        /* the next read catches up; the heartbeat decides whether we are connected */
      } finally {
        reading = false;
      }
    };
    readRoom.current = () => void read();

    const flush = async () => {
      if (stopped || flushing || entering || !session || Date.now() < retryAt) return;
      if (!batch.current && !queue.current.length && Date.now() - lastBeat < BEAT) return;
      flushing = true;
      if (!batch.current) batch.current = { steps: queue.current.slice(0, 8), seq: sequence.current + (queue.current.length ? 1 : 0) };
      const request = batch.current;
      const mine = session;
      try {
        const { data, error: problem } = await sb.rpc("crew_room_step", {
          p_crew: crewId,
          p_session: mine,
          p_seq: request.seq,
          p_steps: request.steps,
        });
        if (stopped || entering || mine !== session) return;
        if (problem) {
          if (/room_session_expired/.test(problem.message)) {
            queue.current = [];
            batch.current = null;
            session = "";
            walking.current = false;
            void enter();
          } else if (/room_session_replaced/.test(problem.message)) stop("replaced", problem.message);
          else if (/not_in_crew|need_account/.test(problem.message)) stop("error", problem.message);
          else if (/invalid_movement|invalid_sequence|moving_too_fast/.test(problem.message)) {
            // The server and this phone disagree about where I stand. Drop the steps in hand, take no more until the server
            // has said where I am, and stand there.
            queue.current = [];
            batch.current = null;
            resync = true;
            walking.current = false;
            const fresh = await sb.rpc("crew_room_state", { p_crew: crewId });
            if (!stopped && mine === session && fresh.data) {
              apply(fresh.data as RoomSnapshot, true);
              walking.current = !!session;
            } else {
              // No answer: the next beat asks again.
              retryAt = Date.now() + BACKOFF;
              lastBeat = 0;
            }
          } else {
            walking.current = false;
            setConnected(false);
            retryAt = Date.now() + BACKOFF;
          }
          return;
        }
        const snap = data as RoomSnapshot;
        // The server has these steps now: its position is where the batch ended, which is not "behind" me any more.
        if (snap.self && snap.room.version >= version.current && !resync) ack = { x: snap.self.x, y: snap.self.y };
        if (batch.current === request) {
          queue.current.splice(0, request.steps.length);
          batch.current = null;
        }
        if (snap.room.version >= version.current && snap.self) sequence.current = snap.self.seq;
        lastBeat = Date.now();
        apply(snap);
        walking.current = !!session;
        setConnected(true);
      } catch {
        walking.current = false;
        setConnected(false);
        retryAt = Date.now() + BACKOFF;
      } finally {
        flushing = false;
      }
    };

    // The first entry waits for an overlapping one (and its leave) to finish.
    const entry = (entries.get(crewId) ?? Promise.resolve()).then(enter);
    entries.set(crewId, entry);
    void entry.then(() => {
      if (entries.get(crewId) === entry) entries.delete(crewId);
    });

    const clock = setInterval(() => {
      void flush();
      if (!document.hidden && Date.now() - lastSnap > READ) void read();
      if (watch && !entering && Date.now() - lastTry > WATCH_RETRY) void enter();
    }, TICK);

    // Back from a locked phone or another app: beat and read now. The beat carries on the same session, or finds it
    // expired and walks back in.
    const onVisible = () => {
      if (document.hidden) return;
      lastBeat = 0;
      lastSnap = 0;
      retryAt = 0;
    };
    // Closing the page or leaving the site: leave now (keepalive outlives the page), so no avatar is left behind.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    void sb.auth.getSession().then(({ data }) => {
      token = data.session?.access_token ?? null;
    });
    const { data: auth } = sb.auth.onAuthStateChange((_event, s) => {
      token = s?.access_token ?? null;
    });
    const onPageHide = () => {
      if (!session || !token || !url || !key) return;
      try {
        void fetch(`${url}/rest/v1/rpc/crew_room_leave`, {
          method: "POST",
          keepalive: true,
          headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_crew: crewId, p_session: session }),
        }).catch(() => {});
      } catch {
        /* the 45 s expiry covers it */
      }
      session = "";
      walking.current = false;
    };
    // Back from the browser's page cache after that leave: walk in again.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !session && !watch) void enter();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      stopped = true;
      walking.current = false;
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      auth.subscription.unsubscribe();
      if (session) void sb.rpc("crew_room_leave", { p_crew: crewId, p_session: session }).then(() => {});
    };
  }, [crewId, userId, attempt]);

  // --------------------------------------------------------- conversations --
  // Threads belong to this crew and this Hopper; a rejoin keeps them.
  useEffect(() => {
    setThreads({});
    pendingSend.current = null;
  }, [crewId, userId]);

  /** Read one thread: its latest page ("first"), the page before what is loaded ("earlier"), or what is new ("newer"). */
  const fetchThread = useCallback(
    async (key: string, mode: "first" | "earlier" | "newer") => {
      const sb = getSupabase();
      if (!sb) return;
      const have = threadsRef.current[key];
      if (mode === "newer" && !have?.items.length) mode = "first";
      if (mode !== "newer" && have?.loading) return;
      if (mode === "earlier" && (!have?.more || !have.items.length)) return;
      if (mode !== "newer") setThreads((all) => merge(all, key, [], { loading: true }));
      try {
        const newest = mode === "newer";
        for (let round = 0; round < (newest ? 3 : 1); round++) {
          let q = sb.from("crew_room_messages").select(MESSAGE_COLUMNS).eq("crew_id", crewId);
          q = key === "general" ? q.eq("scope", "general") : q.eq("scope", "nearby").eq("circle_id", key);
          const items = threadsRef.current[key]?.items ?? [];
          if (mode === "earlier") {
            const first = items[0];
            const at = filterTime(micros(first.created_at));
            q = q.or(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${first.id})`);
          } else if (newest) {
            q = q.gte("created_at", filterTime(micros(items[items.length - 1].created_at)));
          }
          const { data, error: problem } = await q
            .order("created_at", { ascending: newest })
            .order("id", { ascending: newest })
            .limit(PAGE);
          if (problem) throw problem;
          const rows = (data ?? []) as RoomMessage[];
          const full = rows.length === PAGE;
          setThreads((all) => {
            const next = merge(all, key, rows, newest ? {} : { loading: false, loaded: true, more: full });
            threadsRef.current = next;
            return next;
          });
          if (!newest || !full) break;
        }
      } catch {
        if (mode !== "newer") setThreads((all) => merge(all, key, [], { loading: false }));
      }
    },
    [crewId]
  );

  const inside = status === "ready";
  const circleId = snapshot?.self?.circle_id ?? null;

  useEffect(() => {
    if (!inside) return;
    const sb = getSupabase();
    if (!sb) return;
    let stopped = false;
    const catchUp = () => {
      if (stopped || document.hidden) return;
      const area = current.current?.self?.circle_id;
      [...new Set(["general", ...(area ? [area] : [])])].forEach((key) => void fetchThread(key, threadsRef.current[key]?.loaded ? "newer" : "first"));
    };
    const channel = sb
      .channel(`crew-room:${crewId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_room_messages", filter: `crew_id=eq.${crewId}` }, (payload) => {
        const m = payload.new as RoomMessage;
        const key = threadOf(m.scope, m.circle_id);
        if (!stopped && key) setThreads((all) => merge(all, key, [m]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crew_rooms", filter: `crew_id=eq.${crewId}` }, () =>
        readRoom.current()
      )
      // Subscribed, or back after a dropped connection: read what may have been missed.
      .subscribe((state) => {
        if (state === "SUBSCRIBED") catchUp();
      });
    const timer = setInterval(catchUp, CATCH_UP);
    const onVisible = () => {
      if (!document.hidden) catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [inside, crewId, fetchThread]);

  // Walking into an area: read its session's history (what this Hopper received).
  useEffect(() => {
    if (inside && circleId && !threadsRef.current[circleId]?.loaded) void fetchThread(circleId, "first");
  }, [inside, circleId, fetchThread]);

  // ----------------------------------------------------------- the calls --
  const onStep = useCallback((tile: Tile) => {
    if (!walking.current || queue.current.length >= 8) return false;
    queue.current.push(tile);
    return true;
  }, []);

  const send = useCallback(
    async (scope: "general" | "nearby", text: string, circle: string | null) => {
      const sb = getSupabase();
      if (!sb || !current.current) return "The room is reconnecting. Your message is still here.";
      if (scope === "nearby") {
        if (!current.current.self) return "Area chats are for people walking in the room. General is open to you.";
        if (!walking.current) return "The room is reconnecting. Your message is still here.";
        // Still walking: the area is decided by where the walk ends, so wait for it (a few seconds at most).
        const end = Date.now() + 4000;
        while ((queue.current.length || batch.current?.steps.length) && Date.now() < end) await new Promise((r) => setTimeout(r, 120));
        if (queue.current.length || batch.current?.steps.length) return "Finishing your move. Send once your position has updated.";
      }
      const previous = pendingSend.current;
      const request =
        previous && previous.scope === scope && previous.text === text && previous.circle === circle
          ? previous
          : { scope, text, circle, id: crypto.randomUUID() };
      pendingSend.current = request;
      try {
        const { error: problem } = await sb.rpc("crew_room_send", {
          p_crew: crewId,
          p_scope: scope,
          p_body: text,
          p_request: request.id,
          p_circle: circle,
        });
        if (problem) return explain(problem.message);
      } catch {
        return explain();
      }
      pendingSend.current = null;
      const key = threadOf(scope, circle);
      if (key) void fetchThread(key, "newer");
      return null;
    },
    [crewId, fetchThread]
  );

  const save = useCallback(
    async (width: 30 | 36, content: CampaignContent) => {
      const sb = getSupabase();
      if (!sb) return "The room is offline. Try again when connected.";
      const { data, error: problem } = await sb.rpc("crew_room_settings", { p_crew: crewId, p_width: width, p_content: content });
      if (problem) return explain(problem.message);
      if (data) applySnapshot.current(data as RoomSnapshot);
      return null;
    },
    [crewId]
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const dismissNotice = useCallback(() => setNotice(""), []);
  const loadEarlier = useCallback((key: string) => void fetchThread(key, "earlier"), [fetchThread]);

  // The server names a Hopper with no display name "A crew member"; fill those in from their handle (chatNames.ts).
  const namedPeers = useNamedPeers(snapshot?.peers);
  const shown = useMemo(() => (snapshot && namedPeers && namedPeers !== snapshot.peers ? { ...snapshot, peers: namedPeers } : snapshot), [snapshot, namedPeers]);

  return {
    snapshot: shown,
    status,
    reason,
    error,
    connected,
    watching,
    notice,
    dismissNotice,
    retry,
    threads,
    loadEarlier,
    send,
    save,
    world:
      shown && userId
        ? {
            peers: shown.peers,
            circles: shown.circles,
            selfId: userId,
            circleId,
            areaId: shown.circles.find((c) => c.id === circleId)?.area_id ?? null,
            watching,
            observedAt: shown.observed_at,
            reset,
            onStep,
          }
        : null,
  };
}
