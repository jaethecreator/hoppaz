"use client";

import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";
import { Toggle } from "../create/Fields";

/**
 * The owner's small Manage row on a room home: the switch for the walkable 3D room. Off means chat only, and Enter room goes away
 * for everyone. Staff switch it from the Roomz 3D list on /admin. The switch follows the room's own answer (it reloads after the call).
 */
export default function ManageRoom({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");

  if (!room.is_owner || !room.has_3d) return null;

  const flip = async (on: boolean) => {
    if (!api || busy) return;
    setBusy(true);
    setFail("");
    try {
      await api.rooms.setThreeD(room.id, on);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "That did not work. Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Manage" className="mt-6" data-manage>
      <p className="seclabel mb-1">Manage</p>
      <div className="border-t border-line pt-1">
        <Toggle on={room.three_d_on} onChange={flip} disabled={busy || !api} label={`3D room: ${room.three_d_on ? "On" : "Off"}`} hint="Off means chat only: Announcements, General and event chats." />
        {fail && (
          <p role="alert" className="hint text-fireant">
            {fail}
          </p>
        )}
      </div>
    </section>
  );
}
