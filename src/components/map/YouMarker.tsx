"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { FaceDisc } from "@/components/Avatar";
import { anonLook } from "@/lib/avatar";
import { easeInOut, lerp } from "@/components/play/geo";
import MapMarker, { type MarkerHandle } from "./MapMarker";

/** The stand-in Hopper for someone who has not made one: the same one the hotspot room shows. */
const STAND_IN = anonLook("Hopper");

/**
 * You, on the events map: your own mini avatar at your location (where the radius ring is), the way the old Play avatar
 * stood on the map, but nothing to tap. It takes no taps at all, so the map under it pans as usual; NightMap's declutter
 * keeps the signs off it (.hz-obstacle). The look is the Hopper's own (profile, or the local copy).
 */
export default function YouMarker({ map, fix, look }: { map: MLMap; fix: { lat: number; lng: number } | null; look: unknown }) {
  const handle = useRef<MarkerHandle>(null);
  const [running, setRunning] = useState(false);
  const fixRef = useRef(fix);
  fixRef.current = fix;

  // The first run's pull: "hz-you-run" sends your avatar running to a point (and null puts it back where you are).
  useEffect(() => {
    let raf = 0;
    const stop = () => cancelAnimationFrame(raf);
    const on = (e: Event) => {
      stop();
      const d = (e as CustomEvent<{ lat: number; lng: number; ms: number } | null>).detail;
      const from = fixRef.current;
      if (!d || !from) {
        setRunning(false);
        if (from) handle.current?.setLngLat(from.lng, from.lat);
        return;
      }
      const t0 = performance.now();
      setRunning(d.ms > 0);
      const step = (now: number) => {
        const u = d.ms ? Math.min(1, (now - t0) / d.ms) : 1;
        const k = easeInOut(u);
        handle.current?.setLngLat(lerp(from.lng, d.lng, k), lerp(from.lat, d.lat, k));
        if (u < 1) raf = requestAnimationFrame(step);
        else setRunning(false);
      };
      raf = requestAnimationFrame(step);
    };
    window.addEventListener("hz-you-run", on);
    return () => {
      stop();
      window.removeEventListener("hz-you-run", on);
    };
  }, []);

  if (!fix) return null;
  return (
    <MapMarker ref={handle} map={map} lng={fix.lng} lat={fix.lat} anchor="bottom" className={`hz-avatar hz-you hz-obstacle${running ? " hz-avatar-run" : ""}`} style={{ zIndex: 2, pointerEvents: "none" }}>
      <span className="hz-avatar-body">
        <span className="hz-avatar-ring">
          <FaceDisc look={look ?? STAND_IN} size={38} />
        </span>
        <i aria-hidden className="hz-avatar-tip" />
      </span>
      <i aria-hidden className="hz-avatar-shadow" />
    </MapMarker>
  );
}
