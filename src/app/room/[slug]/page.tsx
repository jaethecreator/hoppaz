"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import CampaignWorld from "@/components/campaign/CampaignWorld";
import { anonLook, normalizeLook } from "@/lib/avatar";
import { hotspotRoom } from "@/lib/campaign/templates";
import type { SocialWorld } from "@/lib/crew-room/types";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";

/**
 * /room/<hotspot slug>: the hotspot's own room, the entry point for the map pins and the guest peek. Today it is the room
 * and your own avatar only: the walking server for hotspot rooms (hotspot_rooms.sql) is a separate piece, so nobody else
 * is drawn here and nothing is sent. The avatar is an alias look, not the Hopper's own (hotspot rooms keep aliases). A slug with no room yet (the other hotspots, until their rooms are drawn) says so and
 * leads back to the map, where the crossroads screen is still the way in.
 *
 * Event rooms are addressed by their template key (`eventRoom(key)` in src/lib/campaign/templates.ts) and mount the same
 * way: CampaignWorld with `placeId={room.key}` and `roomContent`.
 */
export default function HotspotRoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const room = hotspotRoom(slug);
  const data = hotspotRoomData(slug);
  // The world reads the window (device tier, camera): draw it on the client only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Hotspot rooms keep aliases for everyone else; the walking server will hand each Hopper theirs (hotspot_rooms.sql, Ola).
  // Until then this is a solo room that only you see, so it wears your own Hopper (the first run says "This is your
  // Hopper"), and falls back to a stand-in alias look when you have not made one.
  const { profile } = useSession();
  const stored = useHoppaz((s) => s.look);
  const look = useMemo(() => normalizeLook(profile?.avatar ?? stored ?? anonLook("Hopper")), [profile?.avatar, stored]);
  const social: SocialWorld | null = useMemo(
    () => (room ? { peers: [], circles: [], selfId: "me", circleId: null, areaId: null, watching: false, observedAt: new Date().toISOString(), reset: { x: room.layout.spawn.x, y: room.layout.spawn.y, revision: 0 }, onStep: () => true } : null),
    [room]
  );

  if (!room || !data || !social) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="font-display text-[20px] font-black">No room here yet</p>
          <p className="hint mt-2">This hotspot&apos;s room is still being built.</p>
          <Link href="/" className="btn mt-5 inline-flex">
            BACK TO THE MAP
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-ink text-cream">
      <header className="flex flex-none items-center gap-1 border-b border-line bg-ink-2 pr-4 pt-[env(safe-area-inset-top)]" style={{ minHeight: "calc(56px + env(safe-area-inset-top))" }}>
        <Link href="/" aria-label="Back to the map" className="grid h-11 w-11 flex-none place-items-center">
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[22px] font-black leading-6">{data.junction}</h1>
          <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim">{data.place} hotspot</p>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ isolation: "isolate" }}>
        {mounted && <CampaignWorld key={room.key} layout={room.layout} look={look} brand={data.junction} social={social} placeId={room.key} />}
      </div>
    </div>
  );
}
