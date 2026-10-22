"use client";

import { useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import CoverPicker from "./CoverPicker";
import EventForm from "./EventForm";
import { Choice } from "./Fields";
import RoomForm from "./RoomForm";

/** Release 1 one page create: Event or Room at the top, then the form. Opened by + Create (CreateButton). */
export default function CreatePage() {
  const [mode, setMode] = useState<"event" | "room">("event");
  const [cover, setCover] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto px-4 pb-10">
      <div className="mx-auto w-full max-w-xl">
        <PageHeader title="Create" back="/" className="pb-3" />
        {mode === "event" && <CoverPicker cover={cover} onChange={setCover} />}
        <Choice
          label="What to create"
          value={mode}
          options={[
            { value: "event", label: "Event" },
            { value: "room", label: "Room" },
          ]}
          onChange={setMode}
          className="mb-5"
        />
        {mode === "event" ? <EventForm cover={cover} /> : <RoomForm />}
      </div>
    </div>
  );
}
