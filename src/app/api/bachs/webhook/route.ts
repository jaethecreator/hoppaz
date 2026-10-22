import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/bachs/http";
import { SIGNATURE_HEADER } from "@/lib/bachs/signature";
import { handleWebhook } from "@/lib/bachs/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one Bachs webhook (set the endpoint's event_source to "all" so connected hosts' events arrive). Spec section 4.
 *   1. The raw body is read as text and checked against X-Bachs-Signature-V2 with BACHS_WEBHOOK_SECRET: 400 if it does not match.
 *   2. The event id (evt_...) is stored; one already seen AND processed is answered 200 and ignored. One seen but never finished
 *      (we answered 5xx last time) is run again: every ev_pay_ function is safe to run twice.
 *   3. The event goes to the matching ev_pay_ function (lib/bachs/webhookRouter.ts). 2xx only after that committed, 5xx if our own
 *      work failed so Bachs tries again (5 tries over about 80 minutes). Unknown event types are stored and answered 200.
 * Tickets are issued here (checkout.completed) or on the buyer's return (pay/confirm), whichever comes first, by the same function.
 * The logic lives in lib/bachs/webhook.ts so scripts/bachs-check.mts can run it.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const out = await handleWebhook({ rawBody, signatureHeader: req.headers.get(SIGNATURE_HEADER), secret: process.env.BACHS_WEBHOOK_SECRET, db: serviceDb() });
  return NextResponse.json(out.body, { status: out.status });
}
