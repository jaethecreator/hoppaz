"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { insideLagos } from "@/lib/geo";
import type { Hotspot } from "@/lib/hotspots/types";
import {
  closeHotspots,
  leaveHotspot,
  openHotspot,
  peekHotspot,
  resetHotspots,
  showHotspotList,
  useHotspotBackButton,
  useHotspotNav,
} from "@/lib/hotspots/open";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import HotspotGlyph from "./HotspotGlyph";
import HotspotMarker from "./HotspotMarker";
import HotspotSheet from "./HotspotSheet";
import HotspotsAll from "./HotspotsAll";

// The room (chat, faces) has its own chunk: nobody pays for it until a sheet is opened. Until it has loaded, the screen is
// the room's own dark ground, so the hand-over from the map has no empty frame in it.
const HotspotRoom = dynamic(() => import("./HotspotRoom"), { ssr: false, loading: () => <div aria-hidden className="fixed inset-0 z-[45] bg-ink" /> });

/**
 * The map's own marker order: event signs use 1 to 4 (the one you picked is 4). A pin sits in the middle of that; NightMap's
 * declutter places the signs around the pins (see .hz-pin), so they do not need to be above the signs, and nothing here
 * can reach over the page's chrome: the page wraps the map in its own stacking context.
 */
const PIN_Z = 3;
const PIN_Z_ON = 5;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The hotspots on the events map: a pin on each open one, a "Hotspots" button with the list, a "Your home base" chip, the
 * sheet a pin opens and the room ENTER opens. Everything that is open is in useHotspotNav (lib/hotspots/open.ts), and
 * the way into a room is openHotspot() there, so a pin, a chip, a list row and the deep link (/?hotspot=yaba, which the
 * crew hub's tiles use) all go the same way.
 *
 * Only open hotspots show. The list is fetched once per visit (useHotspots). Where the Hopper is never leaves the phone:
 * "your home base" and every distance are worked out here from the public zone shapes.
 *
 * `map` is null until the map is up (or when it fell back to the simple map): the button and the list work without it.
 * `top` is the height of the page's top chrome, so the button sits under it wherever it ends up. `hidden` steps the
 * buttons aside while something else has the screen (an event's card, the filter).
 */
export default function MainHotspots({
  map,
  fix,
  top,
  hidden,
}: {
  map: MLMap | null;
  fix: { lat: number; lng: number } | null;
  top: number;
  hidden: boolean;
}) {
  // Hotspots are for everyone, wherever they are or with location off: only "your home base" and distances need a place in Lagos.
  const at = useMemo(() => (fix && insideLagos(fix.lat, fix.lng) ? { lat: fix.lat, lng: fix.lng } : null), [fix]);
  const hs = useHotspots({ active: true, at });
  const { reload, bySlug, loaded } = hs;
  const { sheet, list: listOpen, room } = useHotspotNav();
  useHotspotBackButton();
  // The page can go away with a sheet or the room open: nothing of it may be left standing for the next visit.
  useEffect(() => resetHotspots, []);

  const open = useMemo(() => hs.list.filter((h) => h.status === "open"), [hs.list]);
  /** Your hotspot is always an open one (or null), see yoursOf. */
  const yours = hs.yours && hs.yours.status === "open" ? hs.yours : null;
  const yoursSlug = yours?.slug ?? null;
  const sheetOf = bySlug(sheet);

  // The sheet and the room: fetch the room's chunk now so it is there when ENTER is tapped; ask for fresh counts (at most once a minute).
  useEffect(() => {
    if (!sheet) return;
    void import("./HotspotRoom");
    void reload();
  }, [sheet, reload]);
  // The list: if the first ask did not come back, asking again is what opening it does.
  useEffect(() => {
    if (listOpen && !loaded) void reload(true);
  }, [listOpen, loaded, reload]);

  // A sheet comes up with its hotspot in view, above the sheet: one move per sheet, wherever it was opened from.
  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) {
      flown.current = null;
      return;
    }
    if (!map || !sheetOf || flown.current === sheet) return;
    flown.current = sheet;
    const H = map.getContainer().clientHeight;
    map.easeTo({
      center: [sheetOf.lng, sheetOf.lat],
      zoom: Math.max(map.getZoom(), 13.2),
      offset: [0, -Math.round(H * 0.16)],
      duration: reducedMotion() ? 0 : 700,
      essential: true,
    });
  }, [map, sheet, sheetOf]);

  // A tap on the bare map puts the sheet away. A pin stops its own click, so it never reaches here.
  useEffect(() => {
    if (!map || (!sheet && !listOpen)) return;
    map.on("click", closeHotspots);
    return () => {
      map.off("click", closeHotspots);
    };
  }, [map, sheet, listOpen]);

  // /?hotspot=yaba (a link for the WhatsApp Community, and the crew hub's tiles) opens that hotspot's sheet once.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !loaded) return;
    // A timer, not a straight call: Strict Mode mounts, cleans up and mounts again, and the cleanup must not eat the link.
    const t = setTimeout(() => {
      if (linked.current) return;
      linked.current = true;
      const url = new URL(window.location.href);
      const slug = url.searchParams.get("hotspot");
      if (!slug) return;
      url.searchParams.delete("hotspot");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      const h = bySlug(slug);
      if (h && h.status !== "paused") peekHotspot(h.slug);
    }, 0);
    return () => clearTimeout(t);
  }, [loaded, bySlug]);

  // The buttons are in the way of the signs (data-hz-obstacle): when they come, go or move, the map places the signs again.
  const buttonsKey = `${top}|${hidden || !!room}|${yoursSlug}`;
  useEffect(() => {
    window.dispatchEvent(new Event("hz-declutter"));
  }, [buttonsKey]);

  const onPin = useCallback((h: Hotspot) => peekHotspot(h.slug), []);
  const onEnter = useCallback((h: Hotspot) => void openHotspot(h.slug), []);

  return (
    <>
      {map &&
        open.map((h) => {
          const picked = h.slug === sheet;
          return <HotspotMarker key={h.id} map={map} h={h} mine={h.slug === yoursSlug} picked={picked} far={false} z={picked ? PIN_Z_ON : PIN_Z} onTap={onPin} />;
        })}

      {!hidden && !room && (
        <div className="pointer-events-none absolute left-3.5 z-20 flex max-w-[calc(100%-4.5rem)] items-start gap-2" style={{ top: top + 8 }}>
          <button
            type="button"
            data-hz-obstacle
            onClick={showHotspotList}
            aria-label={open.length ? `Hotspots, ${open.length} open` : "Hotspots"}
            className="pointer-events-auto flex min-h-[44px] flex-none items-center gap-2 rounded-hz border border-line bg-ink-2/95 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-cream backdrop-blur"
          >
            <HotspotGlyph className="h-5 w-5 text-orange" />
            Hotspots
          </button>
          {yours && (
            <button
              type="button"
              data-hz-obstacle
              onClick={() => peekHotspot(yours.slug)}
              className="pointer-events-auto flex min-h-[44px] min-w-0 flex-col items-start justify-center rounded-hz border border-orange bg-ink-2/95 px-2.5 py-1 text-left backdrop-blur"
            >
              <span className="font-mono text-[8.5px] font-medium uppercase leading-tight tracking-[0.1em] text-orange">Your home base</span>
              <span className="max-w-full truncate font-display text-[13px] font-black uppercase leading-tight">{yours.name}</span>
            </button>
          )}
        </div>
      )}

      {sheetOf && !room && (
        <HotspotSheet key={sheetOf.slug} h={sheetOf} mine={sheetOf.slug === yoursSlug} metres={hs.metres(sheetOf)} onEnter={onEnter} onClose={closeHotspots} />
      )}
      {listOpen && !room && (
        <HotspotsAll
          list={open}
          yoursSlug={yoursSlug}
          metres={hs.metres}
          onPick={onPin}
          onClose={closeHotspots}
          loaded={loaded}
          failed={hs.failed}
          onRetry={() => void reload(true)}
        />
      )}
      {room && <HotspotRoom slug={room} name={bySlug(room)?.name} onLeave={leaveHotspot} />}
    </>
  );
}
