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
        zoomSnap: 0.5,
      }).setView([LAGOS_CENTER.lat, LAGOS_CENTER.lng], 10.5);
      // Leaflet has no pitched camera. Pitch its movable map pane with CSS while
      // keeping the controls and touch target flat and easy to operate.
      const mapPane = map.getPane("mapPane");
      if (mapPane) {
        mapPane.style.setProperty("transform-origin", "50% 72%", "important");
        const pitchPane = () => {
          const current = mapPane.style.transform;
          if (!current.includes("rotateX(45deg)")) {
            mapPane.style.transform = `${current} perspective(1100px) rotateX(45deg) scale(1.2)`;
          }
        };
        const observer = new MutationObserver(pitchPane);
        observer.observe(mapPane, { attributes: true, attributeFilter: ["style"] });
        pitchPane();
        map.once("unload", () => observer.disconnect());
      }
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
        const markerNode = document.createElement("span");
        markerNode.className = `hz-map3d-building${active ? " is-selected" : ""}`;
        markerNode.setAttribute("aria-label", eventTitle(event));
        const roof = document.createElement("span");
        roof.className = "hz-map3d-roof";
        const walls = document.createElement("span");
        walls.className = "hz-map3d-walls";
        markerNode.append(roof, walls);
        leaflet.marker([event.lat, event.lng], {
          icon: leaflet.divIcon({ className: "hz-map3d-marker", html: markerNode, iconSize: [32, 44], iconAnchor: [16, 40] }),
          keyboard: true,
          title: eventTitle(event),
        })
          .bindTooltip(eventTitle(event), {
            permanent: true,
            direction: "top",
            offset: [0, -8],
            className: "hz-map-event-label",
          })
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

  useEffect(() => {
    const map = mapRef.current;
    const event = events.find((candidate) => candidate.id === selectedId);
    if (map && event) map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 14), { duration: 0.65 });
  }, [events, selectedId]);

  return <div ref={host} className="hz-map-fallback absolute inset-0" style={{ "--hz-fallback-top": `${hudTop + 8}px` } as CSSProperties} aria-label="Lagos events map" />;
}
