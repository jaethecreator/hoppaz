import { stringToKobo } from "./amounts";
import { getCheckout } from "./api";
import { BachsError, type ClientDeps } from "./client";
import type { OrderRow, PayDb } from "./db";
import { methodOf } from "./webhookRouter";

/**
 * Ask Bachs about one order's checkout and settle it (the buyer's return, spec section 9 sequence B). Never trusts the browser:
 * only Bachs's own answer counts. The session must be this order's (same id, same reference, NGN, exactly the gross), and only
 * status "completed" with a paid payment_status and a succeeded charge calls ev_pay_order_paid, the same idempotent function the
 * webhook calls. Sandbox finding: GET answers payment_status "succeeded" where the webhook says "paid", so both are accepted.
 *
 *   "paid"        tickets issued by this call (or already by the webhook, which changes nothing)
 *   "pending"     Bachs says not paid yet (or the session is not this order's): the page polls again
 *   "expired"     Bachs says expired; the order is expired (a late payment would still arrive later)
 *   "unreachable" Bachs did not answer: the webhook will still settle it
 */
export type Checked = "paid" | "pending" | "expired" | "unreachable";

const PAID = new Set(["paid", "succeeded"]);

export async function reconcileOrder(db: PayDb, row: OrderRow, bachs: ClientDeps = {}, log: (line: string) => void = console.error): Promise<Checked> {
  if (!row.bachs_checkout_id) return "pending";
  try {
    const c = await getCheckout(row.bachs_checkout_id, row.host_account, bachs);
    if (c.checkout_id !== row.bachs_checkout_id || c.reference !== row.bachs_reference || (c.currency && c.currency !== "NGN")) return "pending";
    if (!c.amount || stringToKobo(c.amount) !== row.gross_kobo) return "pending";
    if (c.status === "completed" && PAID.has(String(c.payment_status ?? "")) && (!c.charge?.status || c.charge.status === "succeeded")) {
      const fee = c.charge?.fees?.amount ? stringToKobo(c.charge.fees.amount) : null;
      await db.orderPaid({ ref: row.bachs_checkout_id, charge: c.charge?.payment_id ?? c.charge?.id ?? null, amount: c.amount, method: methodOf(c.charge?.payment_method ?? c.charge?.payment_method_details?.type), feeKobo: fee });
      return "paid";
    }
    if (c.status === "expired") {
      await db.orderExpire(row.bachs_checkout_id);
      return "expired";
    }
    return "pending";
  } catch (e) {
    if (!(e instanceof BachsError)) log(`[bachs] reconcile ${row.id}: ${(e as Error).message}`);
    return "unreachable";
  }
}
