"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useR1Now, useRoomEvents } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";
import EventList from "../EventList";
import { Card } from "./ui";

/** Events posted as the room: upcoming, past. Manage opens the event dashboard inside the room (with a back link here). */
export default function EventsTab({ room }: { room: RoomSummary }) {
  const events = useRoomEvents(room.id);
  const now = useR1Now();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/create?mode=event&room=${encodeURIComponent(room.id)}`} className="lip !px-5" data-new-event>
          <Plus size={16} strokeWidth={3} aria-hidden /> New event
        </Link>
        <p className="font-body text-[13.5px] text-t-muted">Everything posted as {room.name}. Members hear about new ones first.</p>
      </div>
      <Card label="Room events">
        {events.loading && !events.data ? (
          <p className="font-body text-[14px] text-t-muted">Loading</p>
        ) : (
          <EventList events={events.data ?? []} now={now} href={(e) => `/host/${encodeURIComponent(e.id)}`} empty="Nothing posted yet. Make an event and it shows up here and on your room page." />
        )}
        {(events.data ?? []).length > 0 && <p className="mt-3 font-body text-[13px] text-t-muted">Past events collect here and become your room&apos;s history.</p>}
      </Card>
    </div>
  );
}
