import { whereText } from "./templates/copy";
import { formatWhen, oneLine } from "./templates/format";

/**
 * The four WhatsApp templates (docs/reminders-whatsapp-plan.md, "Update, 31 Oct"), their sample values for Meta's review, and how a queue row
 * becomes the values of a message. Pure. Server only; scripts/whatsapp-setup.mts submits these to Meta.
 *
 * Every template: category UTILITY, language English, no promotion, ends "Reply STOP to stop.", and has one URL button, "View ticket", that opens
 * https://hoppaz.fun/event/{{1}} (the event page, which shows the ticket after sign-in; {{1}} is the event's slug, else its id).
 *
 * META'S RULES for a parameter (template fundamentals, components, error codes; checked 31 Oct 2026): a value is never empty (error 132012),
 * and in host-written text there is no newline, no tab and no run of 4 or more spaces. oneLine/param below turn every run of white space,
 * which includes all of those, into one space, so none can get through. KNOWN CONFLICT: Meta's error 2388299 says a body cannot START or END
 * with a variable, and these four bodies (as the guide has them) start with {{1}}. Meta may refuse them at submission; the fix is a lead word
 * in the text below (for example "Hoppaz: "), nothing else changes. scripts/whatsapp-setup.mts prints this warning on its dry run.
 */

export const WA_TEMPLATE_NAMES = ["hoppaz_day_before", "hoppaz_hour_before", "hoppaz_event_changed", "hoppaz_event_cancelled"] as const;
export type WaTemplateName = (typeof WA_TEMPLATE_NAMES)[number];

/** Queue kind -> template. A WhatsApp row of any other kind is failed, never sent. */
export const WA_KIND_TEMPLATE: Readonly<Record<string, WaTemplateName>> = {
  reminder_day: "hoppaz_day_before",
  reminder_hour: "hoppaz_hour_before",
  event_changed: "hoppaz_event_changed",
  event_cancelled: "hoppaz_event_cancelled",
};

/** The fixed part of the View ticket button. The template is created with it, so it cannot differ at send time. */
export const WA_BUTTON_BASE = "https://hoppaz.fun/event/";
export const WA_BUTTON_LABEL = "View ticket";

export type WaTemplateDef = {
  name: WaTemplateName;
  category: "UTILITY";
  language: "en";
  body: string;
  /** One value per {{n}} of the body, for Meta's review. */
  samples: string[];
  /** The sample for the button's {{1}}. */
  buttonSample: string;
};

export const WA_TEMPLATES: readonly WaTemplateDef[] = [
  {
    name: "hoppaz_day_before",
    category: "UTILITY",
    language: "en",
    body: "{{1}} is tomorrow at {{2}}, {{3}}. Reply STOP to stop.",
    samples: ["Detty December Night", "7:30 PM", "Eko Hotel, Victoria Island"],
    buttonSample: "detty-december-night",
  },
  {
    name: "hoppaz_hour_before",
    category: "UTILITY",
    language: "en",
    body: "{{1}} starts at {{2}} at {{3}}. Reply STOP to stop.",
    samples: ["Detty December Night", "7:30 PM", "Eko Hotel, Victoria Island"],
    buttonSample: "detty-december-night",
  },
  {
    name: "hoppaz_event_changed",
    category: "UTILITY",
    language: "en",
    body: "{{1}} has changed: now {{2}} at {{3}}, {{4}}. Reply STOP to stop.",
    samples: ["Detty December Night", "Saturday 20 Dec", "9:00 PM", "Eko Hotel, Victoria Island"],
    buttonSample: "detty-december-night",
  },
  {
    name: "hoppaz_event_cancelled",
    category: "UTILITY",
    language: "en",
    body: "{{1}} on {{2}} is cancelled. {{3}} Reply STOP to stop.",
    samples: ["Detty December Night", "Saturday 20 Dec", "You will be refunded, and we will email you when it is sent."],
    buttonSample: "detty-december-night",
  },
];

/** What the setup script sends to POST /{WABA_ID}/message_templates for one template. */
export function creationPayload(t: WaTemplateDef): Record<string, unknown> {
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    parameter_format: "positional",
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.samples] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: WA_BUTTON_LABEL, url: `${WA_BUTTON_BASE}{{1}}`, example: [t.buttonSample] }] },
    ],
  };
}

/** Problems with a template that Meta's documentation says it will refuse. Empty when there are none. */
export function templateProblems(t: WaTemplateDef): string[] {
  const out: string[] = [];
  const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (vars.some((v, i) => v !== i + 1)) out.push("the variables are not numbered 1, 2, 3 in order");
  if (vars.length !== t.samples.length) out.push(`${vars.length} variables but ${t.samples.length} samples`);
  if (t.body.length > 1024) out.push("the body is longer than 1024 characters");
  if (/^\{\{/.test(t.body) || /\}\}[.!?]?\s*$/.test(t.body)) out.push("the body starts or ends with a variable (Meta error 2388299)");
  if (t.samples.some((s) => !s.trim() || /[\n\t]|\s{4,}/.test(s))) out.push("a sample is empty or has a newline, a tab or 4 spaces in a row");
  if (WA_BUTTON_LABEL.length > 25) out.push("the button text is longer than 25 characters");
  return out;
}

// ------------------------------------------------------------------ values of a message ---
type Payload = Record<string, unknown>;

const MAX_PARAM = 90;

/** One value for a body: one line, single spaces, never empty, never long. */
export function param(v: unknown, fallback: string, max = MAX_PARAM): string {
  const t = oneLine(v, max);
  return t || fallback;
}

const str = (p: Payload, k: string): string => (typeof p[k] === "string" ? (p[k] as string).trim() : "");

/** "7:30 PM" (or "7:30 PM GMT+1" outside Lagos) and "Saturday 20 Dec", both in the event's own timezone, from formatWhen. */
export function splitWhen(startsAt: unknown, timezone: unknown, now: Date): { date: string; time: string } | null {
  const when = formatWhen(startsAt, timezone, now);
  if (!when) return null;
  const at = when.indexOf(", ");
  return at < 0 ? null : { date: when.slice(0, at), time: when.slice(at + 2) };
}

export type WaMessageValues = { template: WaTemplateName; bodyParams: string[]; buttonSuffix: string };

export class WaTemplateError extends Error {}

/**
 * The template and values for a claimed WhatsApp row. Throws WaTemplateError (the row is then failed with the reason, nothing sent) for a kind
 * with no template or a payload with no usable start time.
 */
export function messageFor(kind: string, payload: Payload, now: Date = new Date()): WaMessageValues {
  const template = Object.prototype.hasOwnProperty.call(WA_KIND_TEMPLATE, kind) ? WA_KIND_TEMPLATE[kind] : undefined;
  if (!template) throw new WaTemplateError(`no WhatsApp template for kind "${kind}"`);
  const when = splitWhen(payload.starts_at, payload.timezone, now);
  if (!when) throw new WaTemplateError("the event has no usable start time");
  const event = param(payload.title, "your event");
  const venue = param(whereText(payload) || "Place to be announced", "Place to be announced");
  // The page address after WA_BUTTON_BASE: the slug, else the id (the same page the emails link to).
  const suffix = str(payload, "slug") || str(payload, "event_id");
  if (!suffix) throw new WaTemplateError("the event has no slug or id for the ticket button");
  switch (template) {
    case "hoppaz_day_before":
      return { template, bodyParams: [event, when.time, venue], buttonSuffix: suffix };
    case "hoppaz_hour_before":
      return { template, bodyParams: [event, when.time, venue], buttonSuffix: suffix };
    case "hoppaz_event_changed":
      return { template, bodyParams: [event, when.date, when.time, venue], buttonSuffix: suffix };
    case "hoppaz_event_cancelled":
      // Only a guest with a paid order is ever sent this, so there is always a refund to talk about.
      return { template, bodyParams: [event, when.date, "You will be refunded, and we will email you when it is sent."], buttonSuffix: suffix };
  }
}

/** The text a guest sees, for the dev preview and the checks: the body with its values put in. */
export function renderBody(template: WaTemplateName, values: string[]): string {
  const def = WA_TEMPLATES.find((t) => t.name === template);
  if (!def) throw new WaTemplateError(`unknown template ${template}`);
  return def.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => values[Number(n) - 1] ?? "");
}
