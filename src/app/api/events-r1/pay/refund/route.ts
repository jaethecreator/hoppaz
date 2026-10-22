import { startRefund } from "@/lib/bachs/refunds";
import { fail, isResponse, json, limiter, sameOrigin, sessionOf, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(10);

const REASONS: Record<string, [number, string]> = {
  not_found: [404, "Order not found."],
  not_allowed: [403, "Only the host or Hoppaz staff can refund this order."],
  already_refunding: [409, "A refund is already on its way."],
  already_refunded: [409, "This order was already refunded."],
  not_paid: [409, "Only a paid order can be refunded."],
  tickets_used: [409, "These tickets were already used at the door."],
  method_unknown: [409, "We do not know how this was paid yet. Try again in a minute."],
  no_charge: [409, "The payment is still settling. Try again in a minute."],
  insufficient_host_balance: [409, "The host's Bachs balance is lower than the ticket price, so Bachs cannot send this refund yet. Hoppaz's fee is not returned, so add funds to the Bachs balance and try again."],
  bachs_unavailable: [503, "Bachs is not answering. Try again in a minute."],
  bachs_refused: [502, "Bachs could not start the refund. The tickets stay void; try again or refund by hand."],
};

/**
 * POST { order_id } with a bearer session (the event's host or Hoppaz staff) -> RefundResult { method, status }.
 *   card:           the tickets are voided, Bachs is asked (POST /v1/refunds as the host account), status "refund_pending"; the order
 *                   becomes "refunded" when the refund.paid webhook arrives. { method: "card", status: "refund_pending" }
 *   bank transfer:  Bachs does not refund these: { method: "manual", status: "manual_needed" }. The host pays the buyer by hand and then
 *                   calls the database's ev_pay_mark_manual_refund (PayApi.markManualRefundDone).
 * Whether the person may do this is decided by the database (ev_pay_refund_start). Errors: { error, reason }.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
  const orderId = typeof body?.order_id === "string" && UUID.test(body.order_id) ? body.order_id : null;
  if (!orderId) return fail(400, "Order not found.");

  const out = await startRefund(session.db, { orderId, actor: session.userId });
  if (!out.ok) {
    const [status, message] = REASONS[out.reason] ?? [409, "This order can't be refunded right now."];
    return fail(status, message, { reason: out.reason });
  }
  return json({ method: out.method, status: out.status });
}
