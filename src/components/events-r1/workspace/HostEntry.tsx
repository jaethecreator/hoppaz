"use client";

import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { RowLink } from "@/components/me/Rows";
import { useManagedRooms, useR1Auth, useR1Query } from "@/lib/events-r1/hooks";

/**
 * The way into the host workspace (/host) from the app, for anyone who has an event or runs a room. Nothing for someone who has neither.
 * It reads the Release 1 sign in itself (the Me page runs on the app's older account system, which can differ in a build where the two are
 * not the same session), so it shows wherever the Release 1 person is signed in. `row`: a row for Me. `button`: a small link for the Roomz header.
 */
export default function HostEntry({ variant }: { variant: "row" | "button" }) {
  const { user } = useR1Auth();
  const mine = useR1Query((a) => (a.auth.current() ? a.events.listMine() : Promise.resolve([])), [user?.id]);
  const rooms = useManagedRooms();
  const has = !!user && ((mine.data ?? []).length > 0 || (rooms.data ?? []).length > 0);
  if (!has) return null;
  if (variant === "row") return <RowLink href="/host" title="Host" hint="Your events and rooms, and the guests you have." icon={LayoutDashboard} />;
  return (
    <Link href="/host" className="btn btn-ghost min-h-[40px] gap-1.5 px-3 normal-case" data-host-entry>
      <LayoutDashboard size={16} aria-hidden /> Host
    </Link>
  );
}
