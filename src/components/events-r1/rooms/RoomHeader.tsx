"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { CrewLogo } from "@/components/crew-room/HubHeader";
import css from "@/components/crew-room/HubHeader.module.css";
import { crewImageSrc } from "@/lib/crew-room/images";
import type { RoomSummary } from "@/lib/events-r1/types";
import { gradientFor, memberWord } from "./words";

/**
 * The top of a room home, drawn like the 360Playlist hub's header (same height, scrim, back button, name row with the tick
 * and the round logo at the right end), but with one wallpaper or a brand gradient, and no carousel.
 */
export default function RoomHeader({ room, back = "/crew" }: { room: RoomSummary; back?: string }) {
  const router = useRouter();
  const wall = crewImageSrc(room.wallpaper_url);
  const [failed, setFailed] = useState<string | null>(null);
  const showWall = !!wall && failed !== wall;

  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const canGoBack = nav ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) router.back();
    else router.replace(back);
  };

  return (
    <header className="relative md:pt-4">
      <div className={css.stage} style={showWall ? undefined : { background: gradientFor(room) }} data-room-wallpaper={showWall ? "image" : "gradient"}>
        {showWall && (
          // eslint-disable-next-line @next/next/no-img-element -- the room's own wallpaper, a /brands/ path or our storage
          <img src={wall} alt="" width={1600} height={900} className="h-full w-full object-cover" onError={() => setFailed(wall)} draggable={false} />
        )}
        <div aria-hidden className={css.scrim} />
      </div>
      <Link
        href={back}
        onClick={goBack}
        aria-label="Back"
        className="absolute left-2 grid h-11 w-11 place-items-center rounded-full bg-ink/60 text-cream backdrop-blur-sm md:left-3 md:top-7"
        style={{ top: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
      </Link>
      <div className="relative flex items-start gap-3 px-4">
        <div className="min-w-0 flex-1 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="line-clamp-2 min-w-0 break-words font-display text-[28px] font-black leading-[1.05]" data-hub-title>
              {room.name}
            </h1>
            {room.verified && <VerifiedBadge size={22} />}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 font-body text-[14px] text-dim" data-members={room.members}>
            <Users size={13} aria-hidden /> {memberWord(room.members)}
            {room.verified && <span> · verified</span>}
            {room.online > 0 && <span> · {room.online.toLocaleString("en-NG")} online</span>}
          </p>
        </div>
        <CrewLogo url={room.logo_url} name={room.name} size={64} className="-mt-8" />
      </div>
    </header>
  );
}
