"use client";

import Link from "next/link";
import clsx from "clsx";
import { Plus } from "lucide-react";

/**
 * Release 1: the orange + Create, the same button on the Map and on Events. It opens the one page create (/create).
 * The page puts it where it belongs (bottom right, above the tab bar); this is only the button.
 */
export default function CreateButton({ className }: { className?: string }) {
  return (
    <Link href="/create" aria-label="Create" className={clsx("btn pointer-events-auto flex-none gap-1.5 whitespace-nowrap px-4 normal-case", className)}>
      <Plus size={16} strokeWidth={3} aria-hidden />
      Create
    </Link>
  );
}
