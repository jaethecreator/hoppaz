"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api } from "@/lib/events-r1/hooks";

/** Release 1 one page create, room side: a name and one line, then Create room. */
export default function RoomForm() {
  const router = useRouter();
  const api = useR1Api();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The line sits under the button, which can be below the fold on a phone.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  const [sheet, setSheet] = useState(false);

  const create = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.rooms.create({ name: name.trim(), description: about.trim() });
      router.push(`/rooms/${made.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again later");
      setBusy(false);
    }
  };

  const submit = () => {
    if (!api || busy || !name.trim()) return;
    if (!api.auth.current()) {
      setSheet(true);
      return;
    }
    void create();
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="block">
        <span className="sr-only">Room name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room name"
          autoComplete="off"
          maxLength={60}
          className="!rounded-none !border-0 !border-b !bg-transparent !px-0 py-2 font-display text-[28px] font-black leading-tight placeholder:text-dim/60"
        />
      </label>
      <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What is it about?" aria-label="Description" maxLength={140} autoComplete="off" />
      <div className="flex flex-col gap-2 pb-2">
        <button type="button" className="btn w-full normal-case" onClick={submit} disabled={busy || !name.trim() || !api}>
          {busy ? "Creating" : "Create room"}
        </button>
        {error && (
          <p ref={errorRef} role="alert" className="px-1 font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
      </div>
      <SignInSheet
        open={sheet}
        reason="Create your room"
        onClose={() => setSheet(false)}
        onSignedIn={() => {
          setSheet(false);
          void create();
        }}
      />
    </div>
  );
}
