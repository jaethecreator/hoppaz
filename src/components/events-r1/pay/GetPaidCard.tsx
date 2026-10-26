"use client";

import { useState } from "react";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { PayoutSummary, Withdrawal } from "@/lib/events-r1/pay";
import { CARD, ErrorLine } from "@/components/events-r1/host/ui";
import PayoutSetupSheet from "./PayoutSetupSheet";
import { usePaidOn, usePayoutSummary } from "./usePay";
import { hostPayError, naira, SELLER_NOTE } from "./words";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "");

/** One line for a withdrawal: where it is. */
function wordFor(w: Withdrawal): string {
  if (w.status === "paid") return `${naira(w.received_naira ?? w.amount_naira)} sent to your bank on ${day(w.paid_at)}`;
  if (w.status === "requested") return `${naira(w.amount_naira)} goes to your bank on ${day(w.execute_after)}`;
  return `${naira(w.amount_naira)} on its way to your bank`;
}

/**
 * Your money (paid tickets on). Hoppaz collects every payment; this shows what the host has earned, what they can withdraw now, the 5
 * percent held until 30 days after each event, and the withdrawal on its way. One main action: Withdraw, or Add your bank the first time
 * (PayoutSetupSheet: name, date of birth, address, bank; no ID). A withdrawal is sent a day after it is asked for. `quietWhenReady` hides
 * the card while there is nothing to show (no sales yet and no bank needed yet), for screens where it would be noise.
 */
export default function GetPaidCard({ quietWhenReady }: { returnPath?: string; quietWhenReady?: boolean }) {
  const on = usePaidOn();
  const api = useR1Api();
  const { data: sum, reload } = usePayoutSummary(on);
  const [sheet, setSheet] = useState(false);
  // What the save itself answered: shown at once, whatever a background refresh that was already on its way says.
  const [saved, setSaved] = useState<{ ready: boolean; bank_label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!on || !sum) return null;
  if (quietWhenReady && sum.earned_naira === 0 && !sum.open_withdrawal) return null;

  const withdraw = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.pay.requestWithdrawal();
      reload();
    } catch (e) {
      setError(hostPayError(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = sum.account.ready || !!saved?.ready;
  const bankLabel = saved?.bank_label || sum.account.bank_label;
  const canWithdraw = ready && !sum.open_withdrawal && sum.available_naira >= sum.rules.min_naira;
  const past = sum.recent.filter((w) => w.status === "paid").slice(0, 3);

  return (
    <section className={CARD} aria-label="Your money">
      <h2 className="font-display text-[16px] font-black">Your money</h2>
      <p className="mt-2 font-display text-[28px] font-black leading-none tabular-nums">{naira(sum.available_naira)}</p>
      <p className="mt-1 font-body text-[13px] text-dim">Ready to withdraw</p>

      <Lines sum={sum} />

      {sum.open_withdrawal && <p className="mt-3 font-body text-[14px] text-cream">{wordFor(sum.open_withdrawal)}</p>}

      <div className="mt-3">
        {!ready ? (
          <button type="button" onClick={() => setSheet(true)} disabled={!api} className="btn w-full px-5 normal-case">
            Add your bank
          </button>
        ) : (
          <button type="button" onClick={() => void withdraw()} disabled={!canWithdraw || busy || !api} className="btn w-full px-5 normal-case">
            {busy
              ? "One moment"
              : sum.open_withdrawal
                ? "Withdrawal on its way"
                : sum.available_naira < sum.rules.min_naira
                  ? sum.available_naira > 0
                    ? `Withdraw from ${naira(sum.rules.min_naira)}`
                    : "Nothing to withdraw yet"
                  : `Withdraw ${naira(sum.available_naira)}`}
          </button>
        )}
      </div>
      <ErrorLine>{error}</ErrorLine>

      {ready && (
        <p className="mt-2 font-body text-[13px] text-dim">
          {bankLabel ? `To ${bankLabel}. ` : ""}
          Sent a day after you ask.{" "}
          <button type="button" onClick={() => setSheet(true)} className="text-orange underline underline-offset-4">
            Change bank
          </button>
        </p>
      )}
      {!ready && <p className="mt-2 font-body text-[13px] text-dim">You can sell tickets now. Add your bank once, before your first withdrawal.</p>}

      {past.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 font-body text-[13px] text-dim">
          {past.map((w) => (
            <li key={w.id}>{wordFor(w)}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 font-body text-[12px] leading-snug text-dim">{SELLER_NOTE}</p>

      <PayoutSetupSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onSaved={(s) => {
          setSaved(s);
          setSheet(false);
          reload();
        }}
      />
    </section>
  );
}

/** Earned, held back and withdrawn, only the lines that are not zero. */
function Lines({ sum }: { sum: PayoutSummary }) {
  const rows: Array<[string, string]> = [];
  if (sum.earned_naira > 0) rows.push(["Earned from tickets", naira(sum.earned_naira)]);
  if (sum.reserved_naira > 0) rows.push([`Held until ${day(sum.reserve_until)} (${sum.rules.reserve_percent}%, for refunds)`, naira(sum.reserved_naira)]);
  if (sum.withdrawn_naira > 0) rows.push(["Withdrawn", naira(sum.withdrawn_naira)]);
  if (sum.balance_naira < 0) rows.push(["Owed from refunds, taken from your next sales", naira(-sum.balance_naira)]);
  if (!rows.length) return null;
  return (
    <dl className="mt-3 flex flex-col gap-1 font-body text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="min-w-0 text-dim">{k}</dt>
          <dd className="tabular-nums text-cream">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
