"use client";

/* eslint-disable @next/next/no-img-element -- a small canvas drawing as a data URL */

import { useEffect, useState } from "react";

/**
 * The walkable 2D room choice (build brief section 14): on by default, four starter maps, "Free during launch". Used on
 * create, the event dashboard and create a room. The maps here are drawn previews; the real rooms come from the 2D room
 * templates (supabase/place_room_layouts.sql and docs/ROOM-TEMPLATES.md).
 */
export const TWO_D_TEMPLATES = [
  { id: "clubhouse", name: "Clubhouse" },
  { id: "rooftop", name: "Rooftop" },
  { id: "beach", name: "Beach" },
  { id: "hall", name: "Hall" },
] as const;

const PAL: Record<string, [string, string, string, string]> = {
  clubhouse: ["#3B2A22", "#5A3F33", "#E0A458", "#7A4B3A"],
  rooftop: ["#1E2433", "#2E3650", "#FFD24A", "#E94F6B"],
  beach: ["#F2D7A6", "#EAC98F", "#2EB7D9", "#FF8A5C"],
  hall: ["#E8E3DA", "#D9D2C6", "#5B2EFF", "#C9BFAF"],
};

function draw(kind: string): string {
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 120;
  const x = c.getContext("2d");
  if (!x) return "";
  const T = 8;
  const p = PAL[kind] ?? PAL.clubhouse;
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 15; j++) {
      x.fillStyle = (i + j) % 2 ? p[0] : p[1];
      x.fillRect(i * T, j * T, T, T);
    }
  x.fillStyle = p[3];
  x.fillRect(0, 0, 192, 16);
  if (kind === "clubhouse") {
    x.fillStyle = p[2];
    x.fillRect(72, 40, 48, 24);
  }
  if (kind === "rooftop") {
    x.fillStyle = p[2];
    for (let i = 0; i < 12; i++) x.fillRect(8 + i * 16, 20, 4, 4);
    x.fillStyle = p[3];
    x.fillRect(80, 56, 32, 16);
  }
  if (kind === "beach") {
    x.fillStyle = p[2];
    x.fillRect(0, 88, 192, 32);
    x.fillStyle = p[3];
    x.beginPath();
    x.arc(150, 40, 12, 0, 7);
    x.fill();
  }
  if (kind === "hall") {
    x.fillStyle = p[2];
    x.fillRect(64, 24, 64, 14);
    x.fillStyle = p[3];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 8; k++) x.fillRect(32 + k * 16, 56 + r * 12, 10, 6);
  }
  ["#FF4D00", "#2FD35C", "#22B8F0", "#FFC400", "#9D81FF"].forEach((a, i) => {
    x.fillStyle = a;
    x.fillRect(30 + i * 30, 76 + (i % 2) * 12, 8, 8);
  });
  return c.toDataURL("image/png");
}

export function TwoDThumb({ kind, className = "" }: { kind: string; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => setSrc(draw(kind)), [kind]);
  return src ? <img src={src} alt="" className={`block aspect-[8/5] w-full object-cover [image-rendering:pixelated] ${className}`} /> : <span className={`block aspect-[8/5] w-full bg-t-soft ${className}`} />;
}

export default function TwoDRoomCard({
  on,
  template,
  onChange,
  sub,
}: {
  on: boolean;
  template: string;
  onChange: (v: { on: boolean; template: string }) => void;
  sub: string;
}) {
  return (
    <div className="t-card grid gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <b className="block font-body text-[15px]">Walkable 2D room</b>
          <span className="block font-body text-[13px] text-t-muted">{sub}</span>
          <span className="mt-1.5 inline-block rounded-hz bg-[#1FA847] px-2 py-0.5 font-body text-[11px] font-extrabold text-white">Free during launch</span>
        </div>
        <label className="relative h-6 w-[42px] flex-none">
          <input type="checkbox" checked={on} onChange={(e) => onChange({ on: e.target.checked, template })} aria-label="Walkable 2D room" className="peer absolute inset-0 m-0 cursor-pointer opacity-0" />
          <span className="absolute inset-0 rounded-full bg-t-line transition-colors peer-checked:bg-t-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" />
          <span className="pointer-events-none absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-t-bg transition-transform peer-checked:translate-x-[18px]" />
        </label>
      </div>
      {on && (
        <>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="2D room map">
            {TWO_D_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={template === t.id}
                onClick={() => onChange({ on, template: t.id })}
                className={`grid gap-1 text-center font-body text-[11.5px] font-bold ${template === t.id ? "text-t-text" : "text-t-muted"}`}
              >
                <TwoDThumb kind={t.id} className={`rounded-hz border-2 ${template === t.id ? "border-t-accent" : "border-transparent"}`} />
                {t.name}
              </button>
            ))}
          </div>
          <span className="font-body text-[12.5px] text-t-muted">Guests walk around as avatars, chat with people nearby and join the voice stage.</span>
        </>
      )}
    </div>
  );
}
