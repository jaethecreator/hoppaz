"use client";

import Link from "next/link";
import clsx from "clsx";
import { Plus } from "lucide-react";

/**
 * Release 1: the orange + Create, the same button on the Map, on Events and on Roomz. It opens the one page create (/create)
 * in the kind of this side: an event from the Map and Events, a room from Roomz (`kind="room"`).
 * The page puts it where it belongs (bottom right, above the tab bar); this is only the button.
 */
export default function CreateButton({ className, kind = "event" }: { className?: string; kind?: "event" | "room" }) {
  return (
    <Link href={`/create?mode=${kind}`} aria-label={kind === "room" ? "Create a room" : "Create"} className={clsx("btn pointer-events-auto flex-none gap-1.5 whitespace-nowrap px-4 normal-case", className)}>
      <Plus size={16} strokeWidth={3} aria-hidden />
      Create
    </Link>
  );
}
