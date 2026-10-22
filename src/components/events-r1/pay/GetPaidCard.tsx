"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import { CARD, ErrorLine } from "@/components/events-r1/host/ui";
import { useHostPayout, usePaidOn } from "./usePay";
import { hostPayError, SELLER_NOTE } from "./words";

const CAPS: Array<[string, string]> = [
  ["bank_transfer", "Bank transfers"],
  ["ngn_card_collection", "Cards"],
  ["payouts", "Payouts"],
];

/**
 * Get paid: where the host stands with Bachs. Not started (Set up payouts), In progress and Restricted (what is still
 * needed, Continue setup), Ready (a tick for each thing that works, and the Bachs dashboard). Nothing renders while
 * paid tickets are off. `quietWhenReady` hides the card once payouts are ready (for screens where it would be noise).
 */
export default function GetPaidCard({ returnPath, quietWhenReady }: { returnPath: string; quietWhenReady?: boolean }) {
  const on = usePaidOn();
  const api = useR1Api();
  const { data: payout } = useHostPayout(on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!on || !payout) return null;
  if (payout.status === "ready" && quietWhenReady) return null;

  const go = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await api.pay.startOnboarding(returnPath);
      window.location.assign(url);
    } catch (e) {
      setError(hostPayError(e));
      setBusy(false);
    }
  };

  const ready = payout.status === "ready";
  const title = ready ? "Payouts ready" : payout.status === "restricted" ? "Bachs needs more from you" : payout.status === "in_progress" ? "Finish setting up payouts" : "Get paid";

  return (
    <section className={CARD} aria-label="Get paid">
      <h2 className="flex items-center gap-2 font-display text-[16px] font-black">
        {ready && (
          <span className="grid h-6 w-6 flex-none place-items-center rounded-full border border-keke text-keke" aria-hidden>
            <Check size={14} strokeWidth={3} />
          </span>
        )}
        {title}
      </h2>

      {payout.status === "not_started" && <p className="mt-2 font-body text-[14px]">Connect a payout account to sell paid tickets.</p>}

      {(payout.status === "in_progress" || payout.status === "restricted") && payout.requirements_due.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 font-body text-[14px]">
          {payout.requirements_due.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-dim">
                •
              </span>
              <span className="min-w-0">{r}</span>
            </li>
          ))}
        </ul>
      )}

      {ready && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body text-[13px]">
          {CAPS.map(([key, label]) => {
            const ok = payout.capabilities[key] === "active";
            return (
              <li key={key} className={ok ? "flex items-center gap-1 text-cream" : "flex items-center gap-1 text-dim"}>
                <Check size={13} strokeWidth={3} className={ok ? "text-keke" : "opacity-30"} aria-hidden /> {label}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {!ready && (
          <button type="button" onClick={() => void go()} disabled={busy || !api} className="btn px-5 normal-case">
            {busy ? "One moment" : payout.status === "not_started" ? "Set up payouts" : "Continue setup"}
          </button>
        )}
        {(ready || payout.status === "restricted") && payout.dashboard_url && (
          <a href={payout.dashboard_url} target="_blank" rel="noreferrer noopener" className="min-h-[44px] py-3 font-body text-[14px] text-orange underline underline-offset-4">
            Open Bachs dashboard
          </a>
        )}
      </div>
      <ErrorLine>{error}</ErrorLine>
      <p className="mt-2 font-body text-[12px] leading-snug text-dim">{SELLER_NOTE}</p>
    </section>
  );
}
