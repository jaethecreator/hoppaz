"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import Mascot from "@/components/Mascot";
import { nearestArea } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";
import { useGeoPermission } from "@/lib/useLivePosition";

/**
 * "See what's on near you?" The Events page asks once, in its own words, before
 * the browser does: a yes asks the browser and puts nearby events first, a no is
 * fine and is remembered, so it never asks again on this phone. Closing it any
 * way (the x, a tap outside, Escape, swiping it down) counts as "not now".
 *
 * Location already allowed: no question, the position is just read. Already
 * blocked in the browser: no question either.
 */

const KEY = "hoppaz.locationAsk";
const DELAY_MS = 700;

const answered = () => {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
};
const remember = (a: "yes" | "no") => {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    /* private window: it asks again next visit, no harm */
  }
};

export default function LocationAsk({ paused = false }: { paused?: boolean }) {
  const fix = useHoppaz((s) => s.fix);
  const setFix = useHoppaz((s) => s.setFix);
  const say = useToast((s) => s.say);
  const permission = useGeoPermission();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hasGps = fix?.source === "gps";

  const locate = useCallback(
    (loud: boolean) =>
      new Promise<boolean>((done) => {
        if (!("geolocation" in navigator)) return done(false);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            const near = nearestArea(lat, lng);
            setFix({ lat, lng, source: "gps", area: near.name });
            if (loud) say(`Showing what's on near ${near.name}.`, "ok");
            done(true);
          },
          () => done(false),
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
        );
      }),
    [setFix, say]
  );

  // Allowed before: read it quietly. Never asked: ask, once, after the deck has landed.
  useEffect(() => {
    if (hasGps || paused || permission === "denied") return;
    if (permission === "granted") {
      void locate(false);
      return;
    }
    if (answered()) return;
    const t = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(t);
  }, [hasGps, paused, permission, locate]);

  const notNow = useCallback(() => {
    remember("no");
    setOpen(false);
  }, []);

  const yes = async () => {
    setBusy(true);
    const ok = await locate(true);
    setBusy(false);
    remember(ok ? "yes" : "no");
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") notNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, notNow]);

  // A pull down on the sheet closes it, like any phone sheet.
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="Not now" tabIndex={-1} onClick={notNow} className="absolute inset-0 animate-fade bg-brand-ink/50" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Show events near you"
        tabIndex={-1}
        onPointerDown={(e) => (startY.current = e.clientY)}
        onPointerMove={(e) => startY.current !== null && setPull(Math.max(0, e.clientY - startY.current))}
        onPointerUp={() => {
          if (pull > 70) notNow();
          startY.current = null;
          setPull(0);
        }}
        onPointerCancel={() => {
          startY.current = null;
          setPull(0);
        }}
        className="relative w-full max-w-[480px] animate-rise rounded-t-[12px] border-t border-line bg-ink-2 px-4 pt-3 shadow-sheet outline-none"
        style={{
          paddingBottom: "1rem",
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: pull ? "none" : "transform .2s ease",
          touchAction: "none",
        }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <button
          type="button"
          onClick={notNow}
          aria-label="Close"
          className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-line text-cream">
            <X size={18} strokeWidth={2.4} aria-hidden />
          </span>
        </button>

        <div className="flex items-center gap-4 pr-10">
          <Mascot state="point" size={80} className="rig-on-raised flex-none" />
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-black leading-[1.1]">See what&apos;s on near you?</h2>
            <p className="hint mt-1.5">Share your location and we&apos;ll put the closest events first. It&apos;s fine to say no.</p>
          </div>
        </div>

        <button type="button" onClick={() => void yes()} disabled={busy} className="btn mt-4 w-full">
          <MapPin size={18} aria-hidden /> {busy ? "FINDING YOU…" : "SHOW WHAT'S NEAR ME"}
        </button>
        <button type="button" onClick={notNow} className="btn btn-ghost mt-2.5 w-full">
          NOT NOW
        </button>
      </div>
    </div>
  );
}
