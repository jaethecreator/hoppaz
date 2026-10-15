"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Map as MLMap } from "maplibre-gl";
import AreaPicker from "@/components/AreaPicker";
import EventCard from "@/components/EventCard";
import HopSheet from "@/components/HopSheet";
import FilterCard from "@/components/FilterCard";
import DayPick from "@/components/pick/DayPick";
import TopChrome from "@/components/map-chrome/TopChrome";
import TimeScrubber from "@/components/map-chrome/TimeScrubber";
import { EmptyDay, ErrorLine } from "@/components/map-chrome/MapNotice";
import {
  conductorLine,
  dayTag,
  defaultStop,
  nearestStop,
  scrubStops,
  scrubStrengths,
  scrubTicks,
} from "@/components/map-chrome/scrub";
import { TODAY, countByDay, matchesType, nightOf, todayKey, type DateFilter } from "@/lib/filters";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import { useEvents, useHop } from "@/lib/useEvents";
import { useCheckin } from "@/lib/useCheckin";
import { useGameDashboard } from "@/lib/game";
import { haversineKm, hasVenue } from "@/lib/geo";
import type { EventRow, HopStop } from "@/lib/types";
import { busPosition } from "@/lib/busPosition";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { DEMO_DROP_TITLES } from "@/lib/demoData";
import { NEXT_COUNT, nextEvents } from "@/lib/filters";
import { closeHotspots, useHotspotNav } from "@/lib/hotspots/open";
import YouMarker from "@/components/map/YouMarker";

// MapLibre touches window on import, so it stays out of the server bundle.
const NightMap = dynamic(() => import("@/components/map/NightMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-ink">
      <span className="font-mono text-[10px] tracking-[0.2em] text-dim">LOADING LAGOS…</span>
    </div>
  ),
});

// The hotspot pins hang on the map, and MapLibre touches window on import: also client only, in its own chunk.
const MainHotspots = dynamic(() => import("@/components/hotspots/MainHotspots"), { ssr: false });

// One stable empty list, so memo deps do not change on every render.
const NO_TYPES: string[] = [];
const NO_STOPS: HopStop[] = [];

/** Open on a day with something on, once per page load, and never over a day the Hopper chose. */
let firstDayChosen = false;

const IS_DEV = process.env.NODE_ENV !== "production";

/** With a location, events this close (km) go to the front of NEXT 20. */
const NEAR_KM = 12;

export default function MapPage() {
  const { fix, radiusKm, dateFilter, setDateFilter, types, setTypes, look } = useHoppaz();
  const { userId, refresh, profile } = useSession();
  const [map, setMap] = useState<MLMap | null>(null);
  const { events: allEvents, demo, ready, failed, reload } = useEvents(fix, radiusKm);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);
  // Only the streak is needed here, so ask for the lite read (one call, signed-in Hoppers only).
  const { stats } = useGameDashboard(userId, { lite: true });
  const streak = Number(stats?.daily_streak ?? 0) || 0;

  const [picking, setPicking] = useState(false);
  /** The map opens on the next events (NEXT 20); tapping a day switches to that one night. */
  const [mode, setMode] = useState<"next" | "day">("next");
  const [selected, setSelected] = useState<string | null>(null);
  const [hopOpen, setHopOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);

  // The store rehydrates from localStorage on the client only, so anything that
  // reads it waits a tick, or the server HTML would disagree with the first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Clocks: the bus and the scrubber re-place themselves every half minute.
  const [now, setNow] = useState(() => Date.now());

  /* ------------------------------------------------------------- the day -- */
  const shownTypes = mounted ? types : NO_TYPES;
  const dayKey = mounted && dateFilter.kind === "night" ? dateFilter.date : todayKey();
  const todayStr = nightOf(now);
  const today = dayKey === todayStr;

  // Calendar counts: everything loaded that has a real place, narrowed by type only (not by distance).
  // Leads with no venue yet stay off the map; Today still lists them.
  const typed = useMemo(() => allEvents.filter((e) => hasVenue(e) && matchesType(e, shownTypes)), [allEvents, shownTypes]);
  const counts = useMemo(() => countByDay(typed), [typed]);
  // NEXT 20: the next events from now, whatever night they fall on, so the map never opens empty.
  // With a location (the first run asks for one), the ones close by come first, topped up with the rest: Ola's rule for the
  // deck on the Events page (NEAR_KM in src/app/discover/page.tsx, upstream 1c1ebe0), here for any location.
  const next = useMemo(() => {
    if (!fix) return nextEvents(typed, NEXT_COUNT, now);
    const far = (e: EventRow) => !(e.distance_m <= NEAR_KM * 1000);
    const near = nextEvents(typed.filter((e) => !far(e)), NEXT_COUNT, now).list;
    const taken = new Set(near.map((e) => e.id));
    const rest = nextEvents(typed.filter((e) => !taken.has(e.id)), NEXT_COUNT - near.length, now).list;
    return { list: [...near, ...rest] };
  }, [typed, now, fix]);
  // Otherwise everything on the map (pins, heat, the scrubber) works off the one chosen day.
  const dayEvents = useMemo(() => typed.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey), [typed, dayKey]);
  const events = mode === "next" ? next.list : dayEvents;

  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setMode("day");
      setSelected(null);
    },
    [setDateFilter]
  );
  /** Back to the next twenty events: from the chip's x, the list card or the calendar. */
  const pickNext = useCallback(() => {
    setMode("next");
    setSelected(null);
  }, []);

  // Never leave the map on a day that is over: past days and any leftover "any day" snap to today.
  useEffect(() => {
    const snap = () => {
      const d = useHoppaz.getState().dateFilter;
      if (d.kind !== "night" || d.date < todayKey()) setDateFilter(TODAY());
    };
    snap();
    const onVisible = () => document.visibilityState === "visible" && snap();
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => {
      setNow(Date.now());
      snap();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [setDateFilter]);

  /* ------------------------------------------------ opening an event (?e=) -- */
  const deepLink = useRef<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("e");
    if (id) {
      deepLink.current = id;
      setSelected(id);
    }
  }, []);

  // Once events are in, put the map on that event's day so its pin is on it.
  useEffect(() => {
    const id = deepLink.current;
    if (!id || !ready) return;
    deepLink.current = null;
    const ev = allEvents.find((e) => e.id === id);
    if (!ev) {
      setSelected(null); // gone or finished: drop the link quietly
      return;
    }
    setDateFilter({ kind: "night", date: nightOf(Date.parse(ev.starts_at)) });
    setMode("day");
    if (useHoppaz.getState().types.length && !useHoppaz.getState().types.includes(ev.vibe)) setTypes([]);
  }, [ready, allEvents, setDateFilter, setTypes]);

  // The URL follows the open event, so the share button's link is always the one you are looking at.
  useEffect(() => {
    if (!mounted) return;
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("e", selected);
    else url.searchParams.delete("e");
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", next);
    }
  }, [selected, mounted]);

  // First load: if today is empty, open on the next day that has something on.
  useEffect(() => {
    // A failed first load has nothing to look at yet: wait for "try again" to bring events in.
    if (!ready || firstDayChosen || (failed && allEvents.length === 0)) return;
    firstDayChosen = true;
    // NEXT 20 is never empty while anything is coming up, so there is no quiet day to skip.
    if (mode === "next") return;
    if (deepLink.current) return;
    const d = useHoppaz.getState().dateFilter;
    const t = todayKey();
    if (d.kind !== "night" || d.date !== t || counts[t]) return;
    const next = Object.keys(counts)
      .filter((k) => k > t && counts[k] > 0)
      .sort()[0];
    if (next) setDateFilter({ kind: "night", date: next });
  }, [ready, failed, allEvents.length, counts, setDateFilter, mode]);

  /* ---------------------------------------------------------- the scrubber -- */
  const [chosen, setChosen] = useState<{ day: string; at: number; live: boolean } | null>(null);
  const stops = useMemo(() => scrubStops(events, dayKey, now), [events, dayKey, now]);
  const stopIdx = useMemo(() => {
    if (chosen && chosen.day === dayKey) {
      return chosen.live && stops[0]?.live ? 0 : nearestStop(stops, chosen.at);
    }
    return defaultStop(stops, events, now, today);
  }, [chosen, dayKey, stops, events, now, today]);
  const slot = stops[Math.min(stopIdx, stops.length - 1)];
  const strengths = useMemo(() => scrubStrengths(events, stops), [events, stops]);
  const ticks = useMemo(() => scrubTicks(stops, today), [stops, today]);
  const onStop = useCallback(
    (i: number) => {
      const s = stops[i];
      if (s) setChosen({ day: dayKey, at: s.t, live: s.live });
    },
    [stops, dayKey]
  );

  /* ----------------------------------------------------------- drops, bus -- */
  const liveDropIds = useCollectibleEventIds(allEvents.map((e) => e.id));
  // Development has no database, so a few sample events carry a drop flag.
  const dropIds = useMemo(
    () => (demo ? allEvents.filter((e) => DEMO_DROP_TITLES.includes(e.title)).map((e) => e.id) : liveDropIds),
    [demo, allEvents, liveDropIds]
  );
  const dropSet = useMemo(() => new Set(dropIds), [dropIds]);

  const bus = useMemo(() => busPosition(hop, new Date(now)), [hop, now]);
  const [busFocus, setBusFocus] = useState(0);
  // The route and the bus button belong to Hop day only. Other days the bus sits parked and opens the Hop.
  // The NEXT view spans several nights, so there it waits for the Hop's own night.
  const hopActive = !!hop && hop.hop_date === (mode === "next" ? todayStr : dayKey);

  const closeCard = useCallback(() => setSelected(null), []);
  const event = useMemo(() => allEvents.find((e) => e.id === selected) ?? null, [allEvents, selected]);
  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  const nextBusy = useMemo(
    () =>
      Object.keys(counts)
        .filter((k) => k > dayKey && counts[k] > 0)
        .sort()[0] ?? null,
    [counts, dayKey]
  );

  /* ------------------------------------------------------------ the map -- */
  const onMapReady = useCallback((m: MLMap) => setMap(m), []);
  const onMapUnavailable = useCallback(() => setMap(null), []);

  /* ---------------------------------------------------------- hotspots -- */
  // A hotspot's sheet, the list or the room has the screen: whatever card was open steps aside. Picking an event does the same
  // the other way (pickEvent below), so there are never two cards.
  const hotspotUi = useHotspotNav((s) => !!s.sheet || s.list || !!s.room);
  useEffect(() => {
    if (!hotspotUi) return;
    setSelected(null);
    setHopOpen(false);
    setFiltering(false);
    setPicking(false);
  }, [hotspotUi]);
  const pickEvent = useCallback((id: string) => {
    closeHotspots();
    setSelected(id);
  }, []);

  /* ---------------------------------------- the side card's left and right -- */
  const navRef = useRef<((fromId: string, dir: -1 | 1) => string | null) | null>(null);
  const step = (dir: -1 | 1) => (selected ? navRef.current?.(selected, dir) ?? null : null);

  /* ------------------------------------------- how much of the map the chrome covers -- */
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState({ top: 132, bottom: 150 });
  useEffect(() => {
    const measure = () =>
      setHud((h) => {
        const top = Math.round(topRef.current?.getBoundingClientRect().height ?? h.top);
        const bottom = Math.round(bottomRef.current?.getBoundingClientRect().height ?? h.bottom);
        return top === h.top && bottom === h.bottom ? h : { top, bottom };
      });
    measure();
    const ro = new ResizeObserver(measure);
    if (topRef.current) ro.observe(topRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    return () => ro.disconnect();
  }, [mounted, event, todayStr]);

  // The toast sits above the bottom card, not on top of its text (the side card has no bottom card under it).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--hz-toast-lift", `${event ? 0 : hud.bottom}px`);
    return () => {
      root.style.removeProperty("--hz-toast-lift");
    };
  }, [event, hud.bottom]);

  const noLiveEvents = failed && allEvents.length === 0;
  const line = !ready
    ? "Checking what's on…"
    : noLiveEvents
      ? "Nothing to show yet."
      : conductorLine({ events, dropEventIds: dropSet, dayKey, now });
  const showEmpty = mode === "day" && ready && !noLiveEvents && events.length === 0 && !filtering && !event;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      // An open event docks on the right, from just under the top chrome.
      style={{ ["--hz-side-top" as string]: `${hud.top + 4}px` }}
    >
      {/* The map is its own stacking context: its markers carry z-indexes of their own and must stay under the nav and the chrome. */}
      <div className="absolute inset-0 isolate">
        <NightMap
          events={events}
          collectibleEventIds={dropIds}
          hopStops={hop?.stops ?? NO_STOPS}
          fix={fix}
          radiusKm={radiusKm}
          bus={bus}
          busFocus={busFocus}
          at={mode === "next" ? now : slot?.t ?? now}
          live={mode === "next" ? true : slot?.live ?? true}
          onClear={() => setSelected(null)}
          fitKey={`${mode === "next" ? "next" : dayKey}|${shownTypes.join(",")}`}
          selectedId={selected}
          onSelect={pickEvent}
          onHopSelect={() => setHopOpen(true)}
          hopActive={hopActive}
          hopDate={hop?.hop_date ?? null}
          onBus={() => setHopOpen(true)}
          hudTop={hud.top}
          hudBottom={hud.bottom}
          swoop={mounted}
          onMapReady={onMapReady}
          onMapUnavailable={onMapUnavailable}
          sidePanel={!!event}
          allHot={mode === "next"}
          navRef={navRef}
        />
      </div>

      {/* You: your own mini avatar at your location. Nothing to tap. */}
      {mounted && map && <YouMarker map={map} fix={fix} look={profile?.avatar ?? look} />}

      {/* Hotspots: a pin on each open one, the Hotspots button and list, the sheet and the room. Placed under the chrome's measured height. */}
      {mounted && <MainHotspots map={map} fix={fix} top={hud.top} hidden={!!event || filtering || picking || hopOpen} />}

      {/* The chrome is all "now" (today's rail, the clock), so it draws on the client only: a page
          prerendered yesterday must not hydrate against today's rail. */}

      {/* -------------------------------------------------------------- top -- */}
      {mounted && (
        <TopChrome
          key={todayStr} /* a new day (6am) rebuilds the bar */
          hudRef={topRef}
          pick={
            <DayPick
              mode={mode}
              date={dayKey}
              events={events}
              counts={counts}
              now={now}
              anchorRef={topRef}
              onNext={pickNext}
              onDay={(date) => pickDay({ kind: "night", date })}
              // What a tap on its pin does: select it, and the map flies there and opens its card.
              onPickEvent={(e) => setSelected(e.id)}
            />
          }
          types={shownTypes}
          onRemoveType={(t) => setTypes(types.filter((x) => x !== t))}
          onClearTypes={() => setTypes([])}
          streak={streak}
          onFilter={() => {
            closeHotspots();
            setSelected(null);
            setFiltering(true);
          }}
          onLocate={() => {
            closeHotspots();
            setSelected(null);
            setPicking(true);
          }}
          showBus={hopActive && !!bus}
          onBus={() => setBusFocus((n) => n + 1)}
        >
          {noLiveEvents && <ErrorLine onRetry={() => void reload()} />}
        </TopChrome>
      )}

      {showEmpty && (
        <EmptyDay
          filtered={shownTypes.length > 0}
          nextLabel={nextBusy ? dayTag(nextBusy) : null}
          onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy })}
        />
      )}

      {/* ----------------------------------------------------------- bottom -- */}
      {mounted && !event && (
        <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3.5 pb-2.5">
          <div className="mx-auto flex max-w-[560px] items-end gap-2">
            <Link href="/drop" aria-label="Post a flyer" title="Post a flyer" className="btn pointer-events-auto grid h-11 w-11 flex-none place-items-center p-0">
              <Plus size={16} strokeWidth={3} aria-hidden />
            </Link>
            {mode !== "next" && slot && (
              <TimeScrubber
                className="pointer-events-auto min-w-0 flex-1"
                stops={stops}
                index={stopIdx}
                onIndex={onStop}
                strengths={strengths}
                ticks={ticks}
                dayKey={dayKey}
                today={today}
                line={line}
                dimLine={!ready || noLiveEvents}
                sample={IS_DEV && demo}
              />
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- sheets -- */}
      <AreaPicker open={picking} onClose={() => setPicking(false)} showRadius />
      {event && (
        <EventCard
          event={event}
          fix={fix}
          radiusKm={radiusKm}
          userId={userId}
          checkedIn={done.has(event.id)}
          checkedAt={checkedAt[event.id] ?? null}
          busy={busy === event.id}
          onCheckIn={() => checkIn(event, fix)}
          onClose={closeCard}
          isHopStop={isHopStop}
          placement="side"
          onPrev={step(-1) ? () => setSelected(step(-1)) : undefined}
          onNext={step(1) ? () => setSelected(step(1)) : undefined}
        />
      )}
      {filtering && (
        <FilterCard
          types={shownTypes}
          count={events.length}
          onTypes={setTypes}
          onClear={() => setTypes([])}
          onClose={() => setFiltering(false)}
        />
      )}
      {hopOpen && <HopSheet hop={hop} fix={fix} onClose={() => setHopOpen(false)} />}
    </div>
  );
}
