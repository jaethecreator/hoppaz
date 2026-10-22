"use client";

import { useRouter } from "next/navigation";
import type { Map as MLMap } from "maplibre-gl";
import MapMarker from "@/components/map/MapMarker";
import s from "./LagosHqMarker.module.css";

/** Lagos HQ sits in the open water of the lagoon between Banana Island, Ikorodu, Makoko and Bariga. */
export const LAGOS_HQ_AT = { lat: 6.52, lng: 3.43 };

/** The marker sits under the event signs (they use 1 to 4) and the hotspot pins. */
const Z = 1;

/** A small office block: a body with windows and a door. Drawn in currentColor. */
function BuildingGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V8l7-4.5L19 8v13" />
      <path d="M3 21h18" />
      <path d="M9.5 11.5h.01M14.5 11.5h.01M9.5 15h.01M14.5 15h.01" strokeWidth={2.4} />
      <path d="M10.5 21v-3.2h3V21" />
    </svg>
  );
}

/**
 * The Lagos HQ marker on the events map: a lagoon-blue ring with a small building on it, the name under it. One marker, no
 * layer. It stands in the middle of the water so it stands out, and a tap opens the Lagos HQ room home (chat first).
 * It carries the global class "hz-pin", so NightMap's declutter places the event signs around it and sets data-fit
 * ("full" with its name, "disc" without), the same as for a hotspot pin. Release 1 only; mounted by the map page.
 */
export default function LagosHqMarker({ map }: { map: MLMap }) {
  const router = useRouter();
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
      <span className={s.wrap} data-lagos-hq>
        <i aria-hidden className={s.ripple} />
        <span aria-hidden className={s.disc}>
          <BuildingGlyph className={s.glyph} />
        </span>
        <span aria-hidden className={s.name}>
          Lagos HQ
        </span>
      </span>
    </MapMarker>
  );
}
