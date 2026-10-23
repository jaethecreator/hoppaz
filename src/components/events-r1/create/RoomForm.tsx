"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api, useR1Auth } from "@/lib/events-r1/hooks";
import GlowButton from "./GlowButton";
import { clearDraft, patchDraft, readDraft, str } from "./draft";

/** Release 1 one page create, room side: a name and one line, then Create room. */
export default function RoomForm() {
  const router = useRouter();
  const api = useR1Api();
  // What was typed before a reload or a trip out to Google (see draft.ts). Read once.
  const [saved] = useState(() => readDraft());
  const resume = useRef(saved.pending === "room");
  const resumed = useRef(false);
  const { user } = useR1Auth();
  const [name, setName] = useState(() => str(saved.room?.name));
  const [about, setAbout] = useState(() => str(saved.room?.about));
  useEffect(() => {
    patchDraft({ mode: "room", room: { name, about } });
  }, [name, about]);
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
      clearDraft();
      router.push(`/rooms/${made.slug}`);
    } catch (e) {
      patchDraft({ pending: null });
      setError(e instanceof Error ? e.message : "Try again later");
      setBusy(false);
    }
  };

  const submit = () => {
    if (!api || busy || !name.trim()) return;
    if (!api.auth.current()) {
      // Sign up wall; the draft is marked so the Roomz is made at once after sign up, even after the trip out to Google.
      patchDraft({ pending: "room" });
      setSheet(true);
      return;
    }
    void create();
  };

  // Back from Google (the page reloaded) with the sign up waiting: make the Roomz now, from the restored draft.
  useEffect(() => {
    if (!resume.current || resumed.current || !api) return;
    if (user) {
      resumed.current = true;
      resume.current = false;
      patchDraft({ pending: null });
      submit();
      return;
    }
    const id = window.setTimeout(() => {
      resume.current = false;
      patchDraft({ pending: null });
    }, 6000);
    return () => window.clearTimeout(id);
    // Only when the sign in state answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, user]);

  return (
    <div className="flex flex-col gap-4">
      <label className="block">
        <span className="sr-only">Roomz name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Roomz name"
          autoComplete="off"
          maxLength={60}
          className="!rounded-none !border-0 !border-b !bg-transparent !px-0 py-2 font-display text-[28px] font-black leading-tight placeholder:text-dim/60"
        />
      </label>
      <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What is it about?" aria-label="Description" maxLength={140} autoComplete="off" />
      <div className="flex flex-col gap-2 pb-2">
        <GlowButton ready={!busy && !!name.trim() && !!api} className="btn w-full normal-case" onClick={submit} disabled={busy || !name.trim() || !api}>
          {busy ? "Creating" : "Create Roomz"}
        </GlowButton>
        {error && (
          <p ref={errorRef} role="alert" className="px-1 font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
      </div>
      <SignInSheet
        open={sheet}
        reason="Sign up to create your Roomz"
        onClose={() => {
          setSheet(false);
          patchDraft({ pending: null });
        }}
        onSignedIn={() => {
          setSheet(false);
          void create();
        }}
      />
    </div>
  );
}
