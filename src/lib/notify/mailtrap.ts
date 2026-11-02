import { missingContent, obj, postJson, senderFor, str, LIMIT_WORDS, type FetchLike } from "./mailcommon";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider";

/**
 * Mailtrap Email Sending API (https://docs.mailtrap.io/developers/email-sending/transactional/send-transactional-email.md): POST
 * https://send.api.mailtrap.io/api/send with the token as "Authorization: Bearer" (or "Api-Token"), and a normal User-Agent (the docs say
 * requests without one may be blocked at the edge). Body: { from {email, name}, to [{email}], reply_to, subject, text, html, category,
 * headers }. Success: 200 { success: true, message_ids: [...] }. Failure: 400, 401, 403 or 500 with { success: false, errors: [...] }.
 * Rate limit: 150 requests per 10 seconds per token, answered 429 (body not documented). The free plan allows 150 emails a day and 4,000
 * a month; mail over the limit is "rejected" (the docs name no status code), so a 429, or an error text that talks about a limit, is read
 * as "the allowance is used up".
 *
 * Mailtrap serves sign-in codes only (the free plan's 150 a day, notify_caps provider mailtrap kind code): guest mail goes to Brevo.
 *
 * Not in the docs, so matched on words and never seen for real: the text of the daily limit error and of a bad recipient. Checked against
 * the docs only; never sent. Idempotency: none documented, so dedupeKey is not sent.
 */
export const MAILTRAP_URL = "https://send.api.mailtrap.io/api/send";

type Env = Record<string, string | undefined>;

const USER_AGENT = "Hoppaz/1.0 (+https://hoppaz.fun)";

export function createMailtrapProvider(env: Env = process.env, fetcher: FetchLike = (url, init) => fetch(url, init)): EmailProvider {
  const key = env.MAILTRAP_API_KEY?.trim();
  if (!key) throw new Error("MAILTRAP_API_KEY is needed");
  return {
    name: "mailtrap",
    kinds: ["code"],
    async send(msg: OutgoingEmail): Promise<SendResult> {
      if (msg.capKind !== "code") return { ok: false, error: "mailtrap sends sign-in codes only" };
      const bad = missingContent(msg);
      if (bad) return bad;
      const { from, replyTo } = senderFor(msg, env);
      const body = {
        from: { email: from.email, ...(from.name ? { name: from.name } : {}) },
        to: [{ email: msg.to }],
        reply_to: { email: replyTo.email, ...(replyTo.name ? { name: replyTo.name } : {}) },
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        category: "sign-in",
        ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
      };
      const res = await postJson(fetcher, MAILTRAP_URL, { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT }, body, msg.timeoutMs);
      if ("error" in res) return { ok: false, error: `mailtrap: ${res.error}` };
      const j = obj(res.json);
      if (res.status === 200 && j.success === true) {
        // A 200 with success true is an accepted message; a missing id must not make the router send the same code again from another provider.
        const ids = Array.isArray(j.message_ids) ? j.message_ids : [];
        return { ok: true, messageId: str(ids[0]) || "unknown", costUsd: 0 };
      }
      const errors = (Array.isArray(j.errors) ? j.errors : []).map((e) => (typeof e === "string" ? e : str(obj(e).message) || JSON.stringify(e)));
      const message = errors.join("; ") || str(j.message) || str(j.error);
      const said = `mailtrap ${res.status}${message ? `: ${message}` : ""}`.slice(0, 280);
      if (res.status === 429 || (res.status !== 200 && LIMIT_WORDS.test(message) && !/invalid|malformed/i.test(message))) {
        return { ok: false, error: said, limit: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `${said} (key refused or sender not verified, check MAILTRAP_API_KEY and the auth.hoppaz.fun domain)` };
      }
      if (res.status === 400 && errors.some((e) => /recipient|\bto\b.*(invalid|valid)|invalid.*\bto\b/i.test(e))) {
        return { ok: false, error: said, retryable: false };
      }
      return { ok: false, error: said };
    },
  };
}
