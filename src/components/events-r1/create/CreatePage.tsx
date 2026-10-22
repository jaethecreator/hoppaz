"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import CoverPicker from "./CoverPicker";
import EventForm from "./EventForm";
import { Choice } from "./Fields";
import RoomForm from "./RoomForm";
import { patchDraft, readCover, readDraft, writeCover } from "./draft";

/** Release 1 one page create: Event or Room at the top, then the form. Opened by + Create (CreateButton). */
export default function CreatePage() {
  const [mode, setMode] = useState<"event" | "room">("event");
  const [cover, setCover] = useState<string | null>(null);
  // What was typed before a reload (or before the trip out to Google and back) comes back here. The forms wait for it.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const d = readDraft();
    // A waiting sign up lands on the side it was started from.
    const m = d.pending ?? d.mode;
    if (m === "event" || m === "room") setMode(m);
    setCover(readCover());
    setRestored(true);
  }, []);
  const pickMode = (m: "event" | "room") => {
    setMode(m);
    patchDraft({ mode: m });
  };
  const pickCover = (c: string | null) => {
    setCover(c);
    writeCover(c);
  };
  return (
    <div className="h-full overflow-y-auto px-4 pb-10">
      <div className="mx-auto w-full max-w-xl">
        <PageHeader title="Create" back="/" className="pb-3" />
        {mode === "event" && <CoverPicker cover={cover} onChange={pickCover} />}
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
        {restored && (mode === "event" ? <EventForm cover={cover} /> : <RoomForm />)}
      </div>
    </div>
  );
}
