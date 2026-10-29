"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { useR1Api, useR1Auth, useR1Query } from "@/lib/events-r1/hooks";
import { fullName, maskPhone } from "./CheckoutContact";

/**
 * "Saved checkout details" in Me: what checkout keeps when "Save my details for next time" is on (name, email, phone), with Delete.
 * Nothing saved, signed out of Release 1, or the real function not there yet: no row. It reads the Release 1 sign in itself (Me still reads its numbers from the app session).
 */
export default function SavedDetailsRow() {
  const api = useR1Api();
  const { user } = useR1Auth();
  const { data } = useR1Query((a) => (a.auth.current() ? a.account.savedDetails() : Promise.resolve(null)), [user?.id]);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user || !data) return null;

  const remove = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.account.deleteSavedDetails();
      setSure(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[60px] w-full flex-wrap items-center gap-3 px-4 py-3" data-saved-details>
      <CreditCard size={19} strokeWidth={1.9} aria-hidden className="flex-none text-dim" />
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[15px] font-semibold leading-tight">Saved checkout details</span>
        <span className="hint mt-0.5 block break-words">{[fullName(data), data.email, maskPhone(data.phone)].filter(Boolean).join(" · ")}</span>
      </span>
      {sure ? (
        <span className="flex flex-none items-center gap-2" role="group" aria-label="Delete saved checkout details">
          <button type="button" className="btn btn-ghost min-h-[44px] px-3 normal-case" onClick={() => setSure(false)} disabled={busy}>
            Keep
          </button>
          <button type="button" className="btn min-h-[44px] px-3 normal-case" onClick={() => void remove()} disabled={busy}>
            {busy ? "Deleting" : "Delete"}
          </button>
        </span>
      ) : (
        <button type="button" className="min-h-[44px] flex-none px-1 font-body text-[14px] font-semibold text-fireant underline underline-offset-4" onClick={() => setSure(true)}>
          Delete
        </button>
      )}
      {error && (
        <p role="alert" className="w-full font-body text-[13px] text-fireant">
          {error}
        </p>
      )}
    </div>
  );
}
