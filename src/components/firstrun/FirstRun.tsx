"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MapPin, X } from "lucide-react";
import AreaPicker from "@/components/AreaPicker";
import Mascot from "@/components/Mascot";
import { FIRST_RUN_ENABLED, rememberLocationAsk, startingStep, useFirstRun } from "@/lib/firstRun";
import { insideLagos, nearestArea } from "@/lib/geo";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import { useTopNear } from "@/lib/nearEvents";
import { useHoppaz, useToast } from "@/lib/store";
import { isTestHost } from "@/lib/testHost";
import { useSession } from "@/lib/useSession";
import PazSide from "./PazSide";

/** The beat before a layer comes, so the page (and the camera) land first. */
const BEAT_MS = { location: 700, events: 1400, home: 300, arrived: 600 } as const;
/** The map has been looked at and then left still for this long: bring the hotspot in. */
const STILL_MS = 4_000;
/** Nobody touched the map at all for this long: bring it in anyway. */
const NO_TOUCH_MS = 25_000;

type Layer = "location" | "events" | "home" | "arrived";

/** A link that takes someone to one thing (an event, a hotspot, a day) is not met with a card first. */
const isDeepLink = () => {
  const q = new URLSearchParams(window.location.search);
  return q.has("e") || q.has("hotspot") || q.has("date");
};

/** Where the bottom layers sit: above the page's own bottom controls on a phone, at the corner of a wide screen. */
const BOTTOM = "calc(var(--hz-nav-bottom, 5.25rem) + var(--hz-toast-lift, 0px) + env(safe-area-inset-bottom, 0px))";

/**
 * The first run (src/lib/firstRun.ts): layers over the app as it was, one at a time. It is mounted once in the layout and
 * shows on the map (location, events, the pull to the hotspot) and in a hotspot room (Paz says hello). It is for someone
 * new: an account, or a link to one thing, never meets it.
 */
export default function FirstRun() {
  const pathname = usePathname();
  const router = useRouter();
  const { step, ready, hydrate, go, finish } = useFirstRun();
  const { hasAccount, state: session } = useSession();
  const fix = useHoppaz((s) => s.fix);
  const setFix = useHoppaz((s) => s.setFix);
  const say = useToast((s) => s.say);
  const topNear = useTopNear((s) => s.list);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The third layer is under way: the map is moving, the avatar is running, the room is about to open. */
  const [running, setRunning] = useState(false);
  /** Another sheet or card has the screen: this one waits. */
  const [covered, setCovered] = useState(false);
  /** The map is on the screen (its canvas is up): the pull needs it, to move it and to run your avatar over it. */
  const [mapUp, setMapUp] = useState(false);
  /** The beat before the layer comes. */
  const [late, setLate] = useState(false);
  /** A test host asked for the first run again: an account does not stop it. */
  const forced = useRef(false);

  useEffect(() => hydrate(), [hydrate]);

  // Start, once the session has settled (an account never meets it). On test hosts /?welcome starts it again, with no
  // location, so the first card is there.
  useEffect(() => {
    if (!FIRST_RUN_ENABLED || !ready || session === "loading") return;
    const q = new URLSearchParams(window.location.search);
    if (isTestHost() && q.has("welcome")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      forced.current = true;
      setFix(null);
      go("location");
      return;
    }
    if (hasAccount && !forced.current) {
      if (step !== "done") finish();
      return;
    }
    if (step === null && !isDeepLink()) go(startingStep());
  }, [ready, session, hasAccount, step, go, finish, setFix]);

  // The location came in (from the card, the crosshair, anywhere): the map zooms to you, and the second layer follows.
  useEffect(() => {
    if (step === "location" && fix) go("events");
  }, [step, fix, go]);

  const onMap = pathname === "/";
  const inRoom = pathname.startsWith("/room/");
  const layer: Layer | null = useMemo(() => {
    if (!FIRST_RUN_ENABLED || !ready || !step || step === "done") return null;
    if (inRoom) return "arrived"; // a room of any kind, however they got there
    if (!onMap) return null;
    if (step === "arrived") return running ? "home" : null;
    return step;
  }, [ready, step, onMap, inRoom, running]);

  // Back on the map after the run was meant to open a room and did not (a reload, the back button): that was the end of it.
  useEffect(() => {
    if (onMap && ready && step === "arrived" && !running) finish();
  }, [onMap, ready, step, running, finish]);

  // The beat, again each time the layer changes or the screen does.
  useEffect(() => {
    setLate(false);
    if (!layer) return;
    const t = setTimeout(() => setLate(true), BEAT_MS[layer]);
    return () => clearTimeout(t);
  }, [layer, pathname]);

  // Anything else that is a dialog (an event's card, a hotspot sheet, the area sheet) has the screen first.
  useEffect(() => {
    if (!layer) return;
    const look = () => {
      setCovered(!!document.querySelector('[role="dialog"]:not([data-firstrun])'));
      setMapUp(!!document.querySelector(".maplibregl-canvas"));
    };
    look();
    const t = setInterval(look, 500);
    return () => clearInterval(t);
  }, [layer]);

  /* ----------------------------------------------------------------- 1. the location card -- */
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return setPicking(true);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setBusy(false);
        rememberLocationAsk("yes");
        const near = nearestArea(lat, lng);
        if (insideLagos(lat, lng)) {
          setFix({ lat, lng, source: "gps", area: near.name });
          say(`Showing what's on near ${near.name}.`, "ok");
        } else {
          // The map is Lagos only: someone abroad is shown the closest area, so the map still does its zoom.
          setFix({ lat: near.lat, lng: near.lng, source: "area", area: near.name });
          say(`You're outside Lagos. Showing ${near.name}.`, "ok");
        }
      },
      () => {
        setBusy(false);
        say("Could not find you. Pick your area instead.");
        setPicking(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  }, [setFix, say]);

  const notNow = () => {
    rememberLocationAsk("no");
    go("events");
  };

  /* ------------------------------------------------- 2. the events layer, then the idle watch -- */
  useEffect(() => {
    if (layer !== "events" || !late || !mapUp) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = (ms: number) => {
      clearTimeout(t);
      t = setTimeout(() => go("home"), ms);
    };
    arm(NO_TOUCH_MS);
    // A press cancels the wait; the end of a drag, a scroll or a key starts the still count again.
    const down = () => clearTimeout(t);
    const settle = () => arm(STILL_MS);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", settle, true);
    document.addEventListener("pointercancel", settle, true);
    document.addEventListener("wheel", settle, { capture: true, passive: true });
    document.addEventListener("keydown", settle, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", settle, true);
      document.removeEventListener("pointercancel", settle, true);
      document.removeEventListener("wheel", settle, true);
      document.removeEventListener("keydown", settle, true);
    };
  }, [layer, late, mapUp, go]);

  /* ------------------------------------------- 3. the pull: the map moves, your avatar runs, the room opens -- */
  const at = useMemo(() => (fix && insideLagos(fix.lat, fix.lng) ? { lat: fix.lat, lng: fix.lng } : null), [fix]);
  const hs = useHotspots({ active: layer === "home", at });
  const home = hs.yours ?? hs.list.find((h) => h.status === "open") ?? null;
  const started = useRef(false);
  useEffect(() => {
    if (layer !== "home" || running || !late || covered || !mapUp || !home || started.current) return;
    started.current = true;
    go("arrived");
    setRunning(true);
    const detail = { slug: home.slug, handled: false };
    window.dispatchEvent(new CustomEvent("hz-open-hotspot", { detail }));
    // Anywhere without the map under it: straight to the room.
    if (!detail.handled) router.push(`/room/${home.slug}`);
  }, [layer, running, late, covered, mapUp, home, go, router]);

  const stayHere = () => {
    window.dispatchEvent(new Event("hz-cancel-hotspot-run"));
    setRunning(false);
    finish();
  };

  const editHopper = () => {
    finish();
    router.push(`/me/avatar?next=${encodeURIComponent(pathname)}`);
  };

  /** A flyer on the events layer: open that event on the map. */
  const openEvent = (id: string) => {
    window.dispatchEvent(new CustomEvent("hz-open-event", { detail: { id } }));
    finish();
  };

  /* ---------------------------------------------------------------------------- render -- */
  const picker = picking ? <Picker onClose={() => setPicking(false)} /> : null;
  if (!layer || !late || (covered && !running)) return picker;

  if (layer === "location") {
    return (
      <>
        <div
          role="dialog"
          aria-label="Set your location"
          data-firstrun
          className="fixed inset-x-0 z-[42] mx-auto w-[min(calc(100vw-24px),440px)] animate-rise rounded-[12px] border border-line bg-ink-2 px-4 pb-3 pt-3.5 shadow-sheet lg:inset-x-auto lg:left-[88px] lg:mx-0 lg:w-[380px]"
          style={{ bottom: BOTTOM }}
        >
          <button type="button" onClick={notNow} aria-label="Close" className="absolute right-1 top-1 grid h-11 w-11 place-items-center">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-line text-cream">
              <X size={16} strokeWidth={2.4} aria-hidden />
            </span>
          </button>
          <div className="flex items-center gap-3 pr-9">
            <Mascot state="point" size={56} className="rig-on-raised flex-none" />
            <h2 className="min-w-0 font-display text-[18px] font-black leading-[1.2]">Set your location to see the best events near you.</h2>
          </div>
          <button type="button" onClick={locate} disabled={busy} className="btn mt-3 w-full">
            <MapPin size={18} aria-hidden /> {busy ? "Finding you…" : "Use my location"}
          </button>
          <div className="mt-1 flex items-center justify-center gap-5">
            <button type="button" onClick={() => setPicking(true)} className="min-h-[44px] px-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-dim">
              Pick my area
            </button>
            <button type="button" onClick={notNow} className="min-h-[44px] px-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-dim">
              Not now
            </button>
          </div>
        </div>
        {picker}
      </>
    );
  }

  if (layer === "events") {
    return (
      <>
        <PazSide onClose={finish}>
          {fix
            ? "These are the best events near you. Zoom in to see them, or pick any day with the calendar."
            : "This is what's on in Lagos. Zoom in to see it, or pick any day with the calendar."}
          {fix && topNear.length > 0 && (
            <span className="mt-2.5 flex gap-2" aria-label="Top this week near you">
              {topNear.slice(0, 4).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEvent(e.id)}
                  aria-label={e.title}
                  className="relative h-[68px] w-[52px] flex-none overflow-hidden rounded-[8px] border border-line bg-ink-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote flyers of unknown size, shown small */}
                  <img src={e.flyer_url ?? ""} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={(ev) => (ev.currentTarget.style.display = "none")} />
                </button>
              ))}
            </span>
          )}
        </PazSide>
        {picker}
      </>
    );
  }

  if (layer === "home") {
    if (!running && hs.failed && !hs.loaded) {
      return (
        <PazSide
          onClose={finish}
          actions={
            <button type="button" className="btn px-4" onClick={() => void hs.reload(true)}>
              Try again
            </button>
          }
        >
          Could not find a hotspot just now.
        </PazSide>
      );
    }
    return (
      <PazSide
        actions={
          <button type="button" className="btn btn-ghost px-4" onClick={stayHere}>
            Stay here
          </button>
        }
      >
        {home ? `Let's go meet people near you. Taking you to ${home.name}.` : "Finding the hotspot closest to you…"}
      </PazSide>
    );
  }

  // arrived: in the room
  return (
    <PazSide
      mascot="welcome"
      at="top"
      onClose={finish}
      actions={
        <>
          <button type="button" className="btn px-4" onClick={finish}>
            Let&apos;s go
          </button>
          <button type="button" className="btn btn-ghost px-4" onClick={editHopper}>
            Tweak my Hopper
          </button>
        </>
      }
    >
      Chat with someone in your area and have fun today. Thanks for joining Hoppaz.
    </PazSide>
  );
}

/** The area sheet, on a layer of its own: the sheet sits at the bottom of whatever it is put in. */
function Picker({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-brand-ink/40" />
      <AreaPicker open onClose={onClose} onPicked={onClose} />
    </div>
  );
}
