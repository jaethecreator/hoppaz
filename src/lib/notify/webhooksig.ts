import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks signatures (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), which is
 * what Supabase Auth uses to sign a hook call (https://supabase.com/docs/guides/auth/auth-hooks). Server only. Implemented here with
 * node:crypto so no library is added.
 *
 * Three headers: webhook-id, webhook-timestamp (whole seconds) and webhook-signature, a space separated list of "v1,<base64>". The
 * signature is HMAC-SHA256 over `${id}.${timestamp}.${raw body}`, keyed with the base64 decoded secret. Supabase hands out the secret as
 * "v1,whsec_<base64>"; the prefix is dropped and the rest is base64 (standard alphabet, so + / = can appear).
 * The spec names no tolerance for the timestamp; 5 minutes is what the libraries use.
 */

export const TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: "no_secret" | "missing_headers" | "bad_timestamp" | "stale" | "mismatch" };

/** The key bytes of a secret in Supabase's form, or null when there is none to use. */
export function secretKey(raw: string | undefined): Buffer | null {
  const text = (raw ?? "").trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const key = Buffer.from(text, "base64");
  return key.length ? key : null;
}

const sign = (key: Buffer, id: string, timestamp: string, body: string) => createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

/** Makes the three headers for a body. For the checks and for anyone testing the route by hand; the route itself only verifies. */
export function signWebhook(secret: string, id: string, timestampSeconds: number, body: string): Record<string, string> {
  const key = secretKey(secret);
  if (!key) throw new Error("not a usable secret");
  const timestamp = String(Math.floor(timestampSeconds));
  return { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${sign(key, id, timestamp, body).toString("base64")}` };
}

/**
 * Checks the signature of the raw body, exactly as received (never a re-serialised copy). With no usable secret everything is refused.
 * The comparison is constant time, and every signature in the header is compared (no early exit on the first match or miss).
 */
export function verifyWebhook(secret: string | undefined, headers: Pick<Headers, "get">, body: string, nowSeconds: number, toleranceSeconds = TOLERANCE_SECONDS): SignatureCheck {
  const key = secretKey(secret);
  if (!key) return { ok: false, reason: "no_secret" };
  const id = headers.get("webhook-id")?.trim() ?? "";
  const timestamp = headers.get("webhook-timestamp")?.trim() ?? "";
  const header = headers.get("webhook-signature")?.trim() ?? "";
  if (!id || !timestamp || !header) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  // Too old (a replay) or too far ahead (a wrong clock, or a forged one): both are refused.
  const stale = Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds;
  const expected = sign(key, id, timestamp, body);
  let match = false;
  for (const part of header.split(/\s+/)) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(part.slice(comma + 1), "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) match = true;
  }
  if (stale) return { ok: false, reason: "stale" };
  return match ? { ok: true } : { ok: false, reason: "mismatch" };
}
