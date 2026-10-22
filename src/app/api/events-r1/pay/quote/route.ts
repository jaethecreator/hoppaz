import { koboToNaira } from "@/lib/bachs/amounts";
import { computeFee } from "@/lib/bachs/fee";
import { fail, json, limiter, sameOrigin, serviceDb, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(60);

/**
 * POST { eventId, ticketTypeId, quantity } -> Quote { gross_naira, platform_fee_naira, quantity, unit_price_naira }.
 * What the buyer will pay: price times quantity. Hoppaz's fee is INSIDE that price (the buyer sees one number); the fee is shown
 * for the host's screens. No sign-in needed (prices are public); nothing is reserved.
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
  const db = serviceDb();
  if (!db) return fail(503, "Payments are not set up yet.");
  const price = await db.ticketPrice(eventId, typeId);
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
