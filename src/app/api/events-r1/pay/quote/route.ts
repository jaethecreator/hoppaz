import { koboToNaira } from "@/lib/bachs/amounts";
import { computeFee } from "@/lib/bachs/fee";
import { fail, json, limiter, sameOrigin, viewerClient, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(60);

/**
 * POST { eventId, ticketTypeId, quantity } -> Quote { gross_naira, platform_fee_naira, quantity, unit_price_naira }.
 * What the buyer will pay: price times quantity. Hoppaz's fee is INSIDE that price (the buyer sees one number); the fee is shown
 * for the host's screens. No sign-in needed for a public event; nothing is reserved. The price is read through ev_get_event AS THE
 * CALLER (their bearer token if they sent one), so the visibility rule is the event page's: a community or invite only event's
 * price goes only to people who can open it, and anyone else gets "Ticket not found" (the same answer as a ticket that does not exist).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const body = (await req.json().catch(() => null)) as { eventId?: unknown; ticketTypeId?: unknown; quantity?: unknown } | null;
  const eventId = typeof body?.eventId === "string" && UUID.test(body.eventId) ? body.eventId : null;
  const typeId = typeof body?.ticketTypeId === "string" && UUID.test(body.ticketTypeId) ? body.ticketTypeId : null;
  const qty = Number(body?.quantity);
  if (!eventId || !typeId || !Number.isInteger(qty) || qty < 1 || qty > 5) return fail(400, "Pick a ticket and a number from 1 to 5.");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (slowDown(ip)) return fail(429, "Give it a moment, then try again.");
  const sb = viewerClient(req);
  if (!sb) return fail(503, "Payments are not set up yet.");
  const { data: event, error } = await sb.rpc("ev_get_event", { p_id_or_slug: eventId });
  if (error) return fail(503, "Payments are not set up yet.");
  const types = (event as { ticket_types?: { id: string; price_naira: number }[] } | null)?.ticket_types;
  const price = types?.find((t) => t.id === typeId)?.price_naira ?? null;
  if (price === null) return fail(404, "Ticket not found.");
  if (price <= 0) return fail(400, "This ticket is free.");
  let fee: number;
  try {
    fee = computeFee(price * qty * 100);
  } catch {
    return fail(503, "Payments are not set up yet.");
  }
  return json({ gross_naira: price * qty, platform_fee_naira: koboToNaira(fee), quantity: qty, unit_price_naira: price });
}
