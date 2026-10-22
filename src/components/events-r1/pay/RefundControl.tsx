"use client";

import { useState } from "react";
import { ErrorLine } from "@/components/events-r1/host/ui";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { Order } from "@/lib/events-r1/pay";
import { hostPayError, naira } from "./words";

/** Can this order still be refunded or marked as refunded by the host? */
export const refundable = (o: Order): boolean => (o.status === "paid" && !o.needs_manual_refund) || o.needs_manual_refund;

/**
 * Refund, in place, no pop-up. A card order asks once ("Refund ₦6,000 to the buyer's card? Hoppaz's fee is not returned.").
 * A bank transfer cannot be sent back through Bachs: the host pays the buyer by bank, then taps Mark as refunded.
 */
export default function RefundControl({ order }: { order: Order }) {
  const api = useR1Api();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!refundable(order)) return null;
  const bank = order.payment_method === "bank_transfer" || order.needs_manual_refund;

  const run = async (what: () => Promise<unknown>) => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await what();
      setOpen(false);
    } catch (e) {
      setError(hostPayError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost min-h-[40px] px-5 normal-case">
          {order.needs_manual_refund ? "Mark as refunded" : "Refund"}
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Refund" className="rounded-hz border border-line bg-ink-3 p-3">
      {bank ? (
        <p className="font-body text-[14px]">Bank transfers cannot be refunded here. Pay the buyer back by bank, then mark it done.</p>
      ) : (
        <p className="font-body text-[14px]">Refund {naira(order.gross_naira)} to the buyer&apos;s card? Hoppaz&apos;s fee is not returned.</p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-ghost min-h-[40px] flex-1 normal-case">
          Keep
        </button>
        {bank ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!api) return;
                if (!order.needs_manual_refund) await api.pay.refund(order.id);
                await api.pay.markManualRefundDone(order.id);
              })
            }
            className="btn min-h-[40px] flex-1 normal-case"
          >
            {busy ? "Saving" : "Mark as refunded"}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(async () => api?.pay.refund(order.id))} className="btn min-h-[40px] flex-1 normal-case">
            {busy ? "Refunding" : "Yes, refund"}
          </button>
        )}
      </div>
      <div className="mt-2">
        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}
