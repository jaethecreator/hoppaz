import { notFound, redirect } from "next/navigation";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Old address: Announcements is now a channel of the room page. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  redirect(`/rooms/${encodeURIComponent(slug)}?ch=announcements`);
}
