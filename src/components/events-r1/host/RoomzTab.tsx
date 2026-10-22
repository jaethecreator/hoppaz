"use client";

import clsx from "clsx";
import { useState } from "react";
import { Toggle } from "@/components/events-r1/create/Fields";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { CARD, ErrorLine, Section } from "./ui";
import { errWord } from "./words";

/** The looks: only Chat only works in the first release. The walkable looks are listed so hosts know they are coming. */
const LOOKS = ["Chat only", "Indoor party", "Pool party", "Outdoor party", "Theatre", "Tech event"];

/** Roomz: how the event's chat looks, who can come in, and whether it sits in the host's room. */
export default function RoomzTab({ event }: { event: R1Event }) {
  const api = useR1Api();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inRoom = !!event.room_id;

  const setRoom = async (on: boolean) => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.events.update(event.id, { add_to_room: on });
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Look">
        <div role="radiogroup" aria-label="Look" className="flex flex-col">
          {LOOKS.map((l, i) => {
            const on = i === 0;
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!on}
                className={clsx("flex min-h-[48px] items-center gap-3 py-2 text-left", !on && "opacity-50")}
              >
                <span className={clsx("grid h-5 w-5 flex-none place-items-center rounded-full border", on ? "border-orange" : "border-dim")} aria-hidden>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-orange" />}
                </span>
                <span className="min-w-0 flex-1 font-body text-[15px]">{l}</span>
                {!on && <span className="flex-none font-body text-[13px] text-dim">Coming later</span>}
              </button>
            );
          })}
        </div>
      </Section>

      <p className={clsx(CARD, "font-body text-[15px]")}>Who can come in follows your approval setting.</p>

      {event.host.roomId && event.host.roomName && (
        <section className={CARD}>
          <Toggle on={inRoom} onChange={(on) => void setRoom(on)} disabled={busy} label={`Add to ${event.host.roomName}`} />
          <ErrorLine>{error}</ErrorLine>
        </section>
      )}
    </div>
  );
}
