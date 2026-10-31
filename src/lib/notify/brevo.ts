import { missingContent, obj, postJson, senderFor, str, LIMIT_WORDS, type FetchLike } from "./mailcommon";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider";

/**
 * Brevo (https://developers.brevo.com/reference/sendtransacemail): POST https://api.brevo.com/v3/smtp/email with the header api-key.
 * Body: sender {email, name}, to [{email}], subject, htmlContent, textContent, replyTo {email}, headers {...}, tags [...].
 * Success: 201 with { messageId }. Errors: { code, message } with 400 for a bad request. Over the rate: 429.
 *
 * Brevo serves guest mail only (the free plan: 300 a day, with the "Sent with Brevo" footer).
 *
 * What the docs do NOT say, so is handled by words and not by trusting a code: which status a used-up daily allowance comes back with
 * (the error code list has not_enough_credits / "Insufficient credits"), and how a bad recipient is reported (invalid_parameter). Both are
 * matched on the code and on the message. Treat this file's request shape as checked against the docs only; it has never been sent.
 *
 * Idempotency: the docs have no idempotency key for this endpoint (an "IdempotencyKey" in one example is just a sample custom header),
 * so dedupeKey is NOT sent. Our own queue (unique dedupe_key, and one claim per row) is what prevents a double send. The queue id goes in
 * the X-Hoppaz-Queue header and the kind in tags, so a later webhook step can find the row again.
 */
export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

type Env = Record<string, string | undefined>;

export function createBrevoProvider(env: Env = process.env, fetcher: FetchLike = (url, init) => fetch(url, init)): EmailProvider {
  const key = env.BREVO_API_KEY?.trim();
  if (!key) throw new Error("BREVO_API_KEY is not set");
  return {
    name: "brevo",
    kinds: ["guest"],
    async send(msg: OutgoingEmail): Promise<SendResult> {
      const bad = missingContent(msg);
      if (bad) return bad;
      const { from, replyTo } = senderFor(msg, env);
      const body = {
        sender: from,
        to: [{ email: msg.to }],
        replyTo,
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        headers: { ...(msg.headers ?? {}), "X-Hoppaz-Queue": msg.queueId },
        tags: [msg.kind],
      };
      const res = await postJson(fetcher, BREVO_URL, { "api-key": key }, body);
      if ("error" in res) return { ok: false, error: `brevo: ${res.error}` };
      const j = obj(res.json);
      if (res.status === 201 || res.status === 200 || res.status === 202) {
        const id = str(j.messageId) || str(Array.isArray(j.messageIds) ? j.messageIds[0] : "");
        return id ? { ok: true, messageId: id, costUsd: 0 } : { ok: false, error: `brevo: accepted (${res.status}) but gave no messageId` };
      }
      const code = str(j.code);
      const message = str(j.message);
      const said = `brevo ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`.slice(0, 280);
      if (res.status === 429 || code === "not_enough_credits" || (res.status === 400 && LIMIT_WORDS.test(`${code} ${message}`) && !/invalid_parameter|missing_parameter/.test(code))) {
        return { ok: false, error: said, limit: true };
      }
      // A key that is wrong or not allowed fails every message the same way: leave Brevo alone for the rest of the run.
      if (res.status === 401 || res.status === 403 || code === "unauthorized" || code === "permission_denied") {
        return { ok: false, error: `${said} (key refused, check BREVO_API_KEY and the sender)`, limit: true };
      }
      if (res.status === 400 && code === "invalid_parameter" && /e-?mail|recipient|address/i.test(message) && /invalid|not valid|malformed/i.test(message)) {
        return { ok: false, error: said, retryable: false };
      }
      return { ok: false, error: said };
    },
  };
}
