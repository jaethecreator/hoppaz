import type { ClientDeps } from "./client";
import type { PayDb } from "./db";
import { verifySignature } from "./signature";
import type { BachsEvent } from "./types";
import { routeBachsEvent } from "./webhookRouter";

/**
 * Everything the webhook route does after it has the raw body, as a plain function so the checks can run it with a stub database
 * and an injected clock: verify the signature, dedupe on the event id, route, answer. See api/bachs/webhook/route.ts for the rules.
 * Returns the HTTP status and body to answer with.
 */

export type WebhookInput = {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | undefined;
  db: PayDb | null;
  /** Unix seconds; defaults to the real clock. */
  now?: number;
  bachs?: ClientDeps;
  log?: (line: string) => void;
};

export async function handleWebhook(i: WebhookInput): Promise<{ status: number; body: Record<string, unknown> }> {
  const log = i.log ?? console.log;
  if (!i.secret) return { status: 503, body: { error: "Webhook is not configured" } };
  const verdict = verifySignature({ header: i.signatureHeader, rawBody: i.rawBody, secret: i.secret, now: i.now });
  if (!verdict.ok) {
    log(`[bachs] webhook refused: ${verdict.reason}`);
    return { status: 400, body: { error: "Bad signature" } };
  }
  let event: BachsEvent;
  try {
    event = JSON.parse(i.rawBody) as BachsEvent;
  } catch {
    return { status: 400, body: { error: "Bad body" } };
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string") return { status: 400, body: { error: "Bad event" } };
  if (!i.db) return { status: 503, body: { error: "Not configured" } };
  const db = i.db;
  try {
    const fresh = await db.recordEvent({ id: event.id, type: event.type, account: event.account ?? null, createdAt: event.created_at ?? null, raw: event });
    if (!fresh && (await db.isProcessed(event.id))) return { status: 200, body: { ok: true, duplicate: true } };
    const result = await routeBachsEvent(event, db, i.bachs, log);
    // An order we have never heard of is retried for a while (the buyer can beat our own bookkeeping by a moment), then let go.
    const old = !!event.created_at && (i.now ?? Date.now() / 1000) - Date.parse(event.created_at) / 1000 > 3 * 3600;
    if (result.retry && !old) {
      log(`[bachs] ${event.type} ${event.id}: ${result.action}, asking Bachs to retry`);
      return { status: 500, body: { ok: false, action: result.action } };
    }
    await db.markProcessed(event.id);
    log(`[bachs] ${event.type} ${event.id}: ${result.action}`);
    return { status: 200, body: { ok: true, action: result.action } };
  } catch (e) {
    log(`[bachs] ${event.type} ${event.id} failed: ${(e as Error).message}`);
    return { status: 500, body: { error: "Could not process" } };
  }
}
