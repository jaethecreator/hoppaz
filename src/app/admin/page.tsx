"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Lock, LockKeyhole, RefreshCw, Search, X } from "lucide-react";
import { useToast } from "@/lib/store";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import { emptySpawner } from "@/components/admin/SpawnerSection";
import HotspotsSection, { emptyHotspots } from "@/components/admin/HotspotsSection";
import DeskSearch from "@/components/admin/desk/DeskSearch";
import DropsSection from "@/components/admin/desk/DropsSection";
import RoomsSection from "@/components/admin/desk/RoomsSection";
import EventsSection from "@/components/admin/desk/sections/EventsSection";
import MoreSection from "@/components/admin/desk/sections/MoreSection";
import QuestsSection from "@/components/admin/desk/sections/QuestsSection";
import EventReportsSection from "@/components/admin/desk/sections/EventReportsSection";
import SafetySection from "@/components/admin/desk/sections/SafetySection";
import { SECTIONS, isSection } from "@/components/admin/desk/sections/nav";
import { SectionHead, type Act, type Queue } from "@/components/admin/desk/sections/parts";
import { useGameTimeDesk } from "@/components/admin/desk/useDesk";
import type { RoomRef, SectionKey } from "@/components/admin/desk/types";

/**
 * The staff desk. A token gate (the server's HOPPAZ_ADMIN_TOKEN, kept in this tab only), then a desk with sections: a rail
 * on the left from 1024 px up, chips under the header on a phone. The section and the room that are open live in the address
 * (?s=quests, ?s=rooms&room=crew:<id>), so a reload or a shared link lands in the same place.
 *
 * Two feeds: /api/admin/game (events, reports, photos, quests, partners, hotspots: the queue, below) and
 * /api/admin/game-time (drops, crews: useGameTimeDesk). Rooms and Drops read the second; the other sections read the first.
 */

const TOKEN_KEY = "hoppaz-admin-token";
const empty: Queue = { events: [], liveEvents: [], rules: [], photos: [], claims: [], reports: [], drops: [], partners: [], spawner: emptySpawner, hotspots: emptyHotspots };

/** ?s=<section>&room=<kind>:<id> from the address. Either can be missing or wrong; the desk then keeps its defaults. */
function readAddress(): { section: SectionKey | null; room: RoomRef | null } {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("s");
  const r = /^(crew|event|hotspot):(.+)$/.exec(q.get("room") ?? "");
  return { section: isSection(s) ? s : null, room: r ? { kind: r[1] as RoomRef["kind"], id: r[2] } : null };
}

/**
 * A section that scrolls on its own, in a centred column. Rooms is not one of these: it fills the space and scrolls its own
 * columns. `mounted` false draws nothing; `on` false keeps what was drawn but hides it (so a form half typed is still there).
 */
function Page({ on, mounted, wide, children }: { on: boolean; mounted: boolean; wide?: boolean; children: ReactNode }) {
  if (!mounted) return null;
  return (
    <div className={clsx("min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 lg:px-8 lg:pt-6", !on && "hidden")}>
      <div className={clsx("mx-auto w-full", wide ? "max-w-[900px]" : "max-w-[760px]")}>{children}</div>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<Queue>(empty);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<SectionKey>("rooms");
  const [room, setRoom] = useState<RoomRef | null>(null);
  // Sections the staff member has opened. Those below the Rooms and Drops pair stay mounted (hidden) after the first visit, so a
  // half-typed form or a QR that was just made is still there when they come back.
  const [visited, setVisited] = useState<SectionKey[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // False until the address has been read, so the first write to it cannot wipe what it said.
  const [ready, setReady] = useState(false);
  const chips = useRef<HTMLElement>(null);
  const say = useToast((s) => s.say);

  const lock = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
  }, []);
  const gt = useGameTimeDesk(token, lock);

  const go = useCallback((s: SectionKey) => {
    setSection(s);
    setVisited((v) => (v.includes(s) ? v : [...v, s]));
  }, []);
  /** Open a room in the Rooms section. */
  const openRoom = useCallback(
    (r: RoomRef | null) => {
      go("rooms");
      setRoom(r);
    },
    [go],
  );

  // A token kept from earlier in this tab unlocks straight away, and the queues load with it.
  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    const at = readAddress();
    if (at.section) go(at.section);
    if (at.room) setRoom(at.room);
    setReady(true);
  }, [go]);
  useEffect(() => {
    if (!ready || !token) return;
    const rest = new URLSearchParams(window.location.search);
    rest.delete("s");
    rest.delete("room");
    const more = rest.toString();
    window.history.replaceState(null, "", `${window.location.pathname}?s=${section}${room ? `&room=${room.kind}:${encodeURIComponent(room.id)}` : ""}${more ? `&${more}` : ""}`);
  }, [ready, token, section, room]);
  const games = gt.desk?.games ?? [];
  const live = games.filter((g) => g.phase === "live");
  const comingUp = games.filter((g) => g.phase === "upcoming").length;
  /** The number beside a section: nothing when there is nothing to do. Drops reads "N LIVE" while a drop is live. */
  const counts: Partial<Record<SectionKey, { text: string; n: number; live?: boolean }>> = {};
  const count = (k: SectionKey, n: number, text = String(n), isLive = false) => {
    if (n > 0) counts[k] = { text, n, live: isLive };
  };
  if (live.length) count("drops", live.length, `${live.length} LIVE`, true);
  else count("drops", comingUp);
  count("events", queue.events.length);
  count("safety", queue.reports.length + queue.photos.length);
  count("quests", queue.claims.length);
  const liveCrews = [...new Map(live.map((g) => [g.crew_id, g.crew_name])).entries()].map(([id, name]) => ({ id, name }));

  // The chip row scrolls sideways on a phone; the open section's chip stays in sight (also when a count arrives and widens a chip).
  const chipWidths = Object.values(counts).map((c) => c.text).join();
  useEffect(() => {
    chips.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [section, token, chipWidths]);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    const r = await fetch("/api/admin/game", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    setBusy(false);
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.status === 401) lock();
      say(r.status === 401 ? "ADMIN ACCESS DENIED" : String(err.error ?? "ADMIN DATA FAILED TO LOAD").toUpperCase());
      return;
    }
    setQueue((await r.json()) as Queue);
    setLoaded(true);
  }, [token, lock, say]);
  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const act: Act = async (body) => {
    setBusy(true);
    const r = await fetch("/api/admin/game", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      say(String(data.error ?? "ACTION FAILED"));
      return null;
    }
    await load();
    return data as Record<string, unknown>;
  };
  const refresh = () => void Promise.allSettled([load(), gt.load()]);

  if (!token)
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="card w-full max-w-sm">
          <LockKeyhole className="mb-3 text-orange" />
          <h1 className="font-display text-xl font-black">Hoppaz staff</h1>
          <p className="hint mt-1">Enter the server’s HOPPAZ_ADMIN_TOKEN. It is kept in this tab only.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft.trim();
              if (!t) return;
              sessionStorage.setItem(TOKEN_KEY, t);
              setToken(t);
            }}
          >
            <input className="mt-4" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Staff token" autoComplete="off" />
            <button className="btn mt-3 w-full" disabled={!draft.trim()}>
              UNLOCK STAFF TOOLS
            </button>
          </form>
        </div>
      </div>
    );

  return (
    <div className="flex h-full">
      <aside className="hidden w-[232px] flex-none flex-col border-r border-line bg-ink-2 lg:flex">
        <div className="px-5 pb-4 pt-6">
          <p className="font-display text-xl font-black">Hoppaz</p>
          <p className="seclabel mt-1">Staff desk</p>
        </div>
        <nav aria-label="Staff desk sections" className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
          {SECTIONS.map(({ key, title, Icon }) => {
            const on = section === key;
            const c = counts[key];
            return (
              <button
                key={key}
                aria-current={on ? "page" : undefined}
                onClick={() => go(key)}
                className={clsx("flex min-h-[44px] w-full items-center gap-3 rounded-hz px-3 text-left font-display text-[15px] font-bold transition-colors", on ? "bg-orange/15 text-cream" : "text-dim hover:bg-ink-3 hover:text-cream")}
              >
                <Icon size={18} className={clsx("flex-none", on && "text-orange")} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {c && <span className={clsx("pill", c.live && "pill-keke")}>{c.text}</span>}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <button className="btn btn-ghost w-full" onClick={lock}>
            <Lock size={14} aria-hidden /> LOCK THE DESK
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="hidden h-[60px] flex-none items-center gap-3 border-b border-line px-4 lg:flex">
          <div className="w-[440px] max-w-full">
            <DeskSearch gt={gt} liveEvents={queue.liveEvents} hotspots={queue.hotspots.rooms} onRoom={openRoom} onSection={go} />
          </div>
          <div className="flex-1" />
          {liveCrews.length === 1 ? (
            <button className="pill pill-keke min-h-[32px] px-3 text-[11px]" onClick={() => openRoom({ kind: "crew", id: liveCrews[0].id })}>
              ● {live.length} DROP{live.length > 1 ? "S" : ""} LIVE · {liveCrews[0].name.toUpperCase()}
            </button>
          ) : (
            liveCrews.length > 1 && (
              <span className="pill pill-keke min-h-[32px] px-3 text-[11px]">
                ● {live.length} DROPS LIVE ·
                {liveCrews.map((c) => (
                  <button key={c.id} className="underline-offset-2 hover:underline" onClick={() => openRoom({ kind: "crew", id: c.id })}>
                    {c.name.toUpperCase()}
                  </button>
                ))}
              </span>
            )
          )}
          <button className="btn btn-ghost w-11 flex-none px-0" aria-label="Refresh" title="Refresh" onClick={refresh}>
            <RefreshCw size={16} className={clsx(busy && "animate-spin")} aria-hidden />
          </button>
        </div>

        <header className="pad-top flex-none border-b border-line lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <p className="font-display text-lg font-black">Staff desk</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost w-11 px-0" aria-label={searchOpen ? "Close search" : "Search"} aria-expanded={searchOpen} onClick={() => setSearchOpen((o) => !o)}>
                {searchOpen ? <X size={18} aria-hidden /> : <Search size={18} aria-hidden />}
              </button>
              <button className="btn btn-ghost w-11 px-0" aria-label="Lock the desk" onClick={lock}>
                <Lock size={18} aria-hidden />
              </button>
            </div>
          </div>
          {searchOpen && (
            <div className="px-4 pb-3">
              <DeskSearch
                autoFocus
                gt={gt}
                liveEvents={queue.liveEvents}
                hotspots={queue.hotspots.rooms}
                onRoom={(r) => {
                  openRoom(r);
                  setSearchOpen(false);
                }}
                onSection={(s) => {
                  go(s);
                  setSearchOpen(false);
                }}
              />
            </div>
          )}
          <nav ref={chips} aria-label="Staff desk sections" className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SECTIONS.map(({ key, short }) => {
              const on = section === key;
              const c = counts[key];
              return (
                <button
                  key={key}
                  aria-current={on ? "page" : undefined}
                  // Tapping Rooms while a room is open goes back to the list.
                  onClick={() => (key === "rooms" && on ? setRoom(null) : go(key))}
                  className={clsx("chip flex-none", on && "chip-on")}
                >
                  {short}
                  {c && <span className={clsx(!on && (c.live ? "text-keke" : "text-orange"))}>{c.n}</span>}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {section === "rooms" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <RoomsSection gt={gt} liveEvents={queue.liveEvents} hotspots={queue.hotspots.rooms} room={room} onRoom={setRoom} onSection={go} />
            </div>
          )}
          {/* Drops draws its own centred column and padding, so it only needs a container that scrolls. */}
          {section === "drops" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DropsSection
                gt={gt}
                onOpenRoom={(id) => {
                  go("rooms");
                  setRoom({ kind: "crew", id });
                }}
              />
            </div>
          )}
          <Page on={section === "events"} mounted={section === "events" || visited.includes("events")}>
            <EventsSection queue={queue} act={act} />
          </Page>
          <Page on={section === "hotspots"} mounted={section === "hotspots" || visited.includes("hotspots")} wide>
            <SectionHead title="Hotspots" hint="Hotspot rooms also show under Rooms." />
            <HotspotsSection hotspots={queue.hotspots} act={act} busy={busy} loading={!loaded} />
          </Page>
          <Page on={section === "safety"} mounted={section === "safety" || visited.includes("safety")}>
            <SafetySection queue={queue} act={act} />
          </Page>
          {EVENTS_R1 && (
            <Page on={section === "eventreports"} mounted={section === "eventreports" || visited.includes("eventreports")}>
              <EventReportsSection />
            </Page>
          )}
          <Page on={section === "quests"} mounted={section === "quests" || visited.includes("quests")}>
            <QuestsSection queue={queue} act={act} busy={busy} />
          </Page>
          <Page on={section === "more"} mounted={section === "more" || visited.includes("more")} wide>
            <MoreSection queue={queue} act={act} busy={busy} loaded={loaded} token={token} onLock={lock} />
          </Page>
        </div>
      </div>
    </div>
  );
}
