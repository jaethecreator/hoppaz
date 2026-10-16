"use client";

import { useId } from "react";
import RoomArt from "@/components/campaign/roomArt";
import { sceneSize, type CampaignLayout } from "@/lib/campaign/layout";

export type PickSpot = { id: string; label: string; x: number; y: number; w: number; h: number };

/**
 * The room's own picture with the objects that may hide a box drawn on top: dashed when free, orange when picked, a
 * number on each pick. Tapping an object picks it or lets it go. `found` marks objects whose box was already found
 * (past drops), drawn in green and never tappable. The picture is the room's real art (roomArt.tsx) for the layout given
 * (a crew room: roomTemplate(template, width); a hotspot room: hotspotRoom(slug).layout), so the outlines sit exactly on the
 * furniture. With no spots it is just the picture.
 */
export default function RoomPicker({
  layout,
  brand,
  spots,
  picked,
  onToggle,
  found,
  disabled,
}: {
  layout: CampaignLayout;
  brand: string;
  spots: PickSpot[];
  picked: Set<string>;
  onToggle?: (id: string) => void;
  found?: Set<string>;
  disabled?: boolean;
}) {
  const { width: W, height: H } = sceneSize(layout);
  const tile = layout.grid.tile;
  const uid = `pick${useId().replace(/[^a-z0-9]/gi, "")}`;
  const order = [...picked];
  const pad = 5;
  return (
    <div className="relative w-full overflow-hidden rounded-hz border border-line bg-ink-3" style={{ aspectRatio: `${W} / ${H}` }} data-desk-room-picker>
      <div className="pointer-events-none absolute inset-0 [&>svg]:h-full [&>svg]:w-full">
        <RoomArt layout={layout} uid={uid} brand={brand} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="group" aria-label="Hiding spots in this room">
        {spots.map((s) => {
          const on = picked.has(s.id);
          const done = found?.has(s.id) ?? false;
          const n = order.indexOf(s.id) + 1;
          const x = s.x * tile - pad;
          const y = s.y * tile - pad;
          const w = s.w * tile + pad * 2;
          const h = s.h * tile + pad * 2;
          const tap = () => !disabled && !done && onToggle?.(s.id);
          return (
            <g
              key={s.id}
              role="checkbox"
              aria-checked={on}
              aria-label={s.label}
              aria-disabled={disabled || done}
              tabIndex={disabled || done ? -1 : 0}
              className={disabled || done ? "" : "cursor-pointer"}
              onClick={tap}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  tap();
                }
              }}
              data-desk-spot={s.id}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx="6"
                fill={done ? "rgba(47,211,92,.28)" : on ? "rgba(255,77,0,.30)" : "rgba(14,11,10,.18)"}
                stroke={done ? "#2FD35C" : on ? "#FF4D00" : "#F5EBDD"}
                strokeWidth={on || done ? 5 : 3}
                strokeDasharray={on || done ? undefined : "9 7"}
              />
              {on && !done && (
                <g transform={`translate(${x + w - 2},${y + 2})`}>
                  <circle r="15" fill="#FF4D00" stroke="#0E0B0A" strokeWidth="3" />
                  <text textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-poppins)" fontWeight="900" fontSize="17" fill="#0E0B0A">
                    {n}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
