"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import TwoDRoomCard from "@/components/host/TwoDRoomCard";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Look } from "@/lib/events-r1/looks";
import type { R1Event } from "@/lib/events-r1/types";
import { ErrorLine, useFlash } from "./ui";
import { errWord } from "./words";

/** One settings row that has no backend yet: it is shown, switched off, and says so. Nothing here saves. */
function SoonRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-3 border-t border-t-line py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <b className="flex flex-wrap items-center gap-2 font-body text-[15px]">
          {title}
          <span className="rounded-hz bg-t-soft px-2 py-0.5 font-body text-[11px] font-extrabold text-t-muted">Coming soon</span>
        </b>
        <span className="block font-body text-[13px] text-t-muted">{hint}</span>
      </div>
      <div className="flex-none opacity-60" aria-disabled="true">
        {children}
      </div>
    </div>
  );
}

const SELECT = "!w-auto cursor-not-allowed";

/**
 * 2D room: the walkable room's switch and map (saved in the look's two_d, api.looks.set) and the settings the design lists for it.
 * Only the switch and the map exist in the data layer; opens, closes, who can enter, voice stage, hunts and walkers are marked
 * "Coming soon" and do nothing.
 */
export default function TwoDTab({ event, look, onLook }: { event: R1Event; look: Look; onLook: (l: Look) => void }) {
  const api = useR1Api();
  const [saved, flash] = useFlash(2400);
  const [error, setError] = useState("");
  const two = look.two_d ?? { on: true, template: "clubhouse" };

  const change = (v: { on: boolean; template: string }) => {
    const next: Look = { ...look, two_d: v };
    onLook(next);
    if (!api) return;
    setError("");
    api.looks.set("event", event.id, next).then(
      () => flash("Saved"),
      (e) => setError(errWord(e))
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 h-4 font-body text-[13px] font-bold text-t-muted" aria-live="polite">
        {saved}
      </p>
      <TwoDRoomCard on={two.on} template={two.template} onChange={change} sub="For people going to this event" />

      {two.on && (
        <section className="t-card px-4 lg:px-5" aria-label="2D room settings">
          <SoonRow title="Opens" hint="When guests can walk in">
            <select className={SELECT} disabled aria-label="Opens" defaultValue="1h">
              <option value="1h">1 hour before</option>
            </select>
          </SoonRow>
          <SoonRow title="Closes" hint="The room stays open after the night">
            <select className={SELECT} disabled aria-label="Closes" defaultValue="3d">
              <option value="3d">3 days after</option>
            </select>
          </SoonRow>
          <SoonRow title="Who can enter" hint="Everyone going, or anyone with the link">
            <select className={SELECT} disabled aria-label="Who can enter" defaultValue="going">
              <option value="going">Everyone going</option>
            </select>
          </SoonRow>
          <SoonRow title="Voice stage" hint="You and co-hosts can talk to the whole room">
            <input type="checkbox" disabled defaultChecked aria-label="Voice stage" />
          </SoonRow>
          <SoonRow title="Hunts and drops" hint="Hide ticket boxes or prizes for guests to find">
            <input type="checkbox" disabled aria-label="Hunts and drops" />
          </SoonRow>
          <SoonRow title="Walkers at once" hint="Others can watch when it's full">
            <input disabled value="60" readOnly aria-label="Walkers at once" className="!w-20 text-right" />
          </SoonRow>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="lip" disabled>
          Enter room to test
        </button>
        <span className="font-body text-[13px] text-t-muted">Coming soon. Free while Hoppaz is in launch; it may become a paid extra later.</span>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
