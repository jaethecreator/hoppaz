import { notFound, redirect } from "next/navigation";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** hoppaz.fun/r/<slug>: a room's short address. It opens the room page, keeping an invite code (?invite=) and a channel (?ch=). */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string; ch?: string }> }) {
  if (!EVENTS_R1) notFound();
  const { slug } = await params;
  const { invite, ch } = await searchParams;
  const q = new URLSearchParams();
  if (invite) q.set("invite", invite);
  if (ch) q.set("ch", ch);
  const s = q.toString();
  redirect(`/rooms/${encodeURIComponent(slug)}${s ? `?${s}` : ""}`);
}
