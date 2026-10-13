"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { EventRow } from "@/lib/types";
import { LAGOS_BOUNDS, LAGOS_CENTER, eventTitle } from "@/lib/geo";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

type Props = {
  events: EventRow[];
  fix: { lat: number; lng: number } | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hudTop: number;
};

/** Raster street map for devices whose graphics driver cannot keep MapLibre running. */
export default function MapFallback({ events, fix, selectedId, onSelect, hudTop }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pinsRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((leaflet) => {
      if (disposed || !host.current || mapRef.current) return;
      const map = leaflet.map(host.current, {
        zoomControl: false,
        attributionControl: true,
        maxBounds: [[LAGOS_BOUNDS[0][1], LAGOS_BOUNDS[0][0]], [LAGOS_BOUNDS[1][1], LAGOS_BOUNDS[1][0]]],
        maxBoundsViscosity: 0.8,
        tap: true,
        zoomSnap: 0.5,
      }).setView([LAGOS_CENTER.lat, LAGOS_CENTER.lng], 10.5);
      leaflet.control.zoom({ position: "topright" }).addTo(map);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      pinsRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 50);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pinsRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((leaflet) => {
      if (cancelled || !pinsRef.current) return;
      pinsRef.current.clearLayers();
      for (const event of events) {
        if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) continue;
        const active = event.id === selectedId;
        leaflet.circleMarker([event.lat, event.lng], {
          radius: active ? 10 : 7,
          color: "#fff4e5",
          weight: 2,
          fillColor: active ? "#8d55ff" : "#ff4d00",
          fillOpacity: 1,
        })
          .bindTooltip(eventTitle(event), { direction: "top", offset: [0, -8] })
          .on("click", () => onSelect(event.id))
          .addTo(pinsRef.current!);
      }
      if (fix) {
        leaflet.circleMarker([fix.lat, fix.lng], {
          radius: 6,
          color: "#ffffff",
          weight: 2,
          fillColor: "#2784ff",
          fillOpacity: 1,
        }).bindTooltip("You are here").addTo(pinsRef.current);
      }
    });
    return () => { cancelled = true; };
  }, [events, fix, selectedId, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (fix && map) map.flyTo([fix.lat, fix.lng], Math.max(map.getZoom(), 12), { duration: 0.5 });
  }, [fix]);

  return <div ref={host} className="hz-map-fallback absolute inset-0" style={{ "--hz-fallback-top": `${hudTop + 8}px` } as CSSProperties} aria-label="Lagos events map" />;
}
