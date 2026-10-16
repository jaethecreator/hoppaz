#!/usr/bin/env node
/**
 * Crew room load harness: N simulated phones in one crew room, each doing what the app does (enter, walk, beat, read the
 * room, chat, catch up on chat, poll Game Time, hunt), straight against PostgREST. No browsers.
 *
 * LOCAL OR THROWAWAY DATABASES ONLY. It refuses any address that is not this Mac, and the shared local stack
 * (supabase_db_hoppaz-local) unless --shared-ok. Set-up, the throwaway copy and the numbers: scripts/load/README.md.
 *
 *   node scripts/load/crew-room-load.mjs --levels=20,50,100 --duration=60 --mode=before --out=/tmp/before.json
 *   --capacity=100 with more phones than that: the rest watch, and try for a spot as the app does
 *
 * Modes:
 *   before  today's client (src/lib/crew-room/useCrewRoom.ts on jae/perf-all): steps and reads return the full room.
 *   after   this branch: crew_room_move (small answers), crew_room_tick (what changed), Game Time every 15 s with the
 *           live feed up, watchers that ask for a spot only when there is one.
 *
 * Measures, per call: count, errors, p50/p95/p99 and bytes; per second: DB CPU (docker stats), transactions,
 * connections active / waiting on a lock. At the end: the top statements (pg_stat_statements) and functions.
 */
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// ------------------------------------------------------------------ options --
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? "1" : fallback;
};
const BASE = arg("base", "http://127.0.0.1:3410");
const DB_CONTAINER = arg("container", "hoppaz-load-db");
const DB_NAME = arg("db", "load");
const SECRET = readFileSync(arg("secret-file", ""), "utf8").trim();
const LEVELS = arg("levels", "20").split(",").map(Number);
const DURATION = Number(arg("duration", "60")) * 1000;
const RAMP = Number(arg("ramp", "10")) * 1000;
const MODE = arg("mode", "before");
const HUNT = arg("hunt", "1") === "1";
/** Messages per phone per minute, General chat. */
const CHAT = Number(arg("chat", "0.6"));
const SEED = arg("seed", "scripts/load/seed.sql");
/** Walking spots in the room (the rest watch). The seed's 200 means nobody watches. */
const CAPACITY = Number(arg("capacity", "200"));
const OUT = arg("out", "");
const CREW = "10ad0000-0000-4000-8000-c00000000001";
const GAME = "10ad0000-0000-4000-8000-a00000000001";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing ${BASE}: local addresses only`);
if (DB_CONTAINER === "supabase_db_hoppaz-local" && arg("shared-ok", "0") !== "1") {
  throw new Error("refusing the shared local stack; use the throwaway copy (README) or pass --shared-ok");
}
if (!SECRET) throw new Error("--secret-file is required (the throwaway PostgREST's JWT secret)");

// ------------------------------------------------------------------ helpers --
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms, spread = 0.2) => Math.round(ms * (1 - spread + Math.random() * spread * 2));
const userId = (n) => `10ad0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, role: "authenticated", aud: "authenticated", email: `${sub}@load.invalid`, iat: now, exp: now + 7200 });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "supabase_admin", "-d", DB_NAME, "-At", "-F", "|", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  }).trim();
}
function runSeed() {
  execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-q", "-v", "ON_ERROR_STOP=1"], {
    input: readFileSync(SEED),
    stdio: ["pipe", "ignore", "inherit"],
  });
  psql(`update crew_rooms set capacity = ${CAPACITY} where crew_id = '${CREW}'`);
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

// ------------------------------------------------------------------- the room --
const layout = JSON.parse(psql("select data from crew_room_layouts where template = 'clubhouse' and width = 30"));
const W = layout.grid.width;
const H = layout.grid.height;
const solid = new Set();
for (const b of layout.blocks) for (let x = b.x; x < b.x + b.w; x++) for (let y = b.y; y < b.y + b.h; y++) solid.add(`${x},${y}`);
const walkable = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && !solid.has(`${x},${y}`);
const tiles = [];
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (walkable(x, y)) tiles.push({ x, y });
const spots = psql(`select object_id, x, y, w, h from game_time_spots where game_id = '${GAME}'`)
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [id, x, y, w, h] = l.split("|");
    return { id, x: +x, y: +y, w: +w, h: +h };
  });
/** Walkable tiles within one tile of an object (where a search is allowed). */
const besides = (s) =>
  tiles.filter((t) => Math.max(s.x - t.x, 0, t.x - (s.x + s.w - 1)) <= 1 && Math.max(s.y - t.y, 0, t.y - (s.y + s.h - 1)) <= 1);
const huntable = spots.map((s) => ({ ...s, stand: besides(s) })).filter((s) => s.stand.length);
function path(from, to) {
  const key = (t) => t.y * W + t.x;
  const prev = new Map([[key(from), null]]);
  const q = [from];
  while (q.length) {
    const t = q.shift();
    if (t.x === to.x && t.y === to.y) {
      const out = [];
      for (let c = t; c && key(c) !== key(from); c = prev.get(key(c))) out.unshift(c);
      return out;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (walkable(n.x, n.y) && !prev.has(key(n))) {
        prev.set(key(n), t);
        q.push(n);
      }
    }
  }
  return [];
}

// ------------------------------------------------------------------ metrics --
class Metrics {
  constructor() {
    this.calls = new Map();
    this.timeline = [];
    this.measuring = false;
  }
  add(name, ms, ok, bytes, error) {
    if (!this.measuring) return;
    let c = this.calls.get(name);
    if (!c) this.calls.set(name, (c = { n: 0, errors: 0, bytes: 0, ms: [], why: {} }));
    c.n += 1;
    c.bytes += bytes;
    c.ms.push(ms);
    if (!ok) {
      c.errors += 1;
      const k = String(error).slice(0, 60);
      c.why[k] = (c.why[k] ?? 0) + 1;
    }
  }
  summary(seconds) {
    const rows = {};
    for (const [name, c] of [...this.calls].sort((a, b) => b[1].n - a[1].n)) {
      const s = [...c.ms].sort((a, b) => a - b);
      rows[name] = {
        per_s: +(c.n / seconds).toFixed(1),
        n: c.n,
        err_pct: +((100 * c.errors) / c.n).toFixed(1),
        p50: Math.round(pct(s, 50)),
        p95: Math.round(pct(s, 95)),
        p99: Math.round(pct(s, 99)),
        max: Math.round(s[s.length - 1] ?? 0),
        avg_kb: +(c.bytes / c.n / 1024).toFixed(2),
        egress_kb_s: +(c.bytes / 1024 / seconds).toFixed(1),
        errors: c.why,
      };
    }
    return rows;
  }
}

async function call(m, token, path_, body, method = "POST") {
  const t0 = performance.now();
  const name = path_.startsWith("rpc/") ? path_.slice(4) : path_.split("?")[0];
  try {
    const res = await fetch(`${BASE}/${path_}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) {
      let why = `${res.status}`;
      try {
        why = JSON.parse(text).message ?? why;
      } catch {}
      m.add(name, ms, false, text.length, why);
      return { ok: false, error: why };
    }
    m.add(name, ms, true, text.length);
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (e) {
    m.add(name, performance.now() - t0, false, 0, e.name === "TimeoutError" ? "timeout_30s" : e.message);
    return { ok: false, error: e.message };
  }
}

// -------------------------------------------------------------------- a phone --
const TICK = 200;
const BEAT = 15_000;
const WALK_MS = 90;
// Batching: before = useCrewRoom on jae/perf-all (5 tiles or 450 ms, 8 a batch); after = this branch (10 tiles, 1 s, or the
// walker stopped for 150 ms; 16 a batch).
const FLUSH_TILES = MODE === "before" ? 5 : 10;
const FLUSH_AGE = MODE === "before" ? 450 : 1000;
const SETTLE = MODE === "before" ? Infinity : 150;
const MAX_BATCH = MODE === "before" ? 8 : 16;

class Phone {
  constructor(n, m) {
    this.n = n;
    this.m = m;
    this.id = userId(n);
    this.token = jwt(this.id);
    this.stopped = false;
    this.session = "";
    this.pos = null;
    this.seq = 0;
    this.queue = [];
    this.queuedAt = 0;
    this.batch = null;
    this.walk = [];
    this.lastMove = 0;
    this.lastBeat = 0;
    this.lastSnap = 0;
    this.lastStepAt = 0;
    this.spread = 1;
    this.peers = 0;
    this.stepping = false;
    this.reading = false;
    this.restUntil = 0;
    this.target = null;
    this.searchAt = 0;
    this.won = false;
    this.newest = null;
    /** after: crew_room_tick's watermark and what this phone knows of the room. */
    this.since = null;
    this.version = 0;
    this.view = new Map();
    this.frozen = false;
    /** Watching a full room: no walker; tries for a spot (before: every 15 s; after: when the room has one). */
    this.watching = false;
    this.watchNext = 0;
    this.capacity = CAPACITY;
    /** The area session I stand in (area chat). */
    this.circle = null;
    const now = Date.now();
    this.chatAt = now + (CHAT > 0 ? Math.random() * (60_000 / CHAT) : Infinity);
    this.catchUpAt = now + Math.random() * 30_000;
    this.gtAt = now + Math.random() * 3500;
    this.inboxAt = now + Math.random() * 30_000;
    this.annAt = now + Math.random() * 60_000;
  }

  rpc(name, body) {
    return call(this.m, this.token, `rpc/${name}`, body);
  }

  applySnap(s) {
    if (!s) return;
    this.lastSnap = Date.now();
    this.spread = 0.8 + Math.random() * 0.4;
    if (MODE === "before") this.peers = s.peers?.length ?? this.peers;
    else if (typeof s.walkers === "number") this.peers = s.walkers;
  }

  async enter() {
    const session = randomUUID();
    const wasWatching = this.watching;
    const r = await this.rpc("crew_room_enter", { p_crew: CREW, p_session: session });
    if (!r.ok) return false;
    if (r.data?.watching) {
      this.watching = true;
      this.capacity = r.data.room?.capacity ?? this.capacity;
      this.watchNext = Date.now() + (MODE === "before" ? 15_000 : 15_000 + Math.random() * 30_000);
      if (!wasWatching) {
        this.since = null;
        this.applySnap(r.data);
        if (MODE === "after") this.lastSnap = 0;
      }
      return true;
    }
    if (!r.data?.self) return false;
    this.watching = false;
    this.session = session;
    this.circle = r.data.self.circle_id ?? null;
    this.pos = { x: r.data.self.x, y: r.data.self.y };
    this.seq = r.data.self.seq;
    this.lastBeat = Date.now();
    this.since = null;
    this.applySnap(r.data);
    if (MODE === "after") this.lastSnap = 0;
    return true;
  }

  async leave() {
    this.stopped = true;
    if (this.session) await this.rpc("crew_room_leave", { p_crew: CREW, p_session: this.session });
  }

  /** A watcher tries for a spot: before, every 15 s; after, only when the last read says the room has one. */
  async watch() {
    if (!this.watching || Date.now() < this.watchNext) return;
    if (MODE === "after" && this.peers >= this.capacity) return;
    this.watchNext = Date.now() + (MODE === "before" ? 15_000 : 15_000 + Math.random() * 30_000);
    await this.enter();
  }

  readGap() {
    if (this.peers <= 1) return 10_000;
    // Everyone in a hunt is touching the screen: the 2.5 s gap of useCrewRoom.readGap.
    return 2_500;
  }

  /** after: crew_room_tick, merged the way useCrewRoom.fromTick merges it. */
  async tickRead() {
    const r = await this.rpc("crew_room_tick", { p_crew: CREW, p_since: this.since, p_version: this.version });
    const t = r.data;
    if (!r.ok || !t) return r;
    if (t.full) this.view.clear();
    else if (t.ids) {
      const keep = new Set(t.ids);
      for (const id of this.view.keys()) if (!keep.has(id)) this.view.delete(id);
    }
    let unknown = false;
    for (const [id, x, y, circle, name, look] of t.moved) {
      const was = this.view.get(id);
      if (name === undefined && !was) {
        unknown = true;
        continue;
      }
      this.view.set(id, { x, y, circle, name: name ?? was.name, look: name === undefined ? was.look : look });
    }
    this.version = t.version;
    this.since = unknown ? null : t.at;
    if (t.room?.capacity) this.capacity = t.room.capacity;
    this.applySnap(t);
    return r;
  }

  /** What to do next: hunt an object (70%) or wander. */
  plan() {
    const now = Date.now();
    if (this.frozen || this.watching || !this.pos || now < this.restUntil || this.walk.length || this.target) return;
    if (HUNT && !this.won && Math.random() < 0.8) {
      // Hunters go object to object: mostly one nearby (within 8 tiles), sometimes across the room.
      const near = huntable.filter((s) => s.stand.some((t) => Math.abs(t.x - this.pos.x) + Math.abs(t.y - this.pos.y) <= 8));
      const pool = near.length && Math.random() < 0.7 ? near : huntable;
      const s = pool[Math.floor(Math.random() * pool.length)];
      const stand = s.stand[Math.floor(Math.random() * s.stand.length)];
      const route = path(this.pos, stand);
      // An object whose sides cannot be reached from here is skipped.
      if (!route.length && (this.pos.x !== stand.x || this.pos.y !== stand.y)) return;
      this.walk = route;
      this.target = s.id;
    } else {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      this.walk = path(this.pos, t);
      this.target = null;
      this.restUntil = now + 2000 + Math.random() * 6000;
    }
  }

  /** The walker takes a tile every 90 ms; the queue holds at most 8 (onStep refuses more). */
  advance() {
    const now = Date.now();
    if (!this.walk.length) {
      this.lastMove = now;
      return;
    }
    let due = Math.floor((now - this.lastMove) / WALK_MS);
    while (due-- > 0 && this.walk.length && this.queue.length < MAX_BATCH) {
      const t = this.walk.shift();
      if (!this.queue.length) this.queuedAt = now;
      this.queue.push(t);
      this.pos = t;
      this.lastStepAt = now;
      this.lastMove = now;
    }
    if (this.queue.length >= MAX_BATCH) this.lastMove = now;
  }

  async flush() {
    if (this.stepping || !this.session) return;
    const now = Date.now();
    if (!this.batch) {
      const waiting = this.queue.length;
      const beatDue = now - this.lastBeat >= BEAT;
      const due = waiting >= FLUSH_TILES || (waiting > 0 && (now - this.queuedAt >= FLUSH_AGE || now - this.lastStepAt >= SETTLE));
      if (!beatDue && !due) return;
      this.batch = { steps: this.queue.slice(0, MAX_BATCH), seq: this.seq + (this.queue.length ? 1 : 0) };
    }
    this.stepping = true;
    const req = this.batch;
    const r = await this.rpc(MODE === "before" ? "crew_room_step" : "crew_room_move", { p_crew: CREW, p_session: this.session, p_seq: req.seq, p_steps: req.steps });
    this.stepping = false;
    if (this.stopped) return;
    if (!r.ok) {
      this.batch = null;
      this.queue = [];
      this.walk = [];
      if (/room_session_expired/.test(r.error)) {
        this.session = "";
        await this.enter();
      } else if (/invalid_movement|invalid_sequence|moving_too_fast/.test(r.error)) {
        await this.resync();
      } else {
        this.restUntil = Date.now() + 2000;
      }
      return;
    }
    const s = r.data;
    if (this.batch === req) {
      this.queue.splice(0, req.steps.length);
      this.batch = null;
      if (this.queue.length) this.queuedAt = Date.now();
    }
    this.lastBeat = Date.now();
    if (MODE === "before") {
      if (s?.self) {
        this.seq = s.self.seq;
        this.circle = s.self.circle_id ?? null;
      }
      this.applySnap(s);
    } else if (typeof s?.seq === "number") {
      this.seq = s.seq;
      this.circle = s.circle_id ?? null;
    }
  }

  async resync() {
    const r = MODE === "before" ? await this.rpc("crew_room_state", { p_crew: CREW }) : await this.tickRead();
    const self = r.data?.self;
    if (self) {
      this.pos = { x: self.x, y: self.y };
      this.seq = self.seq;
    }
  }

  async read() {
    if (this.reading || (!this.session && !this.watching)) return;
    if (Date.now() - this.lastSnap <= this.readGap() * this.spread) return;
    this.reading = true;
    if (MODE === "before") {
      const r = await this.rpc("crew_room_state", { p_crew: CREW });
      if (r.ok) this.applySnap(r.data);
    } else await this.tickRead();
    this.reading = false;
  }

  async search() {
    if (!this.target || this.walk.length || this.queue.length || this.batch || this.stepping) return;
    const now = Date.now();
    if (now < this.searchAt) return;
    const object = this.target;
    this.target = null;
    this.searchAt = now + 3000;
    const r = await this.rpc("game_time_search", { p_crew: CREW, p_object: object });
    if (r.ok && r.data?.result === "win") this.won = true;
    if (!r.ok && /already_won|all_found|game_closed/.test(r.error)) this.won = true;
    // The app's own gap: the next search is 3 s after this one.
    this.restUntil = Math.max(this.searchAt, Date.now() + 300 + Math.random() * 700);
  }

  async chat() {
    const now = Date.now();
    if (now < this.chatAt) return;
    this.chatAt = now + jitter(60_000 / CHAT, 0.5);
    // Standing in an area (a booth, the courtyard corner), half the messages go to the area, as the app sends them: once
    // the walk has reached the server.
    const area = this.circle && this.session && !this.queue.length && !this.batch && Math.random() < 0.5;
    const r = await this.rpc("crew_room_send", {
      p_crew: CREW,
      p_scope: area ? "nearby" : "general",
      p_body: `load ${this.n} ${now}`,
      p_request: randomUUID(),
      p_circle: area ? this.circle : null,
    });
    if (r.ok && !area) await this.catchUp(true);
  }

  /** The 30 s safety read of General (and the read after a send): what is newer than the newest message held. */
  async catchUp(force = false) {
    const now = Date.now();
    if (!force && now < this.catchUpAt) return;
    this.catchUpAt = now + jitter(30_000);
    let q = `crew_room_messages?select=id,crew_id,author_id,author_name,author_look,body,scope,circle_id,created_at&crew_id=eq.${CREW}&scope=eq.general`;
    q += this.newest ? `&created_at=gte.${encodeURIComponent(this.newest)}&order=created_at.asc,id.asc&limit=40` : `&order=created_at.desc,id.desc&limit=40`;
    const r = await call(this.m, this.token, q, null, "GET");
    if (r.ok && Array.isArray(r.data) && r.data.length) {
      const last = this.newest ? r.data[r.data.length - 1] : r.data[0];
      this.newest = last.created_at;
    }
  }

  async gameTime() {
    if (!HUNT) return;
    const now = Date.now();
    if (now < this.gtAt) return;
    this.gtAt = now + (MODE === "before" ? jitter(3500) : jitter(15_000));
    await this.rpc("game_time_state", { p_crew: CREW });
  }

  async background() {
    const now = Date.now();
    if (now >= this.inboxAt) {
      this.inboxAt = now + jitter(30_000);
      void this.rpc("crew_friend_inbox", {});
    }
    if (now >= this.annAt) {
      this.annAt = now + jitter(60_000);
      void this.rpc("crew_announcements", { p_crew: CREW });
    }
  }

  async run() {
    if (!(await this.enter())) {
      await sleep(2000);
      if (!(await this.enter())) return;
    }
    while (!this.stopped) {
      void this.watch();
      this.plan();
      this.advance();
      void this.flush();
      void this.read();
      void this.search();
      void this.chat();
      void this.catchUp();
      void this.gameTime();
      void this.background();
      await sleep(TICK);
    }
  }
}

// ------------------------------------------------------------------ sampling --
function startSampler(samples) {
  const stats = spawn("docker", ["stats", DB_CONTAINER, "--format", "{{.CPUPerc}}|{{.MemUsage}}"]);
  let cpu = 0;
  let mem = "";
  stats.stdout.on("data", (d) => {
    const lines = d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n").filter((l) => l.includes("|"));
    const last = lines[lines.length - 1];
    if (last) {
      cpu = parseFloat(last.split("|")[0]) || 0;
      mem = last.split("|")[1]?.trim() ?? "";
    }
  });
  const pg = spawn("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "supabase_admin", "-d", DB_NAME, "-At", "-F", "|"]);
  pg.stdout.on("data", (d) => {
    for (const line of d.toString().split("\n")) {
      if (!line.startsWith("S|")) continue;
      const [, xacts, active, idle, lockWait, advisory, total] = line.split("|").map(Number);
      samples.push({ t: Date.now(), cpu, mem, xacts, active, idle, lockWait, advisory, total });
    }
  });
  const q =
    "select 'S', (select xact_commit + xact_rollback from pg_stat_database where datname = current_database()), " +
    "count(*) filter (where state = 'active'), count(*) filter (where state like 'idle%'), " +
    "count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where wait_event = 'advisory'), count(*) " +
    "from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid();\n";
  const timer = setInterval(() => pg.stdin.write(q), 1000);
  return () => {
    clearInterval(timer);
    stats.kill();
    pg.stdin.end();
    pg.kill();
  };
}

function dbTop() {
  const statements = psql(
    "select calls, round(total_exec_time::numeric, 0), round(mean_exec_time::numeric, 2), left(regexp_replace(query, '\\s+', ' ', 'g'), 90) " +
      "from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database()) " +
      "order by total_exec_time desc limit 12"
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [calls, total_ms, mean_ms, query] = l.split("|");
      return { calls: +calls, total_ms: +total_ms, mean_ms: +mean_ms, query };
    });
  const functions = psql(
    "select funcname, calls, round(total_time::numeric, 0), round(self_time::numeric, 0) from pg_stat_user_functions order by self_time desc limit 12"
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name, calls, total_ms, self_ms] = l.split("|");
      return { name, calls: +calls, total_ms: +total_ms, self_ms: +self_ms };
    });
  return { statements, functions };
}

// ----------------------------------------------------------------------- run --
async function level(n) {
  runSeed();
  psql("select pg_stat_statements_reset(), pg_stat_reset()");
  const m = new Metrics();
  const phones = Array.from({ length: n }, (_, i) => new Phone(i + 1, m));
  const samples = [];
  const stop = startSampler(samples);
  const started = Date.now();
  const runs = phones.map(async (p, i) => {
    await sleep((RAMP * i) / n);
    await p.run();
  });
  await sleep(RAMP + 3000);
  m.measuring = true;
  const from = Date.now();
  await sleep(DURATION);
  m.measuring = false;
  const seconds = (Date.now() - from) / 1000;
  const top = dbTop();
  stop();
  // after: stop walking, let the last batches land, read once more, and compare every phone's room with the server's.
  let view = null;
  if (MODE === "after") {
    phones.forEach((p) => {
      p.frozen = true;
      p.walk = [];
    });
    await sleep(2500);
    await Promise.all(phones.map((p) => p.tickRead()));
    const truth = new Map(
      psql(`select user_id, x, y from crew_room_presence where crew_id = '${CREW}' and last_seen > now() - interval '45 seconds'`)
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [id, x, y] = l.split("|");
          return [id, `${x},${y}`];
        })
    );
    view = { walkers: truth.size, checked: 0, wrong_tile: 0, missing: 0, extra: 0 };
    for (const p of phones) {
      for (const [id, at] of truth) {
        view.checked += 1;
        const v = p.view.get(id);
        if (!v) view.missing += 1;
        else if (`${v.x},${v.y}` !== at) view.wrong_tile += 1;
      }
      for (const id of p.view.keys()) if (!truth.has(id)) view.extra += 1;
    }
  }
  await Promise.all(phones.map((p) => p.leave()));
  await Promise.race([Promise.all(runs), sleep(5000)]);
  const window = samples.filter((s) => s.t >= from);
  const cpu = window.map((s) => s.cpu).sort((a, b) => a - b);
  const xps = window.length > 1 ? (window[window.length - 1].xacts - window[0].xacts) / ((window[window.length - 1].t - window[0].t) / 1000) : 0;
  const calls = m.summary(seconds);
  const all = [...m.calls.values()];
  const total = all.reduce((a, c) => a + c.n, 0);
  const errors = all.reduce((a, c) => a + c.errors, 0);
  const bytes = all.reduce((a, c) => a + c.bytes, 0);
  const allMs = all.flatMap((c) => c.ms).sort((a, b) => a - b);
  const walkers = Number(psql(`select count(*) from crew_room_presence where crew_id = '${CREW}'`));
  return {
    phones: n,
    mode: MODE,
    seconds: Math.round(seconds),
    took_s: Math.round((Date.now() - started) / 1000),
    requests_per_s: +(total / seconds).toFixed(1),
    error_pct: total ? +((100 * errors) / total).toFixed(2) : 0,
    p50_ms: Math.round(pct(allMs, 50)),
    p95_ms: Math.round(pct(allMs, 95)),
    p99_ms: Math.round(pct(allMs, 99)),
    egress_kb_s: +(bytes / 1024 / seconds).toFixed(1),
    db_cpu_avg_pct: +(cpu.reduce((a, b) => a + b, 0) / (cpu.length || 1)).toFixed(0),
    db_cpu_p95_pct: +pct(cpu, 95).toFixed(0),
    db_xacts_per_s: +xps.toFixed(0),
    db_conns_max: Math.max(0, ...window.map((s) => s.total)),
    db_active_avg: +(window.reduce((a, s) => a + s.active, 0) / (window.length || 1)).toFixed(1),
    db_lock_wait_avg: +(window.reduce((a, s) => a + s.lockWait, 0) / (window.length || 1)).toFixed(1),
    walkers_after_leave: walkers,
    view,
    calls,
    top,
  };
}

const results = [];
for (const n of LEVELS) {
  process.stdout.write(`\n=== ${MODE}: ${n} phones, ${DURATION / 1000}s ===\n`);
  const r = await level(n);
  results.push(r);
  const { calls, top, ...head } = r;
  console.log(JSON.stringify(head));
  console.table(Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, { per_s: v.per_s, err_pct: v.err_pct, p50: v.p50, p95: v.p95, p99: v.p99, avg_kb: v.avg_kb, egress_kb_s: v.egress_kb_s }])));
  for (const [k, v] of Object.entries(calls)) if (Object.keys(v.errors).length) console.log(k, v.errors);
  console.table(top.functions.slice(0, 8));
  await sleep(3000);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
process.exit(0);
