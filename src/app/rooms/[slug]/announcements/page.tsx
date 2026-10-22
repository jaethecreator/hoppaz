import { notFound } from "next/navigation";
import Announcements from "@/components/events-r1/rooms/Announcements";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 Announcements of a room. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  return <Announcements slug={slug} />;
}
