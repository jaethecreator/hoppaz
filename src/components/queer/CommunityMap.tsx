"use client";

import { useEffect, useRef } from "react";

export type QueerEvent = {
  id: string;
  title: string;
  venue_name: string;
  area: string;
  description: string;
  lat: number;
  lng: number;
  starts_at: string;
  ends_at: string | null;
};

export default function CommunityMap({ events, selected, onSelect }: {
  events: QueerEvent[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layers = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !host.current || map.current) return;
      const instance = L.map(host.current, { zoomControl: false, maxBounds: [[6.3, 3.05], [6.8, 3.95]], maxBoundsViscosity: 0.8 }).setView([6.5, 3.42], 10.5);
      L.control.zoom({ position: "topright" }).addTo(instance);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);
      layers.current = L.layerGroup().addTo(instance);
      map.current = instance;
      window.setTimeout(() => instance.invalidateSize(), 50);
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !layers.current) return;
      layers.current.clearLayers();
      events.forEach((event) => {
        const active = event.id === selected;
        L.circleMarker([event.lat, event.lng], {
          radius: active ? 10 : 7,
          color: "#fff4e5",
          weight: 2,
          fillColor: active ? "#8d55ff" : "#ff4d00",
          fillOpacity: 1,
        }).bindTooltip(event.title, { direction: "top" }).on("click", () => onSelect(event.id)).addTo(layers.current!);
      });
    });
    return () => { disposed = true; };
  }, [events, selected, onSelect]);

  return <div ref={host} className="hz-map-fallback h-[44vh] min-h-[280px] overflow-hidden rounded-hz border border-line" aria-label="Private community events map" />;
}
