"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { HotspotRoomRow } from "@/app/api/admin/game/hotspots";
import VerifiedBadge from "@/components/VerifiedBadge";
import { templateFor } from "@/lib/campaign/templates";
import { useToast } from "@/lib/store";
import AddDrop from "./AddDrop";
import PlaceRoom from "./PlaceRoom";
import RoomOverview, { RoomAvatar } from "./RoomOverview";
import { lagosDay, plural } from "./format";
import type { Crew, GameTimeDeskApi, LiveEvent, RoomRef, SectionKey } from "./types";

export type RoomsSectionProps = {
  gt: GameTimeDeskApi;
  liveEvents: LiveEvent[];
  hotspots: HotspotRoomRow[];
  /** The room open on the right (desktop) or full screen (phone); null shows the list (phone) or the first brand crew (desktop). */
  room: RoomRef | null;
  onRoom: (room: RoomRef | null) => void;
  /** Jump to another section of the desk (for example Hotspots from a hotspot room). */
  onSection: (s: SectionKey) => void;
};

/** Crews listed before SHOW ALL. */
const CREWS_SHOWN = 30;

/** The desk's desktop layout starts at Tailwind's lg. */
function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return desktop;
}

function Row({ selected, onClick, avatar, name, verified, sub, live }: { selected: boolean; onClick: () => void; avatar: ReactNode; name: string; verified?: boolean; sub: string; live?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-hz px-2 py-2 text-left transition-colors ${selected ? "bg-ink-3 ring-1 ring-orange" : "hover:bg-ink-2"}`}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-display text-[15px] font-black leading-snug">
          <span className="truncate">{name}</span>
          {verified && <VerifiedBadge size={14} />}
        </span>
        <span className="block truncate text-[13px] leading-snug text-dim">{sub}</span>
      </span>
      {live && <span className="pill pill-keke flex-none">LIVE</span>}
    </button>
  );
}

/**
 * The Rooms section: every room the desk knows, and the open one. Brand crews, crews, event rooms and hotspot rooms in one
 * list; a crew room shows its drops, a place room says what it can and cannot do yet. On a phone it is the list, then the
 * room full screen; from lg the list stays on the left. ADD A DROP opens the add-a-drop flow in place of the room.
 */
export default function RoomsSection({ gt, liveEvents, hotspots, room, onRoom, onSection }: RoomsSectionProps) {
  const say = useToast((s) => s.say);
  const desk = gt.desk;
  const desktop = useDesktop();
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const crews = useMemo(() => desk?.crews ?? [], [desk]);
  const brands = useMemo(() => crews.filter((c) => c.verified), [crews]);
  const others = useMemo(() => crews.filter((c) => !c.verified), [crews]);

  // What each crew is doing: a live drop, or how many are coming up. One pass over the drops.
  const doing = useMemo(() => {
    const m = new Map<string, { live: boolean; coming: number }>();
    for (const g of desk?.games ?? []) {
      const d = m.get(g.crew_id) ?? { live: false, coming: 0 };
      if (g.phase === "live") d.live = true;
      if (g.phase === "upcoming") d.coming += 1;
      m.set(g.crew_id, d);
    }
    return m;
  }, [desk]);

  // On desktop the right side is never empty: open the 360Playlist crew, else the first brand crew, else the first crew.
  useEffect(() => {
    if (!desktop || room || !crews.length) return;
    const first = brands.find((c) => /^360\s*playlist$/i.test(c.name.trim())) ?? brands.find((c) => /360\s*playlist/i.test(c.name)) ?? brands[0] ?? crews[0];
    onRoom({ kind: "crew", id: first.id });
  }, [desktop, room, crews, brands, onRoom]);

  // Leaving a room (or opening another) closes its add-a-drop flow.
  const roomKey = room ? `${room.kind}:${room.id}` : "";
  useEffect(() => {
    setAdding(null);
  }, [roomKey]);

  if (!desk) {
    return gt.error ? (
      <div className="px-4 py-5 lg:px-7">
        <p className="text-[14px] text-fireant">{gt.error}</p>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => void gt.load()}>
          TRY AGAIN
        </button>
      </div>
    ) : (
      <p className="px-4 py-5 text-[14px] text-dim lg:px-7">Loading rooms…</p>
    );
  }

  const term = q.trim().toLowerCase();
  const has = (...parts: (string | null | undefined)[]) => !term || parts.some((p) => p?.toLowerCase().includes(term));
  const brandRows = brands.filter((c) => has(c.name));
  const crewRows = others.filter((c) => has(c.name));
  const eventRows = liveEvents.filter((e) => has(e.title, e.venue_name, e.area));
  const hotspotRows = hotspots.filter((h) => has(h.place, h.zone, h.slug));
  const total = crews.length + liveEvents.length + hotspots.length;
  const nothing = !brandRows.length && !crewRows.length && !eventRows.length && !hotspotRows.length;

  const crewRow = (c: Crew) => {
    const d = doing.get(c.id);
    const sub = d?.live ? "Live drop now" : d?.coming ? `${plural(d.coming, "drop")} coming up` : `${templateFor(c.template).name.replace(/^The /, "")} room`;
    return (
      <Row
        key={c.id}
        selected={room?.kind === "crew" && room.id === c.id}
        onClick={() => onRoom({ kind: "crew", id: c.id })}
        avatar={<RoomAvatar name={c.name} src={c.logo_url} />}
        name={c.name}
        verified={c.verified}
        sub={sub}
        live={d?.live}
      />
    );
  };

  const heading = (text: string) => <h3 className="seclabel mb-1.5 mt-5 px-2">{text}</h3>;

  const open = room?.kind === "crew" ? crews.find((c) => c.id === room.id) : undefined;
  const openEvent = room?.kind === "event" ? liveEvents.find((e) => e.id === room.id) : undefined;
  const openHotspot = room?.kind === "hotspot" ? hotspots.find((h) => h.slug === room.id) : undefined;
  const addingCrew = adding ? crews.find((c) => c.id === adding) : undefined;

  return (
    <div className="flex min-h-0 flex-1" data-desk-rooms>
      {/* While a drop is being added on a laptop, the list steps aside so the flow has room; on a wide screen it stays. */}
      <aside className={`${room ? (addingCrew ? "hidden xl:flex" : "hidden lg:flex") : "flex"} min-h-0 w-full flex-none flex-col overflow-y-auto border-line lg:w-[260px] lg:border-r xl:w-[300px]`}>
        <div className="sticky top-0 z-10 bg-ink px-4 pb-3 pt-5 lg:px-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-black">Rooms</h2>
            <span className="font-mono text-[13px] text-dim">{total}</span>
          </div>
          <input className="mt-3" type="search" placeholder="Find a room, brand or hotspot" aria-label="Find a room, brand or hotspot" value={q} onChange={(e) => setQ(e.target.value)} />
          {gt.error && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-0 flex-1 text-[13px] text-fireant">{gt.error}</p>
              <button type="button" className="btn btn-ghost min-h-[36px] px-3 py-1.5" onClick={() => void gt.load()}>
                TRY AGAIN
              </button>
            </div>
          )}
        </div>
        <div className="px-2 pb-8">
          {brandRows.length > 0 && (
            <>
              {heading("Brand crews")}
              {brandRows.map(crewRow)}
            </>
          )}
          {crewRows.length > 0 && (
            <>
              {heading("Crews")}
              {crewRows.slice(0, showAll ? undefined : CREWS_SHOWN).map(crewRow)}
              {!showAll && crewRows.length > CREWS_SHOWN && (
                <button type="button" className="chip mt-2 w-full" onClick={() => setShowAll(true)}>
                  SHOW ALL ({crewRows.length})
                </button>
              )}
            </>
          )}
          {eventRows.length > 0 && (
            <>
              {heading("Event rooms")}
              {eventRows.map((e) => (
                <Row
                  key={e.id}
                  selected={room?.kind === "event" && room.id === e.id}
                  onClick={() => onRoom({ kind: "event", id: e.id })}
                  avatar={<RoomAvatar name={e.title} />}
                  name={e.title}
                  sub={[e.starts_at ? lagosDay(e.starts_at) : "", e.venue_name].filter(Boolean).join(" · ")}
                />
              ))}
            </>
          )}
          {hotspotRows.length > 0 && (
            <>
              {heading("Hotspot rooms")}
              {hotspotRows.map((h) => (
                <Row
                  key={h.slug}
                  selected={room?.kind === "hotspot" && room.id === h.slug}
                  onClick={() => onRoom({ kind: "hotspot", id: h.slug })}
                  avatar={<RoomAvatar name={h.place} />}
                  name={h.place}
                  sub={h.status === "open" ? h.zone : `${h.zone} · ${h.status}`}
                />
              ))}
            </>
          )}
          {nothing && <p className="px-2 pt-5 text-[14px] text-dim">{term ? "No room matches that." : "No rooms yet."}</p>}
        </div>
      </aside>

      <section className={`${room ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto`}>
        {addingCrew ? (
          // Phone: full screen over the desk. Desktop: in this column, in place of the room.
          <div className="fixed inset-0 z-50 overflow-y-auto bg-ink lg:static lg:z-auto lg:flex-1">
            <AddDrop
              crew={addingCrew}
              desk={desk}
              act={gt.act}
              busy={gt.busy}
              onClose={() => setAdding(null)}
              onSaved={(message) => {
                say(message, "violet");
                setAdding(null);
                void gt.load();
              }}
            />
          </div>
        ) : (
          <>
            {room && (
              <button type="button" className="seclabel flex items-center gap-1 px-4 pt-5 text-left lg:hidden" onClick={() => onRoom(null)}>
                <ChevronLeft size={14} aria-hidden /> All rooms
              </button>
            )}
            {open ? (
              <RoomOverview key={open.id} crew={open} gt={gt} onAdd={() => setAdding(open.id)} />
            ) : openEvent ? (
              <PlaceRoom kind="event" event={openEvent} onSection={onSection} />
            ) : openHotspot ? (
              <PlaceRoom kind="hotspot" hotspot={openHotspot} onSection={onSection} />
            ) : (
              <p className="px-4 py-5 text-[14px] text-dim lg:px-7">{room ? "That room is gone." : "Pick a room on the left."}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
