import { notFound } from "next/navigation";
import RoomHome from "@/components/events-r1/rooms/RoomHome";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 room home. /rooms/hq is Lagos HQ. With the flag off there is no such page. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  return <RoomHome slug={slug} />;
}
