import { koboToNaira } from "@/lib/bachs/amounts";
import { createCheckout } from "@/lib/bachs/api";
import { BachsError, bachsConfig } from "@/lib/bachs/client";
import { computeFee } from "@/lib/bachs/fee";
import { fail, isResponse, json, limiter, returnOrigin, sameOrigin, sessionOf, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(8);

/** What the database's "no" means for the buyer. */
const REASONS: Record<string, [number, string]> = {
  no_session: [401, "Sign in to buy a ticket."],
  need_account: [401, "Make an account to buy a ticket."],
  bad_qty: [400, "Pick 1 to 5 tickets."],
  not_found: [404, "Event not found."],
  bad_ticket: [404, "Ticket not found."],
  not_paid_type: [400, "This ticket is free."],
  paid_off: [409, "Paid tickets are not open yet."],
  cancelled: [409, "This event was cancelled."],
  event_over: [409, "This event has closed."],
  not_ready: [409, "The host has not finished setting up payments."],
  order_open: [409, "You already have a payment open for this event."],
  declined: [409, "You can't buy a ticket for this event."],
  already_registered: [409, "You're already on the list for this event."],
  other_ticket_held: [409, "You already hold a different ticket for this event."],
  too_many: [409, "That is more tickets than one person can hold."],
  sold_out: [409, "Sold out."],
  answer_needed: [400, "Answer the host's questions first."],
  too_many_answers: [400, "Too many answers."],
  answer_too_long: [400, "An answer is too long."],
};

/**
 * POST { eventId, ticketTypeId, quantity, answers?, referrerId? } with a bearer session -> { order_id, checkout_url, expires_at }.
 * Reserves the seats (ev_pay_order_reserve), asks Bachs for a hosted checkout as the host's own account (direct charge: header
 * X-Account-Id, platform_fee = Hoppaz's cut inside the gross), saves it on the order, and returns the page to send the buyer to.
 * No ticket is issued here. If Bachs fails the seats are released. Errors are { error, reason, order_id? } (order_id on "order_open").
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  if (!bachsConfig()) return fail(503, "Payments are not set up yet.", { reason: "not_configured" });

  const body = (await req.json().catch(() => null)) as { eventId?: unknown; ticketTypeId?: unknown; quantity?: unknown; answers?: unknown; referrerId?: unknown } | null;
  const eventId = typeof body?.eventId === "string" && UUID.test(body.eventId) ? body.eventId : null;
  const typeId = typeof body?.ticketTypeId === "string" && UUID.test(body.ticketTypeId) ? body.ticketTypeId : null;
  const qty = Number(body?.quantity);
  if (!eventId || !typeId || !Number.isInteger(qty) || qty < 1 || qty > 5) return fail(400, "Pick a ticket and a number from 1 to 5.");
  const answers = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as Record<string, string>) : {};
  const referrer = typeof body?.referrerId === "string" && UUID.test(body.referrerId) ? body.referrerId : null;
  const { db } = session;

  const price = await db.ticketPrice(eventId, typeId);
  if (price === null) return fail(404, REASONS.bad_ticket[1], { reason: "bad_ticket" });
  if (price <= 0) return fail(400, REASONS.not_paid_type[1], { reason: "not_paid_type" });
  let fee: number;
  try {
    fee = computeFee(price * qty * 100);
  } catch (e) {
    console.error(`[bachs] fee not usable: ${(e as Error).message}`);
    return fail(503, "Payments are not set up yet.", { reason: "no_fee" });
  }

  const held = await db.orderReserve({ userId: session.userId, eventId, typeId, qty, feeKobo: fee, answers, referrer });
  if (!held.ok) {
    const [status, message] = REASONS[String(held.reason)] ?? [409, "You can't buy this ticket right now."];
    return fail(status, message, { reason: held.reason, ...(held.order_id ? { order_id: held.order_id } : {}), ...(held.spots_left !== undefined ? { spots_left: held.spots_left } : {}) });
  }
  const orderId = String(held.order_id);
  const release = (why: string) => db.orderRelease(orderId, why).catch((e) => console.error(`[bachs] release failed for ${orderId}: ${(e as Error).message}`));

  // The price may have changed between the read above and the reserve: the fee must match the gross the database took.
  const gross = Number(held.gross_kobo);
  if (computeFee(gross) !== Number(held.platform_fee_kobo)) {
    await release("price_changed");
    return fail(409, "The price just changed. Try again.", { reason: "price_changed" });
  }

  const origin = returnOrigin(req);
  try {
    const checkout = await createCheckout({
      accountId: String(held.host_account),
      reference: String(held.reference),
      idempotencyKey: `order:${orderId}:co1`,
      grossKobo: gross,
      platformFeeKobo: Number(held.platform_fee_kobo),
      customer: { email: String(held.buyer_email ?? ""), name: String(held.buyer_name ?? "") },
      successUrl: `${origin}/tickets/return?order=${orderId}`,
      cancelUrl: `${origin}/event/${eventId}`,
      metadata: { order_id: orderId, event_id: eventId, buyer_id: session.userId },
      expiresInMinutes: 15,
    });
    if (!checkout.checkout_url) throw new Error("Bachs gave no checkout_url");
    const attached = await db.orderAttach(orderId, checkout.checkout_id, checkout.checkout_url, checkout.expires_at ?? null);
    if (attached !== "ok") {
      console.error(`[bachs] could not attach checkout to order ${orderId}: ${attached}`);
      await release(`attach_${attached}`);
      return fail(500, "Could not start the payment. Try again.", { reason: "attach_failed" });
    }
    return json({ order_id: orderId, checkout_url: checkout.checkout_url, expires_at: checkout.expires_at ?? String(held.expires_at), platform_fee_naira: koboToNaira(fee) });
  } catch (e) {
    await release(e instanceof BachsError ? `bachs_${e.errorCode ?? e.kind}` : "checkout_failed");
    if (e instanceof BachsError) {
      if (e.kind === "host_not_ready") return fail(409, "The host has not finished setting up payments.", { reason: "not_ready" });
      if (e.kind === "unavailable" || e.kind === "rate_limited") return fail(503, "Payments are slow right now. Try again in a minute.", { reason: "bachs_unavailable" });
    }
    console.error(`[bachs] checkout failed for order ${orderId}: ${(e as Error).message}`);
    return fail(502, "Could not start the payment. Try again.", { reason: "bachs_failed" });
  }
}
