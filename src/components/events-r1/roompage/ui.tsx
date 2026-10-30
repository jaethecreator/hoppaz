"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import { crewImageSrc } from "@/lib/crew-room/images";
import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import { avatarColor } from "./words";

/** The one main button of a screen (the Tint lip), and the quieter ones. 46 and 44 px tall; the margin keeps the lip off what is under it. */
export const LIP = "lip mb-1 !min-h-[46px] whitespace-nowrap";
export const GHOST = "lip-ghost mb-[3px] !min-h-[44px] whitespace-nowrap";
export const SOFT = "inline-flex min-h-[46px] items-center justify-center whitespace-nowrap rounded-hz bg-t-soft px-5 font-body text-[15px] font-bold text-t-muted";
export const LINK = "inline-flex min-h-[44px] items-center font-body font-bold text-t-accent underline underline-offset-[3px]";
export const CARD = "t-card grid content-start gap-3 p-4";

/** Is the page wide enough for the desktop layout (the lg breakpoint, 1024px)? null until the first read, so nothing flashes the wrong one. */
export function useDesktop(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 1024px)");
    const read = () => setWide(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);
  return wide;
}

/** The address a room's logo is drawn from. A picture made in the fake layer is a data link; the real one is on our own storage. */
export function logoSrc(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (EVENTS_R1_FAKE && (stored.startsWith("data:image/") || stored.startsWith("blob:"))) return stored;
  return crewImageSrc(stored);
}

/** The room's square logo (6px corners), or its first letter on the tint when it has none or it does not load. */
export function RoomLogo({ url, name, size, className }: { url: string | null; name: string; size: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = logoSrc(url);
  const show = !!src && failed !== src;
  return (
    <span className={clsx("block flex-none overflow-hidden rounded-hz bg-t-solid", className)} style={{ width: size, height: size }} data-room-logo={show ? "image" : "letter"}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- the room's own upload or a /brands/ path, already sized for a badge
        <img src={src} alt={`${name} logo`} width={size} height={size} className="h-full w-full object-cover" onError={() => setFailed(src)} draggable={false} />
      ) : (
        <span className="grid h-full w-full place-items-center bg-t-soft font-display font-black leading-none text-t-text" style={{ fontSize: Math.round(size * 0.42) }} aria-hidden>
          {name.trim().charAt(0).toUpperCase() || "H"}
        </span>
      )}
    </span>
  );
}

/** A person's round initial on their own colour. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className="grid flex-none place-items-center rounded-full font-display font-extrabold text-[#140f0d]" style={{ width: size, height: size, background: avatarColor(name), fontSize: size <= 32 ? 12 : 14 }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** A small line at the top of the page that goes by itself. */
export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none fixed left-1/2 top-4 z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-hz bg-t-text px-3.5 py-2.5 font-body text-[14px] font-bold text-t-bg shadow-[0_14px_34px_rgba(0,0,0,.35)]" data-toast>
      <i className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-t-accent text-t-on">
        <Check size={13} strokeWidth={3} aria-hidden />
      </i>
      {text}
    </div>
  );
}

/** A flashed line: set it and it clears after a few seconds. */
export function useFlash(ms = 3200): [string | null, (t: string) => void] {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(() => setText(null), ms);
    return () => window.clearTimeout(id);
  }, [text, ms]);
  return [text, setText];
}
