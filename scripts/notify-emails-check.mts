/**
 * Plain checks for notification step 2: the Brevo and Mailjet providers (against a FAKE fetch: no network, no key, no real call), the
 * email templates, rendering in the router, the QR route and the /dev/emails gate. Run from the repo root:
 *   node --no-warnings scripts/notify-emails-check.mts
 * The provider request shapes are checked against the providers' published docs only, because nothing is ever sent to them from here.
 * The SQL half is supabase/tests/events_r1_notify_emails_test.sql (it needs the local database).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { OutgoingEmail } from "../src/lib/notify/provider.ts";
import type { ClaimedRow } from "../src/lib/notify/types.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server" || specifier === "next/navigation" || specifier === "next/headers") return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]sx?$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createBrevoProvider, BREVO_URL } = await import("../src/lib/notify/brevo.ts");
const { createMailjetProvider, MAILJET_URL } = await import("../src/lib/notify/mailjet.ts");
const { parseAddress } = await import("../src/lib/notify/mailcommon.ts");
const { buildProviders } = await import("../src/lib/notify/providers.ts");
const { renderEmail, TEMPLATE_KINDS, NoTemplateError, UNSUBSCRIBE_KINDS } = await import("../src/lib/notify/templates/index.ts");
const { formatWhen, naira, esc, oneLine } = await import("../src/lib/notify/templates/format.ts");
const { SAMPLES, SAMPLE_TOKEN } = await import("../src/lib/notify/templates/samples.ts");
const { unsubscribeUrlFor } = await import("../src/lib/notify/templates/unsubscribe.ts");
const { routeEmail, newRouterState } = await import("../src/lib/notify/router.ts");
const { KIND_RULES } = await import("../src/lib/notify/types.ts");
const qr = await import("../src/app/api/notify/qr/route.ts");

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

// ------------------------------------------------------------------ a fake fetch ---
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}
const throwingFetch = async () => {
  throw new Error("connect ECONNREFUSED");
};

const mail = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  to: "ada@example.com",
  kind: "registered",
  payload: {},
  queueId: "11111111-1111-4111-8111-111111111111",
  dedupeKey: "registered:abc:1",
  priority: 1,
  capKind: "guest",
  subject: "You're going to Afro Night",
  html: "<p>hi</p>",
  text: "hi",
  headers: {},
  ...over,
});

// ------------------------------------------------------------------ Brevo ---
await test("brevo: the request is the documented one (url, api-key header, body fields)", async () => {
  const f = fakeFetch(201, { messageId: "<202611081830.1234@smtp-relay.mailin.fr>" });
  const p = createBrevoProvider({ BREVO_API_KEY: "xkeysib-test" }, f.fn);
  eq([p.name, [...p.kinds]], ["brevo", ["guest"]], "name and kinds");
  const res = await p.send(mail({ headers: { "List-Unsubscribe": "<https://x.test/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }));
  eq(res, { ok: true, messageId: "<202611081830.1234@smtp-relay.mailin.fr>", costUsd: 0 }, "result");
  eq(f.calls.length, 1, "one call");
  eq(f.calls[0].url, "https://api.brevo.com/v3/smtp/email", "url");
  eq(BREVO_URL, "https://api.brevo.com/v3/smtp/email", "exported url");
  eq(f.calls[0].method, "POST", "method");
  eq(f.calls[0].headers["api-key"], "xkeysib-test", "api-key header");
  eq(f.calls[0].headers["Content-Type"], "application/json", "content type");
  eq(f.calls[0].body, {
    sender: { name: "Hoppaz", email: "tickets@mail.hoppaz.fun" },
    to: [{ email: "ada@example.com" }],
    replyTo: { email: "hello@hoppaz.fun" },
    subject: "You're going to Afro Night",
    htmlContent: "<p>hi</p>",
    textContent: "hi",
    headers: { "List-Unsubscribe": "<https://x.test/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Hoppaz-Queue": "11111111-1111-4111-8111-111111111111" },
    tags: ["registered"],
  }, "body");
});
await test("brevo: NOTIFY_FROM_GUEST and NOTIFY_REPLY_TO are used; the dedupe key is not sent (no idempotency in the docs)", async () => {
  const f = fakeFetch(201, { messageId: "m" });
  await createBrevoProvider({ BREVO_API_KEY: "k", NOTIFY_FROM_GUEST: "Hoppaz Tickets <t@mail.example.com>", NOTIFY_REPLY_TO: "help@example.com" }, f.fn).send(mail());
  const b = f.calls[0].body as Record<string, unknown>;
  eq([b.sender, b.replyTo], [{ name: "Hoppaz Tickets", email: "t@mail.example.com" }, { email: "help@example.com" }], "sender and reply-to");
  ok(!JSON.stringify(f.calls[0]).includes("registered:abc:1"), "the dedupe key is nowhere in the request");
});
await test("brevo: without BREVO_API_KEY it cannot be built", () => {
  let err = "";
  try {
    createBrevoProvider({}, fakeFetch(201, {}).fn);
  } catch (e) {
    err = (e as Error).message;
  }
  ok(/BREVO_API_KEY/.test(err), "names the missing variable");
});
await test("brevo: how each response is handled", async () => {
  const run = async (status: number, body: unknown) => createBrevoProvider({ BREVO_API_KEY: "k" }, fakeFetch(status, body).fn).send(mail());
  eq((await run(201, { messageIds: ["a", "b"] })).ok, true, "messageIds works too");
  const noId = await run(201, {});
  ok(!noId.ok && /no messageId/.test(noId.error) && noId.limit === undefined && noId.retryable === undefined, "201 with no id is a plain failure");
  const rate = await run(429, { code: "too_many_requests", message: "The expected rate limit is exceeded." });
  ok(!rate.ok && rate.limit === true && /429/.test(rate.error), "429 is a limit");
  const credits = await run(400, { code: "not_enough_credits", message: "Your account does not have enough credits" });
  ok(!credits.ok && credits.limit === true, "not_enough_credits is a limit");
  const daily = await run(400, { code: "permission_denied", message: "Daily sending limit reached" });
  ok(!daily.ok && daily.limit === true, "a daily limit message is a limit");
  const bad = await run(400, { code: "invalid_parameter", message: "Invalid email address in to" });
  ok(!bad.ok && bad.retryable === false && bad.limit === undefined, "a bad recipient can never go: retryable false");
  const other400 = await run(400, { code: "missing_parameter", message: "sender is missing" });
  ok(!other400.ok && other400.retryable === undefined && other400.limit === undefined, "any other 400 is a plain failure the next provider may rescue");
  const auth = await run(401, { code: "unauthorized", message: "Key not found" });
  ok(!auth.ok && auth.limit === true && /BREVO_API_KEY/.test(auth.error), "a refused key stops Brevo for the run, with the reason");
  const down = await run(503, { message: "unavailable" });
  ok(!down.ok && down.retryable === undefined && down.limit === undefined && /503/.test(down.error), "5xx is a plain, retryable failure");
  const empty = await run(500, undefined);
  ok(!empty.ok && /500/.test(empty.error), "an empty body does not break it");
  const net = await createBrevoProvider({ BREVO_API_KEY: "k" }, throwingFetch).send(mail());
  ok(!net.ok && /network error/.test(net.error) && net.retryable === undefined, "a network failure is a plain failure");
});
await test("brevo and mailjet: a message with nothing rendered is refused and never sent", async () => {
  const fb = fakeFetch(201, { messageId: "m" });
  const fm = fakeFetch(200, {});
  for (const [p, f] of [[createBrevoProvider({ BREVO_API_KEY: "k" }, fb.fn), fb], [createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, fm.fn), fm]] as const) {
    for (const over of [{ html: "" }, { text: undefined }, { subject: "  " }]) {
      const r = await p.send(mail(over));
      ok(!r.ok && r.retryable === false, `${p.name} refuses ${JSON.stringify(over)}`);
    }
    eq(f.calls.length, 0, `${p.name}: no request`);
  }
});

// ------------------------------------------------------------------ Mailjet ---
const mjOk = { Messages: [{ Status: "success", To: [{ Email: "ada@example.com", MessageUUID: "uuid-1", MessageID: 576460752303423500, MessageHref: "https://api.mailjet.com/v3/REST/message/576460752303423500" }] }] };
await test("mailjet: the request is the documented one (url, Basic auth, Messages[0] fields)", async () => {
  const f = fakeFetch(200, mjOk);
  const p = createMailjetProvider({ MAILJET_API_KEY: "pub", MAILJET_SECRET_KEY: "priv" }, f.fn);
  eq([p.name, [...p.kinds]], ["mailjet", ["guest", "code"]], "name and kinds");
  const res = await p.send(mail({ headers: { "List-Unsubscribe": "<https://x.test/u>" } }));
  eq(res, { ok: true, messageId: "576460752303423500", costUsd: 0 }, "result uses MessageID");
  eq(f.calls[0].url, "https://api.mailjet.com/v3.1/send", "url");
  eq(MAILJET_URL, "https://api.mailjet.com/v3.1/send", "exported url");
  eq(f.calls[0].method, "POST", "method");
  eq(f.calls[0].headers.Authorization, `Basic ${Buffer.from("pub:priv").toString("base64")}`, "basic auth is public:private");
  eq(f.calls[0].body, {
    Messages: [{
      From: { Email: "tickets@mail.hoppaz.fun", Name: "Hoppaz" },
      To: [{ Email: "ada@example.com" }],
      ReplyTo: { Email: "hello@hoppaz.fun" },
      Subject: "You're going to Afro Night",
      TextPart: "hi",
      HTMLPart: "<p>hi</p>",
      Headers: { "List-Unsubscribe": "<https://x.test/u>" },
      CustomID: "11111111-1111-4111-8111-111111111111",
    }],
  }, "body");
});
await test("mailjet: no Headers key when there are none, and a code mail comes from the code sender", async () => {
  const f = fakeFetch(200, mjOk);
  const p = createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, f.fn);
  await p.send(mail());
  ok(!("Headers" in (f.calls[0].body as { Messages: object[] }).Messages[0]), "no empty Headers");
  await p.send(mail({ capKind: "code" }));
  eq(((f.calls[1].body as { Messages: Array<{ From: unknown }> }).Messages[0]).From, { Email: "login@auth.hoppaz.fun", Name: "Hoppaz" }, "code sender");
});
await test("mailjet: needs both keys", () => {
  for (const env of [{ MAILJET_API_KEY: "a" }, { MAILJET_SECRET_KEY: "b" }, {}]) {
    let err = "";
    try {
      createMailjetProvider(env, fakeFetch(200, {}).fn);
    } catch (e) {
      err = (e as Error).message;
    }
    ok(/MAILJET_API_KEY and MAILJET_SECRET_KEY/.test(err), "names both variables");
  }
});
await test("mailjet: how each response is handled", async () => {
  const run = async (status: number, body: unknown) => createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, fakeFetch(status, body).fn).send(mail());
  const status400 = (errors: unknown[]) => ({ Messages: [{ Status: "error", Errors: errors }] });
  eq((await run(200, { Messages: [{ Status: "success", To: [{ MessageUUID: "only-uuid" }] }] })), { ok: true, messageId: "only-uuid", costUsd: 0 }, "falls back to MessageUUID");
  const noId = await run(200, { Messages: [{ Status: "success", To: [{}] }] });
  ok(!noId.ok && /no MessageID/.test(noId.error), "success with no id is a failure");
  const rate = await run(429, { ErrorMessage: "Too many requests" });
  ok(!rate.ok && rate.limit === true, "429 is a limit");
  const quota = await run(400, status400([{ ErrorIdentifier: "x", ErrorCode: "send-0010", StatusCode: 400, ErrorMessage: "Daily sending quota exceeded for this account", ErrorRelatedTo: ["Messages"] }]));
  ok(!quota.ok && quota.limit === true, "a quota message is a limit");
  const badTo = await run(400, status400([{ ErrorIdentifier: "y", ErrorCode: "mj-0013", StatusCode: 400, ErrorMessage: "\"nope\" is an invalid email address.", ErrorRelatedTo: ["To[0].Email"] }]));
  ok(!badTo.ok && badTo.retryable === false && badTo.limit === undefined, "an invalid recipient can never go: retryable false");
  const sender = await run(400, status400([{ ErrorCode: "send-0003", StatusCode: 400, ErrorMessage: "Sender is not validated", ErrorRelatedTo: ["From"] }]));
  ok(!sender.ok && sender.retryable === undefined && sender.limit === undefined, "a sender problem is a plain failure");
  const auth = await run(401, { ErrorMessage: "API key authentication/authorization failure." });
  ok(!auth.ok && auth.limit === true && /MAILJET_API_KEY/.test(auth.error), "a refused key stops Mailjet for the run");
  const down = await run(500, { ErrorIdentifier: "D4DF574C", ErrorMessage: "Internal Server Error" });
  ok(!down.ok && down.limit === undefined && down.retryable === undefined && /500/.test(down.error), "500 is a plain failure");
  const odd = await run(200, { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "weird" }] }] });
  ok(!odd.ok, "HTTP 200 with a status that is not success is a failure");
  const net = await createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, throwingFetch).send(mail());
  ok(!net.ok && /network error/.test(net.error), "a network failure is a plain failure");
});
await test("addresses: Name <a@b> and bare addresses parse, rubbish throws", () => {
  eq(parseAddress("Hoppaz <tickets@mail.hoppaz.fun>"), { name: "Hoppaz", email: "tickets@mail.hoppaz.fun" }, "named");
  eq(parseAddress('"Hoppaz Tickets" <t@x.co>'), { name: "Hoppaz Tickets", email: "t@x.co" }, "quoted");
  eq(parseAddress("hello@hoppaz.fun"), { email: "hello@hoppaz.fun" }, "bare");
  let err = false;
  try {
    parseAddress("not an address");
  } catch {
    err = true;
  }
  ok(err, "throws");
});
await test("providers: brevo and mailjet are built when their keys are there, in the order given, and left out with a warning when not", () => {
  const warned: string[] = [];
  const both = buildProviders({ NOTIFY_PROVIDERS: "brevo,mailjet", BREVO_API_KEY: "k", MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, (l) => warned.push(l));
  eq(both.map((p) => p.name), ["brevo", "mailjet"], "order");
  eq(warned.length, 0, "no warnings");
  const none = buildProviders({ NOTIFY_PROVIDERS: "brevo,mailjet", MAILJET_API_KEY: "a" }, (l) => warned.push(l));
  eq(none.length, 0, "neither without its keys");
  ok(warned.length === 2 && warned.every((w) => /not set up/.test(w)), "one warning each");
});

// ------------------------------------------------------------------ templates ---
const SITE = "https://hoppaz.example";
const NOW = new Date("2026-10-31T10:00:00Z");
const render = (kind: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  renderEmail(kind, payload, { site: SITE, now: NOW, to: "ada@example.com", ...extra });

await test("templates: all 16 kinds have one, and they match the kinds the queue knows", () => {
  eq([...TEMPLATE_KINDS].sort(), ["approved", "declined", "event_cancelled", "event_changed", "host_live", "host_pop", "reminder_day", "reminder_hour", "receipt", "refund_sent", "registered", "request_sent", "spot_opened", "thanks", "waitlisted", "you_cancelled"].sort(), "kinds");
  for (const k of TEMPLATE_KINDS) ok(k in KIND_RULES, `${k} is in KIND_RULES`);
  eq(KIND_RULES.registered.priority, 1, "G1");
  eq(KIND_RULES.request_sent.priority, 2, "G3");
  eq(KIND_RULES.declined.priority, 3, "G5");
  eq(KIND_RULES.refund_sent.priority, 2, "G14");
  eq(KIND_RULES.thanks.priority, 5, "G15");
  eq(KIND_RULES.host_live.priority, 3, "H1");
});
await test("templates: every sample renders with a subject, html and text, and nothing like undefined, null or an em dash", () => {
  for (const s of SAMPLES) {
    const m = render(s.kind, s.payload);
    ok(m.subject.length > 3 && m.subject.length <= 120 && !/[\r\n]/.test(m.subject), `${s.label}: subject is one short line`);
    ok(m.html.startsWith("<!doctype html>") && m.html.length > 1500 && m.text.length > 80, `${s.label}: html and text are real`);
    for (const part of [m.subject, m.html, m.text]) ok(!/undefined|\bnull\b|\[object|NaN/.test(part), `${s.label}: no undefined, null or NaN`);
    for (const part of [m.subject, m.html, m.text]) ok(!/\u2014|\u2013/.test(part), `${s.label}: no em or en dash`);
    ok(/<h1[^>]*>[^<]+<\/h1>/.test(m.html), `${s.label}: one headline`);
    eq((m.html.match(/<a [^>]*href=/g) ?? []).length >= 2, true, `${s.label}: has the button and the logo link`);
  }
});
await test("templates: one button per email, the event facts line is plain, and the text version carries the same button and facts", () => {
  const m = render("registered", SAMPLES[0].payload);
  eq((m.html.match(/text-transform:uppercase;color:#0E0B0A;text-decoration:none/g) ?? []).length, 1, "one button");
  ok(m.html.includes("Saturday 7 Nov, 7:30 PM · Terra Kulture, Victoria Island"), "facts line in the html");
  ok(m.text.includes("Saturday 7 Nov, 7:30 PM · Terra Kulture, Victoria Island"), "facts line in the text");
  ok(m.html.includes(`href="${SITE}/event/afro-soiree-4f2a"`) && m.text.includes(`View ticket: ${SITE}/event/afro-soiree-4f2a`), "the button goes to the event page by slug");
  ok(m.html.includes("#0E0B0A") && m.html.includes("#FF4D00") && m.html.includes("Poppins") && m.html.includes("Archivo") && m.html.includes(`${SITE}/brand/wordmark-orange.png`), "Hoppaz colours, fonts and wordmark");
  ok(/<table role="presentation"/.test(m.html) && !/<script/i.test(m.html), "table layout, no script");
  const noSlug = render("registered", { ...SAMPLES[0].payload, slug: undefined });
  ok(noSlug.html.includes(`${SITE}/event/22222222-2222-4222-8222-222222222222`), "no slug: the event id is used");
});
await test("templates: times are shown in the event's own timezone, exact, and the year only when it is not this year", () => {
  eq(formatWhen("2026-11-08T18:30:00+00:00", "Africa/Lagos", NOW), "Sunday 8 Nov, 7:30 PM", "Lagos is UTC+1");
  eq(formatWhen("2026-11-07T23:30:00Z", "Africa/Lagos", NOW), "Sunday 8 Nov, 12:30 AM", "past midnight is the next day");
  eq(formatWhen("2027-01-02T09:00:00Z", "Africa/Lagos", NOW), "Saturday 2 Jan 2027, 10:00 AM", "next year shows the year");
  eq(formatWhen("2026-11-08T18:30:00Z", "America/New_York", NOW), "Sunday 8 Nov, 1:30 PM EST", "another timezone names itself");
  eq(formatWhen("2026-11-08T18:30:00Z", "Not/AZone", NOW), "Sunday 8 Nov, 7:30 PM", "a bad timezone falls back to Lagos");
  eq([formatWhen(null, "Africa/Lagos"), formatWhen("nope", "Africa/Lagos"), formatWhen("", "Africa/Lagos")], [null, null, null], "no date");
  const m = render("reminder_day", { ...SAMPLES[9].payload, starts_at: "2026-11-08T20:00:00Z" });
  ok(m.html.includes("Sunday 8 Nov, 9:00 PM"), "rendered in the email too");
  ok(!m.html.includes("Saturday"), "the weekday comes from the date (8 Nov 2026 is a Sunday)");
  eq([naira(1_500_000), naira(1_250_050), naira(0), naira(null), naira(-5), naira("700000")], ["₦15,000", "₦12,500.50", "₦0", null, null, "₦7,000"], "naira");
});
await test("templates: host and guest written text is escaped everywhere it appears", () => {
  const evil = `<img src=x onerror=alert(1)> & "q" 'a'`;
  for (const s of SAMPLES) {
    const m = render(s.kind, { ...s.payload, title: evil, venue_name: evil, host_name: evil, name: evil, body: evil, room_name: evil, prev_venue_name: evil });
    ok(!m.html.includes("<img src=x") && !m.html.includes("onerror=alert(1)>"), `${s.label}: no raw tag survives`);
    ok(!/<script/i.test(m.html), `${s.label}: no script`);
    if (/&lt;img/.test(m.html)) ok(m.html.includes("&amp;") && m.html.includes("&quot;q&quot;"), `${s.label}: & and quotes escaped`);
    ok(!/[\r\n]/.test(m.subject), `${s.label}: subject is one line`);
  }
  ok(render("registered", { ...SAMPLES[0].payload, title: evil }).html.includes("&lt;img src=x onerror=alert(1)&gt;"), "the title is shown as text");
  eq(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "esc");
  eq(oneLine("Line one\r\nLine two  three", 120), "Line one Line two three", "a newline cannot get into a subject");
  ok(oneLine("x".repeat(300)).length === 120, "and a subject is cut at 120");
  const multi = render("host_pop", { ...SAMPLES[11].payload, body: "Line one\nLine two <b>" });
  ok(multi.html.includes("Line one<br>Line two &lt;b&gt;"), "a Pop keeps its line breaks, escaped");
  const hdr = render("registered", { ...SAMPLES[0].payload, title: "Night\r\nBcc: evil@example.com" });
  ok(!/[\r\n]/.test(hdr.subject) && Object.keys(hdr.headers).length === 0, "no header injection through a title");
});
await test("templates: unsubscribe link and headers only on G10, G11, G12 and G15, and only when there is a URL", () => {
  eq(unsubscribeUrlFor({ kind: "reminder_day", userId: "u", queueId: "q" }), null, "the helper answers null for now");
  eq([...UNSUBSCRIBE_KINDS].sort(), ["host_pop", "reminder_day", "reminder_hour", "thanks"], "the four kinds");
  for (const s of SAMPLES) {
    const without = render(s.kind, s.payload);
    eq(without.headers, {}, `${s.label}: with the helper's null, no headers`);
    ok(!/nsubscribe/.test(without.html) && !/nsubscribe/.test(without.text), `${s.label}: and no unsubscribe link`);
    const withUrl = render(s.kind, s.payload, { unsubscribeUrl: "https://hoppaz.example/u/abc" });
    if ((UNSUBSCRIBE_KINDS as readonly string[]).includes(s.kind)) {
      eq(withUrl.headers, { "List-Unsubscribe": "<https://hoppaz.example/u/abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, `${s.label}: both headers`);
      ok(withUrl.html.includes('href="https://hoppaz.example/u/abc"') && withUrl.text.includes("https://hoppaz.example/u/abc"), `${s.label}: link in html and text`);
    } else {
      eq(withUrl.headers, {}, `${s.label}: a ticket, receipt, change or cancellation never carries one`);
      ok(!/nsubscribe/.test(withUrl.html), `${s.label}: and no link even if one is passed`);
    }
  }
});
await test("templates: QR is a hosted image of the token, never a data: URI, and an address is never in a URL", () => {
  for (const s of SAMPLES) {
    const m = render(s.kind, s.payload);
    ok(!/data:image|data:text|cid:/.test(m.html), `${s.label}: no data URI`);
    for (const url of [...m.html.matchAll(/(?:href|src)="([^"]*)"/g)].map((x) => x[1]).filter((u) => !u.startsWith("https://fonts.googleapis.com/"))) {
      ok(!url.includes("@") && !/mailto:/i.test(url) && !/ada%40|%40example/i.test(url), `${s.label}: no address in ${url.slice(0, 60)}`);
    }
  }
  const m = render("registered", SAMPLES[0].payload);
  ok(m.html.includes(`src="${SITE}/api/notify/qr?t=${encodeURIComponent(SAMPLE_TOKEN)}"`) && /width="200" height="200"/.test(m.html), "the image points at the QR route");
  ok(m.html.includes("K7M2XQ9R") && m.text.includes("K7M2XQ9R"), "the door code is in the html and the text");
  const two = render("receipt", SAMPLES[1].payload);
  eq((two.html.match(/\/api\/notify\/qr\?t=/g) ?? []).length, 2, "one image per seat");
  ok(two.html.includes("Ticket 1 of 2") && two.text.includes("Ticket 2 of 2: P4TWN8HC"), "labelled");
  const noToken = render("registered", { ...SAMPLES[0].payload, tickets: [{ token: null, code: "K7M2XQ9R" }] });
  ok(!noToken.html.includes("/api/notify/qr") && noToken.html.includes("K7M2XQ9R") && noToken.html.includes("View ticket"), "no token: the door code and the View ticket button, no image");
  const none = render("registered", { ...SAMPLES[0].payload, tickets: undefined });
  ok(!none.html.includes("/api/notify/qr") && none.html.includes("View ticket"), "no tickets at all: just the button");
  const many = render("receipt", { ...SAMPLES[1].payload, tickets: Array.from({ length: 9 }, (_, i) => ({ token: SAMPLE_TOKEN, code: `AAAAAAA${i + 2}` })) });
  eq((many.html.match(/\/api\/notify\/qr\?t=/g) ?? []).length, 6, "at most six images");
  ok(many.html.includes("And 3 more in the app."), "and says so");
  const cancelled = render("event_cancelled", SAMPLES[8].payload);
  ok(!cancelled.html.includes("/api/notify/qr"), "other emails carry no QR");
});
await test("templates: copy says the right thing for the cases that change it", () => {
  const ch = render("event_changed", SAMPLES[7].payload);
  ok(ch.html.includes("Was") && ch.html.includes("Saturday 7 Nov, 5:00 PM") && ch.html.includes("Now") && ch.html.includes("Saturday 7 Nov, 7:30 PM") && ch.html.includes("The Pent Studios, Lekki"), "changed: old and new time and place");
  const link = render("event_changed", { ...SAMPLES[7].payload, time_changed: false, place_changed: false, link_changed: true });
  ok(link.html.includes("The link to join changed too") && !link.html.includes(">Was<"), "changed: link only");
  ok(render("event_cancelled", SAMPLES[8].payload).text.includes("refunded"), "cancelled and paid: promises a refund");
  ok(!render("event_cancelled", { ...SAMPLES[8].payload, paid: false }).text.includes("refund"), "cancelled and free: does not");
  ok(render("waitlisted", SAMPLES[5].payload).text.includes("number 3"), "waitlist place");
  ok(render("refund_sent", SAMPLES[13].payload).text.includes("₦15,000") && render("refund_sent", { ...SAMPLES[13].payload, method: "manual" }).text.includes("bank transfer"), "refund amount and manual wording");
  ok(render("receipt", SAMPLES[1].payload).text.includes("Total paid: ₦15,675") && render("receipt", { ...SAMPLES[1].payload, fee_kobo: null }).text.indexOf("Total paid") === -1, "receipt total only when the fee is known");
  ok(render("thanks", SAMPLES[14].payload).text.includes(`${SITE}/rooms/mainland-nights`) && !render("thanks", SAMPLES[0].payload).text.includes("/rooms/"), "thanks links the room only when there is one");
  const online = render("registered", { ...SAMPLES[0].payload, kind: "online", venue_name: "Online" });
  ok(online.html.includes("Online") && !online.html.includes("Online ·"), "online events say Online");
  ok(render("registered", { ...SAMPLES[0].payload, venue_name: "To be announced" }).html.includes("Place to be announced"), "no place yet");
  ok(render("registered", { ...SAMPLES[0].payload, kind: "hybrid" }).html.includes("and online"), "hybrid");
  const bare = render("reminder_day", { title: "Night" });
  ok(bare.subject === "Tomorrow: Night" && bare.html.includes("Night"), "a thin payload still renders");
  const noName = render("registered", { ...SAMPLES[0].payload, name: "" });
  ok(noName.text.includes("You're going to") && !noName.text.includes("Hey ,"), "no name: no greeting");
  ok(render("registered", SAMPLES[0].payload).text.includes("Hey Ada, you're going"), "first name only");
});
await test("templates: an unknown kind throws NoTemplateError", () => {
  let err: unknown;
  try {
    renderEmail("sign_in_code", {});
  } catch (e) {
    err = e;
  }
  ok(err instanceof NoTemplateError && /sign_in_code/.test((err as Error).message), "named error");
  for (const bad of ["toString", "__proto__", "constructor"]) {
    let e2 = false;
    try {
      renderEmail(bad, {});
    } catch {
      e2 = true;
    }
    ok(e2, `${bad} is not a template`);
  }
});

// ------------------------------------------------------------------ the router renders first ---
const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", kind: "registered", event_id: "33333333-3333-4333-8333-333333333333",
  channel: "email", cap_kind: "guest", payload: { title: "Afro Night", tickets: [{ token: SAMPLE_TOKEN, code: "K7M2XQ9R" }] }, priority: 1, tries: 1,
  dedupe_key: "k1", email: "ada@example.com", whatsapp_number: null, ...over,
});
function spyProvider() {
  const sent: OutgoingEmail[] = [];
  return { sent, p: { name: "brevo", kinds: ["guest"] as const, async send(m: OutgoingEmail) { sent.push(m); return { ok: true as const, messageId: "m1", costUsd: 0 }; } } };
}
function caps() {
  const log: string[] = [];
  return { log, async take(p: string) { log.push(`take ${p}`); return true; }, async give(p: string) { log.push(`give ${p}`); } };
}
await test("router: the row is rendered from its kind and payload before the provider is asked, and the provider gets everything", async () => {
  const { sent, p } = spyProvider();
  const c = caps();
  const out = await routeEmail(row(), [p], c, newRouterState());
  eq(out.final, "sent", "sent");
  eq(sent.length, 1, "one send");
  ok(sent[0].subject === "You're going to Afro Night" && sent[0].html!.includes("Afro Night") && sent[0].text!.includes("K7M2XQ9R") && sent[0].capKind === "guest" && sent[0].to === "ada@example.com", "subject, html, text, cap kind and address");
  ok(sent[0].html!.includes("ada@example.com") === true && !/href="[^"]*ada@/.test(sent[0].html!), "the address is in the footer text only");
});
await test("router: a kind with no template fails with a clear reason, takes no allowance and calls no provider", async () => {
  const { sent, p } = spyProvider();
  const c = caps();
  const out = await routeEmail(row({ kind: "sign_in_code", cap_kind: "code" }), [p], c, newRouterState());
  ok(out.final === "failed" && out.attempts.length === 1, "failed, once");
  ok(/no email template for kind "sign_in_code"/.test(out.attempts[0].error ?? "") && out.attempts[0].provider === "router" && out.attempts[0].status === "failed", "with the reason in the log");
  eq([sent.length, c.log.length], [0, 0], "nothing sent, no allowance touched");
});
await test("router: a render that throws or comes back empty is never sent", async () => {
  const { sent, p } = spyProvider();
  const boom = await routeEmail(row(), [p], caps(), newRouterState(), undefined, () => {
    throw new Error("boom");
  });
  ok(boom.final === "failed" && /boom/.test(boom.attempts[0].error ?? ""), "throwing render");
  const blank = await routeEmail(row(), [p], caps(), newRouterState(), undefined, () => ({ subject: "x", html: "", text: "y", headers: {} }));
  ok(blank.final === "failed" && /empty/.test(blank.attempts[0].error ?? ""), "empty render");
  eq(sent.length, 0, "never sent");
});

// ------------------------------------------------------------------ the QR route ---
const get = (t?: string) => qr.GET(new Request(`https://hoppaz.example/api/notify/qr${t === undefined ? "" : `?t=${encodeURIComponent(t)}`}`));
await test("qr route: a token-shaped value gets a PNG, cached for a year; anything else is refused", async () => {
  const res = await get(SAMPLE_TOKEN);
  eq(res.status, 200, "status");
  eq(res.headers.get("Content-Type"), "image/png", "type");
  ok(/immutable/.test(res.headers.get("Cache-Control") ?? ""), "cached");
  const bytes = new Uint8Array(await res.arrayBuffer());
  eq([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
  ok(bytes.length > 500, "has pixels");
  const again = new Uint8Array(await (await get(SAMPLE_TOKEN)).arrayBuffer());
  eq(Buffer.compare(Buffer.from(bytes), Buffer.from(again)), 0, "the same token draws the same picture");
  for (const bad of [undefined, "", "hello", "ada@example.com", "a.b", "x".repeat(400) + "." + "y".repeat(40), "https://evil.example/x.y", `${SAMPLE_TOKEN}\n`, "aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb<script>"]) {
    const r = await get(bad);
    eq(r.status, 400, `refused: ${String(bad).slice(0, 30)}`);
  }
});

// ------------------------------------------------------------------ the dev page gate, and the house rules ---
await test("/dev/emails: gated like /dev/open, and the samples are imported only inside the development branch", async () => {
  const src = readFileSync(new URL("../src/app/dev/emails/page.tsx", import.meta.url), "utf8");
  ok(/process\.env\.NODE_ENV === "production"/.test(src) && /notFound\(\)/.test(src), "gated like /dev/open");
  ok(src.indexOf("import(") > src.indexOf("} else {"), "imports sit inside the development branch");
  // Node cannot import a .tsx page, so the 404 itself is checked in the running app (development), and by reading the branch here.
  ok(/if \(process\.env\.NODE_ENV === "production"\) \{\s*notFound\(\);\s*\} else \{/.test(src), "production takes the notFound() branch and nothing else");
});
await test("house rules: no em dash in any file this step added or edited", () => {
  const roots = ["src/lib/notify", "src/app/api/notify", "src/app/dev/emails", "scripts/notify-check.mts", "scripts/notify-emails-check.mts", "supabase/events_r1_notify.sql", "supabase/events_r1_notify_emails.sql", "supabase/tests/events_r1_notify_test.sql", "supabase/tests/events_r1_notify_emails_test.sql"];
  const files: string[] = [];
  const walk = (p: string) => {
    const full = new URL(`../${p}`, import.meta.url);
    if (statSync(full).isDirectory()) for (const n of readdirSync(full)) walk(`${p}/${n}`);
    else files.push(p);
  };
  roots.forEach(walk);
  const bad = files.filter((f) => /\u2014/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  eq(bad, [], "files with an em dash");
  ok(files.length > 20, "looked at the files");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
