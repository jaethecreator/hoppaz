import { createRefund, getAvailableNairaKobo } from "./api";
import { BachsError, type ClientDeps } from "./client";
import type { PayDb } from "./db";

/**
 * Start a refund (spec section 5, sequence D). Card: the database voids the tickets and makes the refund row, then Bachs is asked
 * (POST /v1/refunds with the host's X-Account-Id: the sandbox answers 404 "Charge not found" without it). Bank transfer: the docs
 * say Bachs cannot refund it (the sandbox accepted one, the live docs forbid it), so it becomes a manual task for the host.
 *
 * Hoppaz's fee and Bachs's fee are not returned, and the host is debited the FULL amount. A host whose only sale this is holds less
 * than the gross, and Bachs answers INSUFFICIENT_BALANCE. That is checked BEFORE the database voids anything, so a refund that cannot
 * be paid leaves the tickets alone. (A system refund of a late payment that hits this stays owed; the sweeper tries again.)
 */

export type StartRefundResult =
  | { ok: true; method: "card" | "manual"; status: "refund_pending" | "manual_needed"; orderId: string }
  | { ok: false; reason: string };

export async function startRefund(db: PayDb, input: { orderId: string; actor: string | null }, bachs: ClientDeps = {}, log: (line: string) => void = console.warn): Promise<StartRefundResult> {
  const order = await db.orderRow(input.orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (input.actor && !(await db.canRefund(input.orderId, input.actor))) return { ok: false, reason: "not_allowed" };

  if (order.payment_method === "card" && order.status === "paid" && order.bachs_charge_id) {
    try {
      const available = await getAvailableNairaKobo(order.host_account, bachs);
      if (available < order.gross_kobo) return { ok: false, reason: "insufficient_host_balance" };
    } catch (e) {
      // Not being able to read the balance must not block a refund: Bachs itself refuses an unpayable one.
      log(`[bachs] balance check skipped: ${(e as Error).message}`);
    }
  }

  const started = await db.refundStart(input.orderId, input.actor);
  if (!started.ok) return { ok: false, reason: String(started.reason ?? "refused") };
  if (started.method !== "card") return { ok: true, method: "manual", status: "manual_needed", orderId: input.orderId };

  const reference = String(started.reference);
  try {
    const refund = await createRefund(
      { chargeId: String(started.charge_id), reference, idempotencyKey: `refund:${reference}`, accountId: String(started.host_account), reason: "requested_by_customer" },
      bachs
    );
    await db.refundApply(refund.refund_id ?? refund.id ?? null, reference, refund.status === "paid" || refund.status === "success" ? "paid" : "processing");
    return { ok: true, method: "card", status: "refund_pending", orderId: input.orderId };
  } catch (e) {
    // Put the order back to "paid, refund owed" so a person (or the sweeper) can try again; the tickets stay void.
    await db.refundApply(null, reference, "failed");
    if (e instanceof BachsError && e.kind === "insufficient_balance") return { ok: false, reason: "insufficient_host_balance" };
    log(`[bachs] refund ${reference} failed: ${(e as Error).message}`);
    return { ok: false, reason: e instanceof BachsError && e.kind === "unavailable" ? "bachs_unavailable" : "bachs_refused" };
  }
}
