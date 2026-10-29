import { notFound, redirect } from "next/navigation";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** hoppaz.fun/r/<slug>: a room's short address. It opens the room home, keeping an invite code (?invite=) for the invite link. */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  const { invite } = await searchParams;
  redirect(`/rooms/${encodeURIComponent(slug)}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`);
}
