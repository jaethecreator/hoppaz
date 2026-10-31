/**
 * Plain checks for the WhatsApp half of the notification layer (src/lib/notify/whatsapp.ts, watemplates.ts, wabot.ts, the router's WhatsApp path,
 * the run loop and /api/whatsapp/hook). No test framework, no network, no database. Run from the repo root:
 *   node --no-warnings scripts/notify-whatsapp-check.mts
 * Every Meta call goes to a fake fetch, and the real global fetch is replaced with one that fails the run, so a check that reached Meta would show.
 * The SQL half is supabase/tests/events_r1_notify_whatsapp_test.sql (it needs the local database).
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { NotifyDb } from "../src/lib/notify/db.ts";
import type { ClaimedRow, RowOutcome, WaBudget } from "../src/lib/notify/types.ts";
import type { WaBotDb, InboundDecision, WaStatusEvent, Keyword } from "../src/lib/notify/wabot.ts";
import type { WhatsAppSender, WaSendResult } from "../src/lib/notify/whatsapp.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    return nextResolve(specifier, context);
  },
});

// Nothing in this file may reach the network.
let realFetchCalls = 0;
globalThis.fetch = (() => {
  realFetchCalls++;
  throw new Error("the real fetch was called");
}) as typeof fetch;

const wa = await import("../src/lib/notify/whatsapp.ts");
const tpl = await import("../src/lib/notify/watemplates.ts");
const bot = await import("../src/lib/notify/wabot.ts");
const { routeRow, routeWhatsApp, newRouterState, WA_WAIT_MINUTES, retryDelayMinutes } = await import("../src/lib/notify/router.ts");
const { runNotify, waBudgetWarning } = await import("../src/lib/notify/run.ts");
const { MAX_TRIES } = await import("../src/lib/notify/types.ts");
const route = await import("../src/app/api/whatsapp/hook/route.ts");

let pass = 0;
let fail = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (c: unknown, what: string) => {
  if (!c) throw new Error(what);
};
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
const quiet = () => {};

const NOW = new Date("2026-11-02T10:00:00.000Z");
const now = () => NOW;
const NUMBER = "+2348012345678";
const DIGITS = "2348012345678";
const SECRET = "app-secret-for-tests-only";
const VERIFY = "verify-token-for-tests";
const ENV = { WHATSAPP_TOKEN: "EAAfake-token-for-tests-0123456789abcdef", WHATSAPP_PHONE_NUMBER_ID: "106540352242922" };

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } };
/** A fake fetch: answers what it is told, remembers what it was asked. */
function fakeFetch(answer: (n: number) => { status: number; body?: unknown } | Error | "hang") {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    const a = answer(calls.length);
    if (a === "hang") {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { "Content-Type": "application/json" } });
  };
  return { fetcher, calls };
}
const accepted = (id = "wamid.OK1") => ({ status: 200, body: { messaging_product: "whatsapp", contacts: [{ input: DIGITS, wa_id: DIGITS }], messages: [{ id }] } });
const metaError = (status: number, code: number, message = "Something went wrong", details?: string) => ({
  status,
  body: { error: { message, type: "OAuthException", code, error_data: details ? { messaging_product: "whatsapp", details } : undefined, fbtrace_id: "x" } },
});

const PAYLOAD = { event_id: "22222222-2222-4222-8222-222222222222", title: "Detty Night", starts_at: "2026-11-03T18:30:00Z", timezone: "Africa/Lagos", venue_name: "Eko Hotel", online: false };

const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "r1",
  user_id: "11111111-1111-4111-8111-111111111111",
  kind: "reminder_day",
  event_id: PAYLOAD.event_id,
  channel: "whatsapp",
  cap_kind: "guest",
  payload: PAYLOAD,
  priority: 2,
  tries: 1,
  dedupe_key: "k1",
  email: null,
  whatsapp_number: NUMBER,
  ...over,
});

/** A sender whose answers are scripted; remembers what it was asked. */
function fakeSender(answer: WaSendResult | (() => WaSendResult), name = "whatsapp") {
  const sent: { to: string; template?: string; params?: string[]; suffix?: string | null; text?: string }[] = [];
  const s: WhatsAppSender = {
    name,
    async sendTemplate(m) {
      sent.push({ to: m.to, template: m.template, params: m.bodyParams, suffix: m.buttonSuffix });
      return typeof answer === "function" ? answer() : answer;
    },
    async sendText(to, text) {
      sent.push({ to, text });
      return typeof answer === "function" ? answer() : answer;
    },
  };
  return { sender: s, sent };
}
const good = (id = "wamid.G1"): WaSendResult => ({ ok: true, messageId: id, costUsd: 0 });
const recheckOk = async () => NUMBER;

// ------------------------------------------------------------------ the sender ---
await test("sender: a template goes to /v26.0/{phone-number-id}/messages with a bearer token, the body values and the encoded button value", async () => {
  const { fetcher, calls } = fakeFetch(() => accepted("wamid.T1"));
  const s = wa.createWhatsAppSender(ENV, fetcher);
  const res = await s.sendTemplate({ to: NUMBER, template: "hoppaz_day_before", bodyParams: ["Detty Night", "7:30 PM", "Eko Hotel"], buttonSuffix: "detty night/2026" });
  eq(res, { ok: true, messageId: "wamid.T1", costUsd: 0 }, "result");
  eq(calls.length, 1, "one request");
  eq(calls[0].url, "https://graph.facebook.com/v26.0/106540352242922/messages", "the address");
  eq(calls[0].init.method, "POST", "POST");
  eq(calls[0].init.headers.Authorization, `Bearer ${ENV.WHATSAPP_TOKEN}`, "bearer token");
  eq(JSON.parse(calls[0].init.body), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: DIGITS,
    type: "template",
    template: {
      name: "hoppaz_day_before",
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "Detty Night" }, { type: "text", text: "7:30 PM" }, { type: "text", text: "Eko Hotel" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "detty%20night%2F2026" }] },
      ],
    },
  }, "the body");
  ok(!!calls[0].init.signal, "an abort signal is set (a short timeout)");
});
await test("sender: a free-form reply is a plain text message, with no link preview", async () => {
  const { fetcher, calls } = fakeFetch(() => accepted("wamid.T2"));
  const res = await wa.createWhatsAppSender(ENV, fetcher).sendText(NUMBER, "Hello");
  eq(res.ok && res.messageId, "wamid.T2", "id");
  eq(JSON.parse(calls[0].init.body), { messaging_product: "whatsapp", recipient_type: "individual", to: DIGITS, type: "text", text: { preview_url: false, body: "Hello" } }, "the body");
});
await test("sender: accepted without an id is still accepted (a retry would send twice); a number that is not international never reaches Meta", async () => {
  const { fetcher, calls } = fakeFetch(() => ({ status: 200, body: {} }));
  const s = wa.createWhatsAppSender(ENV, fetcher);
  eq(await s.sendText(NUMBER, "x"), { ok: true, messageId: "unknown", costUsd: 0 }, "no id");
  const bad = await s.sendTemplate({ to: "08012345678", template: "hoppaz_day_before", bodyParams: ["a"], buttonSuffix: "x" });
  eq(bad.ok === false && bad.retryable, false, "refused for good");
  const blank = await s.sendText(NUMBER, "   ");
  eq(blank.ok, false, "nothing to say");
  eq(calls.length, 1, "only the first reached the fetch");
});
await test("sender: not configured throws; the timeout aborts and is an ordinary retryable error", async () => {
  let threw = 0;
  for (const env of [{}, { WHATSAPP_TOKEN: "x" }, { WHATSAPP_PHONE_NUMBER_ID: "123456" }, { WHATSAPP_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "abc" }]) {
    try {
      wa.createWhatsAppSender(env, fakeFetch(() => accepted()).fetcher);
    } catch {
      threw++;
    }
  }
  eq(threw, 4, "all four incomplete setups throw");
  const { fetcher } = fakeFetch(() => "hang");
  const res = await wa.createWhatsAppSender(ENV, fetcher, 30).sendText(NUMBER, "hi");
  eq(res, { ok: false, error: "whatsapp: timed out" }, "timed out, retried by the tries rule");
  const net = await wa.createWhatsAppSender(ENV, fakeFetch(() => new Error("socket hang up")).fetcher).sendText(NUMBER, "hi");
  ok(!net.ok && net.retryable === undefined && !net.rateLimited && !net.pause, "a network error is an ordinary retry");
});
await test("sender: Meta's errors are sorted from the docs", async () => {
  const cases: [number, number, string][] = [
    [400, 131026, "permanent"], [400, 131030, "permanent"], [400, 132001, "permanent"], [400, 132007, "permanent"], [400, 132015, "permanent"], [400, 132016, "permanent"],
    [400, 132000, "permanent"], [400, 132012, "permanent"], [400, 100, "permanent"], [400, 131021, "permanent"], [400, 130403, "permanent"], [400, 131050, "permanent"],
    [400, 130429, "rate"], [400, 80007, "rate"], [400, 4, "rate"], [400, 17, "rate"], [400, 341, "rate"], [400, 131056, "rate"], [429, 0, "rate"],
    [401, 190, "pause"], [400, 190, "pause"], [403, 200, "pause"], [400, 299, "pause"], [400, 131042, "pause"], [400, 131048, "pause"], [400, 133010, "pause"], [401, 0, "pause"],
    [500, 131000, "retry"], [503, 131016, "retry"], [500, 1, "retry"], [500, 2, "retry"], [400, 999999, "retry"],
  ];
  for (const [status, code, want] of cases) {
    const got = wa.classifyWaError(status, code);
    // 429 and 401 are sorted by status when the code says nothing: code 0 is an auth code in Meta's list, so 401 + 0 is pause and 429 + 0 is rate.
    eq(got, want, `HTTP ${status} code ${code}`);
  }
  eq(wa.classifyWaError(429, null), "rate", "429 with no body");
  eq(wa.classifyWaError(502, null), "retry", "502 with no body");
  eq(wa.classifyWaError(403, null), "pause", "403 with no body");
  const run = async (status: number, code: number) => wa.createWhatsAppSender(ENV, fakeFetch(() => metaError(status, code)).fetcher).sendText(NUMBER, "x");
  const perm = await run(400, 131026);
  eq(!perm.ok && perm.retryable, false, "131026: failed for good");
  const rate = await run(400, 130429);
  ok(!rate.ok && rate.rateLimited === true && rate.pause === true, "130429: rate limited, stop for this run");
  const pair = await run(400, 131056);
  ok(!pair.ok && pair.rateLimited === true && pair.pause === false, "131056: this recipient only, the run goes on");
  const auth = await run(401, 190);
  ok(!auth.ok && auth.pause === true && auth.retryable === undefined && !auth.rateLimited, "190: stop for this run, retried by the tries rule");
  const plain = await run(500, 131000);
  ok(!plain.ok && !plain.pause && !plain.rateLimited && plain.retryable === undefined, "131000: an ordinary retry");
});
await test("sender: error text keeps no number and no token, and is cut short", async () => {
  const res = await wa.createWhatsAppSender(
    ENV,
    fakeFetch(() => metaError(400, 131026, `Message undeliverable to +${DIGITS} using EAAfake-token-for-tests-0123456789abcdef`, "x".repeat(900))).fetcher,
  ).sendText(NUMBER, "x");
  ok(!res.ok, "failed");
  if (!res.ok) {
    ok(!res.error.includes(DIGITS) && !res.error.includes("EAAfake"), "no number or token in the error");
    ok(res.error.length <= 280, "short");
  }
  const withNumber = await wa.createWhatsAppSender(ENV, fakeFetch(() => metaError(400, 131026, `Message undeliverable to +${DIGITS} using EAAfake-token-for-tests-0123456789abcdef`)).fetcher).sendText(NUMBER, "x");
  ok(!withNumber.ok && withNumber.error.includes("***") && !withNumber.error.includes("2348"), "the number is replaced");
  eq(wa.maskNumber(NUMBER), "+234********78", "the mask");
  eq([wa.maskNumber(null), wa.maskNumber("12"), wa.maskNumber("")], ["***", "***", "***"], "nothing to mask");
});
await test("sender: the log sender sends nothing and writes a masked line; the builder never gives Meta in fake mode or the log in production", async () => {
  const lines: string[] = [];
  const log = wa.createLogWhatsAppSender((l) => lines.push(l));
  const r1 = await log.sendTemplate({ to: NUMBER, template: "hoppaz_day_before", bodyParams: ["a", "b", "c"], buttonSuffix: "x" });
  const r2 = await log.sendText(NUMBER, "hello there");
  ok(r1.ok && r1.messageId.startsWith("walog_") && r2.ok, "fake ids");
  ok(lines.every((l) => !l.includes(DIGITS) && l.includes("+234********78")), "masked, in every line");
  eq(log.name, "whatsapp_log", "its name is not the one the budget counts");
  const warns: string[] = [];
  eq(wa.buildWhatsApp({}, (l) => warns.push(l)), null, "nothing set: none");
  eq(wa.buildWhatsApp({ WHATSAPP_TOKEN: "x" }, (l) => warns.push(l)), null, "half set: none");
  ok(warns.length === 1 && /WHATSAPP_PHONE_NUMBER_ID/.test(warns[0]) && !warns[0].includes("x\n"), "with a warning that names the missing one");
  eq(wa.buildWhatsApp(ENV)?.name, "whatsapp", "keys set: the real sender");
  eq(wa.buildWhatsApp({ ...ENV, NEXT_PUBLIC_EVENTS_R1_FAKE: "1" })?.name, "whatsapp_log", "fake mode: the log sender even with real keys");
  eq(wa.buildWhatsApp({ NEXT_PUBLIC_EVENTS_R1_FAKE: "1" })?.name, "whatsapp_log", "fake mode with no keys: the log sender");
  eq(wa.buildWhatsApp({ WHATSAPP_SENDER: "log", NODE_ENV: "development" })?.name, "whatsapp_log", "asked for, in development");
  eq(wa.buildWhatsApp({ WHATSAPP_SENDER: "log", NODE_ENV: "production" }, (l) => warns.push(l)), null, "asked for in production: refused");
  eq(wa.buildWhatsApp({ ...ENV, WHATSAPP_SENDER: "log", NODE_ENV: "production" }, quiet), null, "and keys do not make it a real sender behind the user's back");
});

// ------------------------------------------------------------------ templates ---
await test("templates: the four exact bodies, category utility, English, one View ticket button, with samples", () => {
  const bodies = Object.fromEntries(tpl.WA_TEMPLATES.map((t) => [t.name, t.body]));
  eq(bodies, {
    hoppaz_day_before: "{{1}} is tomorrow at {{2}}, {{3}}. Reply STOP to stop.",
    hoppaz_hour_before: "{{1}} starts at {{2}} at {{3}}. Reply STOP to stop.",
    hoppaz_event_changed: "{{1}} has changed: now {{2}} at {{3}}, {{4}}. Reply STOP to stop.",
    hoppaz_event_cancelled: "{{1}} on {{2}} is cancelled. {{3}} Reply STOP to stop.",
  }, "the bodies");
  eq(tpl.WA_TEMPLATES.map((t) => [t.category, t.language]), [["UTILITY", "en"], ["UTILITY", "en"], ["UTILITY", "en"], ["UTILITY", "en"]], "utility, English");
  for (const t of tpl.WA_TEMPLATES) {
    const p = tpl.creationPayload(t) as { name: string; language: string; category: string; parameter_format: string; components: { type: string; text?: string; example?: unknown; buttons?: Record<string, unknown>[] }[] };
    eq([p.name, p.language, p.category, p.parameter_format], [t.name, "en", "UTILITY", "positional"], `${t.name}: header`);
    eq(p.components[0], { type: "BODY", text: t.body, example: { body_text: [t.samples] } }, `${t.name}: body with samples`);
    eq(p.components[1], { type: "BUTTONS", buttons: [{ type: "URL", text: "View ticket", url: "https://hoppaz.fun/event/{{1}}", example: [t.buttonSample] }] }, `${t.name}: one URL button`);
    ok((t.body.match(/\{\{\d\}\}/g) ?? []).length === t.samples.length, `${t.name}: a sample for every variable`);
    ok(t.body.endsWith("Reply STOP to stop."), `${t.name}: ends with the STOP line`);
    ok(!/[\n\t]|\s{4,}/.test(t.body) && !tpl.WA_TEMPLATES.some((x) => x.samples.some((s) => /[\n\t]|\s{4,}|^\s*$/.test(s))), `${t.name}: no newline, tab or 4 spaces`);
  }
  eq(Object.entries(tpl.WA_KIND_TEMPLATE).sort(), [["event_cancelled", "hoppaz_event_cancelled"], ["event_changed", "hoppaz_event_changed"], ["reminder_day", "hoppaz_day_before"], ["reminder_hour", "hoppaz_hour_before"]], "kind to template");
});
await test("templates: the only problem the documented rules find is the leading variable (Meta error 2388299), reported openly", () => {
  for (const t of tpl.WA_TEMPLATES) {
    const p = tpl.templateProblems(t);
    ok(p.every((x) => /2388299/.test(x)), `${t.name}: ${p.join("; ")}`);
  }
  const bad = { ...tpl.WA_TEMPLATES[0], body: "Hi {{2}} and {{1}}", samples: ["a"] };
  ok(tpl.templateProblems(bad).length >= 2, "a template with variables out of order or no samples is caught");
  const lead = { ...tpl.WA_TEMPLATES[0], body: "Hoppaz: " + tpl.WA_TEMPLATES[0].body };
  eq(tpl.templateProblems(lead), [], "a lead word clears it");
});
await test("templates: values are in the event's own timezone, with the exact time, and one line each", () => {
  const day = tpl.messageFor("reminder_day", PAYLOAD, NOW);
  eq(day, { template: "hoppaz_day_before", bodyParams: ["Detty Night", "7:30 PM", "Eko Hotel"], buttonSuffix: PAYLOAD.event_id }, "day before (18:30Z is 7:30 PM in Lagos)");
  eq(tpl.renderBody("hoppaz_day_before", day.bodyParams), "Detty Night is tomorrow at 7:30 PM, Eko Hotel. Reply STOP to stop.", "what the guest reads");
  const hour = tpl.messageFor("reminder_hour", { ...PAYLOAD, slug: "detty-night" }, NOW);
  eq([hour.template, hour.bodyParams, hour.buttonSuffix], ["hoppaz_hour_before", ["Detty Night", "7:30 PM", "Eko Hotel"], "detty-night"], "hour before, the slug for the button");
  const changed = tpl.messageFor("event_changed", { ...PAYLOAD, starts_at: "2026-11-21T20:00:00Z" }, NOW);
  eq(changed.bodyParams, ["Detty Night", "Saturday 21 Nov", "9:00 PM", "Eko Hotel"], "changed: date and the new time");
  const cancelled = tpl.messageFor("event_cancelled", PAYLOAD, NOW);
  eq(cancelled.bodyParams, ["Detty Night", "Tuesday 3 Nov", "You will be refunded, and we will email you when it is sent."], "cancelled: date and a refund line");
  const abroad = tpl.messageFor("reminder_day", { ...PAYLOAD, timezone: "Europe/London" }, NOW);
  eq(abroad.bodyParams[1], "6:30 PM GMT", "another timezone says so");
  const nextYear = tpl.messageFor("event_changed", { ...PAYLOAD, starts_at: "2027-01-08T20:00:00Z" }, NOW);
  eq(nextYear.bodyParams[1], "Friday 8 Jan 2027", "a date in another year says the year");
  const online = tpl.messageFor("reminder_day", { ...PAYLOAD, venue_name: null, online: true }, NOW);
  eq(online.bodyParams[2], "Online", "online events say so");
  const tbd = tpl.messageFor("reminder_day", { ...PAYLOAD, venue_name: "" }, NOW);
  eq(tbd.bodyParams[2], "Place to be announced", "no venue: a plain fallback, never an empty value");
});
await test("templates: host-written text can never carry a newline, a tab or 4 spaces, an empty value, or a huge one", () => {
  const nasty = tpl.messageFor("reminder_day", { ...PAYLOAD, title: "Line one\nLine two\t\ttabbed      spaced\r\n  end", venue_name: "A\u2028B\u0000C" }, NOW);
  for (const p of nasty.bodyParams) ok(!/[\n\r\t\u2028\u2029\u0000]|\s{2,}/.test(p) && p.trim() === p && p.length > 0, `clean: ${JSON.stringify(p)}`);
  eq(nasty.bodyParams[0], "Line one Line two tabbed spaced end", "white space becomes single spaces");
  eq(tpl.messageFor("reminder_day", { ...PAYLOAD, title: "   \n\t " }, NOW).bodyParams[0], "your event", "an empty title gets a fallback");
  ok(tpl.messageFor("reminder_day", { ...PAYLOAD, title: "x".repeat(500) }, NOW).bodyParams[0].length <= 90, "a long title is cut");
  eq(tpl.param("a    b\n\nc\td", "z"), "a b c d", "param");
  eq(tpl.param(null, "z"), "z", "param fallback");
  const q = tpl.messageFor("reminder_day", { ...PAYLOAD, slug: "a b/c?d" }, NOW);
  eq(q.buttonSuffix, "a b/c?d", "the suffix is handed on raw; the sender percent-encodes it");
});
await test("templates: a kind with no template, or an event with no time or no page, is refused with a reason", () => {
  for (const kind of ["receipt", "registered", "thanks", "host_pop", "sign_in_code", "ticket", "constructor", "__proto__", ""]) {
    let err = "";
    try {
      tpl.messageFor(kind, PAYLOAD, NOW);
    } catch (e) {
      err = (e as Error).message;
      ok(e instanceof tpl.WaTemplateError, "its own error type");
    }
    ok(/no WhatsApp template/.test(err), `${kind}: ${err}`);
  }
  for (const [what, p, want] of [
    ["no start", { ...PAYLOAD, starts_at: null }, /start time/],
    ["a bad date", { ...PAYLOAD, starts_at: "soon" }, /start time/],
    ["no page", { ...PAYLOAD, event_id: "", slug: "" }, /slug or id/],
  ] as const) {
    let err = "";
    try {
      tpl.messageFor("reminder_day", p, NOW);
    } catch (e) {
      err = (e as Error).message;
    }
    ok(want.test(err), `${what}: ${err}`);
  }
});

// ------------------------------------------------------------------ the router ---
await test("router: each kind goes out on its own template with the number the recheck gave", async () => {
  const seen: Record<string, string> = {};
  for (const [kind, template] of Object.entries(tpl.WA_KIND_TEMPLATE)) {
    const { sender, sent } = fakeSender(good(`wamid.${kind}`));
    const out = await routeWhatsApp(row({ kind }), { sender, recheck: async () => "+2348099999999" }, newRouterState(), now);
    eq(out.final, "sent", `${kind}: sent`);
    eq(out.attempts.map((a) => [a.channel, a.provider, a.status, a.message_id, a.cost_usd, a.error]), [["whatsapp", "whatsapp", "sent", `wamid.${kind}`, 0, null]], `${kind}: the attempt`);
    eq([sent.length, sent[0].template, sent[0].to], [1, template, "+2348099999999"], `${kind}: one send, right template, the rechecked number`);
    seen[kind] = template;
  }
  eq(Object.keys(seen).length, 4, "all four");
});
await test("router: a WhatsApp row of any other kind is failed clearly and never sent", async () => {
  for (const kind of ["receipt", "registered", "thanks", "host_pop", "sign_in_code", "refund_sent"]) {
    const { sender, sent } = fakeSender(good());
    const out = await routeRow(row({ kind }), [], { take: async () => true, give: async () => {} }, newRouterState(), now, undefined, { sender, recheck: recheckOk });
    eq(out.final, "failed", `${kind}: failed`);
    ok(/not sent: no WhatsApp template for kind/.test(out.attempts[0].error ?? ""), `${kind}: ${out.attempts[0].error}`);
    eq(sent.length, 0, `${kind}: the sender was never called`);
  }
});
await test("router: an event with no usable time fails the row with the reason and sends nothing", async () => {
  const { sender, sent } = fakeSender(good());
  const out = await routeWhatsApp(row({ payload: { ...PAYLOAD, starts_at: null } }), { sender, recheck: recheckOk }, newRouterState(), now);
  eq(out.final, "failed", "failed");
  ok(/start time/.test(out.attempts[0].error ?? ""), "with the reason");
  eq(sent.length, 0, "nothing sent");
});
await test("router: no sender set up puts the row back without spending a try; no number skips; a STOP or refund since the claim skips without sending", async () => {
  const none = await routeWhatsApp(row(), null, newRouterState(), now);
  ok(none.final === "queued" && none.freeRetry === true && none.retryAt === new Date(NOW.getTime() + WA_WAIT_MINUTES * 60_000).toISOString(), "waits, free of tries");
  eq(none.attempts[0].error, "WhatsApp is not set up here, waiting", "with the reason");
  const { sender, sent } = fakeSender(good());
  const nonum = await routeWhatsApp(row({ whatsapp_number: null }), { sender, recheck: recheckOk }, newRouterState(), now);
  eq([nonum.final, nonum.attempts[0].error], ["skipped", "no WhatsApp number"], "no number");
  const stopped = await routeWhatsApp(row(), { sender, recheck: async () => null }, newRouterState(), now);
  eq(stopped.final, "skipped", "switched off between the claim and the send");
  ok(/switched off or no longer paid/.test(stopped.attempts[0].error ?? ""), "with the reason");
  eq(sent.length, 0, "nothing was sent in any of the three");
  let threw = false;
  try {
    await routeWhatsApp(row(), { sender, recheck: async () => { throw new Error("database is down"); } }, newRouterState(), now);
  } catch {
    threw = true;
  }
  ok(threw && sent.length === 0, "a recheck that cannot be answered is not a reason to send (the run puts the row back)");
});
await test("router: a permanent Meta error fails the row with no retry, and the log line shows only a masked number", async () => {
  const { sender } = fakeSender({ ok: false, error: "whatsapp 400 code 131026: undeliverable", retryable: false });
  const out = await routeWhatsApp(row(), { sender, recheck: recheckOk }, newRouterState(), now);
  eq(out.final, "failed", "failed");
  ok(!JSON.stringify(out).includes(DIGITS) && /\+234\*+78/.test(out.attempts[0].error ?? ""), "masked");
});
await test("router: a rate limit puts the row back without counting a try and pauses the rest of the run; an auth error counts and pauses", async () => {
  const state = newRouterState();
  const limited = fakeSender({ ok: false, error: "whatsapp 400 code 130429: rate limit", rateLimited: true, pause: true });
  const first = await routeWhatsApp(row({ id: "a", tries: 3 }), { sender: limited.sender, recheck: recheckOk }, state, now);
  ok(first.final === "queued" && first.freeRetry === true && first.retryAt === new Date(NOW.getTime() + WA_WAIT_MINUTES * 60_000).toISOString(), "later, free of tries");
  const second = await routeWhatsApp(row({ id: "b" }), { sender: limited.sender, recheck: recheckOk }, state, now);
  ok(second.final === "queued" && second.freeRetry === true, "the next row waits too");
  eq(limited.sent.length, 1, "and was not sent to Meta (the run is paused)");
  const auth = fakeSender({ ok: false, error: "whatsapp 401 code 190: token", pause: true });
  const st2 = newRouterState();
  const a1 = await routeWhatsApp(row({ tries: 2 }), { sender: auth.sender, recheck: recheckOk }, st2, now);
  ok(a1.final === "queued" && a1.freeRetry === false && a1.retryAt === new Date(NOW.getTime() + retryDelayMinutes(2) * 60_000).toISOString(), "an auth error costs a try and waits the usual time");
  await routeWhatsApp(row({ id: "c" }), { sender: auth.sender, recheck: recheckOk }, st2, now);
  eq(auth.sent.length, 1, "and the rest of that run is not sent either");
});
await test("router: any other error retries by the tries rule and fails after the last try", async () => {
  const { sender } = fakeSender({ ok: false, error: "whatsapp 500: oops" });
  for (const tries of [1, 2, 3, 4]) {
    const out = await routeWhatsApp(row({ tries }), { sender, recheck: recheckOk }, newRouterState(), now);
    ok(out.final === "queued" && !out.freeRetry && out.retryAt === new Date(NOW.getTime() + retryDelayMinutes(tries) * 60_000).toISOString(), `try ${tries}: retried after ${retryDelayMinutes(tries)} minutes`);
  }
  eq((await routeWhatsApp(row({ tries: MAX_TRIES }), { sender, recheck: recheckOk }, newRouterState(), now)).final, "failed", "the last try fails it");
  const boom = await routeWhatsApp(row(), { sender: { name: "whatsapp", sendTemplate: async () => { throw new Error("kaboom"); }, sendText: async () => good() }, recheck: recheckOk }, newRouterState(), now);
  eq(boom.final, "queued", "a sender that throws is an ordinary retry");
});

// ------------------------------------------------------------------ the run loop ---
function stubDb(rows: ClaimedRow[], budget: WaBudget | null = null) {
  const settled: { id: string; outcome: RowOutcome }[] = [];
  const claims: { limit: number; providers: string[]; channels: string[] | undefined }[] = [];
  let handed = false;
  const db: NotifyDb = {
    async enqueue() { return null; },
    async claim(limit, providers, channels) {
      claims.push({ limit, providers, channels });
      if (handed) return [];
      handed = true;
      return rows;
    },
    async takeCap() { return true; },
    async giveCap() {},
    async complete(id, outcome) { settled.push({ id, outcome }); return true; },
    async capStatus() { return []; },
    async waRecheck() { return NUMBER; },
    async waBudget() { return budget; },
  };
  return { db, settled, claims };
}
const BUDGET = (percent: number, room = 100): WaBudget => ({ budget_usd: 50, spent_usd: (50 * percent) / 100, unpriced: 0, in_flight: 0, estimate_usd: 0.0067, projected_usd: (50 * percent) / 100, percent, room });
const logProvider = { name: "log", kinds: ["code", "guest"] as const, async send() { return { ok: true as const, messageId: "log_1", costUsd: 0 }; } };

await test("run: WhatsApp rows are sent through the sender and settled once; the claim names the channels it can serve", async () => {
  const { sender, sent } = fakeSender(good("wamid.RUN1"));
  const { db, settled, claims } = stubDb([row({ id: "w1" }), row({ id: "w2", kind: "event_cancelled" })]);
  const out = await runNotify({ db, providers: [], whatsapp: sender, log: quiet, now });
  eq(claims, [{ limit: 500, providers: [], channels: ["whatsapp"] }], "WhatsApp only: no email provider, so email is not asked for");
  eq(out, { claimed: 2, sent: 2, failed: 0, skipped: 0, requeued: 0, stuck: 0, warnings: [] }, "summary");
  eq(settled.map((s) => s.id).sort(), ["w1", "w2"], "each settled once");
  eq(sent.map((s) => s.template).sort(), ["hoppaz_day_before", "hoppaz_event_cancelled"], "the right templates");
});
await test("run: with an email provider and a sender both channels are asked for; with only email, WhatsApp is not; with neither, nothing is claimed", async () => {
  const both = stubDb([]);
  await runNotify({ db: both.db, providers: [logProvider], whatsapp: fakeSender(good()).sender, log: quiet, now });
  eq(both.claims[0].channels, ["email", "whatsapp"], "both");
  const emailOnly = stubDb([]);
  await runNotify({ db: emailOnly.db, providers: [logProvider], log: quiet, now });
  eq(emailOnly.claims[0].channels, ["email"], "email only: WhatsApp rows are left alone in the queue");
  const none = stubDb([row()]);
  const out = await runNotify({ db: none.db, providers: [], log: quiet, now });
  eq([none.claims.length, out.claimed], [0, 0], "no channel: no claim at all");
});
await test("run: a rate limit in the middle of a run puts the rest back, free of tries, and the run still ends cleanly", async () => {
  let n = 0;
  const { sender, sent } = fakeSender(() => (++n === 1 ? good("wamid.F1") : { ok: false, error: "whatsapp 400 code 130429: rate limit", rateLimited: true, pause: true }));
  const { db, settled } = stubDb([row({ id: "x1" }), row({ id: "x2" }), row({ id: "x3" })]);
  const out = await runNotify({ db, providers: [], whatsapp: sender, log: quiet, now, concurrency: 1 });
  eq([out.sent, out.requeued], [1, 2], "one sent, two put back");
  eq(sent.length, 2, "Meta was asked twice, not three times");
  ok(settled.filter((s) => s.outcome.final === "queued").every((s) => s.outcome.final === "queued" && s.outcome.freeRetry), "both put back free of tries");
});
await test("run: the budget warning at 80 percent, and a louder one when it is reached; none below, none without a sender", async () => {
  eq(waBudgetWarning(BUDGET(79.9)), null, "79.9 percent: nothing");
  eq(waBudgetWarning(null), null, "no budget function: nothing");
  eq(waBudgetWarning(BUDGET(80)), "WhatsApp has used $40.00 of the $50.00 monthly budget (80%)", "80 percent");
  ok(/budget is reached, WhatsApp rows are being skipped/.test(waBudgetWarning(BUDGET(100, 0)) ?? ""), "reached");
  const lines: string[] = [];
  const { db } = stubDb([], BUDGET(85));
  const out = await runNotify({ db, providers: [], whatsapp: fakeSender(good()).sender, log: (l) => lines.push(l), now });
  eq(out.warnings.length, 1, "in the summary");
  ok(lines.some((l) => l.includes("85%")), "and in the log, like the cap warning");
  const quietRun = await runNotify({ db: stubDb([], BUDGET(85)).db, providers: [logProvider], log: quiet, now });
  eq(quietRun.warnings, [], "no sender: the budget is not read");
  let readFailed = "";
  const broken = stubDb([], BUDGET(85));
  broken.db.waBudget = async () => { throw new Error("no such function"); };
  const out2 = await runNotify({ db: broken.db, providers: [], whatsapp: fakeSender(good()).sender, log: (l) => (readFailed += l), now });
  ok(out2.claimed === 0 && /could not read the WhatsApp budget/.test(readFailed), "a budget that cannot be read is logged, not fatal");
});

// ------------------------------------------------------------------ the webhook ---
const WEBHOOK_URL = "https://hoppaz.fun/api/whatsapp/hook";
const msgBody = (messages: unknown[], meta: Record<string, unknown> = { display_phone_number: "2349000000000", phone_number_id: "106540352242922" }, field = "messages") =>
  JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, contacts: [{ profile: { name: "Ada" }, wa_id: DIGITS }], messages } }] }] });
const statusBody = (statuses: unknown[]) =>
  JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "2349000000000", phone_number_id: "106540352242922" }, statuses } }] }] });
const text = (id: string, body: string, from = DIGITS) => ({ from, id, timestamp: "1749416383", type: "text", text: { body } });

const post = (body: string, headers: Record<string, string> = {}) => new Request(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
const signed = (body: string, secret = SECRET) => post(body, { "X-Hub-Signature-256": bot.signBody(secret, body) });

/** A stand-in for the SQL half: remembers message ids (idempotency), and answers by keyword the way the SQL does for a known guest. */
function fakeBotDb(opts: { decide?: (kw: Keyword, id: string) => InboundDecision; fail?: boolean } = {}) {
  const seen = new Set<string>();
  const inbound: { id: string; number: string; keyword: Keyword }[] = [];
  const replies: string[] = [];
  const statuses: WaStatusEvent[][] = [];
  const db: WaBotDb = {
    async inbound(id, number, keyword) {
      if (opts.fail) throw new Error("database is down");
      inbound.push({ id, number, keyword });
      if (seen.has(id)) return { status: "duplicate", reply: null };
      seen.add(id);
      if (opts.decide) return opts.decide(keyword, id);
      const reply = ({ stop: "stop", start: "start", ticket: "ticket", help: "help", other: "help" } as const)[keyword];
      return { status: "ok", reply, ticket: reply === "ticket" ? { event_id: PAYLOAD.event_id, title: "Detty Night", slug: "detty-night", starts_at: PAYLOAD.starts_at, timezone: "Africa/Lagos" } : undefined };
    },
    async recordReply(id) { replies.push(id); },
    async applyStatuses(events) { if (opts.fail) throw new Error("database is down"); statuses.push(events); return { applied: events.length, duplicate: 0, unmatched: 0, ignored: 0 }; },
  };
  return { db, seen, inbound, replies, statuses };
}
const hookEnv = { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY };
async function hook(req: Request, over: Partial<Parameters<typeof bot.handleWebhook>[1]> = {}) {
  const fb = (over as { fb?: ReturnType<typeof fakeBotDb> }).fb ?? fakeBotDb();
  const s = fakeSender(good("wamid.REPLY"));
  const logs: string[] = [];
  const res = await bot.handleWebhook(req, { env: hookEnv, db: fb.db, sender: s.sender, now, log: (l) => logs.push(l), ...over });
  return { res, fb, s, logs, body: (await res.json()) as Record<string, unknown> };
}

await test("webhook GET: the verify challenge is answered only with the right token and mode", async () => {
  const get = (q: string, env: Record<string, string | undefined> = hookEnv) => bot.handleVerify(new Request(`${WEBHOOK_URL}?${q}`), env);
  const okRes = get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`);
  eq([okRes.status, await okRes.text()], [200, "1158201444"], "right token: 200 and the challenge");
  eq(okRes.headers.get("content-type"), "text/plain; charset=utf-8", "plain text");
  eq(get(`hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`).status, 403, "wrong token");
  eq(get(`hub.mode=subscribe&hub.verify_token=${VERIFY}x&hub.challenge=1`).status, 403, "token with something added");
  eq(get(`hub.mode=subscribe&hub.challenge=1`).status, 403, "no token");
  eq(get(`hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`).status, 403, "wrong mode");
  eq(get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=<script>alert(1)</script>`).status, 400, "a challenge that is not plain is not echoed");
  eq(get(`hub.mode=subscribe&hub.verify_token=&hub.challenge=1`, { WHATSAPP_VERIFY_TOKEN: "" }).status, 403, "token unset and an empty token given: nobody gets in");
  eq(get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`, {}).status, 403, "token unset: nobody gets in");
});
await test("webhook POST: refuses everything when WHATSAPP_APP_SECRET is not set, even a call signed with the empty key", async () => {
  const body = msgBody([text("wamid.A1", "STOP")]);
  for (const env of [{}, { WHATSAPP_APP_SECRET: "" }, { WHATSAPP_APP_SECRET: "   " }, { WHATSAPP_APP_SECRET: undefined, NODE_ENV: "development", NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }]) {
    const fb = fakeBotDb();
    const r = await hook(post(body, { "X-Hub-Signature-256": bot.signBody("", body) }), { env, fb } as never);
    eq(r.res.status, 503, `no secret (${JSON.stringify(env)}): refused`);
    eq([fb.inbound.length, r.s.sent.length], [0, 0], "nothing read, nothing sent");
  }
});
await test("webhook POST: the signature is checked over the raw body, in constant time, with no way round it", async () => {
  const body = msgBody([text("wamid.A2", "STOP")]);
  const none = await hook(post(body));
  eq(none.res.status, 401, "no header");
  const wrongSecret = await hook(signed(body, "some-other-secret"));
  eq(wrongSecret.res.status, 401, "signed with another secret");
  const other = await hook(post(body, { "X-Hub-Signature-256": bot.signBody(SECRET, body + " ") }));
  eq(other.res.status, 401, "signature of a different body");
  const reserialised = JSON.stringify(JSON.parse(body), null, 2);
  const rewritten = await hook(post(reserialised, { "X-Hub-Signature-256": bot.signBody(SECRET, body) }));
  eq(rewritten.res.status, 401, "the same JSON with other white space: the raw bytes are what is signed");
  for (const h of ["", "sha256=", "sha256=zz", `sha1=${bot.signBody(SECRET, body).slice(7)}`, bot.signBody(SECRET, body).slice(7), `sha256=${"0".repeat(64)}`, `sha256=${bot.signBody(SECRET, body).slice(7)}00`, ` ${bot.signBody(SECRET, body)}x`]) {
    eq((await hook(post(body, { "X-Hub-Signature-256": h }))).res.status, 401, `header ${JSON.stringify(h.slice(0, 20))}`);
  }
  for (const env of [{ ...hookEnv, NODE_ENV: "development" }, { ...hookEnv, NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }, { ...hookEnv, NODE_ENV: "test", NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }]) {
    const fb = fakeBotDb();
    eq((await hook(post(body), { env, fb } as never)).res.status, 401, `development and fake switches do not open it (${JSON.stringify(env).slice(0, 60)})`);
    eq(fb.inbound.length, 0, "and nothing was read");
  }
  eq(bot.verifySignature(SECRET, bot.signBody(SECRET, body).toUpperCase().replace("SHA256=", "sha256="), Buffer.from(body)), true, "hex case does not matter");
  eq(bot.verifySignature(undefined, bot.signBody(SECRET, body), Buffer.from(body)), false, "no secret: false");
  const good1 = await hook(signed(body));
  eq(good1.res.status, 200, "a good signature is accepted");
  const unicode = msgBody([text("wamid.A3", "STOP \u00e9\u4e2d")]);
  eq((await hook(signed(unicode))).res.status, 200, "a body with non-ASCII text verifies the same");
  eq((await hook(signed("not json"))).res.status, 400, "signed but not JSON: 400 (after the signature)");
  eq((await hook(post("not json"))).res.status, 401, "unsigned and not JSON: 401, the body is never parsed");
});
await test("webhook POST: STOP, START, TICKET, HELP and anything else are matched exactly, ignoring case and spaces", () => {
  const cases: [string, string][] = [
    ["STOP", "stop"], ["stop", "stop"], ["Stop", "stop"], ["  stop  ", "stop"], ["\n\tSTOP\r\n", "stop"], ["\u00a0stop\u00a0", "stop"], ["\u200bSTOP", "stop"],
    ["START", "start"], ["sTaRt", "start"], ["TICKET", "ticket"], [" ticket ", "ticket"], ["HELP", "help"], ["help ", "help"],
    ["stop.", "other"], ["please stop", "other"], ["s t o p", "other"], ["STOPP", "other"], ["unsubscribe", "other"], ["", "other"], ["   ", "other"], ["stop\nstop", "other"], ["tickets", "other"], ["hello", "other"],
  ];
  for (const [input, want] of cases) eq(bot.matchKeyword(input), want, JSON.stringify(input));
});
await test("webhook POST: a STOP is acted on and confirmed once; the reply goes to the sender's number, after the 200", async () => {
  const body = msgBody([text("wamid.B1", " stop ")]);
  const order: string[] = [];
  const fb = fakeBotDb();
  const s = fakeSender(good("wamid.R1"));
  let scheduled: (() => Promise<void>) | null = null;
  const res = await bot.handleWebhook(signed(body), { env: hookEnv, db: fb.db, sender: s.sender, now, log: quiet, schedule: (w) => { order.push("scheduled"); scheduled = w; } });
  order.push("answered");
  eq(res.status, 200, "200");
  eq(s.sent.length, 0, "no reply has gone out when the answer is given");
  eq(order, ["scheduled", "answered"], "the reply is handed to be sent after");
  await scheduled!();
  eq(fb.inbound, [{ id: "wamid.B1", number: DIGITS, keyword: "stop" }], "the database got the message id, the number and the keyword");
  eq(s.sent, [{ to: NUMBER, text: bot.WA_STOP_DONE }], "one confirmation, to that number");
  eq(fb.replies, ["wamid.R1"], "and it is logged so its price can be matched");
});
await test("webhook POST: replays are harmless: the same batch twice replies once and changes nothing the second time", async () => {
  const body = msgBody([text("wamid.C1", "STOP"), text("wamid.C2", "HELP", "2348022222222")]);
  const fb = fakeBotDb();
  const first = await hook(signed(body), { fb } as never);
  const second = await hook(signed(body), { fb } as never);
  eq([first.body.replies, second.body.replies], [2, 0], "two replies, then none");
  eq([first.s.sent.length, second.s.sent.length], [2, 0], "the sender was used only the first time");
  eq(fb.inbound.length, 4, "the database was asked both times (it is where idempotency lives)");
  const dup = msgBody([text("wamid.C3", "STOP"), text("wamid.C3", "STOP")]);
  const d = await hook(signed(dup), { fb: fakeBotDb() } as never);
  eq(d.s.sent.length, 1, "the same message twice in one batch: one reply");
});
await test("webhook POST: help text for HELP and anything else, a ticket link for TICKET, the START refusal and the limits' silence", async () => {
  const r = await hook(signed(msgBody([text("wamid.D1", "HELP"), text("wamid.D2", "what is this?", "2348022222222"), text("wamid.D3", "TICKET", "2348033333333")])));
  eq(r.s.sent.map((x) => x.text), [
    "This number sends your Hoppaz reminders. Reply TICKET for your ticket, STOP to stop.",
    "This number sends your Hoppaz reminders. Reply TICKET for your ticket, STOP to stop.",
    "Your next ticket: Detty Night, Tuesday 3 Nov, 7:30 PM. https://hoppaz.fun/event/detty-night",
  ], "the three replies");
  const none = await hook(signed(msgBody([text("wamid.D4", "START")])), { fb: fakeBotDb({ decide: () => ({ status: "ok", reply: "start_no" }) }) } as never);
  eq(none.s.sent[0].text, bot.WA_START_NO, "START with no earlier agreement says to turn it on at checkout");
  ok(/at checkout/.test(bot.WA_START_NO), "and says so");
  const limited = await hook(signed(msgBody([text("wamid.D5", "HELP")])), { fb: fakeBotDb({ decide: () => ({ status: "ok", reply: null, why: "hourly limit" }) }) } as never);
  eq([limited.res.status, limited.s.sent.length], [200, 0], "over a limit: 200 and no reply");
  eq(bot.replyText({ status: "ok", reply: "ticket", ticket: {} }), bot.WA_TICKET_NONE, "a ticket with no event in it is never sent as a blank");
  eq(bot.replyText({ status: "ok", reply: null }), null, "no reply, no text");
  eq(bot.replyText({ status: "ok", reply: "stop" }), "You're unsubscribed from Hoppaz WhatsApp reminders. Reply START to turn them back on.", "the STOP confirmation");
});
await test("webhook POST: status updates are logged and never answered", async () => {
  const body = statusBody([
    { id: "wamid.E1", status: "delivered", timestamp: "1", recipient_id: DIGITS, pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "utility" } },
    { id: "wamid.E2", status: "failed", timestamp: "1", recipient_id: DIGITS, errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "to " + DIGITS } }] },
    { id: "wamid.E3", status: "read", timestamp: "1", recipient_id: DIGITS },
    { id: "wamid.E4", status: "played", timestamp: "1", recipient_id: DIGITS },
    { id: "wamid.E5", status: "sent", timestamp: "1", recipient_id: DIGITS, pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" } },
  ]);
  const r = await hook(signed(body));
  eq([r.res.status, r.body.statuses, r.s.sent.length, r.fb.inbound.length], [200, 4, 0, 0], "four statuses kept (played dropped), no reply, no message read");
  eq(r.fb.statuses[0], [
    { message_id: "wamid.E1", status: "delivered", priced: true, billable: true, category: "utility", error: null },
    { message_id: "wamid.E2", status: "failed", priced: false, billable: false, category: null, error: "131026: Message undeliverable" },
    { message_id: "wamid.E3", status: "read", priced: false, billable: false, category: null, error: null },
    { message_id: "wamid.E5", status: "sent", priced: true, billable: false, category: "service", error: null },
  ], "what the database is given");
  ok(!JSON.stringify(r.fb.statuses).includes(DIGITS), "the recipient's number is not passed on");
  const old = bot.parseWebhook(JSON.parse(statusBody([{ id: "wamid.E6", status: "delivered", pricing: { billable: true, category: "utility" } }])));
  eq(old.statuses[0].billable, true, "pricing with no type falls back to the deprecated billable flag");
  const free = bot.parseWebhook(JSON.parse(statusBody([{ id: "wamid.E7", status: "delivered", pricing: { billable: true, type: "free_entry_point", category: "utility" } }])));
  eq(free.statuses[0].billable, false, "type free_entry_point is not billable, whatever the old flag says");
});
await test("webhook POST: a group message, our own number, an echo, a reaction, a picture and a malformed sender are never answered", async () => {
  const ours = { display_phone_number: "+234 900 000 0000", phone_number_id: "106540352242922" };
  const cases: [string, unknown][] = [
    ["group_id", { ...text("wamid.G1", "HELP"), group_id: "120363@g.us" }],
    ["recipient_type group", { ...text("wamid.G2", "HELP"), recipient_type: "group" }],
    ["our display number", text("wamid.G3", "HELP", "2349000000000")],
    ["our phone number id", text("wamid.G4", "HELP", "106540352242922")],
    ["from_me", { ...text("wamid.G5", "HELP"), from_me: true }],
    ["a reaction", { from: DIGITS, id: "wamid.G6", timestamp: "1", type: "reaction", reaction: { emoji: "x", message_id: "wamid.Z" } }],
    ["an image", { from: DIGITS, id: "wamid.G7", timestamp: "1", type: "image", image: { id: "1" } }],
    ["a sticker", { from: DIGITS, id: "wamid.G8", timestamp: "1", type: "sticker", sticker: { id: "1" } }],
    ["a button reply", { from: DIGITS, id: "wamid.G9", timestamp: "1", type: "button", button: { text: "x" } }],
    ["an unsupported type", { from: DIGITS, id: "wamid.G10", timestamp: "1", type: "unsupported", errors: [{ code: 131051 }] }],
    ["a sender with a plus", text("wamid.G11", "HELP", "+2348012345678")],
    ["a sender that is not a number", text("wamid.G12", "HELP", "group@g.us")],
    ["a sender too short", text("wamid.G13", "HELP", "12345")],
    ["no id", { from: DIGITS, timestamp: "1", type: "text", text: { body: "HELP" } }],
    ["text that is not text", { from: DIGITS, id: "wamid.G14", timestamp: "1", type: "text", text: { body: 5 } }],
  ];
  for (const [what, m] of cases) {
    const r = await hook(signed(msgBody([m], ours)));
    eq([r.res.status, r.fb.inbound.length, r.s.sent.length], [200, 0, 0], `${what}: ignored`);
  }
  const echo = await hook(signed(msgBody([text("wamid.G15", "This number sends your Hoppaz reminders. Reply TICKET for your ticket, STOP to stop.", "2349000000000")], ours)));
  eq([echo.fb.inbound.length, echo.s.sent.length], [0, 0], "our own help text coming back at us is not answered (no loop)");
  const other = await hook(signed(msgBody([text("wamid.G16", "HELP")], ours, "smb_message_echoes")));
  eq([other.fb.inbound.length, other.s.sent.length], [0, 0], "a change under another field name is ignored");
  const notWa = await hook(signed(JSON.stringify({ object: "page", entry: [] })));
  eq([notWa.res.status, notWa.s.sent.length], [200, 0], "not a WhatsApp payload: nothing");
  const mixed = await hook(signed(msgBody([{ ...text("wamid.G17", "HELP"), group_id: "x" }, text("wamid.G18", "HELP")], ours)));
  eq([mixed.fb.inbound.length, mixed.s.sent.length], [1, 1], "a real message next to a group one is still answered");
});
await test("webhook POST: a ping-pong with another bot ends after one reply (the limit is the database's; here the loop is cut by what we never answer)", async () => {
  // Another bot answers every reply we send. With a database that limits as the SQL does (one help an hour), 30 round trips cost one message.
  let last = -1e9;
  const fb = fakeBotDb({ decide: (_kw, id) => { const t = Number(id.split(".")[1]); if (t - last < 60) return { status: "ok", reply: null, why: "hourly limit" }; last = t; return { status: "ok", reply: "help" }; } });
  let sent = 0;
  for (let i = 1; i <= 30; i++) {
    const r = await hook(signed(msgBody([text(`wamid.${i}`, "This number sends your Hoppaz reminders. Reply TICKET for your ticket, STOP to stop.")])), { fb } as never);
    sent += r.s.sent.length;
  }
  eq(sent, 1, "one reply in 30 messages");
  const statusLoop = await hook(signed(statusBody(Array.from({ length: 500 }, (_, i) => ({ id: `wamid.S${i}`, status: "delivered", recipient_id: DIGITS })))));
  eq(statusLoop.s.sent.length, 0, "500 status updates: no reply at all");
});
await test("webhook POST: a database failure is a 500 (Meta tries again) and no reply goes out; a failing sender does not break the 200", async () => {
  const body = msgBody([text("wamid.H1", "STOP")]);
  const down = await hook(signed(body), { fb: fakeBotDb({ fail: true }) } as never);
  eq([down.res.status, down.s.sent.length], [500, 0], "database down");
  const noDb = await hook(signed(body), { db: null });
  eq(noDb.res.status, 503, "no database configured");
  const noMessages = await hook(signed(msgBody([])), { db: null });
  eq(noMessages.res.status, 200, "nothing to do needs no database");
  const bad = fakeSender({ ok: false, error: `whatsapp 400 code 131047: too late for ${DIGITS}`, retryable: false });
  const logs: string[] = [];
  const r1 = await bot.handleWebhook(signed(body), { env: hookEnv, db: fakeBotDb().db, sender: bad.sender, now, log: (l) => logs.push(l) });
  eq(r1.status, 200, "the reply failed, the answer is still 200 (the keyword was acted on)");
  ok(logs.length === 1 && !logs.join("").includes(DIGITS) && /\+234\*+78/.test(logs.join("")), "and the log line has the number masked");
  const throwing: WhatsAppSender = { name: "whatsapp", sendTemplate: async () => good(), sendText: async () => { throw new Error(`socket error to +${DIGITS}`); } };
  const logs2: string[] = [];
  const r2 = await bot.handleWebhook(signed(body), { env: hookEnv, db: fakeBotDb().db, sender: throwing, now, log: (l) => logs2.push(l) });
  eq(r2.status, 200, "a sender that throws does not break the answer");
  const noSender = await hook(signed(body), { sender: null });
  eq(noSender.res.status, 200, "no sender set up: STOP is still acted on");
  eq(noSender.fb.inbound.length, 1, "the database was told");
});
await test("webhook: no log line of a whole handled call holds a whole number", async () => {
  const logs: string[] = [];
  const fb = fakeBotDb({ fail: true });
  await bot.handleWebhook(signed(msgBody([text("wamid.L1", "STOP")])), { env: hookEnv, db: fb.db, sender: fakeSender(good()).sender, now, log: (l) => logs.push(l) });
  const ok2 = await bot.handleWebhook(signed(msgBody([text("wamid.L2", "STOP")])), { env: hookEnv, db: fakeBotDb().db, sender: null, now, log: (l) => logs.push(l) });
  eq(ok2.status, 200, "ok");
  ok(!logs.join("\n").includes("2348012345678") && !logs.join("\n").includes("8012345678"), `no number in ${JSON.stringify(logs)}`);
});
await test("webhook route: GET and POST on the real route file refuse without the settings, and never reach Meta", async () => {
  const keep = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (/^WHATSAPP_|^NEXT_PUBLIC_SUPABASE|^SUPABASE_/.test(k)) delete process.env[k];
    eq((await route.GET(new Request(`${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=a&hub.challenge=1`))).status, 403, "GET, token unset");
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY;
    const g = await route.GET(new Request(`${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=77`));
    eq([g.status, await g.text()], [200, "77"], "GET, right token");
    eq((await route.POST(post("{}"))).status, 503, "POST, secret unset");
    process.env.WHATSAPP_APP_SECRET = SECRET;
    eq((await route.POST(post("{}"))).status, 401, "POST, unsigned");
    const body = msgBody([text("wamid.RT1", "STOP")]);
    eq((await route.POST(signed(body))).status, 503, "POST, signed, no database configured: refused, nothing done");
    const empty = msgBody([]);
    eq((await route.POST(signed(empty))).status, 200, "POST, signed, nothing in it: 200");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
  eq(realFetchCalls, 0, "the real fetch was never called");
});

await test("nothing in this file reached the real network", () => {
  eq(realFetchCalls, 0, "the real fetch was never called");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
