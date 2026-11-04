import { randomUUID } from "node:crypto";
import { obj, postJson, str, type FetchLike } from "./mailcommon";

/**
 * The WhatsApp sender: template messages (the reminders) and free-form replies (the bot) through Meta's Cloud API. Server only.
 *
 * META'S API (checked on developers.facebook.com on 31 Oct 2026; nothing here has ever called Meta):
 *   POST https://graph.facebook.com/v26.0/{phone-number-id}/messages with "Authorization: Bearer <token>" and a JSON body. v26.0 is the version
 *   the current docs use in their examples (messages/send-messages). Success: 200 { messaging_product, contacts: [...], messages: [{ id }] };
 *   the id is the wamid that the status webhooks (delivered, read, failed) quote. 200 means accepted, not delivered.
 *   A template: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name, language: { code },
 *   components: [{ type: "body", parameters: [{ type: "text", text }] }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text }] }] } }.
 *   A URL button's parameter is the part after the template's fixed address and must be percent-encoded (templates/components).
 *   A free-form reply: { ..., type: "text", text: { preview_url, body } }, allowed only inside the 24 hour window a guest's message opens.
 *   An error: HTTP 4xx or 5xx with { error: { message, type, code, error_subcode, error_data: { details }, fbtrace_id } } (Graph API error handling).
 *   The Cloud API has no idempotency key: a request that timed out may still have gone out, so a timeout is retried and can, rarely, send twice.
 * ERROR CODES are sorted in classifyWaError below from support/error-codes and graph-api/guides/error-handling.
 */

type Env = Record<string, string | undefined>;

export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = "https://graph.facebook.com";

/** Short on purpose: a run has 40 seconds for up to 500 rows, and Meta answers in well under a second when it is well. */
export const WA_TIMEOUT_MS = 8_000;

export type WaTemplateMessage = {
  /** International form, "+2348012345678" (the plus is dropped on the wire). */
  to: string;
  template: string;
  /** The values of {{1}}, {{2}}, ... of the body, already made safe by watemplates.ts. */
  bodyParams: string[];
  /** The text that follows the View ticket button's fixed address, not yet percent-encoded. null: the template has no button value. */
  buttonSuffix?: string | null;
};

export type WaSendResult =
  | { ok: true; messageId: string; costUsd: number }
  | {
      ok: false;
      error: string;
      /** false: this message can never go (not on WhatsApp, a bad number, a template rejected or paused). Failed, no retry. */
      retryable?: boolean;
      /** Meta says we are going too fast: try again later and do not count it as a try. */
      rateLimited?: boolean;
      /** Stop sending for the rest of this run: the token or the account is the problem, not this message. */
      pause?: boolean;
    };

export interface WhatsAppSender {
  /** The name written to notify_sends. "whatsapp" is the real one; the budget counts only that name. */
  readonly name: string;
  sendTemplate(msg: WaTemplateMessage): Promise<WaSendResult>;
  /** A free-form reply. Only ever called to answer a message the guest just sent. */
  sendText(to: string, body: string): Promise<WaSendResult>;
}

/** +2348012345678 -> +234*******78. Every log line about a guest uses this; nothing prints a whole number. */
export function maskNumber(n: string | null | undefined): string {
  const t = (n ?? "").trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `+${digits.slice(0, 3)}${"*".repeat(digits.length - 5)}${digits.slice(-2)}`;
}

const wireNumber = (n: string) => n.replace(/\D/g, "");

// ------------------------------------------------------------------ errors ---
export type WaErrorClass = "permanent" | "rate" | "pause" | "retry";

/** Sorted from the docs: support/error-codes and graph-api/guides/error-handling. Anything not named here is "retry". */
const PERMANENT = new Set([
  131026, // undeliverable: not a WhatsApp number, terms not accepted, outdated client
  131030, // recipient not in the allowed list (a test number's limit). Not on the current error page; kept from Meta's earlier list.
  131021, // sender and recipient are the same number
  131050, // the recipient opted out of this kind of message
  130403, // the business blocked the user: "do not retry"
  131051, // unsupported message type
  131008, // a required parameter is missing: the same request fails the same way
  100, // invalid parameter (a number that is not a number, among others): the same request fails the same way
  132000, // parameter count does not match the template
  132001, // template missing for that language, or not approved
  132005, // translated text too long
  132007, // template violates policy
  132012, // parameter values formatted incorrectly
  132015, // template paused for low quality
  132016, // template permanently disabled
  132018, // template validation error
]);
/** Too fast: wait, and do not count a try. 131056 is per recipient pair; the others are per app, account or number. */
const RATE = new Set([4, 17, 341, 80007, 130429, 131056]);
/** The account, not the message: a token that expired, a missing permission, a payment method, a restricted number. Retry later, and stop for this run. */
const PAUSE = new Set([0, 3, 10, 190, 33, 368, 130497, 131005, 131031, 131042, 131045, 131048, 131057, 133010, 2494100]);

export function classifyWaError(httpStatus: number, code: number | null): WaErrorClass {
  if (code !== null) {
    if (PERMANENT.has(code)) return "permanent";
    if (RATE.has(code)) return "rate";
  }
  if (httpStatus === 429) return "rate";
  if (code !== null && (PAUSE.has(code) || (code >= 200 && code <= 299))) return "pause";
  if (httpStatus === 401 || httpStatus === 403) return "pause";
  return "retry";
}

/** Meta's text with anything number shaped or token shaped removed, cut short: it goes into the send log. */
export const scrub = (t: string): string =>
  t.replace(/\+?\d[\d\s-]{6,}\d/g, "***").replace(/\bEA[A-Za-z0-9]{20,}\b/g, "***").replace(/\s+/g, " ").trim().slice(0, 200);

function fail(status: number, json: unknown): WaSendResult {
  const err = obj(obj(json).error);
  const code = typeof err.code === "number" ? err.code : /^\d+$/.test(str(err.code)) ? Number(err.code) : null;
  const text = scrub(str(obj(err.error_data).details) || str(err.message) || str(err.error_user_msg));
  const error = `whatsapp ${status}${code !== null ? ` code ${code}` : ""}${text ? `: ${text}` : ""}`.slice(0, 280);
  switch (classifyWaError(status, code)) {
    case "permanent":
      return { ok: false, error, retryable: false };
    case "rate":
      return { ok: false, error, rateLimited: true, pause: code !== 131056 };
    case "pause":
      return { ok: false, error, pause: true };
    default:
      return { ok: false, error };
  }
}

// ------------------------------------------------------------------ the real sender ---
export function createWhatsAppSender(env: Env = process.env, fetcher: FetchLike = (url, init) => fetch(url, init), timeoutMs: number = WA_TIMEOUT_MS): WhatsAppSender {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token) throw new Error("WHATSAPP_TOKEN is needed");
  if (!phoneId || !/^\d{5,30}$/.test(phoneId)) throw new Error("WHATSAPP_PHONE_NUMBER_ID is needed (digits only)");
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${phoneId}/messages`;

  async function post(body: Record<string, unknown>): Promise<WaSendResult> {
    const res = await postJson(fetcher, url, { Authorization: `Bearer ${token}` }, body, timeoutMs);
    if ("error" in res) return { ok: false, error: `whatsapp: ${res.error}` };
    if (res.status >= 200 && res.status < 300) {
      const first = Array.isArray(obj(res.json).messages) ? obj((obj(res.json).messages as unknown[])[0]) : {};
      // Accepted without an id is still accepted: failing it would send the same reminder again.
      return { ok: true, messageId: str(first.id) || "unknown", costUsd: 0 };
    }
    return fail(res.status, res.json);
  }

  return {
    name: "whatsapp",
    sendTemplate(msg) {
      if (!/^\+[1-9]\d{7,14}$/.test(msg.to)) return Promise.resolve({ ok: false, error: "whatsapp: not an international number", retryable: false });
      const components: Record<string, unknown>[] = [{ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text })) }];
      if (msg.buttonSuffix != null) {
        components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: encodeURIComponent(msg.buttonSuffix) }] });
      }
      return post({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: wireNumber(msg.to),
        type: "template",
        template: { name: msg.template, language: { code: "en" }, components },
      });
    },
    sendText(to, body) {
      if (!/^\+[1-9]\d{7,14}$/.test(to)) return Promise.resolve({ ok: false, error: "whatsapp: not an international number", retryable: false });
      if (!body.trim()) return Promise.resolve({ ok: false, error: "whatsapp: nothing to say", retryable: false });
      return post({ messaging_product: "whatsapp", recipient_type: "individual", to: wireNumber(to), type: "text", text: { preview_url: false, body } });
    },
  };
}

// ------------------------------------------------------------------ the fake one ---
/**
 * For fake mode and local runs: sends nothing, writes one line with the number masked, answers with a made-up id. Not allowed in production
 * unless the fake switch is on (buildWhatsApp). It is named "whatsapp_log", so the monthly budget (which counts "whatsapp") never counts it.
 */
export function createLogWhatsAppSender(write: (line: string) => void = (line) => console.log(line)): WhatsAppSender {
  return {
    name: "whatsapp_log",
    async sendTemplate(msg) {
      write(`[hoppaz] notify (log sender, nothing sent): WhatsApp template ${msg.template} to ${maskNumber(msg.to)}, ${msg.bodyParams.length} values`);
      return { ok: true, messageId: `walog_${randomUUID()}`, costUsd: 0 };
    },
    async sendText(to, body) {
      write(`[hoppaz] notify (log sender, nothing sent): WhatsApp reply to ${maskNumber(to)}, ${body.length} characters`);
      return { ok: true, messageId: `walog_${randomUUID()}`, costUsd: 0 };
    },
  };
}

/**
 * The WhatsApp sender this deployment can use, or null (the run route then leaves WhatsApp rows queued and the bot acts on STOP without replying).
 *   The fake switch (NEXT_PUBLIC_EVENTS_R1_FAKE=1) always gets the log sender, even if keys are set: fake mode never calls Meta.
 *   WHATSAPP_SENDER=log asks for the log sender; it is refused in production (the fake switch is the only way to get it there).
 *   Otherwise the real sender, if WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both set.
 */
export function buildWhatsApp(env: Env = process.env, warn: (line: string) => void = (line) => console.warn(line)): WhatsAppSender | null {
  const fake = env.NEXT_PUBLIC_EVENTS_R1_FAKE === "1";
  if (fake) return createLogWhatsAppSender();
  if (env.WHATSAPP_SENDER?.trim().toLowerCase() === "log") {
    if (env.NODE_ENV === "production") {
      warn("[hoppaz] notify: the WhatsApp log sender sends nothing and is not allowed in production; ignored");
      return null;
    }
    return createLogWhatsAppSender();
  }
  if (!env.WHATSAPP_TOKEN?.trim() && !env.WHATSAPP_PHONE_NUMBER_ID?.trim()) return null;
  try {
    return createWhatsAppSender(env);
  } catch (e) {
    warn(`[hoppaz] notify: WhatsApp is not set up (${(e as Error).message}); ignored`);
    return null;
  }
}
