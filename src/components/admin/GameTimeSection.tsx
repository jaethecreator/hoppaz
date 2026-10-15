"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { MARK_MAX, dropMark, parseDrop } from "@/lib/game-time/drops";
import { useToast } from "@/lib/store";

/**
 * The staff desk for Game Time (supabase/game_time.sql, docs/GAME-TIME.md section 6): make one for a crew's room with pasted
 * codes and the objects that may hide a box (checkboxes from that room's template), start it now or schedule it, edit it,
 * close it, watch it live, read the winners and export them. The admin page owns the staff token; every call here goes to
 * /api/admin/game-time with it. Codes and hiding spots show here and nowhere a Hopper can see.
 */

type Crew = { id: string; name: string; verified: boolean; visibility: string; template: string; width: number };
type RoomObject = { id: string; label: string; kind: string; x: number; y: number; w: number; h: number };
type Box = { id: string; code: string; spot: string | null; placed_at: string; claimed_at: string | null; claimed_by: string | null; handle: string | null; name: string | null };
type Game = {
  id: string;
  crew_id: string;
  crew_name: string;
  brand: string;
  title: string;
  status: "upcoming" | "live" | "over";
  phase: "upcoming" | "live" | "all_found" | "closed" | "time_up";
  opens_at: string;
  closes_at: string;
  ended_at: string | null;
  campaign_key: string;
  room_template: string;
  room_width: number;
  room_ok: boolean;
  relocate_minutes: number;
  hot_tiles: number;
  warm_tiles: number;
  min_member_minutes: number;
  push_sent_at: string | null;
  push_count: number;
  push_ready: boolean;
  cron_ready: boolean;
  room_capacity: number | null;
  boxes_total: number;
  boxes_left: number;
  searches: number;
  searchers: number;
  claims: number;
  members: number;
  in_room: number;
  objects?: { id: string }[];
  boxes?: Box[];
};
type Winner = {
  game_id: string;
  title: string;
  crew_name: string;
  handle: string | null;
  name: string | null;
  email: string | null;
  code: string;
  object: string | null;
  won_at: string;
  account_created: string | null;
  email_confirmed: boolean;
  provider: string | null;
  joined_crew: string | null;
  joined_mins_before_open: number | null;
  account_mins_before_open: number | null;
  searches: number | null;
  secs_after_open: number | null;
  flags: string[];
};
type Desk = { games: Game[]; crews: Crew[]; objects: Record<string, RoomObject[]> };

const NOW_KIND: Record<Game["phase"], { tag: string; label: string }> = {
  upcoming: { tag: "", label: "UPCOMING" },
  live: { tag: "pill-keke", label: "LIVE" },
  all_found: { tag: "pill-violet", label: "ALL FOUND" },
  closed: { tag: "", label: "CLOSED" },
  time_up: { tag: "pill-danfo", label: "TIME UP" },
};

/** Lagos wall time, "Fri 16 Oct, 20:00". */
const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
/** An ISO time as a datetime-local value in Lagos time (UTC+1, no daylight saving). */
const lagosInput = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 16);
const SUMMARY = "cursor-pointer py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-orange";

/** Live first, then the ones coming up (soonest first), then everything that ended (newest first): the one in play is never buried. */
const RANK: Record<Game["phase"], number> = { live: 0, upcoming: 1, all_found: 2, closed: 2, time_up: 2 };
function inPlayOrder(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (RANK[a.phase] !== RANK[b.phase]) return RANK[a.phase] - RANK[b.phase];
    const d = Date.parse(a.opens_at) - Date.parse(b.opens_at);
    return a.phase === "upcoming" ? d : -d;
  });
}

/** "5 min", "2 h 10 min", "3 days": minutes as a person reads them. */
function span(mins: number | null): string {
  if (mins === null || !Number.isFinite(mins)) return "?";
  const m = Math.abs(Math.round(mins));
  const sign = mins < 0 ? "-" : "";
  if (m < 90) return `${sign}${m} min`;
  if (m < 2880) return `${sign}${Math.floor(m / 60)} h ${m % 60} min`;
  return `${sign}${Math.round(m / 1440)} days`;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-3">
      <h2 className="seclabel mb-3 text-orange">{title}</h2>
      {children}
    </section>
  );
}

/** A button that asks twice: the first tap changes its label, the second does it. It backs off after 4 seconds. */
function Sure({ label, sure = "SURE?", onYes, disabled, ghost = true }: { label: string; sure?: string; onYes: () => void; disabled: boolean; ghost?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn px-3 py-2 ${ghost && !armed ? "btn-ghost" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onYes();
      }}
    >
      {armed ? sure : label}
    </button>
  );
}

export default function GameTimeSection({ token, onLock }: { token: string; onLock?: () => void }) {
  const say = useToast((s) => s.say);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/game-time", { headers, cache: "no-store" });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Partial<Desk>;
    if (r.status === 401) return onLock?.();
    if (!r.ok || !data.ok) {
      setError(data.message ?? "Game Time did not load.");
      return;
    }
    setError("");
    setDesk({ games: data.games ?? [], crews: data.crews ?? [], objects: data.objects ?? {} });
  }, [headers, onLock]);
  useEffect(() => {
    void load();
  }, [load]);

  /** POST an action; on success reload the list. Returns the answer, or null after telling staff why not. */
  const act = useCallback(
    async (body: Record<string, unknown>, onError?: (message: string) => void) => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/game-time", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; game?: Game };
        if (r.status === 401) {
          onLock?.();
          return null;
        }
        if (!r.ok || !data.ok) {
          if (onError) onError(data.message ?? "That did not work.");
          else say((data.message ?? "That did not work.").toUpperCase());
          return null;
        }
        // The save worked; a reload that fails (a dropped connection) must not make it look as if it had not.
        await load().catch(() => undefined);
        return data;
      } finally {
        setBusy(false);
      }
    },
    [headers, load, onLock, say],
  );

  const exportCsv = async (game: string | null, name: string) => {
    const r = await fetch(`/api/admin/game-time?winners=${game ?? "all"}&format=csv`, { headers, cache: "no-store" });
    if (!r.ok) return say("EXPORT FAILED");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (error) {
    return (
      <Card title="Game Time">
        <p className="hint">{error}</p>
        <button className="btn btn-ghost mt-2 px-3 py-2" onClick={() => void load()}>
          <RefreshCw size={14} /> TRY AGAIN
        </button>
      </Card>
    );
  }
  if (!desk) {
    return (
      <Card title="Game Time">
        <p className="hint">Loading Game Time…</p>
      </Card>
    );
  }

  const live = desk.games.filter((g) => g.phase === "live").length;
  const upcoming = desk.games.filter((g) => g.phase === "upcoming").length;
  const ordered = inPlayOrder(desk.games);

  return (
    <>
      <Card title="Game Time">
        <p className="hint">
          Hide ticket boxes in a crew&apos;s room. Members walk next to an object and SEARCH; the first to find a box wins its code. <b className="text-cream">{live}</b> live ·{" "}
          <b className="text-cream">{upcoming}</b> coming up · <b className="text-cream">{desk.games.length}</b> in all.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost px-3 py-2" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={14} /> REFRESH
          </button>
          <button type="button" className="btn btn-ghost px-3 py-2" onClick={() => void exportCsv(null, "game-time-winners.csv")}>
            <Download size={14} /> EXPORT ALL WINNERS
          </button>
        </div>
        <div className="mt-3">
          {ordered.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              desk={desk}
              busy={busy}
              act={act}
              expanded={open === g.id}
              editing={editing === g.id}
              onToggle={() => setOpen(open === g.id ? null : g.id)}
              onEdit={() => setEditing(editing === g.id ? null : g.id)}
              onExport={() => void exportCsv(g.id, `game-time-winners-${g.id.slice(0, 8)}.csv`)}
              headers={headers}
              reload={load}
            />
          ))}
          {!desk.games.length && <p className="hint">No Game Time yet. Make the first one below.</p>}
        </div>
      </Card>

      <Card title="New Game Time">
        <CreateForm desk={desk} busy={busy} act={act} />
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- a game -- */

function GameRow({
  game: g,
  desk,
  busy,
  act,
  expanded,
  editing,
  onToggle,
  onEdit,
  onExport,
  headers,
  reload,
}: {
  game: Game;
  desk: Desk;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<{ game?: Game } | null>;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onExport: () => void;
  headers: { authorization: string };
  reload: () => Promise<void>;
}) {
  const say = useToast((s) => s.say);
  const kind = NOW_KIND[g.phase];
  const ended = g.status === "over" && g.phase !== "time_up";
  return (
    <div className="border-t border-line py-2 first:border-0" data-gt-admin-game={g.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[min(100%,15rem)] flex-1 basis-[15rem]">
          <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold [overflow-wrap:anywhere]">
            {g.title}
            <span className={`pill ${kind.tag}`}>{kind.label}</span>
            {!g.room_ok && <span className="pill pill-fireant">ROOM CHANGED</span>}
          </p>
          <p className="hint break-words">
            {g.crew_name} · {lagos(g.opens_at)} to {lagos(g.closes_at)} · {g.boxes_total - g.boxes_left} of {g.boxes_total} found · {g.in_room} in the room · {g.searches}{" "}
            {g.searches === 1 ? "search" : "searches"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {g.phase === "upcoming" && (
            <Sure ghost={false} label="START NOW" sure="OPEN IT AND PING?" disabled={busy} onYes={() => void act({ action: "start_now", id: g.id }).then((r) => r && say("GAME TIME STARTED", "violet"))} />
          )}
          {(g.phase === "upcoming" || g.phase === "live") && (
            <Sure label="CLOSE NOW" sure="CLOSE IT?" disabled={busy} onYes={() => void act({ action: "close", id: g.id }).then((r) => r && say("GAME TIME CLOSED", "violet"))} />
          )}
          <button type="button" className="btn btn-ghost px-3 py-2" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? "HIDE" : "LIVE STATUS"}
          </button>
          {!ended && (
            <button type="button" className="btn btn-ghost px-3 py-2" onClick={onEdit} aria-expanded={editing}>
              {editing ? "CANCEL" : "EDIT"}
            </button>
          )}
        </div>
      </div>
      {expanded && <Details id={g.id} headers={headers} onExport={onExport} reload={reload} summary={g} />}
      {editing && <EditForm id={g.id} desk={desk} headers={headers} busy={busy} act={act} onDone={onEdit} />}
    </div>
  );
}

/** Live status: the counts, every box with its code and where it hides now, and the winners. Refreshes every 5 s while it runs. */
function Details({ id, headers, onExport, reload, summary }: { id: string; headers: { authorization: string }; onExport: () => void; reload: () => Promise<void>; summary: Game }) {
  const [game, setGame] = useState<Game | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const alive = useRef(true);
  const running = summary.status !== "over";

  const read = useCallback(async () => {
    const [g, w] = await Promise.all([
      fetch(`/api/admin/game-time?id=${id}`, { headers, cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/admin/game-time?winners=${id}`, { headers, cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (!alive.current) return;
    if (g?.ok) setGame(g.game as Game);
    if (w?.ok) setWinners(w.winners as Winner[]);
  }, [id, headers]);

  useEffect(() => {
    alive.current = true;
    void read();
    if (!running) return () => void (alive.current = false);
    const t = setInterval(() => {
      void read();
      void reload();
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [read, reload, running]);

  const g = game ?? summary;
  const label = (spot: string | null) => (spot ? spot.replace(/[-_]+/g, " ") : "");
  return (
    <div className="mt-2 rounded border border-line p-2" data-gt-admin-details>
      <p className="hint">
        <b className="text-cream">{g.in_room}</b> in the room now · <b className="text-cream">{g.members}</b> members · <b className="text-cream">{g.searchers}</b> searched ·{" "}
        <b className="text-cream">{g.searches}</b> {g.searches === 1 ? "search" : "searches"} · <b className="text-cream">{g.claims}</b> {g.claims === 1 ? "win" : "wins"}. Box moves on after{" "}
        {g.relocate_minutes ? `${g.relocate_minutes} min` : "never"}. Hot to {g.hot_tiles} tiles, warm to {g.warm_tiles}. Campaign {g.campaign_key}.{" "}
        {g.min_member_minutes ? `Members of at least ${span(g.min_member_minutes)} before it opens.` : "Any member can hunt."}{" "}
        {g.push_sent_at ? (g.push_count ? `Push sent to ${g.push_count}.` : "No opening push went out (quiet hours, a rehearsal, or nobody to tell).") : g.push_ready ? "Push not sent yet." : "Push is not set up on this database."}
      </p>
      <p className="hint mt-1" data-gt-admin-health>
        Room fits <b className="text-cream">{g.room_capacity ?? "?"}</b> walkers; <b className="text-cream">{g.members}</b> are members. Minute tick{" "}
        <b className={g.cron_ready ? "text-cream" : "text-fireant"}>{g.cron_ready ? "is running" : "IS OFF (pushes and box moves wait for a Hopper to load the room)"}</b>.
      </p>
      {g.room_capacity !== null && g.status !== "over" && g.members > g.room_capacity && (
        <p className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-fireant" data-gt-admin-cap-warning>
          {g.members} members but the room fits {g.room_capacity}. The rest only watch. Raise the room&apos;s capacity before the drop.
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="text-dim">
            <tr>
              <th className="py-1 pr-3 font-medium">CODE</th>
              <th className="py-1 pr-3 font-medium">OBJECT</th>
              <th className="py-1 font-medium">FOUND BY</th>
            </tr>
          </thead>
          <tbody>
            {(game?.boxes ?? []).map((b) => (
              <tr key={b.id} className="border-t border-line" data-gt-admin-box={b.claimed_at ? "found" : "hiding"}>
                <td className="py-1 pr-3 text-cream">{b.code}</td>
                <td className="py-1 pr-3 uppercase">{label(b.spot)}</td>
                <td className="py-1 uppercase">{b.claimed_at ? `${b.handle ? `@${b.handle}` : b.name || "someone"} · ${lagos(b.claimed_at)}` : "STILL HIDING"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="seclabel mt-3">WINNERS</p>
      {winners.length ? (
        <ul className="mt-1 grid gap-2" data-gt-admin-winners>
          {winners.map((w) => (
            <li key={`${w.game_id}-${w.code}`} className="min-w-0 rounded border border-line p-2 font-mono text-[11px]" data-gt-admin-winner>
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 text-[12px] font-bold text-cream [overflow-wrap:anywhere]">{w.handle ? `@${w.handle}` : w.name || "no handle"}</span>
                <span className="text-cream [overflow-wrap:anywhere]">{w.code}</span>
              </p>
              <p className="mt-0.5 break-all text-dim">{w.email ?? "no email"}</p>
              <p className="mt-0.5 text-dim">
                {lagos(w.won_at)} · {w.secs_after_open !== null ? `${w.secs_after_open} s after the opening` : ""} · {w.searches ?? "?"} {w.searches === 1 ? "search" : "searches"}
              </p>
              <p className="mt-0.5 text-dim">
                Joined the crew {w.joined_mins_before_open === null ? "(no longer a member)" : `${span(w.joined_mins_before_open)} before the opening`} · account made{" "}
                {span(w.account_mins_before_open)} before it · email {w.email_confirmed ? "confirmed" : "NOT confirmed"}
                {w.provider ? ` (${w.provider})` : ""}
              </p>
              {w.flags?.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {w.flags.map((f) => (
                    <span key={f} className="pill pill-fireant">
                      {f}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint mt-1">Nobody has won yet.</p>
      )}
      <button type="button" className="btn btn-ghost mt-2 px-3 py-2" onClick={onExport}>
        <Download size={14} /> EXPORT WINNERS (CSV)
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ the forms -- */

function ObjectBoxes({ objects, picked, onChange, disabled }: { objects: RoomObject[]; picked: Set<string>; onChange: (next: Set<string>) => void; disabled?: boolean }) {
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="hint">
          <b className="text-cream">{picked.size}</b> of {objects.length} objects
        </span>
        <button type="button" className="chip" disabled={disabled} onClick={() => onChange(new Set(objects.map((o) => o.id)))}>
          ALL
        </button>
        <button type="button" className="chip" disabled={disabled} onClick={() => onChange(new Set())}>
          NONE
        </button>
      </div>
      <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto rounded border border-line p-2" role="group" aria-label="Objects that may hide a box">
        {objects.map((o) => (
          <label key={o.id} className="flex min-h-[32px] items-center gap-2 font-body text-[13px]">
            <input type="checkbox" className="!h-4 !w-4 flex-none" checked={picked.has(o.id)} disabled={disabled} onChange={() => toggle(o.id)} data-gt-object={o.id} />
            <span className="min-w-0 truncate">{o.label}</span>
          </label>
        ))}
        {!objects.length && <p className="hint col-span-2">This room has no objects that can hide a box.</p>}
      </div>
    </div>
  );
}

/** "Thu 21:30" in Lagos time, from a time in ms. */
function lagosShort(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}`;
}
/** A datetime-local value (Lagos wall time, no zone) as ms; NaN when empty or invalid. */
const lagosMs = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00+01:00`) : NaN);
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A small seeded random number generator (mulberry32): the same seed gives the same mystery times, so the preview holds still. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The opening time of every drop. Drop 1 opens at the first time exactly. With mystery on, drop i (from 2) opens at a random
 * minute inside its window [first + i * every, first + (i + 1) * every - length], so every drop keeps the same length and
 * the drops never overlap (a drop opens at least a minute after the one before has closed). With it off the drops are
 * exactly `every` hours apart.
 */
function dropTimes(first: number, every: number, count: number, length: number, mystery: boolean, seed: number): number[] {
  const rand = seeded(seed);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0 || !mystery) {
      times.push(first + i * every);
      continue;
    }
    const lo = Math.max(first + i * every, times[i - 1] + length + MINUTE);
    const hi = Math.max(lo, first + (i + 1) * every - length);
    times.push(lo + Math.floor(rand() * ((hi - lo) / MINUTE + 1)) * MINUTE);
  }
  return times;
}

const codeLines = (text: string) => text.split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
const countCodes = (text: string) => text.split(/\r?\n/).map((c) => c.trim()).filter(Boolean).length;

/** A key for a rehearsal: unique, so it never uses up a Hopper's real win. "rehearsal-1016-2035-k3f9" */
function newRehearsalKey(): string {
  const d = new Date(Date.now() + 3_600_000).toISOString(); // Lagos wall time
  const rand = Math.random().toString(36).slice(2, 6);
  return `rehearsal-${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}-${rand}`;
}

function CreateForm({ desk, busy, act }: { desk: Desk; busy: boolean; act: (body: Record<string, unknown>, onError?: (message: string) => void) => Promise<{ game?: Game } | null> }) {
  const say = useToast((s) => s.say);
  const first = desk.crews.find((c) => /360\s*playlist/i.test(c.name)) ?? desk.crews[0];
  const [crewId, setCrewId] = useState(first?.id ?? "");
  const crew = desk.crews.find((c) => c.id === crewId);
  const objects = useMemo(() => (crew ? desk.objects[`${crew.template}:${crew.width}`] ?? [] : []), [crew, desk.objects]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // SCHEDULE is the default: a hunt that opens by accident pings the whole crew.
  const [when, setWhen] = useState<"now" | "later">("later");
  const [codes, setCodes] = useState("");
  const [more, setMore] = useState(false);
  const [campaign, setCampaign] = useState("");
  // Starts at 0 (any member can hunt), Jae's call for the 360Playlist night. Staff raise it to keep late joiners out.
  const [members, setMembers] = useState("0");
  const [rehearsal, setRehearsal] = useState(false);
  const [rehearsalKey, setRehearsalKey] = useState("");
  // START NOW asks twice: the first press changes the button, the second opens the hunt.
  const [armed, setArmed] = useState(false);
  // REPEAT (schedule only): the same hunt every few hours, one code and one box per drop.
  const [repeat, setRepeat] = useState(false);
  const [every, setEvery] = useState("3");
  const [drops, setDrops] = useState("8");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState("");
  // Mystery times (on with Repeat): drop 1 at the exact time, every later drop at a random moment in its window.
  const [mystery, setMystery] = useState(true);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [title, setTitle] = useState("");

  // A crew's room has its own objects: start from all of them.
  useEffect(() => {
    setPicked(new Set(objects.map((o) => o.id)));
  }, [objects]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const n = countCodes(codes);
  // The win limit that will apply, and how many Hoppers have already used it up.
  const key = rehearsal ? rehearsalKey : campaign.trim() || `crew:${crewId}`;
  const used = desk.games.filter((g) => g.campaign_key === key).reduce((sum, g) => sum + g.claims, 0);

  // The repeat plan: drop i opens at the first opening + i * interval and stays open as long as the first one.
  const repeating = repeat && when === "later" && !rehearsal;
  const everyN = Math.floor(Number(every));
  const dropsN = Math.floor(Number(drops));
  const mysteryOn = repeating && mystery;
  const baseTitle = parseDrop(title.trim()).title;
  const plan = useMemo(() => {
    if (!repeating) return { problem: "", times: [] as number[] };
    if (!(everyN >= 1 && everyN <= 12)) return { problem: "Every: 1 to 12 hours.", times: [] };
    if (!(dropsN >= 2 && dropsN <= 24)) return { problem: "Drops: 2 to 24.", times: [] };
    const o = lagosMs(opensAt);
    const c = lagosMs(closesAt);
    if (!Number.isFinite(o) || !Number.isFinite(c)) return { problem: "Set the first opens and closes time.", times: [] };
    if (c <= o) return { problem: "Closes must be after opens.", times: [] };
    if (c - o >= everyN * HOUR) return { problem: "Each window must be shorter than the gap between drops.", times: [] };
    return { problem: "", times: dropTimes(o, everyN * HOUR, dropsN, c - o, mystery, seed) };
  }, [repeating, everyN, dropsN, opensAt, closesAt, mystery, seed]);
  const codeProblem = repeating && n !== dropsN ? `Repeat needs one code per drop: ${dropsN} drops, ${n} code${n === 1 ? "" : "s"}.` : "";
  const titleProblem = mysteryOn && baseTitle.length + MARK_MAX > 60 ? `With the drop counter the title can have ${60 - MARK_MAX} characters at most.` : "";
  const repeatOk = !repeating || (!plan.problem && !codeProblem && !titleProblem && picked.size >= 1);
  // A warning, not a block: the first opening is already gone, so the server will say no to it.
  const firstPast = repeating && Number.isFinite(lagosMs(opensAt)) && lagosMs(opensAt) <= Date.now();
  const preview = plan.times.length
    ? mysteryOn
      ? `${plan.times.length} drops: ${plan.times.map((t, i) => `${i + 1}. ${lagosShort(t)}`).join(", ")}`
      : `${plan.times.length} drops: ${(plan.times.length > 8 ? [...plan.times.slice(0, 6).map(lagosShort), "...", lagosShort(plan.times[plan.times.length - 1])] : plan.times.map(lagosShort)).join(", ")}`
    : "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!crew) return;
    if (when === "now" && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setOutcome("");
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      action: "create",
      crew_id: crew.id,
      title: String(f.get("title") ?? ""),
      codes_text: codes,
      objects: [...picked],
      relocate_minutes: Number(f.get("relocate") ?? 10),
      min_member_minutes: rehearsal ? 0 : Math.max(0, Math.floor(Number(members) || 0)),
    };
    if (when === "now") {
      body.start_now = true;
      body.duration_minutes = Number(f.get("duration") ?? 60);
    } else {
      body.opens_at = String(f.get("opens_at") ?? "");
      body.closes_at = String(f.get("closes_at") ?? "");
    }
    if (rehearsal) {
      body.silent = true;
      body.campaign_key = rehearsalKey;
    } else if (campaign.trim()) {
      body.campaign_key = campaign.trim();
    }
    if (more) {
      const hot = String(f.get("hot") ?? "");
      const warm = String(f.get("warm") ?? "");
      if (hot) body.hot_tiles = Number(hot);
      if (warm) body.warm_tiles = Number(warm);
    }
    if (repeating) {
      if (!repeatOk) return;
      const lines = codeLines(codes);
      const windowMs = lagosMs(closesAt) - lagosMs(opensAt);
      setRunning(true);
      let done = 0;
      let reason = "";
      try {
        for (let i = 0; i < plan.times.length; i++) {
          const opens = plan.times[i];
          const r = await act(
            {
              ...body,
              // Mystery drops carry their place in the title ("Dave's concert · 2/5"): Hoppers' screens read it, never show it.
              title: mysteryOn ? `${baseTitle}${dropMark(i + 1, plan.times.length)}` : body.title,
              codes_text: lines[i],
              opens_at: lagosInput(new Date(opens).toISOString()),
              closes_at: lagosInput(new Date(opens + windowMs).toISOString()),
            },
            (m) => (reason = m),
          );
          if (!r) break;
          done++;
        }
      } catch {
        // The connection dropped part way: a drop may or may not have been saved, so staff look at the list.
        reason = "network";
      } finally {
        setRunning(false);
      }
      if (done === plan.times.length && !reason) {
        setOutcome(`${done} of ${done} scheduled.`);
        say(`${done} DROPS SCHEDULED`, "violet");
        setCodes("");
      } else {
        setOutcome(`${done} of ${plan.times.length} scheduled. Stopped: ${reason || "that did not work."} Check the list.`);
      }
      return;
    }
    const r = await act(body);
    if (r) {
      say(when === "now" ? "GAME TIME IS LIVE" : "GAME TIME SCHEDULED", "violet");
      setCodes("");
    }
  };

  if (!desk.crews.length) return <p className="hint">No crews on this database.</p>;
  const label = when === "later" ? "SCHEDULE GAME TIME" : armed ? (rehearsal ? "OPEN IT NOW?" : "OPEN IT AND PING THE CREW?") : "CREATE AND START NOW";
  return (
    <form className="grid gap-3" onSubmit={submit} data-gt-create>
      <label className="label">
        Crew
        <select value={crewId} onChange={(e) => setCrewId(e.target.value)} required>
          {desk.crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.template}, {c.width} wide)
            </option>
          ))}
        </select>
      </label>
      <label className="label">
        Title
        <input name="title" required minLength={2} maxLength={60} placeholder="Find the Dave ticket" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <div role="radiogroup" aria-label="When" className="flex gap-2">
        <button type="button" role="radio" aria-checked={when === "later"} className={`chip min-h-[44px] flex-1 ${when === "later" ? "chip-on" : ""}`} onClick={() => { setWhen("later"); setArmed(false); }}>
          SCHEDULE
        </button>
        <button type="button" role="radio" aria-checked={when === "now"} className={`chip min-h-[44px] flex-1 ${when === "now" ? "chip-on" : ""}`} onClick={() => { setWhen("now"); setArmed(false); }}>
          START NOW
        </button>
      </div>
      {when === "now" ? (
        <label className="label">
          Runs for (minutes), opens this second{rehearsal ? "" : " and pings the crew"}
          <input name="duration" type="number" min={1} max={10080} defaultValue={60} required />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="label">
            Opens (Lagos time)
            <input name="opens_at" type="datetime-local" required value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          </label>
          <label className="label">
            Closes (Lagos time)
            <input name="closes_at" type="datetime-local" required value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </label>
        </div>
      )}
      {when === "later" && !rehearsal && (
        <div className="rounded border border-line p-2" data-gt-repeat>
          <label className="flex min-h-[44px] items-center gap-2 font-body text-[13px]">
            <input type="checkbox" role="switch" className="!h-4 !w-4 flex-none" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} data-gt-repeat-switch />
            <span>
              <b className="text-cream">REPEAT</b>: the same hunt again and again
            </span>
          </label>
          {repeat && (
            <>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="label">
                  Every (hours)
                  <input type="number" inputMode="numeric" min={1} max={12} value={every} onChange={(e) => setEvery(e.target.value)} data-gt-repeat-every />
                </label>
                <label className="label">
                  Drops
                  <input type="number" inputMode="numeric" min={2} max={24} value={drops} onChange={(e) => setDrops(e.target.value)} data-gt-repeat-drops />
                </label>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 font-body text-[13px]">
                <input type="checkbox" role="switch" className="!h-4 !w-4 flex-none" checked={mystery} onChange={(e) => setMystery(e.target.checked)} data-gt-mystery-switch />
                <span>
                  <b className="text-cream">MYSTERY TIMES</b>: drops 2 onward open at a random moment
                </span>
              </label>
              <p className="hint mt-1">
                {mystery
                  ? "Drop 1 opens at the exact time. Each later drop opens at a random moment in its slot. Titles get a counter (Dave's concert · 2/5). Hoppers never see a countdown after drop 1."
                  : "One code per line, one per drop. Each drop opens the same time after the last and stays open as long as the first. Hoppers see a countdown for each."}
              </p>
              {(plan.problem || codeProblem || titleProblem) && <p className="hint mt-1 !text-fireant" data-gt-repeat-problem>{plan.problem || codeProblem || titleProblem}</p>}
              {firstPast && <p className="hint mt-1 !text-fireant" data-gt-repeat-past>The first opens time is in the past. Pick a time ahead or the first drop will be refused.</p>}
              {preview && <p className="hint mt-1" data-gt-repeat-preview>{preview}</p>}
              {mysteryOn && plan.times.length > 0 && (
                <button type="button" className="btn btn-ghost mt-1 px-3 py-2" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))} data-gt-mystery-shuffle>
                  <RefreshCw size={14} /> SHUFFLE TIMES
                </button>
              )}
            </>
          )}
        </div>
      )}

      <label className="label">
        {repeating ? `Ticket codes, one per line (one per drop, ${dropsN > 0 ? dropsN : "?"} needed)` : "Ticket codes, one per line (1 to 10, one box per code)"}: <b className="text-cream">{n}</b>
        <textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={4} placeholder={"DAVE-1111\nDAVE-2222"} spellCheck={false} data-gt-codes />
      </label>

      <div>
        <p className="label">Objects that may hide a box</p>
        <ObjectBoxes objects={objects} picked={picked} onChange={setPicked} />
        {n > 0 && picked.size < (repeating ? 1 : n) && <p className="hint mt-1 text-fireant">Every code needs its own object: pick at least {repeating ? 1 : n}.</p>}
      </div>

      <label className="label">
        Minutes before an unfound box moves on (0 means never)
        <input name="relocate" type="number" min={0} max={720} defaultValue={10} required />
      </label>

      <div>
        <label className="label">
          Members for at least this many minutes before it opens (0 means any member)
          <input name="members" type="number" min={0} max={10080} value={rehearsal ? "0" : members} disabled={rehearsal} onChange={(e) => setMembers(e.target.value)} data-gt-members />
        </label>
        <p className="hint mt-1">One person with a pile of new accounts can clear a hunt in seconds. A Hopper who joined later can watch, not hunt. Use 30 or more for a real drop.</p>
      </div>

      <div className="rounded border border-line p-2" data-gt-limit>
        <label className="flex min-h-[44px] items-center gap-2 font-body text-[13px]">
          <input type="checkbox" className="!h-4 !w-4 flex-none" checked={rehearsal} onChange={(e) => { setRehearsal(e.target.checked); if (e.target.checked) setRehearsalKey(newRehearsalKey()); }} data-gt-rehearsal />
          <span>
            <b className="text-cream">REHEARSAL</b>: its own win limit, no opening push, any member can hunt. Use it for tests so nobody&apos;s real win is used up.
          </span>
        </label>
        <label className="label mt-1 block">
          Win limit (campaign key)
          <input value={rehearsal ? rehearsalKey : campaign} onChange={(e) => setCampaign(e.target.value)} disabled={rehearsal} maxLength={80} placeholder={`crew:${crewId.slice(0, 8)}… (this crew's own limit)`} data-gt-campaign />
        </label>
        <p className="hint mt-1">One win per Hopper for every Game Time that shares the same key.</p>
        <p className={`hint mt-1 ${used > 0 ? "!text-fireant" : ""}`} data-gt-limit-note>
          {rehearsal
            ? "This test has a limit of its own. Nobody's real win is touched."
            : campaign.trim()
              ? `Key "${campaign.trim()}".`
              : "Empty means every Game Time of this crew shares ONE win per Hopper."}{" "}
          {!rehearsal && used > 0 ? `${used} Hopper${used === 1 ? "" : "s"} already won on this limit and cannot win again.` : ""}
        </p>
      </div>

      <details onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className={SUMMARY}>Hints (hot and warm rings)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="label">
            Hot up to (tiles)
            <input name="hot" type="number" step="0.5" min={0.5} max={100} defaultValue={5} />
          </label>
          <label className="label">
            Warm up to (tiles)
            <input name="warm" type="number" step="0.5" min={0.5} max={200} defaultValue={10} />
          </label>
        </div>
        <p className="hint mt-1">One box: 5 and 10 gives a useful hint. Three or more boxes: try 3 and 6, or hot will be the answer a third of the time.</p>
      </details>

      <button className={`btn ${armed ? "!bg-fireant" : ""}`} disabled={busy || running || !crew || n < 1 || (repeating ? !repeatOk : n > 10 || picked.size < n)} data-gt-submit={when}>
        {running ? "SCHEDULING…" : repeating ? `SCHEDULE ${dropsN > 0 ? dropsN : ""} DROPS` : label}
      </button>
      {outcome && <p className="hint !text-cream" role="status" data-gt-repeat-outcome>{outcome}</p>}
      {when === "now" && !rehearsal && <p className="hint">START NOW opens the hunt this second and sends the opening push to the crew&apos;s members. Press twice.</p>}
      {rehearsal && <p className="hint">A rehearsal sends no push. Members with the app open will still see the in-app Game Time card.</p>}
    </form>
  );
}

function EditForm({
  id,
  desk,
  headers,
  busy,
  act,
  onDone,
}: {
  id: string;
  desk: Desk;
  headers: { authorization: string };
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<{ game?: Game } | null>;
  onDone: () => void;
}) {
  const say = useToast((s) => s.say);
  const [game, setGame] = useState<Game | null>(null);
  const [codes, setCodes] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void fetch(`/api/admin/game-time?id=${id}`, { headers, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return;
        const g = d.game as Game;
        setGame(g);
        setCodes((g.boxes ?? []).map((b) => b.code).join("\n"));
        setPicked(new Set((g.objects ?? []).map((o) => o.id)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, headers]);

  if (!game) return <p className="hint mt-2">Loading the game…</p>;
  const crew = desk.crews.find((c) => c.id === game.crew_id);
  const objects = crew ? desk.objects[`${crew.template}:${crew.width}`] ?? [] : [];
  const won = game.claims > 0;
  const opened = Date.parse(game.opens_at) <= Date.now() || game.status !== "upcoming";
  const was = new Set((game.objects ?? []).map((o) => o.id));
  const objectsChanged = picked.size !== was.size || [...picked].some((o) => !was.has(o));
  const codesChanged = codes.split(/\r?\n/).map((c) => c.trim()).filter(Boolean).join("\n") !== (game.boxes ?? []).map((b) => b.code).join("\n");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = { action: "update", id };
    const title = String(f.get("title") ?? "").trim();
    if (title !== game.title) patch.title = title;
    const closes = String(f.get("closes_at") ?? "");
    if (closes && closes !== lagosInput(game.closes_at)) patch.closes_at = closes;
    const opens = String(f.get("opens_at") ?? "");
    if (!opened && opens && opens !== lagosInput(game.opens_at)) patch.opens_at = opens;
    const relocate = Number(f.get("relocate"));
    if (relocate !== game.relocate_minutes) patch.relocate_minutes = relocate;
    const minMembers = Number(f.get("members"));
    if (!opened && Number.isFinite(minMembers) && minMembers !== game.min_member_minutes) patch.min_member_minutes = minMembers;
    const hot = Number(f.get("hot"));
    if (hot !== game.hot_tiles) patch.hot_tiles = hot;
    const warm = Number(f.get("warm"));
    if (warm !== game.warm_tiles) patch.warm_tiles = warm;
    if (!won && codesChanged) patch.codes_text = codes;
    if (objectsChanged) patch.objects = [...picked];
    if (Object.keys(patch).length === 2) return say("NOTHING TO CHANGE");
    if (await act(patch)) {
      say("GAME TIME SAVED", "violet");
      onDone();
    }
  };

  return (
    <form className="mt-2 grid gap-3 rounded border border-line p-2" onSubmit={submit} data-gt-edit>
      <label className="label">
        Title
        <input name="title" defaultValue={game.title} required minLength={2} maxLength={60} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Opens (Lagos time){opened ? ", already open" : ""}
          <input name="opens_at" type="datetime-local" defaultValue={lagosInput(game.opens_at)} disabled={opened} />
        </label>
        <label className="label">
          Closes (Lagos time)
          <input name="closes_at" type="datetime-local" defaultValue={lagosInput(game.closes_at)} />
        </label>
      </div>
      <label className="label">
        Ticket codes{won ? ", locked because someone won" : ""}
        <textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={4} disabled={won} spellCheck={false} />
      </label>
      <div>
        <p className="label">Objects that may hide a box (boxes on a removed object move to a free one)</p>
        <ObjectBoxes objects={objects} picked={picked} onChange={setPicked} />
      </div>
      <label className="label">
        Members for at least (minutes) before it opens{opened ? ", already open" : ""}
        <input name="members" type="number" min={0} max={10080} defaultValue={game.min_member_minutes} disabled={opened} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="label">
          Moves on (min)
          <input name="relocate" type="number" min={0} max={720} defaultValue={game.relocate_minutes} required />
        </label>
        <label className="label">
          Hot (tiles)
          <input name="hot" type="number" step="0.5" min={0.5} max={100} defaultValue={game.hot_tiles} required />
        </label>
        <label className="label">
          Warm (tiles)
          <input name="warm" type="number" step="0.5" min={0.5} max={200} defaultValue={game.warm_tiles} required />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn flex-1" disabled={busy}>
          SAVE CHANGES
        </button>
        <button type="button" className="btn btn-ghost flex-none" onClick={onDone}>
          CANCEL
        </button>
      </div>
    </form>
  );
}
