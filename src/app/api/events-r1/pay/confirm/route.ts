import { bachsConfig } from "@/lib/bachs/client";
import { reconcileOrder } from "@/lib/bachs/confirm";
import { fail, isResponse, json, limiter, sameOrigin, sessionOf, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(30);

/**
 * POST { order_id } with a bearer session: the buyer's return from the Bachs page. -> { order: Order, checked }.
 * Never trusts the browser. The server asks Bachs itself (GET /v1/checkout-sessions/{id} as the host account) and only when Bachs
 * says the session is completed and paid, for this order's reference and exactly its gross, calls ev_pay_order_paid: the same
 * idempotent function the webhook calls, so whichever arrives first issues the tickets and the other changes nothing.
 * `checked`: "paid" (tickets are issued), "pending" (Bachs says not paid yet: poll again), "expired", "already" (the order was
 * settled before we asked), "unreachable" (Bachs did not answer: the webhook will still settle it).
 * The Order is the same object the app reads with ev_pay_my_order (checkout_url only while the order is open).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
  const orderId = typeof body?.order_id === "string" && UUID.test(body.order_id) ? body.order_id : null;
  if (!orderId) return fail(400, "Order not found.");

  const { db } = session;
  const row = await db.orderRow(orderId);
  if (!row || row.buyer_id !== session.userId) return fail(404, "Order not found.");

  let checked: "paid" | "pending" | "expired" | "already" | "unreachable" = "already";
  if (["open", "expired", "failed"].includes(row.status) && row.bachs_checkout_id && bachsConfig()) {
    checked = await reconcileOrder(db, row);
  }
  const { data: order } = await session.userClient.rpc("ev_pay_my_order", { p_order: orderId });
  return json({ order: order ?? null, checked });
}
