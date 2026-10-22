"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2, Undo2, X } from "lucide-react";
import DayPick from "@/components/pick/DayPick";
import EventCard from "@/components/EventCard";
import { SIDE_PANEL, sidePanelWidth } from "@/components/event/side";
import SwipeStack, { type StackApi, type SwipeDir } from "@/components/today/SwipeStack";
import WeOutsideSheet, { type Liked } from "@/components/today/WeOutsideSheet";
import DeckCard, { GhostDeck } from "@/components/today/DeckCard";
import DeckGlow, { type GlowApi } from "@/components/today/DeckGlow";
import SoundToggle from "@/components/today/SoundToggle";
import StorySheet from "@/components/today/StorySheet";
import { snapTick } from "@/components/today/tick";
import Marquee from "@/components/today/Marquee";
import { EmptyDay, FilteredOut, LoadFailed } from "@/components/today/Empty";
import YourDays from "@/components/today/YourDays";
import LocationAsk from "@/components/today/LocationAsk";
import { useEventQuests } from "@/components/today/useEventQuests";
import { useViewport } from "@/components/today/useViewport";
import {
  HOUR,
  byGoingThenStart,
  conductorLine,
  hasEnded,
  nextBusyDay,
  nextBusyLabel,
} from "@/components/today/helpers";
import { DEMO_DROP_TITLES } from "@/lib/demoData";
import {
  NEXT_COUNT,
  TODAY,
  countByDay,
  matchesType,
  nextEvents,
  nightOf,
  todayKey,
  type DateFilter,
} from "@/lib/filters";
import { demoFlyer } from "@/components/event/demo";
import { eventTitle, haversineKm } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";
import { isNeedAccount, requireAccount } from "@/lib/accountGate";
import { useEventGroups } from "@/lib/chat";
import { logSwipe, useGuestLikes } from "@/lib/swipeLog";
import { useCheckin } from "@/lib/useCheckin";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { useEvents, useHop } from "@/lib/useEvents";
import { useGoing } from "@/lib/useGoing";
import { useSession } from "@/lib/useSession";
import type { EventRow } from "@/lib/types";
import { EVENTS_R1, EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import CreateButton from "@/components/events-r1/CreateButton";
import DayList from "@/components/events-r1/DayList";
import { eventsLine } from "@/components/events-r1/EventsHeading";
import { EVENTS_TITLE, realGoing } from "@/components/events-r1/words";

// One stable empty list, so memo deps do not change on every render.
const NO_TYPES: string[] = [];
/** With the Hopper's real location, events this close (km) go to the front of the deck. */
const NEAR_KM = 12;
/** Release 1: a right swipe means interested only. The fake data layer takes it instead of Supabase. */
const FAKE_R1 = EVENTS_R1 && EVENTS_R1_FAKE;
const WE_OUTSIDE = EVENTS_R1 ? "Saved to Interested." : "We outside. You're in its room in Chat.";

/**
 * TODAY (the /discover route): the night as a pile of big flyer cards you
 * swipe, Tinder style: right is WE OUTSIDE (you're going), left is a nah for
 * now and the card goes to the back of the pile, so it comes round again.
 * The screen behind takes the colours of the flyer on top and blends towards
 * the next as you drag (a phone that can buzz gives a tiny tap on each swipe;
 * the speaker button in the header is the app's one mute). SHARE TO STORY
 * makes a 9:16 picture of the top card; ?demo=1 swipes by itself, for
 * filming. It opens on NEXT 20 every time; the chip and the orange calendar in the header (the same
 * ones the Map has) pick one night instead. Tap the top card and it opens into the breakdown: the event
 * card as a sheet on a phone, docked on the right on a wide screen. A slow
 * strip of tags underneath scrolls what is coming up and jumps the deck to
 * whichever one you tap.
 */
export default function TodayPage() {
  const { fix, radiusKm, dateFilter, setDateFilter, types, setTypes } = useHoppaz();
  const { userId, refresh } = useSession();
  const { events: allEvents, demo, ready, failed, reload } = useEvents(fix, 45);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);
  const going = useGoing(userId);
  const say = useToast((st) => st.say);
  const { width, wide } = useViewport();

  /** Which night the deck shows: one chosen day, or the next twenty events whatever night they fall on. */
  const [mode, setMode] = useState<"day" | "next">("next");
  /**
   * The swipe pile for one deck (a night, or NEXT), by event id so a list that shifts under it keeps its place:
   * `order` is the pile as you left it. Another night starts its own pile.
   */
  const [pile, setPile] = useState<{ key: string; order: string[] }>({ key: "", order: [] });
  /** The WE OUTSIDE list is open. */
  const [listOpen, setListOpen] = useState(false);
  /** The breakdown is open on the card on top. */
  const [open, setOpen] = useState(false);
  /** Your own taps, added to the loaded going counts until a fresh load brings the real ones. */
  const [delta, setDelta] = useState<Record<string, number>>({});

  // The store rehydrates from localStorage on the client only, and everything
  // here is "now" (today's rail, the clock), so it draws after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [now, setNow] = useState(() => Date.now());

  // Never sit on a day that is over: past days snap to today, on return and every half minute.
  useEffect(() => {
    const snap = () => {
      const d = useHoppaz.getState().dateFilter;
      if (d.kind !== "night" || d.date < todayKey()) setDateFilter(TODAY());
    };
    snap();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      snap();
    };
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

  // A fresh load carries the real counts, so your own taps are no longer needed.
  // (The sample day in development never includes them, so it keeps them.)
  useEffect(() => {
    if (!demo) setDelta({});
  }, [allEvents, demo]);

  /* ------------------------------------------------------------- the day -- */
  const shownTypes = mounted ? types : NO_TYPES;
  const today = nightOf(now);
  const dayKey = mounted && dateFilter.kind === "night" ? dateFilter.date : today;

  // Calendar counts: everything loaded, narrowed by type only (the same dots the Map's calendar shows).
  const typed = useMemo(() => allEvents.filter((e) => matchesType(e, shownTypes)), [allEvents, shownTypes]);
  const counts = useMemo(() => countByDay(typed), [typed]);
  // Shared location: the ones close by come first. Without it (or with a picked area) nothing is reordered.
  const gps = fix?.source === "gps";
  const far = useCallback((e: EventRow) => gps && !(e.distance_m <= NEAR_KM * 1000), [gps]);
  // The next events from now, whatever night: the deck's NEXT view and the strip under it. With a location, the
  // next ones close by, topped up with the rest when there are not enough.
  const next = useMemo(() => {
    if (!gps) return nextEvents(typed, NEXT_COUNT, now);
    const near = nextEvents(typed.filter((e) => !far(e)), NEXT_COUNT, now).list;
    const taken = new Set(near.map((e) => e.id));
    const rest = nextEvents(typed.filter((e) => !taken.has(e.id)), NEXT_COUNT - near.length, now).list;
    return { list: [...near, ...rest] };
  }, [typed, now, gps, far]);
  // One night: the ones close by first (with a location), then the busiest, the ones already over at the back.
  const dayEvents = useMemo(
    () =>
      typed
        .filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey)
        .sort(
          (a, b) =>
            Number(hasEnded(a, now)) - Number(hasEnded(b, now)) || Number(far(a)) - Number(far(b)) || byGoingThenStart(a, b)
        ),
    [typed, dayKey, now, far]
  );
  // A new location reorders the deck: start the pile again from its new order.
  const fixKey = fix ? `${fix.source}:${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}` : "";
  useEffect(() => setPile({ key: "", order: [] }), [fixKey]);
  const dayTotal = useMemo(
    () => allEvents.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey).length,
    [allEvents, dayKey]
  );
  const nextBusy = useMemo(() => nextBusyDay(counts, dayKey), [counts, dayKey]);

  // Release 1: a row that carries the real going count (people who registered) shows that, never the swipe count.
  const goingOf = useCallback(
    (e: EventRow) => {
      const real = EVENTS_R1 ? realGoing(e) : null;
      return real !== null ? real : Math.max(0, (e.swipes_in ?? 0) + (delta[e.id] ?? 0));
    },
    [delta]
  );
  const distanceLabel = useCallback((e: EventRow) => {
    if (!fix || !Number.isFinite(e.distance_m)) return null;
    return e.distance_m < 1000 ? `${Math.round(e.distance_m)} M` : `${(e.distance_m / 1000).toFixed(1)} KM`;
  }, [fix]);

  /* ------------------------------------------------------------ the deck -- */
  const deckKey = mode === "next" ? "next" : `day:${dayKey}`;
  const deckEvents = mode === "next" ? next.list : dayEvents;
  const byId = useMemo(() => new Map(deckEvents.map((e) => [e.id, e])), [deckEvents]);
  // The pile: the night's events in the deck's order (the ones that are over are left out), and a card you swipe,
  // either way, goes to the back so it comes round again. The deck never runs out.
  const pileIds = useMemo(() => {
    const live = deckEvents.filter((e) => !hasEnded(e, now));
    const liveIds = new Set(live.map((e) => e.id));
    const listed = (pile.key === deckKey ? pile.order : []).filter((id) => liveIds.has(id));
    const seen = new Set(listed);
    return [...listed, ...live.filter((e) => !seen.has(e.id)).map((e) => e.id)];
  }, [pile, deckKey, deckEvents, now]);
  const pileRef = useRef(pileIds);
  useEffect(() => {
    pileRef.current = pileIds;
  });
  const top = byId.get(pileIds[0] ?? "") ?? null;
  /** An event opened from the WE OUTSIDE list: it may be on another night, or over, so it is not the pile's top. */
  const [picked, setPicked] = useState<EventRow | null>(null);
  const event = picked ?? (open ? top : null);

  /** Move a card in the pile: to the front (a tag in the strip, the breakdown's back button) or to the back (a swipe). */
  const move = useCallback(
    (id: string, to: "front" | "back") =>
      setPile(() => {
        const rest = pileRef.current.filter((x) => x !== id);
        return { key: deckKey, order: to === "front" ? [id, ...rest] : [...rest, id] };
      }),
    [deckKey]
  );

  // How far the top card has gone, for the glow behind it.
  const glow = useRef<GlowApi | null>(null);
  const stack = useRef<StackApi | null>(null);
  const flyers = useMemo(() => pileIds.slice(0, 3).map((id) => demoFlyer(byId.get(id)!)), [pileIds, byId]);
  const onPos = useCallback((pos: number) => glow.current?.set(pos), []);

  // Share to story: the card on top, as a 9:16 picture.
  const [story, setStory] = useState<EventRow | null>(null);
  const closeStory = useCallback(() => setStory(null), []);

  // ?demo=1 passes a card by itself every 2.5 seconds, for filming ads. A touch or a key hands it back to you for a while.
  const [filming, setFilming] = useState(false);
  useEffect(() => {
    setFilming(new URLSearchParams(window.location.search).get("demo") === "1");
  }, []);
  const touched = useRef(0);
  const touch = useCallback(() => {
    touched.current = Date.now();
  }, []);
  const pileCount = pileIds.length;
  useEffect(() => {
    if (!filming || open || story || pileCount < 2) return;
    const id = setInterval(() => {
      if (Date.now() - touched.current < 6000) return;
      stack.current?.swipe("pass");
    }, 2500);
    return () => clearInterval(id);
  }, [filming, open, story, pileCount]);

  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setMode("day");
      setOpen(false);
    },
    [setDateFilter]
  );

  /** Back to the next twenty events: from the chip's x, the list card or the calendar. */
  const pickNext = useCallback(() => {
    setMode("next");
    setOpen(false);
  }, []);

  /** A tag in the strip: put that event on top of the pile, on its own night if it is not on this deck. */
  const jump = (e: EventRow) => {
    setOpen(false);
    if (byId.has(e.id)) {
      move(e.id, "front");
      return;
    }
    const night = nightOf(Date.parse(e.starts_at));
    setDateFilter({ kind: "night", date: night });
    setMode("day");
    setPile({ key: `day:${night}`, order: [e.id] });
  };

  /* ----------------------------------------------- drops, quests, your days -- */
  const liveDropIds = useCollectibleEventIds(allEvents.map((e) => e.id));
  // Development has no database, so a few sample events carry a drop (same rule as the Map).
  const dropSet = useMemo(
    () =>
      new Set(demo ? allEvents.filter((e) => DEMO_DROP_TITLES.includes(e.title)).map((e) => e.id) : liveDropIds),
    [demo, allEvents, liveDropIds]
  );
  const questsByEvent = useEventQuests(userId, deckEvents);

  const mine = useMemo(
    () =>
      allEvents
        .filter(
          (e) =>
            going.decisions[e.id] === "in" &&
            !hasEnded(e, now) &&
            Date.parse(e.starts_at) < now + 14 * 24 * HOUR
        )
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
    [allEvents, going.decisions, now]
  );

  /* ---------------------------------------------------- the breakdown -- */
  // The event card can change your going. When it closes or moves on, fold that change into the count.
  const goingRef = useRef(going);
  useEffect(() => {
    goingRef.current = going;
  });
  const openId = event?.id ?? null;
  const openIdRef = useRef<string | null>(null);
  useEffect(() => {
    openIdRef.current = openId;
  });
  useEffect(() => {
    if (!openId) return;
    const was = goingRef.current.isGoing(openId);
    return () => {
      const is = goingRef.current.isGoing(openId);
      if (is !== was) setDelta((d) => ({ ...d, [openId]: (d[openId] ?? 0) + (is ? 1 : -1) }));
    };
  }, [openId]);

  /* ------------------------------------------------- WE OUTSIDE on a card -- */
  // A guest's tap opens the sign-up sheet and finishes on its own after sign-up (useGoing remembers it);
  // when the going lands, fold it into the count here and say so.
  const awaiting = useRef<Set<string>>(new Set());
  useEffect(() => {
    awaiting.current.forEach((id) => {
      if (!going.isGoing(id)) return;
      awaiting.current.delete(id);
      if (id !== openIdRef.current) setDelta((d) => ({ ...d, [id]: (d[id] ?? 0) + 1 }));
      say(WE_OUTSIDE, "ok");
    });
  }, [going, say]);
  const weOutside = async (e: EventRow) => {
    if (going.busy[e.id]) return;
    const was = going.isGoing(e.id);
    const err = await going.toggleGoing(e.id);
    if (err) {
      if (isNeedAccount(err)) awaiting.current.add(e.id);
      else say(err, "error");
      return;
    }
    // The open breakdown folds its own change in when it closes; counting it here too would double it.
    if (e.id !== openIdRef.current) setDelta((d) => ({ ...d, [e.id]: (d[e.id] ?? 0) + (was ? -1 : 1) }));
    if (!was) say(WE_OUTSIDE, "ok");
  };
  // The deck's cards are memoised: hand them one steady function that always reaches the newest.
  const weOutsideRef = useRef(weOutside);
  useEffect(() => {
    weOutsideRef.current = weOutside;
  });
  const onGoing = useCallback((e: EventRow) => void weOutsideRef.current(e), []);

  /* ------------------------------------------------------------- a swipe -- */
  // Right is WE OUTSIDE: you're interested in going. With an account it saves as going (and so the group chat
  // invite); a guest's right swipes are kept on the phone and saved the moment they sign up (the sheet asks once a
  // visit, not on every swipe). Every swipe, both ways, goes into the swipe log for the data. Either way the card
  // goes to the back of the pile and comes round again.
  const guest = useGuestLikes(async (id) => going.decide(id, "in"));
  const asked = useRef(false);
  const toldOnce = useRef(false);
  const swipeIn = async (e: EventRow) => {
    if (going.isGoing(e.id) || going.busy[e.id]) return;
    // Release 1 with the fake layer: a guest can swipe, there is no account to ask for.
    if (!FAKE_R1 && !requireAccount(EVENTS_R1 ? "save your Interested list" : "save your WE OUTSIDE list and get the group chats", { quiet: asked.current })) {
      asked.current = true;
      guest.add(e.id);
      return;
    }
    const err = await going.decide(e.id, "in");
    if (err) {
      if (!isNeedAccount(err)) say(err, "error");
      return;
    }
    if (e.id !== openIdRef.current) setDelta((d) => ({ ...d, [e.id]: (d[e.id] ?? 0) + 1 }));
    // Said once a visit: on an endless deck a line on every swipe would be noise.
    if (!toldOnce.current) say(EVENTS_R1 ? "Saved to Interested. Register on the event page to go." : "We outside. It's on your list, and you're in its room in Chat.", "ok");
    toldOnce.current = true;
  };
  const swipeInRef = useRef(swipeIn);
  useEffect(() => {
    swipeInRef.current = swipeIn;
  });
  const filmingRef = useRef(false);
  useEffect(() => {
    filmingRef.current = filming;
  });
  // A left swipe can be a slip: for a few seconds a GO BACK button puts that card back on top.
  const [undoId, setUndoId] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoId(null);
  }, []);
  useEffect(() => clearUndo, [clearUndo]);
  // Another night is another pile: the card to go back to is not on it.
  useEffect(() => clearUndo(), [deckKey, clearUndo]);
  const onSwipe = useCallback(
    (id: string, dir: SwipeDir) => {
      snapTick();
      move(id, "back");
      // ?demo=1 swipes on its own for filming: that is not a Hopper's choice, so it is not logged or saved.
      if (filmingRef.current && Date.now() - touched.current >= 6000) return;
      logSwipe(id, dir === "in" ? "right" : "left");
      const e = byId.get(id);
      if (dir === "in" && e) void swipeInRef.current(e);
      if (dir === "in") {
        clearUndo();
        return;
      }
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoId(id);
      undoTimer.current = setTimeout(() => {
        undoTimer.current = null;
        setUndoId(null);
      }, 5000);
    },
    [move, byId, clearUndo]
  );
  const goBack = () => {
    if (!undoId) return;
    snapTick();
    move(undoId, "front");
    clearUndo();
  };

  /* ------------------------------------------------- the WE OUTSIDE list -- */
  const groups = useEventGroups(userId);
  const allById = useMemo(() => new Map(allEvents.map((e) => [e.id, e])), [allEvents]);
  const liked = useMemo(() => {
    const items: Liked[] = [];
    for (const [id, d] of Object.entries(going.decisions)) {
      const e = d === "in" ? allById.get(id) : undefined;
      if (e) items.push({ event: e, saved: true });
    }
    for (const id of guest.liked) {
      const e = allById.get(id);
      if (e && going.decisions[id] !== "in") items.push({ event: e, saved: false });
    }
    // Coming up soonest first, then the ones that are over.
    return items.sort(
      (a, b) =>
        Number(hasEnded(a.event, now)) - Number(hasEnded(b.event, now)) ||
        Date.parse(a.event.starts_at) - Date.parse(b.event.starts_at)
    );
  }, [going.decisions, guest.liked, allById, now]);
  const likedUpcoming = liked.filter((i) => !hasEnded(i.event, now)).length;
  const reloadGroups = groups.reload;
  useEffect(() => {
    if (listOpen) void reloadGroups();
  }, [listOpen, reloadGroups]);

  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  /** A row in the NEXT 20 card: that event on top of the deck, opened like a tap on its card. One that is over is not in the pile, so it opens on its own. */
  const headerRef = useRef<HTMLElement>(null);
  const openFromList = (e: EventRow) => {
    if (hasEnded(e, now)) {
      setPicked(e);
    } else {
      jump(e);
      setPicked(null);
      setOpen(true);
    }
  };

  // Docked on the right, the card sits under the header and the deck slides left to stay in view beside it.
  const root = useRef<HTMLDivElement>(null);
  const deckBox = useRef<HTMLDivElement>(null);
  const [sideTop, setSideTop] = useState(140);
  useEffect(() => {
    if (!event || !wide) return;
    const r = root.current?.getBoundingClientRect();
    const d = deckBox.current?.getBoundingClientRect();
    if (r && d) setSideTop(Math.max(8, Math.round(d.top - r.top)));
  }, [event, wide]);
  const shift = event && wide ? Math.round((sidePanelWidth(width) + SIDE_PANEL.gap * 2) / 2) : 0;

  /* ------------------------------------------------------------ what shows -- */
  const loading = !mounted || !ready;
  const noLiveEvents = ready && failed && allEvents.length === 0;
  const empty = !loading && !noLiveEvents && deckEvents.length === 0;

  const line = loading
    ? "Checking what's on…"
    : empty
      ? "Nothing listed for this night yet."
      : EVENTS_R1
        ? eventsLine(mode, dayKey)
        : conductorLine({ events: deckEvents, dropIds: dropSet, dayKey: mode === "next" ? "" : dayKey, now, goingOf });


  return (
    <div
      ref={root}
      className="relative flex h-full flex-col overflow-hidden"
      style={{ ["--hz-side-top" as string]: `${sideTop}px` }}
      data-demo={filming ? "1" : undefined}
      onPointerDownCapture={touch}
      onKeyDownCapture={touch}
    >
      {/* The screen takes the middle card's colours. Behind everything, and it never takes a tap. */}
      {!loading && !noLiveEvents && !empty && top && <DeckGlow urls={flyers} index={0} api={glow} />}
      <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col">
          {/* -------------------------------------------------------- header -- */}
          <header ref={headerRef} className="pad-top flex-none px-4 pb-3">
            <div className="flex items-center gap-1">
              <h1 className={`mr-auto min-w-0 truncate font-display font-black leading-none tracking-[-0.01em] ${EVENTS_R1 ? "text-[22px] md:text-[26px]" : "text-[34px]"}`}>{EVENTS_R1 ? EVENTS_TITLE : "Events"}</h1>
              {mounted && (
                <DayPick
                  key={today}
                  mode={mode}
                  date={dayKey}
                  events={deckEvents}
                  counts={counts}
                  now={now}
                  anchorRef={headerRef}
                  onNext={pickNext}
                  onDay={(date) => pickDay({ kind: "night", date })}
                  onPickEvent={openFromList}
                />
              )}
              {!loading && !noLiveEvents && !empty && <SoundToggle className="-mr-2" />}
            </div>
            <div className="mt-2.5 flex items-start gap-2.5">
              <p className="min-h-[22px] min-w-0 flex-1 font-body text-[15px] font-medium leading-snug text-cream">{line}</p>
              {mounted && (
                <button
                  type="button"
                  onClick={() => setListOpen(true)}
                  aria-label={EVENTS_R1 ? `Interested: ${liked.length} event${liked.length === 1 ? "" : "s"} you swiped right on` : `We outside: ${liked.length} event${liked.length === 1 ? "" : "s"} you swiped right on`}
                  className="inline-flex h-[34px] flex-none items-center gap-1.5 rounded-full border border-line bg-ink-2/70 px-3 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-cream transition-transform active:scale-[0.94]"
                >
                  {EVENTS_R1 ? "Interested" : "We outside"}
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-orange px-1 text-[10px] font-medium tabular-nums text-brand-ink">
                    {likedUpcoming}
                  </span>
                </button>
              )}
            </div>
          </header>


          {shownTypes.length > 0 && (
            <div className="flex flex-none items-center gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shownTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed="true"
                  aria-label={`Remove ${t}`}
                  onClick={() => setTypes(types.filter((x) => x !== t))}
                  className="chip min-h-[32px] flex-none gap-1.5 px-2.5 text-[10.5px]"
                >
                  {t}
                  <X size={12} aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTypes([])}
                className="flex h-[32px] flex-none items-center px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-cream underline underline-offset-4"
              >
                Clear
              </button>
            </div>
          )}

          {/* ------------------------------------------------------- the deck -- */}
          <div
            ref={deckBox}
            className="flex min-h-[400px] flex-1 flex-col pt-2 transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ transform: shift ? `translate3d(${-shift}px,0,0)` : undefined }}
          >
            {loading ? (
              <GhostDeck />
            ) : noLiveEvents ? (
              <LoadFailed onRetry={() => void reload()} />
            ) : empty ? (
              <div className="my-auto">
                {mode === "day" && dayTotal > 0 && shownTypes.length > 0 ? (
                  <FilteredOut
                    onClear={() => setTypes([])}
                    next={nextBusy}
                    onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy.key })}
                  />
                ) : (
                  <EmptyDay
                    next={nextBusy}
                    onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy.key })}
                  />
                )}
              </div>
            ) : !top ? (
              <div className="my-auto px-4 pb-8 pt-8 text-center">
                <p className="font-display text-[22px] font-black">That&apos;s a wrap.</p>
                <p className="hint mx-auto mt-1.5 max-w-[30ch]">Everything on this night has ended.</p>
                {nextBusy && (
                  <button
                    type="button"
                    onClick={() => pickDay({ kind: "night", date: nextBusy.key })}
                    className="btn mt-5 px-5 text-[12.5px]"
                  >
                    {nextBusyLabel(nextBusy)}
                  </button>
                )}
              </div>
            ) : (
              <div key={deckKey} className="relative flex min-h-0 flex-1 animate-fade flex-col">
                {undoId && byId.has(undoId) && (
                  <button
                    key={undoId}
                    type="button"
                    onClick={goBack}
                    aria-label={`Go back to ${eventTitle(byId.get(undoId)!)}`}
                    className="absolute left-1/2 top-2 z-20 inline-flex h-[38px] -translate-x-1/2 animate-fade items-center gap-[7px] rounded-full border border-line bg-ink-2/90 pl-[11px] pr-[14px] font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-cream shadow-lg backdrop-blur transition-transform active:scale-[0.94]"
                  >
                    <Undo2 size={15} strokeWidth={2.2} className="text-orange" aria-hidden />
                    Go back
                  </button>
                )}
                <SwipeStack
                  ids={pileIds}
                  api={stack}
                  onSwipe={onSwipe}
                  onPos={onPos}
                  hint={!event && !story && !listOpen && !filming}
                  lead={
                    <button
                      type="button"
                      onClick={() => setStory(top)}
                      aria-label="Share to story"
                      className="inline-flex h-[38px] flex-none items-center gap-[7px] rounded-full border border-line bg-ink-2/70 pl-[11px] pr-[14px] font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-cream transition-transform active:scale-[0.94]"
                    >
                      <Share2 size={15} strokeWidth={2.2} className="text-orange" aria-hidden />
                      Share to story
                    </button>
                  }
                  onOpen={() => setOpen(true)}
                  label={(id) => `Open ${eventTitle(byId.get(id)!)}`}
                  slide={(id, s) => {
                    const e = byId.get(id);
                    if (!e) return null;
                    return (
                      <DeckCard
                        event={e}
                        distance={distanceLabel(e)}
                        now={now}
                        count={goingOf(e)}
                        going={going.isGoing(e.id)}
                        box={dropSet.has(e.id)}
                        quests={questsByEvent.get(e.id)?.length ?? 0}
                        near={s.near}
                        active={s.active}
                        narrow={s.narrow}
                        busy={!!going.busy[e.id]}
                        onGoing={onGoing}
                      />
                    );
                  }}
                />
              </div>
            )}
          </div>

          {/* --------------------------------------------- the moving strip -- */}
          {/* Release 1: the events as plain text under day headings, instead of the drifting strip. */}
          {!loading && !noLiveEvents && EVENTS_R1 && (
            <section aria-label="Events" className="flex-none border-t border-line px-1 pb-2 pt-1">
              <DayList events={mode === "next" ? next.list : dayEvents} now={now} onPick={openFromList} />
            </section>
          )}
          {!loading && !noLiveEvents && !EVENTS_R1 && <Marquee events={next.list} now={now} onPick={jump} />}

          {!loading && mine.length > 0 && <YourDays
              events={mine}
              now={now}
              onOpen={(e) => {
                // A night you are going to: slide the deck to it and open it, like a tap on its card.
                jump(e);
                setOpen(true);
              }}
            />}
          <div className={EVENTS_R1 ? "h-20 flex-none" : "h-3 flex-none"} />
        </div>
      </div>

      {/* Release 1: the same orange + Create as the Map, bottom right above the tab bar. It steps aside while a card is open. */}
      {EVENTS_R1 && mounted && !event && (
        <div className="pointer-events-none absolute bottom-2.5 right-3.5 z-20">
          <CreateButton />
        </div>
      )}

      <WeOutsideSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        items={liked}
        groups={groups.groups}
        now={now}
        onOpen={(e) => {
          setListOpen(false);
          setPicked(e);
        }}
        onJoin={async (id) => {
          const ok = await groups.join(id);
          say(ok ? "You're in the group chat." : "Couldn't join. Try again.", ok ? "ok" : "error");
          return ok;
        }}
        onSignUp={() => {
          setListOpen(false);
          requireAccount("save your WE OUTSIDE list and get the group chats");
        }}
      />

      <LocationAsk paused={filming || listOpen || !!story || !!event} />

      <StorySheet event={story} going={story ? goingOf(story) : 0} box={story ? dropSet.has(story.id) : false} onClose={closeStory} />

      {/* ------------------------------------------------------ the breakdown -- */}
      {event && !wide && (
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={() => {
            setOpen(false);
            setPicked(null);
          }}
          className="absolute inset-0 z-30 animate-fade bg-brand-ink/50"
        />
      )}
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
          onClose={() => {
            setOpen(false);
            setPicked(null);
          }}
          isHopStop={isHopStop}
          showOnMap
          placement={wide ? "side" : "sheet"}
          onPrev={wide && !picked && pileIds.length > 1 ? () => move(pileIds[pileIds.length - 1], "front") : undefined}
          onNext={wide && !picked && pileIds.length > 1 ? () => move(event.id, "back") : undefined}
        />
      )}
    </div>
  );
}
