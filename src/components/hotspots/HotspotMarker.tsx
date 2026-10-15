"use client";

import { memo } from "react";
import clsx from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import MapMarker from "@/components/map/MapMarker";
import { BAND_BARS, bandPulses, hereLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";
import HotspotGlyph from "./HotspotGlyph";
import s from "./Hotspots.module.css";

/**
 * A hotspot on the map. Dark disc, cream crossroads, orange ring, the place name under it, a small bar badge for how
 * many are there. The ring pulses when 3 or more avatars are there. One that is not open yet keeps a quiet ring.
 *
 * On the events map the marker carries the global class "hz-pin": NightMap's declutter places the signs around it and
 * sets data-fit to "full" (with its name) or "disc" (just the disc) from how much room it has.
 */
function HotspotMarker({
  map,
  h,
  mine,
  picked,
  far,
  z,
  bob = false,
  onTap,
}: {
  map: MLMap;
  h: Hotspot;
  /** It is the Hopper's own hotspot. */
  mine: boolean;
  /** Its sheet is open. */
  picked: boolean;
  /** The camera is out over all of Lagos: just the disc. */
  far: boolean;
  /** Stacking order among the map's markers (the event signs use 1 to 4; the Play shell used millions, see PIN_Z in HotspotsLayer). */
  z: number;
  /** Bobs open: your avatar has just arrived (the first run's pull to the hotspot). */
  bob?: boolean;
  onTap: (h: Hotspot) => void;
}) {
  const soon = h.status !== "open";
  const bars = soon ? 0 : BAND_BARS[h.hereBand];
  const label = `${h.name} hotspot${mine ? ", your hotspot" : ""}. ${soon ? "Opening soon." : `${hereLabel(h)}.`} Tap to see it.`;
  return (
    <MapMarker
      map={map}
      lng={h.lng}
      lat={h.lat}
      anchor="center"
      className={clsx("hz-pin", mine && "hz-pin-mine", picked && "hz-pin-on", s.spot, mine && s.mine, picked && s.picked, soon && s.soon, far && s.far, bob && s.bob)}
      label={label}
      onClick={() => onTap(h)}
      style={{ zIndex: z }}
    >
      <span className={s.wrap}>
        {!soon && bandPulses(h.hereBand) && <i aria-hidden className={s.pulse} />}
        <span aria-hidden className={s.disc}>
          <HotspotGlyph className={s.glyph} />
        </span>
        {bars > 0 && (
          <span aria-hidden className={s.bars}>
            {[1, 2, 3, 4].map((n) => (
              <i key={n} className={n <= bars ? s.on : undefined} />
            ))}
          </span>
        )}
        {mine && <span aria-hidden className={s.yours}>HOME BASE</span>}
        <span aria-hidden className={s.name}>{h.name}</span>
      </span>
    </MapMarker>
  );
}

export default memo(HotspotMarker);
