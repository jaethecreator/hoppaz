import { notFound } from "next/navigation";
import GeneralChat from "@/components/events-r1/rooms/GeneralChat";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 General: the room's own chat. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  return <GeneralChat slug={slug} />;
}
