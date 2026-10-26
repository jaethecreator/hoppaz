"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import { ExternalLink } from "lucide-react";
import { LAGOS_BOUNDS } from "@/lib/geo";
import { addressFor, searchPlaces } from "@/lib/geocode/client";
import { clampToLagos, cleanQuery, DROP_START, inLagosBox, mapsUrl, MAX_NAME, MAX_QUERY, MIN_NAME, spotFromSuggestion } from "@/lib/geocode/lagos";
import type { PlaceSpot, PlaceSuggestion } from "@/lib/geocode/types";
import { fallbackStyle, loadBrandStyle } from "@/lib/mapStyle";
import { useTheme } from "@/lib/useTheme";

/**
 * The Where step for an in person (or hybrid) event: type an address or a venue, pick a suggestion, and a small map shows a pin
 * there. Drag the pin to the exact entrance, or tap the map to move it. If nothing is found, "Drop a pin" puts one on the map by
 * hand and the host names the place. The form gets { place_name, address, lat, lng } and sends place_name, lat and lng; the
 * database picks the nearest area from the point. Photon answers the search (src/lib/geocode), through our own route.
 */

const DEBOUNCE_MS = 300;
const PIN_ZOOM = 16;
const WIDE_ZOOM = 11.5;
/** One arrow key press moves the pin about 4 m; with Shift about 40 m. */
const NUDGE = 0.00004;
const LAGOS_ONLY = "Hoppaz is Lagos only for now, so the pin stays inside Lagos.";

const sameSpot = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;

export default function PlaceSearch({ value, onChange }: { value: PlaceSpot | null; onChange: (spot: PlaceSpot | null) => void }) {
  if (value) return <Picked spot={value} onChange={onChange} />;
  return (
    <Finder
      onPick={(s) => onChange(spotFromSuggestion(s))}
      onDrop={(typed) => {
        const name = (cleanQuery(typed) ?? "").slice(0, MAX_NAME);
        onChange({ place_name: name.length >= MIN_NAME ? name : "", address: "", ...DROP_START, manual: true });
      }}
    />
  );
}

/* ------------------------------------------------------------------ search -- */

type Answer = { q: string; rows: PlaceSuggestion[]; error: string };

function Finder({ onPick, onDrop }: { onPick: (s: PlaceSuggestion) => void; onDrop: (typed: string) => void }) {
  const uid = useId();
  const list = `${uid}-list`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const typed = cleanQuery(text);

  // Debounced: wait for a pause in typing, drop the call that is no longer wanted. State is set only when an answer arrives.
  useEffect(() => {
    if (!typed) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(typed, ac.signal).then(
        (rows) => !ac.signal.aborted && setAnswer({ q: typed, rows, error: "" }),
        (e: unknown) => !ac.signal.aborted && setAnswer({ q: typed, rows: [], error: e instanceof Error ? e.message : "Search is not working right now." }),
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [typed]);

  const fresh = typed && answer && answer.q === typed ? answer : null;
  const rows = fresh?.rows ?? [];
  const loading = !!typed && !fresh;
  const showList = open && rows.length > 0;
  const optionId = (i: number) => `${uid}-o${i}`;

  const status = !typed
    ? ""
    : loading
      ? "Searching"
      : fresh?.error
        ? fresh.error
        : rows.length
          ? `${rows.length} ${rows.length === 1 ? "place" : "places"} found`
          : "Nothing found";

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === "Enter" && showList) {
      e.preventDefault();
      onPick(rows[active >= 0 ? active : 0]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="grid gap-2">
      <input
        type="text"
        role="combobox"
        aria-label="Venue or address"
        aria-expanded={showList}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={key}
        placeholder="Search a venue or address"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        maxLength={MAX_QUERY}
      />
      <ul id={list} role="listbox" aria-label="Places found" hidden={!showList} className="overflow-hidden rounded-hz border border-t-line bg-t-bg">
        {rows.map((r, i) => (
          <li
            key={r.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // Keep the input focused through the press, so the list is still there when the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(r)}
            className="min-h-[48px] cursor-pointer border-b border-t-line px-3 py-2 last:border-b-0 hover:bg-t-soft aria-selected:bg-t-soft"
          >
            <span className="block font-body text-[14.5px] text-t-text">{r.name}</span>
            {r.address && <span className="block font-body text-[12.5px] text-t-muted">{r.address}</span>}
          </li>
        ))}
      </ul>
      <p role="status" className={fresh && !rows.length ? "font-body text-[13px] text-t-text" : "sr-only"}>
        {fresh && !rows.length ? (fresh.error ? `${fresh.error} You can still drop a pin.` : `Nothing found for "${typed}". Check the spelling, or drop a pin.`) : status}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="font-body text-[12.5px] text-t-muted">Pinned on the map. You can drag the pin after.</span>
        <button type="button" onClick={() => onDrop(text)} className="inline-flex min-h-[44px] items-center font-body text-[13.5px] font-bold text-t-accent">
          Can&apos;t find it? Drop a pin
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- picked place -- */

function Picked({ spot, onChange }: { spot: PlaceSpot; onChange: (spot: PlaceSpot | null) => void }) {
  const theme = useTheme();
  const [notice, setNotice] = useState("");
  // The map opens wide only for a pin just dropped by hand; a place found by search (or a saved one) opens close.
  const [zoom] = useState(() => (spot.manual && sameSpot(spot, DROP_START) ? WIDE_ZOOM : PIN_ZOOM));

  const latest = useRef({ spot, onChange });
  useEffect(() => {
    latest.current = { spot, onChange };
  });

  // A pin dropped by hand has no address: ask for one near it, once the pin has rested.
  useEffect(() => {
    if (!spot.manual) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void addressFor(spot.lat, spot.lng, ac.signal).then((address) => {
        const cur = latest.current.spot;
        if (ac.signal.aborted || !cur.manual || cur.address === (address ?? "")) return;
        latest.current.onChange({ ...cur, address: address ?? "" });
      });
    }, 700);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [spot.manual, spot.lat, spot.lng]);

  const moved = (lat: number, lng: number, clamped: boolean) => {
    setNotice(clamped ? LAGOS_ONLY : "");
    latest.current.onChange({ ...latest.current.spot, lat, lng });
  };

  return (
    <div className="t-card overflow-hidden">
      <PinMap theme={theme} lat={spot.lat} lng={spot.lng} zoom={zoom} onMove={moved} />
      <div className="grid gap-1 p-3">
        {spot.manual ? (
          <input
            value={spot.place_name}
            onChange={(e) => onChange({ ...spot, place_name: e.target.value.slice(0, MAX_NAME) })}
            placeholder="Name this place"
            aria-label="Name of the place"
            autoComplete="off"
            maxLength={MAX_NAME}
          />
        ) : (
          <b className="font-body text-[15px]">{spot.place_name}</b>
        )}
        {spot.manual && spot.place_name.trim().length < MIN_NAME && <span className="font-body text-[12.5px] text-t-muted">Add a name so people know where to go.</span>}
        {spot.address && (
          <span className="font-body text-[13px] text-t-muted">
            {spot.manual ? "Near " : ""}
            {spot.address}
          </span>
        )}
        <span className="font-body text-[12.5px] text-t-muted">Drag the pin to the entrance, or tap the map.</span>
        <p role="status" className={notice ? "font-body text-[13px] text-t-text" : "sr-only"}>
          {notice}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <a
            href={mapsUrl(spot.lat, spot.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 font-body text-[13.5px] font-bold text-t-accent"
          >
            Open in Google Maps
            <ExternalLink size={14} aria-hidden />
          </a>
          <button type="button" onClick={() => onChange(null)} className="inline-flex min-h-[44px] items-center font-body text-[13.5px] font-bold text-t-accent">
            Change
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- map -- */

const PIN_SVG =
  '<svg viewBox="0 0 36 46" width="36" height="46" aria-hidden="true" focusable="false" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">' +
  '<path d="M18 1C9 1 2 8 2 16.6 2 28.5 18 44.5 18 44.5S34 28.5 34 16.6C34 8 27 1 18 1z" style="fill:var(--t-accent);stroke:var(--t-bg);stroke-width:2.5"/>' +
  '<circle cx="18" cy="16.5" r="5.5" style="fill:var(--t-on)"/></svg>';

/**
 * The preview: the app's own map style (day or night), a draggable pin, a tap moves it. The map is only started once its box has a
 * size (the create page draws a phone and a desktop layout, one of them hidden), and one finger scrolls the page while two move the
 * map, so the small map never traps a thumb. MapLibre is loaded on demand so the create page stays light until a place is picked.
 */
function PinMap({ theme, lat, lng, zoom, onMove }: { theme: "day" | "night"; lat: number; lng: number; zoom: number; onMove: (lat: number, lng: number, clamped: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [failed, setFailed] = useState(false);

  const latest = useRef({ lat, lng, zoom, onMove });
  useEffect(() => {
    latest.current = { lat, lng, zoom, onMove };
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let dead = false;
    let starting = false;
    const ac = new AbortController();

    const start = async () => {
      starting = true;
      try {
        const ml = await import("maplibre-gl");
        ml.setWorkerUrl("/maplibre-gl-worker.mjs");
        let style;
        try {
          style = await loadBrandStyle(theme, ac.signal);
        } catch {
          style = fallbackStyle(theme); // tile host unreachable: the pin and the coordinates still work
        }
        if (dead) return;
        const at = latest.current;
        const m = new ml.Map({
          container: el,
          style,
          center: [at.lng, at.lat],
          zoom: at.zoom,
          minZoom: 9,
          maxZoom: 19,
          maxBounds: LAGOS_BOUNDS,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          attributionControl: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new ml.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
        m.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");
        m.on("error", (e) => console.warn("[hoppaz] place map:", e.error));

        const dom = document.createElement("div");
        dom.setAttribute("role", "button");
        dom.tabIndex = 0;
        dom.setAttribute("aria-label", "Pin. Drag it, or use the arrow keys, to move it to the entrance.");
        dom.style.cssText = "width:36px;height:46px;cursor:grab;touch-action:none";
        dom.innerHTML = PIN_SVG;
        const marker = new ml.Marker({ element: dom, draggable: true, anchor: "bottom" }).setLngLat([at.lng, at.lat]).addTo(m);

        const settle = (p: { lat: number; lng: number }) => {
          const ok = inLagosBox(p.lat, p.lng);
          const to = ok ? p : clampToLagos(p.lat, p.lng);
          if (!ok) marker.setLngLat([to.lng, to.lat]);
          if (!m.getBounds().contains([to.lng, to.lat])) m.easeTo({ center: [to.lng, to.lat] });
          latest.current.onMove(to.lat, to.lng, !ok);
        };
        marker.on("dragend", () => settle(marker.getLngLat()));
        m.on("click", (e) => {
          marker.setLngLat(e.lngLat);
          settle(e.lngLat);
        });
        // A tap on the pin itself must not also move it to the tap point.
        dom.addEventListener("click", (e) => e.stopPropagation());
        dom.addEventListener("keydown", (e) => {
          const d = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
          if (!d) return;
          e.preventDefault();
          const step = e.shiftKey ? NUDGE * 10 : NUDGE;
          const p = marker.getLngLat();
          marker.setLngLat([p.lng + d[1] * step, p.lat + d[0] * step]);
          settle(marker.getLngLat());
        });

        map.current = m;
        pin.current = marker;
      } catch (error) {
        if (!dead) {
          console.warn("[hoppaz] place map could not start:", error);
          setFailed(true);
        }
      }
    };

    const watch = new ResizeObserver(() => {
      if (map.current) map.current.resize();
      else if (!starting && el.clientWidth > 0) void start();
    });
    watch.observe(el);

    return () => {
      dead = true;
      ac.abort();
      watch.disconnect();
      pin.current?.remove();
      map.current?.remove();
      pin.current = null;
      map.current = null;
    };
  }, [theme]);

  // The point changed from outside (a saved place restored, a different suggestion): move the pin and the view with it.
  useEffect(() => {
    const m = map.current;
    const p = pin.current;
    if (!m || !p) return;
    const now = p.getLngLat();
    if (sameSpot({ lat: now.lat, lng: now.lng }, { lat, lng })) return;
    p.setLngLat([lng, lat]);
    m.jumpTo({ center: [lng, lat] });
  }, [lat, lng]);

  return (
    <div className="relative h-[180px] w-full bg-t-soft sm:h-[220px]">
      {/* MapLibre's own CSS makes this box position: relative, so it is sized, not stretched. */}
      <div ref={box} className="h-full w-full" />
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-4 text-center font-body text-[13px] text-t-muted">
          The map could not load. Your pin is saved and the link below still opens it.
        </p>
      )}
    </div>
  );
}
