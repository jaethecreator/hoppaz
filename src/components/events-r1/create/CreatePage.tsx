"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import CreateEvent from "./CreateEvent";
import { Choice } from "./Fields";
import RoomForm from "./RoomForm";
import { patchDraft, readDraft } from "./draft";

/**
 * + Create. An event opens the redesigned create screen (CreateEvent: random Hoppaz cover, tinted page, look, tickets, 2D
 * room). A room keeps the Release 1 form until Create a room is rebuilt (build brief section 13). "+ New room" from Post as,
 * and "Set up my room" after creating, switch here.
 */
export default function CreatePage() {
  const [mode, setMode] = useState<"event" | "room">("event");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const d = readDraft();
    const m = new URLSearchParams(window.location.search).get("mode") ?? d.pending ?? d.mode;
    if (m === "event" || m === "room") setMode(m);
    setRestored(true);
  }, []);
  const pickMode = (m: "event" | "room") => {
    setMode(m);
    patchDraft({ mode: m });
  };
  if (!restored) return <div className="h-full" />;
  if (mode === "event")
    return (
      <div className="h-full overflow-y-auto">
        <CreateEvent onNewRoom={() => pickMode("room")} />
      </div>
    );
  return (
    <div className="h-full overflow-y-auto px-4 pb-10">
      <div className="mx-auto w-full max-w-xl">
        <PageHeader title="Create" back="/" className="pb-3" />
        <Choice
          label="What to create"
          value={mode}
          options={[
            { value: "event", label: "Event" },
            { value: "room", label: "Roomz" },
          ]}
          onChange={pickMode}
          className="mb-5"
        />
        <RoomForm />
      </div>
    </div>
  );
}
