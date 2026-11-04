"use client";

import { useState } from "react";
import { JoinCards } from "@/components/events-r1/create/RoomParts";
import { dayLagos, maskEmail } from "@/components/events-r1/claim/words";
import { useR1Api, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { JoinMode, RoomSummary } from "@/lib/events-r1/types";
import TransferDialog, { isOpen } from "./TransferDialog";
import { Err, errText, SOON, SoonRow } from "./ui";

/**
 * Settings: who can join (saved through the rooms data), the rows that have no backend yet (Coming soon), and for the owner
 * Transfer ownership (a link the new owner accepts; see TransferDialog) and Delete room (Coming soon, nothing destructive is wired).
 */
export default function SettingsTab({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const [mode, setMode] = useState<JoinMode>(room.join_mode);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const now = useR1Now();
  // Only an owner reads the room's transfers.
  const transfers = useR1Query((a) => (room.is_owner ? a.claims.transfersFor(room.id) : Promise.resolve([])), [room.id, room.is_owner]);
  const list = transfers.data ?? [];
  const pending = list.find((t) => isOpen(t, now));

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

      {room.is_owner && pending && (
        <p className="t-card px-4 py-3 font-body text-[14px]" data-transfer-pending>
          Transfer to <b>{maskEmail(pending.to_email)}</b> pending, expires {dayLagos(pending.expires_at)}.{" "}
          <button type="button" className="font-bold underline underline-offset-4" onClick={() => setAsking(true)}>
            Manage
          </button>
        </p>
      )}

      {room.is_owner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="lip-ghost" onClick={() => setAsking(true)}>
            Transfer ownership
          </button>
          <button type="button" className="lip-ghost" disabled aria-label="Delete room, coming soon">
            Delete room
          </button>
          {SOON}
        </div>
      )}

      {room.is_owner && asking && <TransferDialog room={room} transfers={list} now={now} onChanged={transfers.reload} onClose={() => setAsking(false)} />}
    </div>
  );
}
