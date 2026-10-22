import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/bachs/http";
import { SIGNATURE_HEADER, verifySignature } from "@/lib/bachs/signature";
import { routeBachsEvent } from "@/lib/bachs/webhookRouter";
import type { BachsEvent } from "@/lib/bachs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one Bachs webhook (set the endpoint's event_source to "all" so connected hosts' events arrive). Spec section 4.
 *   1. The raw body is read as text and checked against X-Bachs-Signature-V2 with BACHS_WEBHOOK_SECRET: 400 if it does not match.
 *   2. The event id (evt_...) is stored; one already seen AND processed is answered 200 and ignored. One seen but never finished
 *      (we answered 5xx last time) is run again: every ev_pay_ function is safe to run twice.
 *   3. The event goes to the matching ev_pay_ function (webhookRouter.ts). 2xx only after that committed, 5xx if our own work failed
 *      so Bachs tries again (5 tries over about 80 minutes). Unknown event types are stored and answered 200.
 * Tickets are issued here (checkout.completed) or on the buyer's return (pay/confirm), whichever comes first, by the same function.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.BACHS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  const verdict = verifySignature({ header: req.headers.get(SIGNATURE_HEADER), rawBody: raw, secret });
  if (!verdict.ok) {
    console.warn(`[bachs] webhook refused: ${verdict.reason}`);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  let event: BachsEvent;
  try {
    event = JSON.parse(raw) as BachsEvent;
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string") return NextResponse.json({ error: "Bad event" }, { status: 400 });

  const db = serviceDb();
  if (!db) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  try {
    const fresh = await db.recordEvent({ id: event.id, type: event.type, account: event.account ?? null, createdAt: event.created_at ?? null, raw: event });
    if (!fresh && (await db.isProcessed(event.id))) return NextResponse.json({ ok: true, duplicate: true });
    const result = await routeBachsEvent(event, db);
    // An order we have never heard of is retried for a while (the buyer can beat our own bookkeeping by a moment), then let go.
    const old = event.created_at && Date.now() - Date.parse(event.created_at) > 3 * 3600_000;
    if (result.retry && !old) {
      console.warn(`[bachs] ${event.type} ${event.id}: ${result.action}, asking Bachs to retry`);
      return NextResponse.json({ ok: false, action: result.action }, { status: 500 });
    }
    await db.markProcessed(event.id);
    console.log(`[bachs] ${event.type} ${event.id}: ${result.action}`);
    return NextResponse.json({ ok: true, action: result.action });
  } catch (e) {
    console.error(`[bachs] ${event.type} ${event.id} failed: ${(e as Error).message}`);
    return NextResponse.json({ error: "Could not process" }, { status: 500 });
  }
}
