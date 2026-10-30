import { notFound } from "next/navigation";
import { Suspense } from "react";
import RoomPage from "@/components/events-r1/roompage/RoomPage";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 room page (CHANGE-001): the chat is the room. /rooms/hq is Lagos HQ. With the flag off there is no such page. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  return (
    <Suspense fallback={<div className="h-full" />}>
      <RoomPage slug={slug} />
    </Suspense>
  );
}
