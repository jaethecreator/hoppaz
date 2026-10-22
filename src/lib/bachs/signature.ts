import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Bachs webhook. Header X-Bachs-Signature-V2 is `t=<unix seconds>,v1=<hex>[,v1=<hex>]`; the message is
 * `${t}.${rawBody}` (the raw bytes as text, before any JSON parse), HMAC-SHA256 with the endpoint signing secret, hex.
 * Several v1 values appear while a secret is being rotated: any one that matches is enough. Constant time compare.
 * A timestamp more than 300 s from now (either way) is rejected. The clock is injectable so tests are exact.
 */

export const SIGNATURE_HEADER = "x-bachs-signature-v2";
export const TOLERANCE_SECONDS = 300;

export type ParsedSignature = { t: number | null; v1: string[] };

export function parseSignatureHeader(header: string | null | undefined): ParsedSignature {
  const out: ParsedSignature = { t: null, v1: [] };
  if (!header) return out;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) out.t = Number(value);
    else if (key === "v1" && /^[0-9a-fA-F]{64}$/.test(value)) out.v1.push(value.toLowerCase());
  }
  return out;
}

export function computeSignature(secret: string, t: number | string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
}

/** The header a sender would build (the mock server and the tests use this). */
export function signatureHeader(secret: string, rawBody: string, t: number, extraV1: string[] = []): string {
  return [`t=${t}`, `v1=${computeSignature(secret, t, rawBody)}`, ...extraV1.map((v) => `v1=${v}`)].join(",");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" | "no_secret" };

export function verifySignature(opts: {
  header: string | null | undefined;
  rawBody: string;
  secret: string | undefined;
  /** Unix seconds. Defaults to the real clock. */
  now?: number;
  toleranceSeconds?: number;
}): VerifyResult {
  if (!opts.secret) return { ok: false, reason: "no_secret" };
  if (!opts.header) return { ok: false, reason: "missing" };
  const { t, v1 } = parseSignatureHeader(opts.header);
  if (t === null || v1.length === 0) return { ok: false, reason: "malformed" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? TOLERANCE_SECONDS)) return { ok: false, reason: "stale" };
  const expected = Buffer.from(computeSignature(opts.secret, t, opts.rawBody), "hex");
  // Compare against every value, no early exit, so timing does not tell which one was close.
  let matched = false;
  for (const candidate of v1) {
    const got = Buffer.from(candidate, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: "mismatch" };
}
