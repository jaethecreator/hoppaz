"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { R1Event } from "@/lib/events-r1/types";

const key = (id: string) => `hz.r1.host.roompop.${id}`;

const POINTS = ["Everyone going joins it in one tap", "Your next event reaches them automatically", "Your logo and look, set up in a minute"];

/**
 * "Where do your guests go after the night?" Opens once when a host arrives at an event that has no room. Once it has been shown
 * (or closed) it is remembered in this browser and never opens by itself again; the Room tab and the Overview card stay.
 */
export default function RoomPopup({ event, going }: { event: R1Event; going: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(key(event.id)) === "1";
      if (!seen) window.localStorage.setItem(key(event.id), "1");
    } catch {
      /* storage blocked: it opens once per page load */
    }
    if (!seen && event.status === "live") setOpen(true);
  }, [event.id, event.status]);

  useEffect(() => {
    if (!open) return;
    ok.current?.focus();
    const onKey = (k: KeyboardEvent) => k.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const title = going > 0 ? `${going.toLocaleString("en-NG")} ${going === 1 ? "person is" : "people are"} going. Where do they go after the night?` : "Where do your guests go after the night?";

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="room-pop-title" onClick={(e) => e.stopPropagation()} className="relative w-full max-w-[400px] rounded-hz border border-t-line bg-t-bg p-6 shadow-2xl">
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-hz border border-t-line text-t-text">
          <X size={16} aria-hidden />
        </button>
        <div className="mb-4 flex items-center justify-center" aria-hidden>
          <span className="-mr-3 h-11 w-11 rounded-full bg-t-soft" />
          <span className="-mr-3 h-11 w-11 rounded-full bg-t-line" />
          <span className="grid h-14 w-14 rotate-[6deg] place-items-center rounded-hz bg-t-accent font-display text-[22px] font-black text-t-on shadow-lip">?</span>
          <span className="-ml-3 h-11 w-11 rounded-full bg-t-soft" />
        </div>
        <h2 id="room-pop-title" className="t-title text-[22px] font-extrabold leading-tight">
          {title}
        </h2>
        <p className="mt-3 font-body text-[14.5px] leading-snug text-t-muted">
          Right now, nowhere. Give them a room: one link where your next event, announcements, chat and quests find them, without chasing anyone on WhatsApp.
        </p>
        <ol className="mt-4 grid gap-2.5">
          {POINTS.map((p, i) => (
            <li key={p} className="flex items-center gap-3 font-body text-[14.5px] font-semibold">
              <span className="grid h-6 w-6 flex-none place-items-center rounded-hz bg-t-soft font-body text-[12px] font-extrabold text-t-accent">{i + 1}</span>
              {p}
            </li>
          ))}
        </ol>
        <button ref={ok} type="button" className="lip mt-5 w-full" onClick={() => router.push("/create?mode=room")}>
          Set up my room
        </button>
        <button type="button" className="mt-2 min-h-[44px] w-full font-body text-[14.5px] font-semibold text-t-muted" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}
