"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { idleMs } from "@/lib/idle";
import { getSupabase } from "@/lib/supabase/client";
import { useNamedPeers } from "./chatNames";
import type { CampaignContent } from "@/lib/campaign/layout";
import type { Tile } from "@/lib/campaign/geometry";
import type { CrewRoomConnection, PositionReset, RoomMessage, RoomPeer, RoomSnapshot, RoomStatus, Thread } from "./types";

/**
 * One crew room, live: the walker, everyone else in the room, and its conversations. The server decides every
 * position, area and audience (supabase/crew_rooms.sql, supabase/crew_rooms_scale.sql); nothing private travels by
 * client broadcast.
 *
 * Presence. Steps go up in batches of up to 16 tiles (crew_room_move), sent when 10 are waiting, the oldest has waited
 * 1 s, or the walker has stopped; the answer is only where I stand. A walker standing still beats every 15 s and the
 * server keeps them 45 s, so a phone screen lock or a quick look at another app keeps the avatar. Coming back to the page beats at
 * once: the same session carries on, or (gone too long) the room is entered again with nothing lost. Closing the page
 * leaves straight away (a keepalive request), so nobody is left standing in the room. A second tab takes the walker
 * over: this one is told ("replaced") and can take it back with one tap. A full room is entered to watch: the room
 * stays live and General works, and a spot is tried for when the room has one (every 15 to 45 s). A call that fails is
 * tried again after 2, 4, 8, 16, then 30 s, each spread 0.5x to 1.5x, so a slow database is not asked again by every
 * phone at once.
 *
 * The room. crew_room_tick answers only what changed since this phone's last read: the walkers who moved, names and
 * looks for new arrivals, the walker list when someone left, the owner's content when it changed. It is read every
 * 2.5 s with company and a hand on the screen, 5 s then 10 s as the person goes idle, 10 s alone, each gap spread 20%
 * either way so a full room does not knock together. An owner's edit arrives in the Realtime payload, so nobody reads
 * for it. A database without crew_rooms_scale.sql gets the calls of earlier versions (crew_room_step, crew_room_state).
 *
 * Conversations. General and each area session are separate threads, each read a page at a time (older pages on
 * request). New messages arrive in the Realtime payload (RLS decides who gets an area message) and are added to their
 * thread; a small catch-up read every 30 s (10 s while the channel is down), and after every send, covers a dropped event.
 */

const MESSAGE_COLUMNS = "id,crew_id,author_id,author_name,author_look,body,scope,circle_id,created_at";
/** Messages per page of history. */
const PAGE = 40;
/** The movement queue is looked at this often (ms). */
const TICK = 200;
/** A walker standing still beats this often (ms). The server keeps a walker 45 s after the last one (_crew_room_ttl). */
const BEAT = 15_000;
/**
 * Steps go up when this many tiles are waiting, the oldest has waited FLUSH_AGE (ms), or no new tile came for SETTLE
 * (ms): the walker stopped, so the server knows where I stand before I search or talk. The walker makes about 11 a
 * second, so a long walk is about one call a second.
 */
const FLUSH_TILES = 10;
const FLUSH_AGE = 1000;
const SETTLE = 150;
/** Tiles in one batch (crew_room_move takes 16, the older crew_room_step 8). The walker waits when this many are queued. */
const MAX_BATCH = 16;
const LEGACY_BATCH = 8;
/** A walker with no beat for this long is drawn as away (CampaignWorld's AWAY is 25 s). */
const AWAY_MS = 30_000;

/**
 * The room is read when nothing has brought a snapshot for this long (ms). Not while the page is hidden. Alone in the room
 * there is nothing to see move; with company, how fast depends on whether the person is doing anything.
 */
function readGap(peers: number, lastStepAt: number) {
  if (peers <= 1) return 10_000;
  const touched = Math.min(idleMs(), Date.now() - lastStepAt);
  // 16 Oct 2026: 2.5 s for an active Hopper was too dear with a full room on a small database (the 360Playlist night).
  return touched < 30_000 ? 4_000 : touched < 180_000 ? 8_000 : 15_000;
}
/** Someone watching a full room tries for a walking spot only when the room has one, and at most every 15 to 45 s. */
const watchGap = () => 15_000 + Math.random() * 30_000;
/** Newer messages are read this often (ms), in case Realtime dropped one: rarely while the channel is up, soon when it is not. */
const CATCH_UP = 30_000;
const CATCH_UP_DOWN = 10_000;
/** After a failed request, wait this long (ms), doubling with each failure in a row up to 30 s. */
const BACKOFF = 2_000;
/** Each wait is spread 0.5x to 1.5x, so phones that failed together (a slow database) do not all ask again together. */
const backoff = (fails: number) => Math.min(30_000, BACKOFF * 2 ** Math.max(0, fails - 1)) * (0.5 + Math.random());
/** The whole room is read again about this often (ms), so a block, a new look or anything missed cannot stay wrong for long. */
const FULL_READ = 120_000;

/** A walker in a crew_room_tick answer: [id, x, y, circle_id], with [name, look] added for someone new to this phone. */
type TickPeer = [string, number, number, string | null, string?, unknown?];
/** What crew_room_tick hands back (supabase/crew_rooms_scale.sql). */
type RoomTick = {
  at: number;
  full: boolean;
  version: number;
  room: RoomSnapshot["room"] | null;
  crew: RoomSnapshot["crew"] | null;
  walkers: number;
  ids: string[] | null;
  moved: TickPeer[];
  away: string[];
  self: RoomSnapshot["self"];
  circles: RoomSnapshot["circles"];
};
/** What crew_room_move hands back. */
type MoveAnswer = { seq: number; x: number; y: number; circle_id: string | null };
/** The owner's room row, as the Realtime payload of a crew_rooms update carries it. */
type RoomRow = Partial<RoomSnapshot["room"]> & { template?: string; version?: number };

/** The database has no crew_rooms_scale.sql yet: use the calls of earlier versions. */
const missing = (message = "") => /PGRST202|Could not find the function|function .*does not exist/.test(message);
const byPeerId = (a: RoomPeer, b: RoomPeer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
  /** The owner changed the room (the Realtime payload of the crew_rooms row). */
  const roomChanged = useRef<(row: RoomRow) => void>(() => {});
  /** When the walker last took a step (phone clock): a walker is not idle. */
  const lastStepAt = useRef(0);
  /** When the oldest tile in the queue was added (phone clock). */
  const queuedAt = useRef(0);
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
    /** Spread on the read gap, drawn again after each read (+/-20%). */
    let spread = 1;
    let lastBeat = 0;
    /** Failures in a row and the time before which nobody asks again: reads, steps, walking back in. */
    let readFails = 0;
    let readAfter = 0;
    let flushFails = 0;
    let retryAt = 0;
    let rejoinFails = 0;
    let rejoinAt = 0;
    /** A watcher's next try for a walking spot; the next whole-room read. */
    let watchNext = 0;
    let fullAt = 0;
    /** Where the server last said this walker stands. Steps I have taken but it has not heard of yet are ahead of it. */
    let ack: Tile | null = null;
    /** The steps in hand were thrown away (the server refused them): the next answer says where I stand, whatever it is. */
    let resync = false;
    let token: string | null = null;
    /** The database answers only the calls of earlier versions (no crew_rooms_scale.sql). */
    let legacy = false;
    /** crew_room_tick's watermark: what this phone has seen. null: the next read brings everything. */
    let since: number | null = null;
    /** The server time of the last full snapshot (entering, saving, or a legacy read), to drop one that comes late. */
    let lastObserved = "";
    // The room as this phone knows it, put together from the reads.
    const people = new Map<string, RoomPeer>();
    let away = new Set<string>();
    let crewInfo: RoomSnapshot["crew"] | null = null;
    let roomInfo: RoomSnapshot["room"] | null = null;
    let circles: RoomSnapshot["circles"] = [];
    let selfInfo: RoomSnapshot["self"] = null;
    let walkers = 0;
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

    /** Hand the room to the screen in the shape every room call used to answer. */
    const publish = () => {
      if (stopped || !crewInfo || !roomInfo) return;
      const now = Date.now();
      const observed = new Date(now).toISOString();
      const quiet = new Date(now - AWAY_MS).toISOString();
      const peers = [...people.values()].map((p) => ({ ...p, last_seen: away.has(p.id) ? quiet : observed })).sort(byPeerId);
      const snap: RoomSnapshot = { observed_at: observed, crew: crewInfo, room: roomInfo, peers, self: selfInfo, circles };
      current.current = snap;
      setSnapshot(snap);
    };

    /** Where the server says I stand. False when that ended this session (gone too long, or another tab took over). */
    const placeSelf = (self: RoomSnapshot["self"], force: boolean) => {
      if (session && !self) {
        // Gone too long (a locked phone): walk back in. Drafts and threads are untouched. A stall that timed out a whole
        // room brings everyone back in the same moment, so each phone waits up to 2 s.
        session = "";
        walking.current = false;
        rejoinAt = Date.now() + Math.random() * 2000;
        return false;
      }
      if (session && self && self.session_id !== session) {
        stop("replaced", "room_session_replaced");
        return false;
      }
      if (self) {
        // The room's version moves for every owner edit (a caption, the fountain's ribbon), and the server's position is
        // always a little behind mine while I walk. Neither is a reason to move anyone. I am put on the server's tile only
        // when it is not a tile I have walked (or am about to be told I walked): it was moved (a new width or template sends
        // everyone to the entrance), I entered again, or the steps in hand were refused.
        const ahead = (t: Tile) => t.x === self.x && t.y === self.y;
        const known = !!ack && (ahead(ack) || !!batch.current?.steps.some(ahead) || queue.current.some(ahead));
        if (force || resync || !known) {
          queue.current = [];
          batch.current = null;
          resync = false;
          sequence.current = self.seq;
          setReset((old) => ({ x: self.x, y: self.y, revision: old.revision + 1 }));
        }
        ack = { x: self.x, y: self.y };
      }
      selfInfo = self;
      return true;
    };

    /** A whole room (entering, the owner saving, or a database without crew_room_tick). */
    const fromSnapshot = (data: RoomSnapshot, force = false) => {
      if (stopped || !data || data.room.version < version.current) return;
      if (!force && (entering || (lastObserved && data.observed_at < lastObserved))) return;
      if (!placeSelf(data.self, force)) return;
      lastObserved = data.observed_at;
      crewInfo = data.crew;
      roomInfo = data.room;
      circles = data.circles;
      version.current = data.room.version;
      people.clear();
      data.peers.forEach((p) => people.set(p.id, p));
      const at = Date.parse(data.observed_at);
      away = new Set(data.peers.filter((p) => at - Date.parse(p.last_seen) > 25_000).map((p) => p.id));
      walkers = data.peers.length;
      lastSnap = Date.now();
      spread = 0.8 + Math.random() * 0.4;
      publish();
    };
    applySnapshot.current = (data) => fromSnapshot(data);

    /** What changed since the last read (crew_room_tick). */
    const fromTick = (t: RoomTick, force = false) => {
      if (stopped || !t || (!force && entering)) return;
      if (t.room) roomInfo = t.room;
      if (t.crew) crewInfo = t.crew;
      if (t.full) people.clear();
      else if (t.ids) {
        const keep = new Set(t.ids);
        for (const id of people.keys()) if (!keep.has(id)) people.delete(id);
      }
      let unknown = false;
      for (const [id, x, y, circle, name, look] of t.moved) {
        const was = people.get(id);
        if (name === undefined && !was) {
          // Someone this phone has no name or look for (a block just lifted): the next read brings everyone.
          unknown = true;
          continue;
        }
        people.set(id, { id, x, y, circle_id: circle, name: name ?? was!.name, look: name === undefined ? was!.look : look, last_seen: "" });
      }
      away = new Set(t.away);
      circles = t.circles;
      walkers = t.walkers;
      version.current = t.version;
      since = unknown ? null : t.at;
      if (t.full) fullAt = Date.now() + FULL_READ * (0.75 + Math.random() * 0.5);
      // A read that left before my last batch was taken knows an older tile of mine: keep mine. A sequence back at 0 is
      // the owner sending everyone to the entrance, which counts.
      const behind = !force && !!session && !!t.self && t.self.seq < sequence.current && t.self.seq !== 0;
      if (!behind && !placeSelf(t.self, force)) return;
      lastSnap = Date.now();
      spread = 0.8 + Math.random() * 0.4;
      publish();
    };

    const enter = async () => {
      if (stopped || entering) return;
      entering = true;
      const wasWatching = watch;
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
            if (!watch) rejoinAt = Date.now() + backoff(++rejoinFails);
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
        fromSnapshot(snap, true);
        rejoinFails = 0;
        rejoinAt = 0;
        if (watch) watchNext = Date.now() + watchGap();
        // The first read brings the room again with a watermark; every read after it brings only what changed. A watcher
        // still waiting for a spot keeps the watermark it has.
        if (!(wasWatching && watch)) {
          since = null;
          lastSnap = 0;
        }
        setWatching(watch);
        if (snap.took_over) setNotice("You had this room open somewhere else. It's here now, and the other one has paused.");
        setConnected(true);
        setStatus("ready");
        setReason("");
        setError("");
      } catch {
        if (stopped) return;
        if (!current.current) stop("error", "");
        else if (!watch) rejoinAt = Date.now() + backoff(++rejoinFails);
      } finally {
        entering = false;
      }
    };

    /** Read the room: what changed (crew_room_tick), or the whole room on a database without it. */
    const ask = async (force: boolean): Promise<{ ok: boolean; why?: string }> => {
      if (!legacy) {
        const { data, error: problem } = await sb.rpc("crew_room_tick", { p_crew: crewId, p_since: since, p_version: version.current });
        if (!problem) {
          if (data) fromTick(data as RoomTick, force);
          return { ok: !!data };
        }
        if (!missing(problem.message)) return { ok: false, why: problem.message };
        legacy = true;
      }
      const { data, error: problem } = await sb.rpc("crew_room_state", { p_crew: crewId });
      if (problem) return { ok: false, why: problem.message };
      if (data) fromSnapshot(data as RoomSnapshot, force);
      return { ok: !!data };
    };

    const read = async () => {
      if (stopped || reading || entering || !current.current) return;
      reading = true;
      let ok = false;
      try {
        if (Date.now() > fullAt) since = null;
        const r = await ask(false);
        ok = r.ok;
        if (!stopped && r.why && /not_in_crew|need_account/.test(r.why)) stop("error", r.why);
      } catch {
        /* the next read catches up; the heartbeat decides whether we are connected */
      } finally {
        reading = false;
        // A failed read waits (longer each time, spread) instead of going again on the next tick.
        readFails = ok ? 0 : readFails + 1;
        readAfter = ok ? 0 : Date.now() + backoff(readFails);
      }
    };
    // The owner changed the room: the Realtime payload has the new row, so nobody needs to read for it. A new width or
    // template sends everyone to the entrance; the next read brings where they stand (spread, so a full room does not
    // knock together).
    roomChanged.current = (row) => {
      if (stopped || !roomInfo || typeof row.version !== "number" || row.version <= version.current || row.content === undefined) return;
      const was = roomInfo as RoomSnapshot["room"] & { template?: string };
      const moved = (row.width !== undefined && row.width !== was.width) || (row.template !== undefined && row.template !== was.template);
      roomInfo = { ...was, ...row } as RoomSnapshot["room"];
      version.current = row.version;
      publish();
      if (moved) setTimeout(() => void read(), Math.random() * 2000);
    };

    const flush = async () => {
      if (stopped || flushing || entering || !session || Date.now() < retryAt) return;
      const now = Date.now();
      if (!batch.current) {
        const waiting = queue.current.length;
        const beatDue = now - lastBeat >= BEAT;
        const due = waiting >= FLUSH_TILES || (waiting > 0 && (now - queuedAt.current >= FLUSH_AGE || now - lastStepAt.current >= SETTLE));
        if (!beatDue && !due) return;
      }
      flushing = true;
      if (!batch.current) {
        batch.current = { steps: queue.current.slice(0, legacy ? LEGACY_BATCH : MAX_BATCH), seq: sequence.current + (queue.current.length ? 1 : 0) };
      }
      const request = batch.current;
      const mine = session;
      try {
        const { data, error: problem } = await sb.rpc(legacy ? "crew_room_step" : "crew_room_move", {
          p_crew: crewId,
          p_session: mine,
          p_seq: request.seq,
          p_steps: request.steps,
        });
        if (stopped || entering || mine !== session) return;
        if (problem) {
          if (!legacy && missing(problem.message)) {
            // No crew_rooms_scale.sql here: the same batch goes again, at most 8 tiles, by the older call.
            legacy = true;
            if (batch.current === request && request.steps.length > LEGACY_BATCH) batch.current = null;
          } else if (/room_session_expired/.test(problem.message)) {
            queue.current = [];
            batch.current = null;
            session = "";
            walking.current = false;
            rejoinAt = Date.now() + Math.random() * 2000;
          } else if (/room_session_replaced/.test(problem.message)) stop("replaced", problem.message);
          else if (/not_in_crew|need_account/.test(problem.message)) stop("error", problem.message);
          else if (/invalid_movement|invalid_sequence|moving_too_fast/.test(problem.message)) {
            // The server and this phone disagree about where I stand. Drop the steps in hand, take no more until the server
            // has said where I am, and stand there.
            queue.current = [];
            batch.current = null;
            resync = true;
            walking.current = false;
            const fresh = await ask(true).catch(() => ({ ok: false }));
            if (!stopped && mine === session && fresh.ok) walking.current = !!session;
            else {
              // No answer: the next beat asks again.
              retryAt = Date.now() + backoff(++flushFails);
              lastBeat = 0;
            }
          } else {
            walking.current = false;
            setConnected(false);
            retryAt = Date.now() + backoff(++flushFails);
          }
          return;
        }
        flushFails = 0;
        if (batch.current === request) {
          queue.current.splice(0, request.steps.length);
          batch.current = null;
          if (queue.current.length) queuedAt.current = Date.now();
        }
        lastBeat = Date.now();
        if (legacy) {
          const snap = data as RoomSnapshot;
          // The server has these steps now: its position is where the batch ended, which is not "behind" me any more.
          if (snap.self && snap.room.version >= version.current && !resync) ack = { x: snap.self.x, y: snap.self.y };
          if (snap.room.version >= version.current && snap.self) sequence.current = snap.self.seq;
          fromSnapshot(snap);
        } else {
          const at = data as MoveAnswer;
          if (!resync) ack = { x: at.x, y: at.y };
          sequence.current = at.seq;
          if (selfInfo) {
            const area = selfInfo.circle_id !== at.circle_id;
            selfInfo = { ...selfInfo, x: at.x, y: at.y, seq: at.seq, circle_id: at.circle_id };
            // Walking into or out of an area changes which conversation is open.
            if (area) publish();
          }
        }
        walking.current = !!session;
        setConnected(true);
      } catch {
        walking.current = false;
        setConnected(false);
        retryAt = Date.now() + backoff(++flushFails);
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
      const now = Date.now();
      void flush();
      if (!document.hidden && now >= readAfter && now - lastSnap > readGap(walkers, lastStepAt.current) * spread) void read();
      // Out of the room (timed out, or a rejoin that failed): walk back in when the wait is over.
      if (!session && !watch && !entering && rejoinAt && now >= rejoinAt) {
        rejoinAt = 0;
        void enter();
      }
      // Watching a full room: ask for a spot only when the room has one (a locked entry is the dearest call there is).
      if (watch && !entering && now >= watchNext && walkers < (roomInfo?.capacity ?? Infinity)) {
        watchNext = now + watchGap();
        void enter();
      }
    }, TICK);

    // Back from a locked phone or another app: beat and read now. The beat carries on the same session, or finds it
    // expired and walks back in.
    const onVisible = () => {
      if (document.hidden) return;
      lastBeat = 0;
      lastSnap = 0;
      retryAt = 0;
      readAfter = 0;
      if (rejoinAt) rejoinAt = Date.now();
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
    let subscribed = false;
    const catchUp = () => {
      if (stopped || document.hidden) return;
      const area = current.current?.self?.circle_id;
      [...new Set(["general", ...(area ? [area] : [])])].forEach((key) => void fetchThread(key, threadsRef.current[key]?.loaded ? "newer" : "first"));
    };
    // The safety read: 30 s while Realtime is up, 10 s while it is not.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(() => {
        catchUp();
        arm();
      }, subscribed ? CATCH_UP : CATCH_UP_DOWN);
    };
    const channel = sb
      .channel(`crew-room:${crewId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_room_messages", filter: `crew_id=eq.${crewId}` }, (payload) => {
        const m = payload.new as RoomMessage;
        const key = threadOf(m.scope, m.circle_id);
        if (!stopped && key) setThreads((all) => merge(all, key, [m]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crew_rooms", filter: `crew_id=eq.${crewId}` }, (payload) =>
        roomChanged.current(payload.new as RoomRow)
      )
      // Subscribed, or back after a dropped connection: read what may have been missed.
      .subscribe((state) => {
        subscribed = state === "SUBSCRIBED";
        if (subscribed) catchUp();
        arm();
      });
    arm();
    const onVisible = () => {
      if (!document.hidden) catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
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
    if (!walking.current || queue.current.length >= MAX_BATCH) return false;
    if (!queue.current.length) queuedAt.current = Date.now();
    lastStepAt.current = Date.now();
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
