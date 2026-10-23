"use client";

import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import { hostPayError } from "./words";

/** In the Tickets row, when Paid is chosen and the host cannot sell yet: one line and the Set up payouts button. */
export default function PayoutNeeded({ returnPath }: { returnPath?: string }) {
  const api = useR1Api();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await api.pay.startOnboarding(returnPath ?? `${window.location.pathname}${window.location.search}`);
      window.location.assign(url);
    } catch (e) {
      setError(hostPayError(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 rounded-hz border border-line bg-ink-3/40 p-3">
      <p className="font-body text-[14px] text-cream">Set up payouts first</p>
      <button type="button" onClick={() => void go()} disabled={busy || !api} className="btn px-5 normal-case">
        {busy ? "One moment" : "Set up payouts"}
      </button>
      {error && (
        <p role="alert" className="font-body text-[14px] text-fireant">
          {error}
        </p>
      )}
    </div>
  );
}
