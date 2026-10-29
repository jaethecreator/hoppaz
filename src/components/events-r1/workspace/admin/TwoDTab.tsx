"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import TwoDRoomCard from "@/components/host/TwoDRoomCard";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Look } from "@/lib/events-r1/looks";
import type { RoomSummary } from "@/lib/events-r1/types";
import { enterPath, walkable } from "../../rooms/words";
import { Err, errText, SoonRow } from "./ui";

const SELECT = "!w-auto cursor-not-allowed";

/**
 * 2D room: the walkable room's switch and map, saved in the room's look (two_d). Opens, who can enter, the voice stage, hunts and
 * walkers have no data layer yet and are marked Coming soon. Only admins reach this tab, so "Add a walkable room" is theirs to see.
 */
export default function TwoDTab({ room, look, onLook }: { room: RoomSummary; look: Look; onLook: (l: Look) => void }) {
  const api = useR1Api();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const two = look.two_d ?? { on: true, template: "clubhouse" };

  const change = (v: { on: boolean; template: string }) => {
    const next: Look = { ...look, two_d: v };
    onLook(next);
    if (!api) return;
    setError("");
    api.looks.set("room", room.id, next).then(
      () => {
        setSaved(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSaved(false), 2200);
      },
      (e) => setError(errText(e))
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 h-4 font-body text-[13px] font-bold text-t-muted" aria-live="polite">
        {saved ? "Saved" : ""}
      </p>
      <TwoDRoomCard on={two.on} template={two.template} onChange={change} sub={room.has_3d ? "Always open for members" : "Add a walkable room for your members"} />
      {two.on && (
        <section className="t-card px-4 lg:px-5" aria-label="2D room settings">
          <SoonRow title="Who can enter" hint="Members, or guests of your events too">
            <select className={SELECT} disabled aria-label="Who can enter" defaultValue="members">
              <option value="members">Members and event guests</option>
            </select>
          </SoonRow>
          <SoonRow title="Open" hint="When the doors are unlocked">
            <select className={SELECT} disabled aria-label="Open" defaultValue="always">
              <option value="always">Always</option>
            </select>
          </SoonRow>
          <SoonRow title="Event nights use this map" hint="Each event's 2D room opens on your map">
            <input type="checkbox" disabled defaultChecked aria-label="Event nights use this map" />
          </SoonRow>
          <SoonRow title="Voice stage" hint="You and your admins can talk to the whole room">
            <input type="checkbox" disabled defaultChecked aria-label="Voice stage" />
          </SoonRow>
          <SoonRow title="Hunts and drops" hint="Hide prizes, ticket boxes or quest clues">
            <input type="checkbox" disabled aria-label="Hunts and drops" />
          </SoonRow>
          <SoonRow title="Walkers at once" hint="Others can watch when it's full">
            <input disabled value="60" readOnly aria-label="Walkers at once" className="!w-20 text-right" />
          </SoonRow>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {walkable(room) ? (
          <Link href={enterPath(room)} className="lip">
            Enter room
          </Link>
        ) : (
          <button type="button" className="lip" disabled>
            Enter room
          </button>
        )}
        <span className="font-body text-[13px] text-t-muted">{walkable(room) ? "Free while Hoppaz is in launch. It may become a paid extra later." : "Coming soon. Free while Hoppaz is in launch; it may become a paid extra later."}</span>
      </div>
      <Err>{error}</Err>
    </div>
  );
}
