"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useManagedRooms } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";

/**
 * Shown once, on the room admin, right after someone took a room over from the claim page (?welcome=1). It says what happened,
 * the first thing to do, and, when they already ran another room, how to tell the two apart. Closing it drops ?welcome from the address.
 */
export default function WelcomeBanner({ room, moved, also, onTab }: { room: RoomSummary; moved: number; also: boolean; onTab: (t: string) => void }) {
  const [open, setOpen] = useState(true);
  const mine = useManagedRooms();
  if (!open) return null;

  const others = (mine.data ?? []).filter((r) => r.id !== room.id && r.my_role === "owner");
  const other = others[0];

  const close = () => {
    setOpen(false);
    const sp = new URLSearchParams(window.location.search);
    for (const k of ["welcome", "moved", "also"]) sp.delete(k);
    const q = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  };

  return (
    <section className="t-card relative mb-4 border-2 !border-t-accent p-4 pr-12 lg:p-5" aria-label="Welcome" data-welcome>
      <button type="button" onClick={close} aria-label="Close" className="absolute right-1 top-1 grid h-11 w-11 place-items-center text-t-muted">
        <X size={18} aria-hidden />
      </button>
      <h3 className="t-title text-[18px] font-extrabold leading-tight">{room.name} is yours now</h3>
      <p className="mt-1 font-body text-[14px] text-t-muted">
        {moved > 0 ? `${moved} ${moved === 1 ? "event moved" : "events moved"} over to you. ` : ""}
        Open an event, then Tickets, to set real tickets and switch from the old page to Hoppaz tickets. Payouts need a Bachs setup. You do it under Payouts when you are ready to be paid.
      </p>
      {also && (
        <p className="mt-2 font-body text-[14px] text-t-muted" data-welcome-also>
          You also run {other ? other.name : "another room"}. Switch rooms from the room switcher; pick Post as when you create an event.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" className="lip" onClick={() => {
            close();
            onTab("events");
          }}>
          See your events
        </button>
        <button type="button" className="lip-ghost" onClick={close}>
          Got it
        </button>
      </div>
    </section>
  );
}
