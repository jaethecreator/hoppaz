import { createRefund, getAvailableNairaKobo, getRefund } from "./api";
import { BachsError, type ClientDeps } from "./client";
import type { PayDb, PendingRefund } from "./db";

/**
 * Start a refund (spec section 5, sequence D). Card: the database voids the tickets and makes the refund row, then Bachs is asked
 * (POST /v1/refunds with the host's X-Account-Id: the sandbox answers 404 "Charge not found" without it). Bank transfer: the docs
 * say Bachs cannot refund it (the sandbox accepted one, the live docs forbid it), so it becomes a manual task for the host.
 *
 * Hoppaz's fee and Bachs's fee are not returned, and the host is debited the FULL amount. A host whose only sale this is holds less
 * than the gross, and Bachs answers INSUFFICIENT_BALANCE. That is checked BEFORE the database voids anything, so a refund that cannot
 * be paid leaves the tickets alone. (A system refund of a late payment that hits this stays owed; the sweeper tries again.)
 *
 * THREE OUTCOMES of the call to Bachs, and only the first undoes anything:
 *   - a DEFINITE refusal (Bachs answered 400/404 with a reason, for example INSUFFICIENT_BALANCE): nothing was refunded. The order goes
 *     back to paid with the refund owed and the tickets come back (refund_apply "failed").
 *   - it worked: refund_apply with Bachs's status (processing or paid).
 *   - UNKNOWN (a timeout, a 5xx, no answer, or any error that is not Bachs's own answer): Bachs may well have accepted it. Nothing is
 *     undone: the order stays refund_pending with its tickets void, the try is recorded (refund_attempt), and the sweeper settles it
 *     with reconcileRefund. The buyer must never be refunded AND hold valid tickets, and the host must never be debited twice.
 *
 * RECONCILING an unknown outcome. Bachs documents no list-by-reference for refunds, so: when the refund id is known (refund.created
 * carried it) the sweeper asks GET /v1/refunds/{id}; otherwise it sends the SAME reference with the SAME idempotency key again
 * (`refund:<reference>`), which Bachs answers with the original refund and never a second one. A NEW reference is only ever made by the
 * database, and only after a definite failure (ev_pay_refund_start refuses while a refund is pending).
 */

export type StartRefundResult =
  | { ok: true; method: "card" | "manual"; status: "refund_pending" | "manual_needed"; orderId: string; /** Bachs did not answer yet: the refund is pending and will be settled automatically. */ unconfirmed?: boolean }
  | { ok: false; reason: string };

/** Bachs's status words (paid, success, succeeded, failed, processing) as the database knows them. */
const settledStatus = (s: unknown): "paid" | "failed" | "processing" => {
  const v = String(s ?? "").toLowerCase();
  return v === "paid" || v === "success" || v === "succeeded" ? "paid" : v === "failed" ? "failed" : "processing";
};

/**
 * Did Bachs itself say no? Only then is it safe to undo the refund. On a RETRY of an unknown outcome only INSUFFICIENT_BALANCE counts:
 * any other refusal ("charge already refunded", "reference already used") may mean the first try went through after all.
 */
function definiteRefusal(e: unknown, retry: boolean): boolean {
  if (!(e instanceof BachsError)) return false;
  if (e.kind === "insufficient_balance") return true;
  if (retry) return false;
  return e.kind === "invalid" || e.kind === "not_found" || e.kind === "auth" || e.kind === "guard";
}

type Sent = { kind: "sent" } | { kind: "refused"; reason: string } | { kind: "unknown" };

/** POST the refund with its fixed reference and idempotency key, and tell the database what came of it. Used for the first try and every retry. */
async function sendRefund(db: PayDb, r: { reference: string; chargeId: string; hostAccount: string }, retry: boolean, bachs: ClientDeps, log: (line: string) => void): Promise<Sent> {
  try {
    const refund = await createRefund(
      { chargeId: r.chargeId, reference: r.reference, idempotencyKey: `refund:${r.reference}`, accountId: r.hostAccount, reason: "requested_by_customer" },
      bachs
    );
    await db.refundApply(refund.refund_id ?? refund.id ?? null, r.reference, settledStatus(refund.status));
    return { kind: "sent" };
  } catch (e) {
    if (definiteRefusal(e, retry)) {
      // Bachs said no: put the order back to "paid, refund owed" and the tickets back (if their seats are free).
      await db.refundApply(null, r.reference, "failed");
      log(`[bachs] refund ${r.reference} refused: ${(e as Error).message}`);
      return { kind: "refused", reason: e instanceof BachsError && e.kind === "insufficient_balance" ? "insufficient_host_balance" : "bachs_refused" };
    }
    log(`[bachs] refund ${r.reference} outcome unknown, left pending: ${(e as Error).message}`);
    await db.refundAttempt(r.reference, (e as Error).message).catch((err) => log(`[bachs] could not record the attempt for ${r.reference}: ${(err as Error).message}`));
    return { kind: "unknown" };
  }
}

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

  const sent = await sendRefund(db, { reference: String(started.reference), chargeId: String(started.charge_id), hostAccount: String(started.host_account) }, false, bachs, log);
  if (sent.kind === "refused") return { ok: false, reason: sent.reason };
  return { ok: true, method: "card", status: "refund_pending", orderId: input.orderId, ...(sent.kind === "unknown" ? { unconfirmed: true } : {}) };
}

export type Reconciled = "paid" | "failed" | "processing" | "unknown";

/**
 * Settle one refund whose outcome nobody has heard (the sweeper calls this). By id when Bachs gave us one, otherwise by sending the
 * same reference with the same idempotency key again. A try that still gets no answer is recorded; ten of them flag the order.
 */
export async function reconcileRefund(db: PayDb, p: PendingRefund, bachs: ClientDeps = {}, log: (line: string) => void = console.warn): Promise<Reconciled> {
  if (p.bachsRefundId) {
    try {
      const refund = await getRefund(p.bachsRefundId, p.hostAccount, bachs);
      const status = settledStatus(refund.status);
      await db.refundApply(p.bachsRefundId, p.reference, status);
      return status;
    } catch (e) {
      log(`[bachs] could not read refund ${p.bachsRefundId}: ${(e as Error).message}`);
      await db.refundAttempt(p.reference, (e as Error).message).catch(() => undefined);
      return "unknown";
    }
  }
  if (!p.chargeId) {
    await db.refundAttempt(p.reference, "no charge id to send").catch(() => undefined);
    return "unknown";
  }
  const sent = await sendRefund(db, { reference: p.reference, chargeId: p.chargeId, hostAccount: p.hostAccount }, true, bachs, log);
  if (sent.kind === "refused") return "failed";
  return sent.kind === "sent" ? "processing" : "unknown";
}
