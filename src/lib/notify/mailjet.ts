import { missingContent, obj, postJson, senderFor, str, LIMIT_WORDS, type FetchLike } from "./mailcommon";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider";

/**
 * Mailjet Send API v3.1 (https://dev.mailjet.com/email/guides/send-api-v31/): POST https://api.mailjet.com/v3.1/send with HTTP Basic auth,
 * the public API key as user and the private (secret) key as password. Body: { Messages: [{ From {Email, Name}, To [{Email}], ReplyTo,
 * Subject, TextPart, HTMLPart, TrackOpens, TrackClicks, Headers {...}, CustomID }] }. Success: 200 with Messages[0].Status "success" and
 * Messages[0].To[0] { Email, MessageUUID, MessageID, MessageHref }. A failed message has Status "error" and Errors[] { ErrorIdentifier,
 * ErrorCode, StatusCode, ErrorMessage, ErrorRelatedTo }, usually with HTTP 400. Over the per-minute rate: 429. A wrong key: 401. 403: not allowed.
 *
 * Mailjet serves guest mail and sign-in codes (the free plan: 200 a day, split 100 and 100 in notify_caps).
 *
 * Not in the docs I could read, so matched on words: the daily quota error and the bad-recipient error. Checked against the docs only;
 * never sent. Idempotency: none documented. dedupeKey is NOT sent. CustomID is the queue id, which Mailjet gives back in its webhooks,
 * so a later step can match a bounce to the row.
 */
export const MAILJET_URL = "https://api.mailjet.com/v3.1/send";

type Env = Record<string, string | undefined>;

export function createMailjetProvider(env: Env = process.env, fetcher: FetchLike = (url, init) => fetch(url, init)): EmailProvider {
  const pub = env.MAILJET_API_KEY?.trim();
  const secret = env.MAILJET_SECRET_KEY?.trim();
  if (!pub || !secret) throw new Error("MAILJET_API_KEY and MAILJET_SECRET_KEY are both needed");
  const auth = `Basic ${Buffer.from(`${pub}:${secret}`).toString("base64")}`;
  return {
    name: "mailjet",
    kinds: ["guest", "code"],
    async send(msg: OutgoingEmail): Promise<SendResult> {
      const bad = missingContent(msg);
      if (bad) return bad;
      const { from, replyTo } = senderFor(msg, env);
      const body = {
        Messages: [
          {
            From: { Email: from.email, ...(from.name ? { Name: from.name } : {}) },
            To: [{ Email: msg.to }],
            ReplyTo: { Email: replyTo.email, ...(replyTo.name ? { Name: replyTo.name } : {}) },
            Subject: msg.subject,
            TextPart: msg.text,
            HTMLPart: msg.html,
            // Off per message: the account default rewrites links through mjt.lu and adds an open pixel, and ticket and sign-in mail must not be tracked.
            TrackOpens: "disabled",
            TrackClicks: "disabled",
            ...(msg.headers && Object.keys(msg.headers).length ? { Headers: msg.headers } : {}),
            // A sign-in code sent from the hook has no queue row, so no CustomID.
            ...(msg.queueId ? { CustomID: msg.queueId } : {}),
          },
        ],
      };
      const res = await postJson(fetcher, MAILJET_URL, { Authorization: auth }, body, msg.timeoutMs);
      if ("error" in res) return { ok: false, error: `mailjet: ${res.error}` };
      const j = obj(res.json);
      const first = obj(Array.isArray(j.Messages) ? j.Messages[0] : null);
      const errors = (Array.isArray(first.Errors) ? first.Errors : Array.isArray(j.Errors) ? j.Errors : []).map(obj);
      if (res.status === 200 && str(first.Status).toLowerCase() === "success") {
        const to = obj(Array.isArray(first.To) ? first.To[0] : null);
        const id = str(to.MessageID) || str(to.MessageUUID);
        return id ? { ok: true, messageId: id, costUsd: 0 } : { ok: false, error: "mailjet: success but no MessageID" };
      }
      const e0 = errors[0] ?? {};
      const message = str(e0.ErrorMessage) || str(j.ErrorMessage) || str(j.Message);
      const code = str(e0.ErrorCode) || str(j.ErrorCode);
      const said = `mailjet ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`.slice(0, 280);
      if (res.status === 429 || (res.status !== 200 && LIMIT_WORDS.test(message) && !/invalid|malformed/i.test(message))) {
        return { ok: false, error: said, limit: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `${said} (key refused, check MAILJET_API_KEY, MAILJET_SECRET_KEY and the sender)`, limit: true };
      }
      const related = (x: Record<string, unknown>) => (Array.isArray(x.ErrorRelatedTo) ? x.ErrorRelatedTo.map(str).join(" ") : str(x.ErrorRelatedTo));
      const aboutRecipient = errors.some((x) => /^to\b|recipient/i.test(related(x)) || /invalid.*e-?mail|e-?mail.*invalid|not a valid e-?mail/i.test(str(x.ErrorMessage)));
      if (res.status === 400 && aboutRecipient) return { ok: false, error: said, retryable: false };
      return { ok: false, error: said };
    },
  };
}
