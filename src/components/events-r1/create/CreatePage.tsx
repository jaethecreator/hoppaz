"use client";

import { useEffect, useState } from "react";
import CreateEvent from "./CreateEvent";
import RoomForm from "./RoomForm";
import { patchDraft, readDraft } from "./draft";

/**
 * + Create. An event opens the redesigned create screen (CreateEvent: random Hoppaz cover, tinted page, look, tickets, 2D
 * room). A room opens Create a room (RoomForm: the room profile in edit mode, tinted from its logo, build brief section 13).
 * "+ New room" from Post as, and "Set up my room" after creating an event, switch here; each screen has its own way back.
 */
export default function CreatePage() {
  const [mode, setMode] = useState<"event" | "room">("event");
  const [restored, setRestored] = useState(false);
  // "Set up my room" from the event's done sheet: the room's name starts as the host's own.
  const [fromEvent, setFromEvent] = useState(false);
  useEffect(() => {
    const d = readDraft();
    // ?mode= is the page that was asked for (Events' Create is event, Roomz' Create is room): it beats whatever the draft last held.
    const asked = new URLSearchParams(window.location.search).get("mode");
    const m = asked === "event" || asked === "room" ? asked : (d.pending ?? d.mode);
    if (m === "event" || m === "room") setMode(m);
    // A sign up left half way for the other kind must not resume into this one later.
    if (asked === "event" || asked === "room") patchDraft({ mode: asked, ...(d.pending && d.pending !== asked ? { pending: null } : {}) });
    setRestored(true);
  }, []);
  const pickMode = (m: "event" | "room", from?: "event") => {
    setFromEvent(m === "room" && from === "event");
    setMode(m);
    patchDraft({ mode: m });
    // Keep the address true to the page, so a reload (or the return from Google) opens the same kind.
    window.history.replaceState(null, "", `/create?mode=${m}`);
  };
  if (!restored) return <div className="h-full" />;
  if (mode === "event")
    return (
      <div className="h-full overflow-y-auto">
        <CreateEvent onNewRoom={(from) => pickMode("room", from)} />
      </div>
    );
  return (
    <div className="h-full overflow-y-auto">
      <RoomForm onSwitch={() => pickMode("event")} fromEvent={fromEvent} />
    </div>
  );
}
