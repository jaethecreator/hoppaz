import { notFound } from "next/navigation";
import EventChat from "@/components/events-r1/rooms/EventChat";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 event chat, tied to the event's room. */
export default async function Page({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug, eventId } = await params;
  return <EventChat slug={slug} eventId={eventId} />;
}
