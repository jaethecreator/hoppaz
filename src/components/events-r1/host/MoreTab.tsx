"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { CARD, ErrorLine, Section } from "./ui";
import { errWord } from "./words";

/** More: clone the event, cancel it, or open the public page. Cancel asks twice, in place. */
export default function MoreTab({ event }: { event: R1Event }) {
  const router = useRouter();
  const api = useR1Api();
  const [busy, setBusy] = useState<"clone" | "cancel" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  const clone = async () => {
    if (!api || busy) return;
    setBusy("clone");
    setError("");
    try {
      const made = await api.events.clone(event.id);
      router.push(`/host/${encodeURIComponent(made.id)}?new=1`);
    } catch (e) {
      setError(errWord(e));
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!api || busy) return;
    setBusy("cancel");
    setError("");
    try {
      await api.events.cancel(event.id);
      setConfirm(false);
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Clone event">
        <p className="hint">Same details, a week later. No guests.</p>
        <button type="button" onClick={() => void clone()} disabled={!!busy} className="btn btn-ghost mt-3 px-5 normal-case">
          {busy === "clone" ? "Cloning" : "Clone event"}
        </button>
      </Section>

      <Section title="Event page">
        <Link href={`/event/${encodeURIComponent(event.id)}`} className="font-body text-[15px] text-orange underline underline-offset-4">
          Open event page
        </Link>
      </Section>

      {event.status === "cancelled" ? (
        <p className={`${CARD} font-body text-[15px]`}>This event is cancelled.</p>
      ) : event.status === "live" ? (
        <Section title="Cancel event">
          {confirm ? (
            <div role="group" aria-label="Cancel event">
              <p className="font-body text-[15px]">Cancel this event?</p>
              <p className="hint mt-1">Guests are told. Registrations stay as a record.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirm(false)} disabled={!!busy} className="btn btn-ghost flex-1 normal-case">
                  Keep event
                </button>
                <button type="button" onClick={() => void cancel()} disabled={!!busy} className="btn flex-1 normal-case">
                  {busy === "cancel" ? "Cancelling" : "Yes, cancel"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="hint">Guests are told. Registrations stay as a record.</p>
              <button type="button" onClick={() => setConfirm(true)} className="btn btn-ghost mt-3 px-5 normal-case text-fireant">
                Cancel event
              </button>
            </>
          )}
        </Section>
      ) : null}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
