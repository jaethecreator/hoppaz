"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Ticket } from "lucide-react";
import { EditForm } from "@/components/admin/GameTimeSection";
import { useToast } from "@/lib/store";
import { PHASE_PILL, dropLabel, dropOf, hhmm, isRehearsalKey, lagosDay, plural, seriesName, span, spotLabel } from "./format";
import type { Box, Game, GameTimeDeskApi, Winner } from "./types";
import { fetchGame, fetchWinners } from "./useDesk";

/**
 * The cards of one drop on the staff desk. Every drop gets its own card, and a drop with more than one code says so: that
 * is what Jae misread on the old desk (two pasted codes looked like one drop with two winners). Live drops poll their own
 * numbers; past drops read their boxes and winners once.
 */

/** A block of the desk: a small title row (title in cream, an optional note on the right) over its content. */
export function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="seclabel text-cream">{title}</h3>
        {note ? <p className="hint text-right">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The dashed card of a block with nothing in it. */
export function EmptyCard({ children }: { children: ReactNode }) {
  return <p className="rounded-hz border border-dashed border-line px-4 py-4 text-[14px] text-dim">{children}</p>;
}

/** A button that asks twice: the first tap changes its label, the second does it. It backs off after 4 seconds. */
export function Sure({
  label,
  sure = "SURE?",
  onYes,
  disabled,
  ghost = true,
  className = "px-3 py-2",
}: {
  label: string;
  sure?: string;
  onYes: () => void;
  disabled: boolean;
  ghost?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn ${ghost && !armed ? "btn-ghost" : ""} ${className}`}
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

/** The clock, ticking on its own so "18 min left" stays true on a screen nobody touches. */
function useNow(every = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/* ----------------------------------------------------------- a found box -- */

/** One found box as the desk reads it: who, where, when, and the checks staff look at before handing over a prize. */
type Found = {
  label: string;
  handle: string | null;
  name: string | null;
  code: string;
  spot: string | null;
  at: string;
  secs: number | null;
  /** Null when the winners did not load, so the desk does not claim either way. */
  confirmed: boolean | null;
  /** Minutes in the crew before it opened. Null: no longer a member. Undefined: not known. */
  joined: number | null | undefined;
  searches: number | null | undefined;
  flags: string[];
};

const fromWinner = (w: Winner, label: string): Found => ({
  label,
  handle: w.handle,
  name: w.name,
  code: w.code,
  spot: w.object,
  at: w.won_at,
  secs: w.secs_after_open,
  confirmed: w.email_confirmed,
  joined: w.joined_mins_before_open,
  searches: w.searches,
  flags: w.flags ?? [],
});

/** A found box without its winner record (the winners did not load): what the box itself knows. */
const fromBox = (b: Box, label: string, opensAt: string): Found => ({
  label,
  handle: b.handle,
  name: b.name,
  code: b.code,
  spot: b.spot,
  at: b.claimed_at ?? "",
  secs: b.claimed_at ? Math.max(0, Math.round((Date.parse(b.claimed_at) - Date.parse(opensAt)) / 1000)) : null,
  confirmed: null,
  joined: undefined,
  searches: undefined,
  flags: [],
});

function FoundRow({ f }: { f: Found }) {
  const who = f.handle ? `@${f.handle}` : f.name || "no handle";
  const checks: ReactNode[] = [];
  if (f.confirmed !== null) checks.push(f.confirmed ? "Email confirmed" : <span className="text-fireant">Email NOT confirmed</span>);
  if (f.joined !== undefined) {
    checks.push(f.joined === null ? "no longer in the crew" : f.joined < 0 ? `joined the crew ${span(-f.joined)} after it opened` : `joined the crew ${span(f.joined)} before it opened`);
  }
  if (f.searches !== undefined && f.searches !== null) checks.push(plural(f.searches, "search", "searches"));
  return (
    <div className="min-w-0 rounded-hz border border-line bg-ink-3 p-3.5" data-desk-found>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="seclabel">{f.label}</span>
        <span className="min-w-0 font-display text-[17px] font-black [overflow-wrap:anywhere]">{who}</span>
        {f.handle && f.name ? <span className="text-[14px] text-dim">{f.name}</span> : null}
        <span className="ml-auto font-mono text-[13px] text-cream [overflow-wrap:anywhere]">{f.code}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-dim">
        Found{f.spot ? ` at ${spotLabel(f.spot)}` : ""}
        {f.at ? ` · ${hhmm(f.at)}` : ""}
        {f.secs !== null ? ` · ${f.secs < 59.5 ? `${Math.round(f.secs)} s` : span(f.secs / 60)} after it opened` : ""}
      </p>
      {checks.length > 0 && (
        <p className="mt-0.5 text-[13px] leading-snug text-dim">
          {checks.map((c, i) => (
            <Fragment key={i}>
              {i > 0 ? " · " : ""}
              {c}
            </Fragment>
          ))}
        </p>
      )}
      {f.flags.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {f.flags.map((flag) => (
            <span key={flag} className="pill pill-fireant">
              {flag}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** A box nobody found: its code is still good, so staff can use it in a new drop. */
function UnfoundRow({ code }: { code: string }) {
  return (
    <div className="min-w-0 rounded-hz border border-dashed border-line p-3.5" data-desk-unfound>
      <p className="text-[15px] text-cream">Nobody found it.</p>
      <p className="hint mt-0.5">
        Code <span className="font-mono text-cream [overflow-wrap:anywhere]">{code}</span> was not won. You can use it in a new drop.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- live drop -- */

/**
 * A drop that is open now: when it closes, how many tickets are found, how many are in the room, and (for staff only) where
 * the boxes hide. It reads its own numbers every 5 s and asks the desk to reload every 20 s, so the room's health shows
 * without a refresh. WATCH IT LIVE opens every box and the winners with their checks; EDIT opens the edit form inline.
 */
export function LiveDropCard({ game, gt, showCrew, onOpenRoom }: { game: Game; gt: GameTimeDeskApi; showCrew?: boolean; onOpenRoom?: (crewId: string) => void }) {
  const { headers } = gt;
  const now = useNow();
  const [full, setFull] = useState<Game | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [watching, setWatching] = useState(false);
  const [editing, setEditing] = useState(false);
  // The desk's load changes identity when the shell re-renders; a ref keeps the 20 s timer running.
  const reload = useRef(gt.load);
  reload.current = gt.load;

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const g = await fetchGame(headers, game.id);
      if (alive && g) setFull(g);
    };
    void read();
    const poll = setInterval(() => void read(), 5000);
    const desk = setInterval(() => void reload.current(), 20_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(desk);
    };
  }, [headers, game.id]);

  useEffect(() => {
    if (!watching) return;
    let alive = true;
    const read = async () => {
      const w = await fetchWinners(headers, game.id);
      if (alive) setWinners(w);
    };
    void read();
    const poll = setInterval(() => void read(), 5000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [watching, headers, game.id]);

  const g = full ?? game;
  const d = dropOf(game);
  const found = g.boxes_total - g.boxes_left;
  const minsLeft = Math.ceil((Date.parse(g.closes_at) - now) / 60_000);
  const hiding = (full?.boxes ?? []).filter((b) => !b.claimed_at);
  const where = [...new Set(hiding.map((b) => spotLabel(b.spot)).filter(Boolean))];
  const spots = full?.objects?.length ?? 0;
  const over = g.room_capacity !== null && g.members > g.room_capacity;

  return (
    <article className="card min-w-0 border-keke/60 p-4 lg:p-5" data-desk-live-drop={game.id}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <h4 className="font-display text-lg font-black [overflow-wrap:anywhere]">{d.title}</h4>
        <span className={`pill ${PHASE_PILL.live.cls}`}>{PHASE_PILL.live.label}</span>
        {d.i ? (
          <span className="pill">
            DROP {d.i} OF {d.n}
          </span>
        ) : null}
      </div>
      {showCrew && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-dim">
          {game.crew_name}
          {onOpenRoom && (
            <button type="button" className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-orange underline-offset-2 hover:underline" onClick={() => onOpenRoom(game.crew_id)}>
              OPEN ROOM
            </button>
          )}
        </p>
      )}
      <p className="hint mt-1.5">
        Opened {hhmm(g.opens_at)} · closes {hhmm(g.closes_at)} · {minsLeft <= 0 ? "closing now" : `${span(minsLeft)} left`}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-line py-4">
        <div className="min-w-0">
          <p className="num text-2xl lg:text-[28px]">
            {found} of {g.boxes_total}
          </p>
          <p className="seclabel mt-2.5">{g.boxes_total === 1 ? "Ticket found" : "Tickets found"}</p>
        </div>
        <div className="min-w-0">
          <p className="num text-2xl lg:text-[28px]">{g.in_room}</p>
          <p className="seclabel mt-2.5">In the room</p>
        </div>
        <div className="min-w-0">
          <p className="num text-2xl lg:text-[28px]">{g.searches}</p>
          <p className="seclabel mt-2.5">{g.searches === 1 ? "Search" : "Searches"}</p>
        </div>
      </div>

      {hiding.length > 0 && (
        <p className="mt-3.5 flex items-start gap-2 text-[14px] leading-snug text-dim" data-desk-staff-only>
          <Ticket size={15} className="mt-[3px] flex-none text-orange" aria-hidden />
          <span>
            {plural(hiding.length, "box", "boxes")} hiding{where.length ? ` now at ${where.join(", ")}` : ""}
            {spots ? `, ${hiding.length === 1 ? "one of" : "among"} ${spots} spots` : ""}. Only staff see this.
          </span>
        </p>
      )}
      {!g.cron_ready && <p className="mt-2 text-[13px] leading-snug text-fireant">The minute tick is off: pushes and box moves wait for someone to load the room.</p>}
      {over && (
        <p className="mt-2 text-[13px] leading-snug text-fireant">
          {g.members} members but the room fits {g.room_capacity}. The rest only watch.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" className="btn btn-ghost px-3 py-2 sm:px-6" onClick={() => setWatching((v) => !v)} aria-expanded={watching}>
          {watching ? "HIDE LIVE VIEW" : "WATCH IT LIVE"}
        </button>
        <Sure className="px-3 py-2 sm:px-6" label="CLOSE NOW" sure="CLOSE IT?" disabled={gt.busy} onYes={() => void gt.act({ action: "close", id: game.id })} />
        <button type="button" className="btn btn-ghost col-span-2 px-3 py-2 sm:col-auto sm:px-6" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          EDIT
        </button>
      </div>

      {watching && (
        <div className="mt-4 min-w-0 rounded-hz border border-line p-3" data-desk-watch>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-dim">
                <tr>
                  <th className="py-1 pr-3 font-medium">CODE</th>
                  <th className="py-1 pr-3 font-medium">SPOT</th>
                  <th className="py-1 font-medium">FOUND BY</th>
                </tr>
              </thead>
              <tbody>
                {(full?.boxes ?? []).map((b) => (
                  <tr key={b.id} className="border-t border-line" data-desk-box={b.claimed_at ? "found" : "hiding"}>
                    <td className="py-1.5 pr-3 text-cream">{b.code}</td>
                    <td className="py-1.5 pr-3 uppercase">{spotLabel(b.spot)}</td>
                    <td className="py-1.5 uppercase">{b.claimed_at ? `${b.handle ? `@${b.handle}` : b.name || "someone"} · ${hhmm(b.claimed_at)}` : "STILL HIDING"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!full && <p className="hint mt-2">Loading the boxes…</p>}
          <p className="seclabel mt-4">Winners</p>
          {winners.length ? (
            <div className="mt-2 grid gap-2.5">
              {winners.map((w, i) => (
                <FoundRow key={`${w.game_id}-${w.code}`} f={fromWinner(w, g.boxes_total > 1 ? `Ticket ${i + 1}` : "Winner")} />
              ))}
            </div>
          ) : (
            <p className="hint mt-1">Nobody has won yet.</p>
          )}
        </div>
      )}
      {editing && gt.desk && <EditForm id={game.id} desk={gt.desk} headers={headers} busy={gt.busy} act={gt.act} onDone={() => setEditing(false)} />}
    </article>
  );
}

/* --------------------------------------------------------- coming up -- */

const up = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/**
 * The drops that have not opened, in one card, grouped by the win rule they share (their campaign key). A group of a mystery
 * series says staff see the real times and Hoppers do not. Each row can be edited, started now or cancelled.
 */
export function UpcomingDrops({ games, gt, showCrew }: { games: Game[]; gt: GameTimeDeskApi; showCrew?: boolean }) {
  const say = useToast((s) => s.say);
  const [editing, setEditing] = useState<string | null>(null);

  const groups = useMemo(() => {
    const by = new Map<string, Game[]>();
    for (const g of games) by.set(g.campaign_key, [...(by.get(g.campaign_key) ?? []), g]);
    const opens = (g: Game) => Date.parse(g.opens_at);
    return [...by.entries()]
      .map(([key, list]) => ({ key, list: list.sort((a, b) => opens(a) - opens(b)) }))
      .sort((a, b) => opens(a.list[0]) - opens(b.list[0]));
  }, [games]);

  return (
    <div className="card divide-y divide-line overflow-hidden p-0" data-desk-upcoming>
      {groups.map(({ key, list }) => (
        <Fragment key={key}>
          {(list.length > 1 || !key.startsWith("crew:")) && (
            <p className="px-4 py-2.5 text-[13px] text-dim">
              <b className="font-bold text-cream">{up(seriesName(key, list[0].crew_name))}</b> · {plural(list.length, "drop")}
            </p>
          )}
          {list.some((g) => (dropOf(g).i ?? 0) >= 2) && (
            <p className="px-4 py-3 text-[13px] leading-snug text-dim">Mystery times: Hoppers only see “the next one can drop soon”. You see the real time.</p>
          )}
          {list.map((g) => {
            const d = dropOf(g);
            return (
              <div key={g.id} data-desk-upcoming-drop={g.id}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-[11rem]">
                    <p className="text-[15px] leading-snug">
                      {d.i ? (
                        <>
                          <b className="font-display font-black">
                            Drop {d.i} of {d.n}
                          </b>{" "}
                          <span className="text-dim">· {d.title}</span>
                        </>
                      ) : (
                        <b className="font-display font-black">{d.title}</b>
                      )}
                      {isRehearsalKey(g.campaign_key) && <span className="pill ml-2 align-middle">TEST RUN</span>}
                    </p>
                    <p className="hint mt-0.5">
                      {showCrew ? `${g.crew_name} · ` : ""}
                      {lagosDay(g.opens_at)} · {hhmm(g.opens_at)} to {hhmm(g.closes_at)} · {plural(g.boxes_total, "ticket")}
                    </p>
                  </div>
                  <div className="flex flex-none flex-wrap gap-2">
                    <button type="button" className="btn btn-ghost min-h-[36px] px-2.5 py-2 text-[12px]" onClick={() => setEditing((e) => (e === g.id ? null : g.id))} aria-expanded={editing === g.id}>
                      EDIT
                    </button>
                    <Sure
                      className="min-h-[36px] px-2.5 py-2 text-[12px]"
                      label="START NOW"
                      sure="OPEN IT AND PING?"
                      disabled={gt.busy}
                      onYes={() => void gt.act({ action: "start_now", id: g.id }).then((r) => r && say("DROP IS LIVE", "violet"))}
                    />
                    <Sure
                      className="min-h-[36px] px-2.5 py-2 text-[12px]"
                      label="CANCEL"
                      sure="CANCEL IT?"
                      disabled={gt.busy}
                      onYes={() => void gt.act({ action: "close", id: g.id }).then((r) => r && say("DROP CANCELLED", "violet"))}
                    />
                  </div>
                </div>
                {editing === g.id && gt.desk && (
                  <div className="px-4 pb-4">
                    <EditForm id={g.id} desk={gt.desk} headers={gt.headers} busy={gt.busy} act={gt.act} onDone={() => setEditing(null)} />
                  </div>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- past drop -- */

/**
 * A drop that is over, on its own card: its time, how many tickets and spots it had, and one row per box with who found it
 * and the checks, or "Nobody found it." The boxes and winners are read once when the card appears.
 */
export function PastDropCard({ game, gt, showCrew }: { game: Game; gt: GameTimeDeskApi; showCrew?: boolean }) {
  const { headers } = gt;
  const [full, setFull] = useState<Game | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [read, setRead] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchGame(headers, game.id), fetchWinners(headers, game.id)]).then(([g, w]) => {
      if (!alive) return;
      setFull(g);
      setWinners(w);
      setRead(g ? "ready" : "failed");
    });
    return () => {
      alive = false;
    };
  }, [headers, game.id]);

  const pill = PHASE_PILL[game.phase];
  const total = game.boxes_total;
  const found = total - game.boxes_left;
  const spots = full?.objects?.length ?? 0;
  const boxes = full?.boxes ?? [];

  return (
    <article className="card min-w-0 p-4 lg:p-5" data-desk-past-drop={game.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="font-display text-lg font-black leading-snug [overflow-wrap:anywhere]">{dropLabel(game)}</h4>
        <span className={`pill ${pill.cls}`}>{pill.label}</span>
        {isRehearsalKey(game.campaign_key) && <span className="pill">TEST RUN</span>}
      </div>
      <p className="hint mt-1.5">
        {showCrew ? `${game.crew_name} · ` : ""}
        {lagosDay(game.opens_at)} · {hhmm(game.opens_at)} to {hhmm(game.closes_at)} · {plural(total, "ticket")}
        {spots ? ` · ${plural(spots, "spot")}` : ""} ·{" "}
        <b className="font-bold text-cream">
          {found} of {total} found
        </b>
      </p>

      {total > 1 && (
        <p className="mt-3 rounded-hz border border-danfo px-3 py-2.5 text-[14px] leading-snug text-danfo">
          This drop had {total} codes, so it hid {total} boxes and could make {total} winners.
        </p>
      )}

      {boxes.length > 0 && (
        <div className="mt-3 grid gap-2.5">
          {boxes.map((b, i) => {
            if (!b.claimed_at) return <UnfoundRow key={b.id} code={b.code} />;
            const label = total > 1 ? `Ticket ${i + 1}` : "Winner";
            const w = winners.find((x) => x.code === b.code);
            return <FoundRow key={b.id} f={w ? fromWinner(w, label) : fromBox(b, label, game.opens_at)} />;
          })}
        </div>
      )}
      {read === "loading" && <p className="hint mt-3">Loading the boxes…</p>}
      {read === "failed" && <p className="hint mt-3">The boxes did not load.</p>}

      {found > 0 && (
        <div className="mt-3 flex justify-end">
          <button type="button" className="btn btn-ghost min-h-[36px] px-3 py-2" onClick={() => void gt.exportCsv(game.id, `game-time-winners-${game.id.slice(0, 8)}.csv`)}>
            <Download size={14} aria-hidden /> EXPORT CSV
          </button>
        </div>
      )}
    </article>
  );
}
