"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Map as MLMap } from "maplibre-gl";
import MapMarker from "@/components/map/MapMarker";
import s from "./LagosHqMarker.module.css";

/** Lagos HQ sits in the open water of the lagoon between Banana Island, Ikorodu, Makoko and Bariga. */
export const LAGOS_HQ_AT = { lat: 6.52, lng: 3.43 };

/** The marker sits under the event signs (they use 1 to 4) and the hotspot pins. */
const Z = 1;

/** The marker's box is 96 px (the tap target); it is drawn at this share of that, by zoom: smaller zoomed out, bigger up close. */
const scaleAt = (zoom: number) => Math.min(1.12, Math.max(0.74, 0.74 + (zoom - 11.5) * 0.1));

/**
 * The Lagos HQ pavilion: a tower and a wide hall on a pier over the water, Hoppaz orange and cream with a dark outline.
 * Drawn in brand colours (not theme ones) so it looks the same by day and by night.
 */
function Pavilion({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 78" className={className} aria-hidden focusable="false" strokeLinejoin="round" strokeLinecap="round">
      {/* its shadow on the water, the stilts, the pier deck */}
      <ellipse cx="48" cy="72" rx="40" ry="5" fill="#0e0b0a" opacity="0.35" />
      <g stroke="#0e0b0a" strokeWidth="3.2">
        <path d="M20 64v9M36 64v9M60 64v9M76 64v9" />
      </g>
      <rect x="10" y="57" width="76" height="7" rx="2" fill="#f5ebdd" stroke="#0e0b0a" strokeWidth="2.6" />
      {/* the hall */}
      <rect x="18" y="34" width="60" height="23" fill="#ff4d00" stroke="#0e0b0a" strokeWidth="2.8" />
      <path d="M13 36l11-10h48l11 10z" fill="#f5ebdd" stroke="#0e0b0a" strokeWidth="2.8" />
      {/* the tower */}
      <rect x="37" y="10" width="22" height="16" fill="#ff4d00" stroke="#0e0b0a" strokeWidth="2.8" />
      <path d="M34 11L48 1l14 10z" fill="#f5ebdd" stroke="#0e0b0a" strokeWidth="2.8" />
      <rect x="44" y="14" width="8" height="8" rx="1" fill="#f5ebdd" stroke="#0e0b0a" strokeWidth="2" />
      {/* the door and the windows */}
      <rect x="42" y="42" width="12" height="15" fill="#0e0b0a" />
      <g fill="#f5ebdd" stroke="#0e0b0a" strokeWidth="2">
        <rect x="24" y="41" width="11" height="9" rx="1" />
        <rect x="61" y="41" width="11" height="9" rx="1" />
      </g>
    </svg>
  );
}

/**
 * The Lagos HQ marker on the events map: a big, bold pavilion on a pier in the lagoon, a soft pulse ring on the water and a
 * LAGOS HQ plate under it. One marker, no layer. It stands in the middle of the water so it stands out, and a tap opens the
 * Lagos HQ room home (chat first). It carries the global class "hz-pin", so NightMap's declutter places the event signs around
 * it (it reads data-pin-full and data-pin-disc, set here, for how much room this bigger marker needs) and sets data-fit
 * ("full" with its plate, "disc" smaller without) the same as for a hotspot pin. Release 1 only; mounted by the map page.
 */
export default function LagosHqMarker({ map }: { map: MLMap }) {
  const router = useRouter();
  const wrap = useRef<HTMLSpanElement>(null);

  // Scale with the camera. The element stays 96 px (the tap target); the drawing inside it grows and shrinks.
  useEffect(() => {
    const apply = () => {
      const w = wrap.current;
      const el = w?.parentElement;
      if (!w || !el) return;
      const k = scaleAt(map.getZoom());
      w.style.setProperty("--k", k.toFixed(3));
      // What NightMap's declutter keeps free around the centre, px: the whole drawing and its plate, and the small form.
      const half = Math.round(48 * k) + 4;
      el.dataset.pinFull = `${half},${half},${half},${half}`;
      el.dataset.pinDisc = String(Math.round(30 * k));
    };
    apply();
    map.on("zoom", apply);
    const again = () => {
      apply();
      window.dispatchEvent(new Event("hz-declutter"));
    };
    map.on("zoomend", again);
    return () => {
      map.off("zoom", apply);
      map.off("zoomend", again);
    };
  }, [map]);

  return (
    <MapMarker
      map={map}
      lng={LAGOS_HQ_AT.lng}
      lat={LAGOS_HQ_AT.lat}
      anchor="center"
      className={`hz-pin ${s.spot}`}
      label="Lagos HQ. Tap to open the room."
      onClick={() => router.push("/rooms/hq")}
      style={{ zIndex: Z }}
    >
      <span className={s.wrap} data-lagos-hq ref={wrap}>
        <i aria-hidden className={s.ripple} />
        <i aria-hidden className={`${s.ripple} ${s.ripple2}`} />
        <span aria-hidden className={s.scale}>
          <Pavilion className={s.art} />
          <span className={s.plate}>Lagos HQ</span>
        </span>
      </span>
    </MapMarker>
  );
}
