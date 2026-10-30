import { notFound, redirect } from "next/navigation";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** hoppaz.fun/r/<slug>/admin: the room admin lives at /rooms/<slug>/admin, next to the room page. */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  const { tab } = await searchParams;
  redirect(`/rooms/${encodeURIComponent(slug)}/admin${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`);
}
