"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { CrewCard } from "@/lib/crew-room/hub";
import { dayLabel } from "@/lib/filters";

/** The event on the room's fountain sticker, with the owner's ribbon, and the way to it on the map. */
export default function Featured({ card }: { card: CrewCard }) {
  const e = card.featured_event;
  if (!e) return null;
  return (
    <Link href={`/?e=${e.id}`} className="card mt-4 flex items-center gap-3 p-3 transition-colors active:bg-ink-3" data-featured={e.id}>
      <span className="relative block h-[96px] w-[74px] flex-none overflow-hidden rounded-[4px] bg-ink-3 ring-2 ring-cream/80">
        {e.flyer_url && (
          // eslint-disable-next-line @next/next/no-img-element -- an event flyer, uploaded by its organiser
          <img src={e.flyer_url} alt="" width={74} height={96} loading="lazy" className="h-full w-full object-cover" />
        )}
        {card.featured_ribbon && (
          <span
            className="absolute inset-x-0 bottom-2 bg-orange px-1 py-0.5 text-center font-display text-[10px] font-black uppercase leading-none tracking-[0.04em] text-brand-ink"
            data-ribbon
          >
            {card.featured_ribbon}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="seclabel block">On the fountain</span>
        <b className="mt-1 line-clamp-2 block font-display text-[16px] font-semibold leading-tight">{e.title}</b>
        <span className="hint block truncate">
          {dayLabel(e.starts_at)} · {e.venue_name}
        </span>
        <span className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] font-medium tracking-[0.12em] text-orange">
          <MapPin size={12} aria-hidden /> SEE IT ON THE MAP →
        </span>
      </span>
    </Link>
  );
}
