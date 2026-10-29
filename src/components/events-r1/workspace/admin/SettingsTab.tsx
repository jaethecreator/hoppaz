"use client";

import { useState } from "react";
import { JoinCards } from "@/components/events-r1/create/RoomParts";
import { usePaidOn } from "@/components/events-r1/pay/usePay";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { JoinMode, RoomSummary } from "@/lib/events-r1/types";
import { Card, Err, errText, SOON, SoonRow } from "./ui";

/**
 * Settings: who can join (saved through the rooms data), the rows that have no backend yet (Coming soon), a note on payouts, and
 * Transfer ownership and Delete room for the owner: both Coming soon, nothing destructive is wired.
 */
export default function SettingsTab({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const paidOn = usePaidOn();
  const [mode, setMode] = useState<JoinMode>(room.join_mode);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const pick = (m: JoinMode) => {
    if (!api || m === mode) return;
    const before = mode;
    setMode(m);
    setError("");
    api.rooms.update(room.id, { join_mode: m }).then(
      () => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2200);
      },
      (e) => {
        setMode(before);
        setError(errText(e));
      }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 h-4 font-body text-[13px] font-bold text-t-muted" aria-live="polite">
        {saved ? "Saved" : ""}
      </p>
      <JoinCards value={mode} onChange={pick} />
      <Err>{error}</Err>

      <section className="t-card px-4 lg:px-5" aria-label="Visibility">
        <SoonRow title="Show on the map and in search" hint="Your room and its public events">
          <input type="checkbox" disabled defaultChecked aria-label="Show on the map and in search" />
        </SoonRow>
        <SoonRow title="Show member count" hint="On your room page">
          <input type="checkbox" disabled aria-label="Show member count" />
        </SoonRow>
      </section>

      <Card title="Payouts" aside="For paid tickets">
        <p className="font-body text-[14.5px]">
          {paidOn
            ? "Money from paid tickets is paid out per event. Open an event from the Events tab and go to its Payouts tab."
            : "Paid tickets are not switched on yet. When they are, each event has its own Payouts tab in its dashboard."}
        </p>
      </Card>

      {room.is_owner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="lip-ghost" disabled aria-label="Transfer ownership, coming soon">
            Transfer ownership
          </button>
          <button type="button" className="lip-ghost" disabled aria-label="Delete room, coming soon">
            Delete room
          </button>
          {SOON}
        </div>
      )}
    </div>
  );
}
