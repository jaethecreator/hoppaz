import { stringToKobo } from "./amounts";
import type { ClientDeps } from "./client";
import type { Json, PayDb } from "./db";
import { startRefund } from "./refunds";
import type { BachsEvent } from "./types";

/**
 * Sends one verified Bachs event to the matching ev_pay_ function. Pure routing: the signature check and the dedupe are done by the
 * route; everything that touches the database goes through `PayDb`, so scripts/bachs-check.mts runs this against a stub.
 *
 *   checkout.completed (paid)        ev_pay_order_paid       tickets issue here (or on the buyer's return, whichever is first)
 *   collection.succeeded             ev_pay_order_details    charge id, processing fee, method (never issues)
 *   checkout.expired                 ev_pay_order_expire     never overwrites a paid order
 *   refund.created / paid / failed   ev_pay_refund_apply
 *   dispute.created / updated        ev_pay_dispute_flag
 *   capability.updated               ev_pay_host_apply_capability
 *   account.updated                  ev_pay_host_apply_requirements
 *   collection.failed and the rest   logged, not acted on
 *
 * `retry: true` means answer 5xx so Bachs sends it again (an order that is not in our database yet: the buyer can pay a few
 * milliseconds before the checkout is attached).
 */

export type RouteResult = { action: string; retry?: boolean };

const PAID = new Set(["paid", "succeeded"]);

export const methodOf = (v: unknown): "card" | "bank_transfer" | null => {
  const s = String(v ?? "").toLowerCase();
  if (s === "card" || s === "ngn_card") return "card";
  if (s === "bank_transfer" || s === "ngn_bank_transfer") return "bank_transfer";
  return null;
};

const koboOrNull = (v: unknown): number | null => {
  try {
    return typeof v === "string" ? stringToKobo(v) : null;
  } catch {
    return null;
  }
};

export async function routeBachsEvent(event: BachsEvent, db: PayDb, bachs: ClientDeps = {}, log: (line: string) => void = console.warn): Promise<RouteResult> {
  const d: Json = event.data ?? {};
  const account = event.account ?? (typeof d.account === "string" ? d.account : null);

  switch (event.type) {
    case "checkout.completed": {
      if (!PAID.has(String(d.payment_status ?? ""))) return { action: "ignored_not_paid" };
      const checkoutId = typeof d.checkout_id === "string" ? d.checkout_id : null;
      const reference = typeof d.reference === "string" ? d.reference : null;
      const order = await db.orderByRef(checkoutId, reference);
      if (!order) return { action: "order_not_found", retry: true };
      // The event must come from the host account the order was sold for.
      if (account && account !== order.host_account) {
        log(`[bachs] ${event.id}: account ${account} is not the order's host, ignored`);
        return { action: "account_mismatch" };
      }
      const res = await db.orderPaid({
        ref: order.bachs_checkout_id ?? checkoutId ?? order.bachs_reference,
        charge: d.charge?.id ?? d.charge_id ?? null,
        amount: String(d.amount ?? ""),
        method: methodOf(d.payment_method_details?.type ?? d.charge?.payment_method_details?.type ?? d.payment_method),
        feeKobo: koboOrNull(d.processing_fee),
      });
      if (!res.ok) return { action: `paid_${res.reason ?? "refused"}`, retry: res.reason === "not_found" };
      if (res.needs_refund) await autoRefund(res, db, bachs, log);
      return { action: res.issued ? "tickets_issued" : res.needs_refund ? "late_payment_refund" : "already_paid_or_flagged" };
    }
    case "collection.succeeded": {
      const checkoutId = typeof d.checkout_id === "string" ? d.checkout_id : null;
      const reference = typeof d.reference === "string" ? d.reference : null;
      const order = await db.orderByRef(checkoutId, reference);
      if (!order) return { action: "order_not_found", retry: true };
      if (account && account !== order.host_account) return { action: "account_mismatch" };
      const res = await db.orderDetails({ charge: d.charge_id ?? null, checkout: order.bachs_checkout_id ?? checkoutId ?? order.bachs_reference, feeKobo: koboOrNull(d.processing_fee), method: methodOf(d.payment_method_details?.type) });
      // A payment that could not be seated while its method was unknown was held as a manual refund; now it says card, so Bachs can refund it.
      if (res.ok && res.refund_by_card) {
        await autoRefund(res, db, bachs, log);
        return { action: "details_saved_refund_card" };
      }
      return { action: res.ok ? "details_saved" : `details_${res.reason ?? "refused"}` };
    }
    case "checkout.expired": {
      if (typeof d.checkout_id !== "string") return { action: "ignored_no_checkout" };
      const res = await db.orderExpire(d.checkout_id);
      return { action: res.ok ? (res.changed ? "order_expired" : "expire_no_change") : `expire_${res.reason ?? "refused"}` };
    }
    case "refund.created":
    case "refund.paid":
    case "refund.failed": {
      const status = event.type === "refund.paid" ? "paid" : event.type === "refund.failed" ? "failed" : "processing";
      const res = await db.refundApply(typeof d.refund_id === "string" ? d.refund_id : null, String(d.reference ?? ""), status);
      return { action: res.ok ? `refund_${res.status}` : `refund_${res.reason ?? "refused"}` };
    }
    case "dispute.created":
    case "dispute.updated": {
      const res = await db.disputeFlag(String(d.charge_id ?? ""), String(d.dispute_id ?? ""), String(d.status ?? ""), typeof d.amount === "string" ? d.amount : null);
      return { action: res.ok ? "dispute_flagged" : `dispute_${res.reason ?? "refused"}` };
    }
    case "capability.updated": {
      const acct = typeof d.account === "string" ? d.account : account;
      if (!acct || typeof d.capability !== "string" || typeof d.status !== "string") return { action: "ignored_bad_capability" };
      const res = await db.hostApplyCapability(acct, d.capability, d.status, event.created_at ?? null);
      return { action: `capability_${res}` };
    }
    case "account.updated": {
      const acct = typeof d.account === "string" ? d.account : account;
      if (!acct || !Array.isArray(d.outstanding)) return { action: "ignored_bad_account" };
      const res = await db.hostApplyRequirements(acct, d.outstanding.filter((x: unknown): x is string => typeof x === "string"));
      return { action: `requirements_${res}` };
    }
    default:
      return { action: "ignored" };
  }
}

/** A payment that landed with no seat left: refund a card payment at once. A bank transfer stays flagged for the host to pay back by hand. */
async function autoRefund(res: Json, db: PayDb, bachs: ClientDeps, log: (line: string) => void) {
  try {
    const order = await db.orderRow(String(res.order_id));
    if (!order || order.payment_method !== "card" || order.needs_manual_refund) return;
    const out = await startRefund(db, { orderId: order.id, actor: null }, bachs, log);
    if (!out.ok) log(`[bachs] late payment on order ${order.id} stays owed: ${out.reason}`);
  } catch (e) {
    // The order is already marked as owing a refund; the sweeper tries again.
    log(`[bachs] automatic refund failed: ${(e as Error).message}`);
  }
}
