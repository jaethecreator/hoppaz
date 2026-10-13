"use client";

import clsx from "clsx";
import { Crosshair } from "lucide-react";
import { nightTag } from "@/lib/filters";

/**
 * The map's bottom bar while it shows the next events rather than one day:
 * how many, which nights they cover, and the way into Play. Boxes are not on
 * this map any more: tap your avatar and they appear around you. Without a
 * location there is no avatar, and this is where you set one.
 */
export default function NextBar({
  count,
  from,
  to,
  hasFix,
  onLocate,
  className,
}: {
  count: number;
  from: string | null;
  to: string | null;
  hasFix: boolean;
  onLocate: () => void;
  className?: string;
}) {
  const range = from && to ? (from === to ? nightTag(from) : `${nightTag(from)} TO ${nightTag(to)}`) : null;
  return (
    <section aria-label="What is on" className={clsx("flex min-h-11 items-center gap-2.5 rounded-hz border border-line bg-ink-2/95 px-3 py-2 backdrop-blur", className)}>
      <span className="num text-[25px] leading-none">{count}</span>
      <div className="min-w-0 flex-1">
        <p className="seclabel truncate">{range ? `NEXT ${count} · ${range}` : "NOTHING COMING UP"}</p>
        <p className="truncate font-body text-[12px] leading-snug text-cream">
          {hasFix ? "Tap your avatar to play" : "Set your location to play"}
        </p>
      </div>
      {!hasFix && <button type="button" onClick={onLocate} aria-label="Set your location" className="grid h-9 w-9 flex-none place-items-center rounded-hz text-orange"><Crosshair size={17} aria-hidden /></button>}
    </section>
  );
}
