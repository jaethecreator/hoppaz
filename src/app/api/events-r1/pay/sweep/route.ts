import { getCheckout } from "@/lib/bachs/api";
import { bachsConfig } from "@/lib/bachs/client";
import { stringToKobo } from "@/lib/bachs/amounts";
import { cronAllowed, fail, json, serviceDb } from "@/lib/bachs/http";
import { startRefund } from "@/lib/bachs/refunds";
import { methodOf } from "@/lib/bachs/webhookRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sweeper. POST (or GET, which is what Vercel Cron sends) with the shared secret: Authorization: Bearer <HOPPAZ_CRON_SECRET>
 * (or the existing CRON_SECRET), or the header x-hoppaz-cron-secret. Without it: 401.
 *   1. ev_pay_sweep expires open orders whose hold and 2 minute margin have run out and frees the seats.
 *   2. Each of those is checked with Bachs (GET /v1/checkout-sessions/{id} as the host). One that was paid after all goes through
 *      ev_pay_order_paid, which takes the late payment path (seats again if free, else a refund is owed).
 *   3. Card payments that are owed a refund with none under way (a late payment with no seat, or a refund Bachs refused earlier,
 *      for example a host balance that was too low) are tried again.
 * -> { ok, expired, paid_late, refunds_started }. Schedule it every few minutes (vercel.json is not edited by this package).
 */
async function run(req: Request) {
  if (!cronAllowed(req)) return fail(401, "Not allowed.");
  const db = serviceDb();
  if (!db) return fail(503, "Not configured.");
  const expired = await db.sweep();
  let paidLate = 0;
  if (bachsConfig()) {
    for (const o of expired) {
      if (!o.checkout_id) continue;
      try {
        const row = await db.orderRow(o.order_id);
        if (!row) continue;
        const c = await getCheckout(o.checkout_id, row.host_account);
        const paid = c.status === "completed" && ["paid", "succeeded"].includes(String(c.payment_status ?? ""));
        if (paid && c.reference === row.bachs_reference && c.amount && stringToKobo(c.amount) === row.gross_kobo) {
          await db.orderPaid({ ref: o.checkout_id, charge: c.charge?.payment_id ?? null, amount: c.amount, method: methodOf(c.charge?.payment_method), feeKobo: c.charge?.fees?.amount ? stringToKobo(c.charge.fees.amount) : null });
          paidLate++;
        }
      } catch (e) {
        console.warn(`[bachs] sweep: could not reconcile ${o.order_id}: ${(e as Error).message}`);
      }
    }
  }
  let refunds = 0;
  for (const o of await db.refundsOwedByCard(20)) {
    const out = await startRefund(db, { orderId: o.id, actor: null }).catch(() => null);
    if (out?.ok) refunds++;
  }
  return json({ ok: true, expired: expired.length, paid_late: paidLate, refunds_started: refunds });
}

export const POST = run;
export const GET = run;
