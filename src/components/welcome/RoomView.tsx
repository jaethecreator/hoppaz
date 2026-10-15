"use client";

import { useEffect, useMemo, useState } from "react";
import CampaignWorld from "@/components/campaign/CampaignWorld";
import { anonLook } from "@/lib/avatar";
import { hotspotRoom } from "@/lib/campaign/templates";
import type { SocialWorld } from "@/lib/crew-room/types";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";

/** The room the first run uses when the Hopper's own hotspot has no room drawn yet (and the one the tests use): Adeola Odeku. */
export const DEMO_ROOM = "victoria-island";

/** A hotspot slug that has a room drawn: the one asked for, or the demo room. */
export const roomSlugFor = (slug: string | null | undefined) => (slug && hotspotRoom(slug) ? slug : DEMO_ROOM);

/**
 * A hotspot's own room (the room-templates work, /room/<slug>) on its own: the room and one avatar, no server. Hotspot rooms
 * keep aliases, so the avatar is an alias look, never the Hopper's own. `look` only: a peek takes no taps, you cannot walk
 * it (the exit door would take you out of the first run).
 */
export default function RoomView({ slug, lookOnly = false }: { slug: string; lookOnly?: boolean }) {
  const room = hotspotRoom(slug);
  const data = hotspotRoomData(slug);
  // The world reads the window (device tier, camera): draw it on the client only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const look = useMemo(() => anonLook("Hopper"), []);
  const social: SocialWorld | null = useMemo(
    () =>
      room
        ? {
            peers: [],
            circles: [],
            selfId: "me",
            circleId: null,
            areaId: null,
            watching: false,
            observedAt: new Date().toISOString(),
            reset: { x: room.layout.spawn.x, y: room.layout.spawn.y, revision: 0 },
            onStep: () => true,
          }
        : null,
    [room]
  );
  if (!room || !data || !social) return null;
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden" style={{ isolation: "isolate" }}>
      <div className={lookOnly ? "pointer-events-none absolute inset-0" : "absolute inset-0"}>
        {mounted && <CampaignWorld key={room.key} layout={room.layout} look={look} brand={data.junction} social={social} placeId={room.key} />}
      </div>
    </div>
  );
}
