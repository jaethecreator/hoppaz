"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
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
  push_sent_at: string | null;
  push_count: number;
  push_ready: boolean;
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
type Winner = { game_id: string; title: string; crew_name: string; handle: string | null; name: string | null; email: string | null; code: string; object: string | null; won_at: string };
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
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/game-time", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; game?: Game };
        if (r.status === 401) {
          onLock?.();
          return null;
        }
        if (!r.ok || !data.ok) {
          say((data.message ?? "That did not work.").toUpperCase());
          return null;
        }
        await load();
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
          {desk.games.map((g) => (
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold">
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
        {g.push_sent_at ? `Push sent to ${g.push_count}.` : g.push_ready ? "Push not sent yet." : "Push is not set up on this database."}
      </p>
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
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px]" data-gt-admin-winners>
            <thead className="text-dim">
              <tr>
                <th className="py-1 pr-3 font-medium">HANDLE</th>
                <th className="py-1 pr-3 font-medium">EMAIL</th>
                <th className="py-1 pr-3 font-medium">CODE</th>
                <th className="py-1 font-medium">WHEN</th>
              </tr>
            </thead>
            <tbody>
              {winners.map((w) => (
                <tr key={`${w.game_id}-${w.code}`} className="border-t border-line">
                  <td className="py-1 pr-3 text-cream">{w.handle ? `@${w.handle}` : w.name || "no handle"}</td>
                  <td className="py-1 pr-3">{w.email ?? "no email"}</td>
                  <td className="py-1 pr-3 text-cream">{w.code}</td>
                  <td className="py-1">{lagos(w.won_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

const countCodes = (text: string) => text.split(/\r?\n/).map((c) => c.trim()).filter(Boolean).length;

function CreateForm({ desk, busy, act }: { desk: Desk; busy: boolean; act: (body: Record<string, unknown>) => Promise<{ game?: Game } | null> }) {
  const say = useToast((s) => s.say);
  const first = desk.crews.find((c) => /360\s*playlist/i.test(c.name)) ?? desk.crews[0];
  const [crewId, setCrewId] = useState(first?.id ?? "");
  const crew = desk.crews.find((c) => c.id === crewId);
  const objects = useMemo(() => (crew ? desk.objects[`${crew.template}:${crew.width}`] ?? [] : []), [crew, desk.objects]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<"now" | "later">("now");
  const [codes, setCodes] = useState("");
  const [more, setMore] = useState(false);

  // A crew's room has its own objects: start from all of them.
  useEffect(() => {
    setPicked(new Set(objects.map((o) => o.id)));
  }, [objects]);

  const n = countCodes(codes);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!crew) return;
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      action: "create",
      crew_id: crew.id,
      title: String(f.get("title") ?? ""),
      codes_text: codes,
      objects: [...picked],
      relocate_minutes: Number(f.get("relocate") ?? 10),
    };
    if (when === "now") {
      body.start_now = true;
      body.duration_minutes = Number(f.get("duration") ?? 60);
    } else {
      body.opens_at = String(f.get("opens_at") ?? "");
      body.closes_at = String(f.get("closes_at") ?? "");
    }
    if (more) {
      const hot = String(f.get("hot") ?? "");
      const warm = String(f.get("warm") ?? "");
      const key = String(f.get("campaign") ?? "").trim();
      if (hot) body.hot_tiles = Number(hot);
      if (warm) body.warm_tiles = Number(warm);
      if (key) body.campaign_key = key;
    }
    const r = await act(body);
    if (r) {
      say(when === "now" ? "GAME TIME IS LIVE" : "GAME TIME SCHEDULED", "violet");
      setCodes("");
    }
  };

  if (!desk.crews.length) return <p className="hint">No crews on this database.</p>;
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
        <input name="title" required minLength={2} maxLength={60} placeholder="Find the Dave ticket" />
      </label>

      <div role="radiogroup" aria-label="When" className="flex gap-2">
        <button type="button" role="radio" aria-checked={when === "now"} className={`chip min-h-[44px] flex-1 ${when === "now" ? "chip-on" : ""}`} onClick={() => setWhen("now")}>
          START NOW
        </button>
        <button type="button" role="radio" aria-checked={when === "later"} className={`chip min-h-[44px] flex-1 ${when === "later" ? "chip-on" : ""}`} onClick={() => setWhen("later")}>
          SCHEDULE
        </button>
      </div>
      {when === "now" ? (
        <label className="label">
          Runs for (minutes), opens this second and pings the crew
          <input name="duration" type="number" min={1} max={10080} defaultValue={60} required />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="label">
            Opens (Lagos time)
            <input name="opens_at" type="datetime-local" required />
          </label>
          <label className="label">
            Closes (Lagos time)
            <input name="closes_at" type="datetime-local" required />
          </label>
        </div>
      )}

      <label className="label">
        Ticket codes, one per line (1 to 10, one box per code): <b className="text-cream">{n}</b>
        <textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={4} placeholder={"DAVE-1111\nDAVE-2222"} spellCheck={false} data-gt-codes />
      </label>

      <div>
        <p className="label">Objects that may hide a box</p>
        <ObjectBoxes objects={objects} picked={picked} onChange={setPicked} />
        {n > 0 && picked.size < n && <p className="hint mt-1 text-fireant">Every code needs its own object: pick at least {n}.</p>}
      </div>

      <label className="label">
        Minutes before an unfound box moves on (0 means never)
        <input name="relocate" type="number" min={0} max={720} defaultValue={10} required />
      </label>

      <details onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className={SUMMARY}>Hints and the win limit</summary>
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
        <label className="label mt-2 block">
          Campaign key (one win per account across games with the same key; empty means this crew&apos;s own limit)
          <input name="campaign" maxLength={80} placeholder="crew:<crew id>" />
        </label>
      </details>

      <button className="btn" disabled={busy || !crew || n < 1 || n > 10 || picked.size < n}>
        {when === "now" ? "CREATE AND START NOW" : "SCHEDULE GAME TIME"}
      </button>
      {when === "now" && <p className="hint">START NOW opens the hunt this second and sends the opening push to the crew&apos;s members.</p>}
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
