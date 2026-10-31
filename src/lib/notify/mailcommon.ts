import type { OutgoingEmail, SendResult } from "./provider";

/** Bits the real providers (brevo.ts, mailjet.ts) share. Server only. */

type Env = Record<string, string | undefined>;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

export const DEFAULT_FROM_GUEST = "Hoppaz <tickets@mail.hoppaz.fun>";
/** Sign-in codes come from auth.hoppaz.fun (docs/reminders-email-plan.md, 31 Oct). No code mail is queued yet; this is for the step that does. */
export const DEFAULT_FROM_CODE = "Hoppaz <login@auth.hoppaz.fun>";
export const DEFAULT_REPLY_TO = "hello@hoppaz.fun";

export type Address = { email: string; name?: string };

/** "Hoppaz <tickets@mail.hoppaz.fun>" or a bare address. Throws on anything else, so a typo in an env var shows at once. */
export function parseAddress(raw: string): Address {
  const text = raw.trim();
  const m = /^(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>$/.exec(text);
  if (m) return m[1] && m[1].trim() ? { name: m[1].trim(), email: m[2] } : { email: m[2] };
  if (/^[^<>\s]+@[^<>\s]+$/.test(text)) return { email: text };
  throw new Error(`not an email address: ${text.slice(0, 60)}`);
}

export type Sender = { from: Address; replyTo: Address };

export function senderFor(msg: OutgoingEmail, env: Env): Sender {
  const code = msg.capKind === "code";
  return {
    from: parseAddress((code ? env.NOTIFY_FROM_CODE : env.NOTIFY_FROM_GUEST)?.trim() || (code ? DEFAULT_FROM_CODE : DEFAULT_FROM_GUEST)),
    replyTo: parseAddress(env.NOTIFY_REPLY_TO?.trim() || DEFAULT_REPLY_TO),
  };
}

/** A message with nothing to show is a bug in the caller. It is refused here and never retried. */
export function missingContent(msg: OutgoingEmail): SendResult | null {
  if (!msg.subject?.trim() || !msg.html?.trim() || !msg.text?.trim()) {
    return { ok: false, error: "nothing rendered to send (subject, html and text are all needed)", retryable: false };
  }
  return null;
}

const TIMEOUT_MS = 15_000;

/** One POST with a timeout. A network failure or a timeout is an ordinary retryable error. */
export async function postJson(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: unknown } | { error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    return { error: ctl.signal.aborted ? "timed out" : `network error: ${(e as Error).message}`.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** The words that say a provider's own allowance is used up. */
export const LIMIT_WORDS = /daily|per day|limit|quota|credit|exceed|too many/i;
