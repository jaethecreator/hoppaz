"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import type { HotspotRoomRow } from "@/app/api/admin/game/hotspots";
import { PHASE_PILL, dropLabel, inPlayOrder, lagos } from "./format";
import { SECTIONS } from "./sections/nav";
import type { GameTimeDeskApi, LiveEvent, RoomRef, SectionKey, Winner } from "./types";
import { fetchWinners } from "./useDesk";

/**
 * The desk's search box. Type two letters or more and it lists what matches, in four groups of at most six rows: rooms (crews,
 * event rooms, hotspot rooms), drops, winners (by handle, name, email or ticket code) and the desk's own sections. Picking a
 * row opens that room, or the crew room of that drop or win, or that section. The winners are read once, the first time the
 * box is used, so the desk does not load them for someone who never searches.
 */

const MIN = 2;
const PER_GROUP = 6;

type Hit = { id: string; group: string; title: string; sub?: string; pill?: { cls: string; label: string }; pick: () => void };

const has = (v: string | null | undefined, q: string) => !!v && v.toLowerCase().includes(q);

export default function DeskSearch({
  gt,
  liveEvents,
  hotspots,
  onRoom,
  onSection,
  autoFocus,
}: {
  gt: GameTimeDeskApi;
  liveEvents: LiveEvent[];
  hotspots: HotspotRoomRow[];
  onRoom: (r: RoomRef) => void;
  onSection: (s: SectionKey) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [winners, setWinners] = useState<Winner[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const winnersAsked = useRef(false);

  const loadWinners = () => {
    if (winnersAsked.current) return;
    winnersAsked.current = true;
    void fetchWinners(gt.headers, null).then(setWinners);
  };

  const query = q.trim().toLowerCase();
  const showing = open && query.length >= MIN;

  const hits = useMemo<Hit[]>(() => {
    if (query.length < MIN) return [];
    const games = gt.desk?.games ?? [];
    const crews = gt.desk?.crews ?? [];
    const crewRoom = (id: string) => () => onRoom({ kind: "crew", id });
    const rooms: Hit[] = [];

    for (const c of crews.filter((c) => has(c.name, query))) rooms.push({ id: `crew:${c.id}`, group: "Rooms", title: c.name, sub: c.verified ? "Brand crew" : "Crew", pick: crewRoom(c.id) });
    for (const e of liveEvents.filter((e) => has(e.title, query))) rooms.push({ id: `event:${e.id}`, group: "Rooms", title: e.title, sub: "Event room", pick: () => onRoom({ kind: "event", id: e.id }) });
    for (const h of hotspots.filter((h) => has(h.place, query) || has(h.zone, query))) rooms.push({ id: `hotspot:${h.slug}`, group: "Rooms", title: h.place, sub: `Hotspot room · ${h.zone}`, pick: () => onRoom({ kind: "hotspot", id: h.slug }) });

    const drops = inPlayOrder(games.filter((g) => has(dropLabel(g), query) || has(g.crew_name, query)))
      .slice(0, PER_GROUP)
      .map<Hit>((g) => ({ id: `drop:${g.id}`, group: "Drops", title: dropLabel(g), sub: `${g.crew_name} · ${lagos(g.opens_at)}`, pill: PHASE_PILL[g.phase], pick: crewRoom(g.crew_id) }));

    // "@jol" finds the handle "JollofRaver4821" too.
    const handle = query.startsWith("@") ? query.slice(1) : query;
    const wins = winners
      .filter((w) => has(w.handle, handle) || has(w.name, query) || has(w.email, query) || has(w.code, query))
      .slice(0, PER_GROUP)
      .map<Hit>((w, i) => ({
        id: `winner:${w.game_id}:${w.code}:${i}`,
        group: "Winners",
        title: w.handle ? `@${w.handle}` : (w.name ?? "No handle"),
        sub: `${w.code} · ${w.crew_name} · ${dropLabel({ title: w.title })}`,
        pick: () => {
          const crewId = games.find((g) => g.id === w.game_id)?.crew_id ?? crews.find((c) => c.name === w.crew_name)?.id;
          if (crewId) onRoom({ kind: "crew", id: crewId });
        },
      }));

    const sections = SECTIONS.filter((s) => s.words.some((w) => w.includes(query) || query.includes(w)))
      .slice(0, PER_GROUP)
      .map<Hit>((s) => ({ id: `section:${s.key}`, group: "Sections", title: s.title, sub: "Open this section", pick: () => onSection(s.key) }));

    return [...rooms.slice(0, PER_GROUP), ...drops, ...wins, ...sections];
  }, [query, gt.desk, liveEvents, hotspots, winners, onRoom, onSection]);

  // A tap outside closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // The arrow keys move the highlight; keep it in view.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, hits]);

  const done = () => {
    setQ("");
    setOpen(false);
    setActive(0);
    input.current?.blur();
  };
  const pick = (h: Hit | undefined) => {
    if (!h) return;
    h.pick();
    done();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQ("");
      setOpen(false);
      setActive(0);
    } else if (e.key === "Enter" && showing) {
      e.preventDefault();
      pick(hits[active] ?? hits[0]);
    } else if (e.key === "ArrowDown" && showing) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" && showing) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
  };

  const groups = [...new Set(hits.map((h) => h.group))];
  return (
    <div ref={wrap} className="relative w-full">
      <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" aria-hidden />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={showing}
        aria-controls="desk-search-results"
        aria-activedescendant={showing && hits.length ? `desk-hit-${active}` : undefined}
        aria-label="Search rooms, drops, winners or codes"
        autoComplete="off"
        inputMode="search"
        autoFocus={autoFocus}
        className="pl-10"
        placeholder="Search rooms, drops, winners or codes"
        value={q}
        onFocus={() => {
          loadWinners();
          setOpen(true);
        }}
        onChange={(e) => {
          loadWinners();
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKey}
      />
      {showing && (
        <div ref={list} id="desk-search-results" role="listbox" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-hz border border-line bg-ink-2 shadow-sheet">
          {hits.length === 0 && <p className="hint px-3 py-3">Nothing matches.</p>}
          {groups.map((g) => (
            <div key={g} className="border-t border-line first:border-0">
              <p className="seclabel px-3 pb-1 pt-3">{g}</p>
              {hits
                .filter((h) => h.group === g)
                .map((h) => {
                  const i = hits.indexOf(h);
                  return (
                    <button
                      key={h.id}
                      id={`desk-hit-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      className={clsx("flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left", i === active ? "bg-ink-3" : "hover:bg-ink-3")}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(h)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-sm font-bold">{h.title}</span>
                        {h.sub && <span className="hint block truncate">{h.sub}</span>}
                      </span>
                      {h.pill && <span className={clsx("pill", h.pill.cls)}>{h.pill.label}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
