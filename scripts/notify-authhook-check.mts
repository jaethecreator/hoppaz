/**
 * Plain checks for the sign-in email hook (src/app/api/auth/send-email, src/lib/notify/authhook.ts, webhooksig.ts, mailtrap.ts and the
 * templates/authcode.ts emails). No test framework, no network, no database: every provider is a fake, every fetch is a fake, and Mailtrap
 * and Mailjet are never called for real. Run from the repo root:  node --no-warnings scripts/notify-authhook-check.mts
 * Covers: the Standard Webhooks signature (a published test vector, tampering, stale and future timestamps, no secret), what each
 * email_action_type becomes (including the two codes of Secure email change), the code emails themselves (a code and never a sign-in link),
 * Mailtrap's request and its answers, the order of the providers, failover, a provider that never answers, a database that is down, the
 * rule that nothing secret reaches a log, and production never letting the log provider swallow a code.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { EmailProvider, OutgoingEmail, SendResult } from "../src/lib/notify/provider.ts";
import type { HookDeps, SendRow } from "../src/lib/notify/authhook.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context); // the route file imports it extensionless
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

const { handleSendEmailHook, planAuthMails, codeProviders, scrub, DEFAULT_LIMITS, DOCUMENTED_ACTIONS } = await import("../src/lib/notify/authhook.ts");
const { signWebhook, verifyWebhook, secretKey } = await import("../src/lib/notify/webhooksig.ts");
const { createMailtrapProvider, MAILTRAP_URL } = await import("../src/lib/notify/mailtrap.ts");
const { createMailjetProvider } = await import("../src/lib/notify/mailjet.ts");
const { buildProviders } = await import("../src/lib/notify/providers.ts");
const { renderAuthEmail, AUTH_SAMPLES, CODE_VARIANTS } = await import("../src/lib/notify/templates/authcode.ts");
const { DEFAULT_FROM_CODE } = await import("../src/lib/notify/mailcommon.ts");
const route = await import("../src/app/api/auth/send-email/route.ts");

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

// ------------------------------------------------------------------ the fixtures ---
const SECRET = `v1,whsec_${Buffer.from("a-test-secret-of-some-length-0123456789").toString("base64")}`;
const CODE = "482913";
const CODE2 = "731605";
const HASH = "hashsecret-9f8e7d6c5b4a";
const HASH2 = "hashsecret-0a1b2c3d4e5f";
const ADA = "ada@example.com";
const OLD = "ada.old@example.com";
const NEW = "ada.new@example.com";
const nowSec = () => Math.floor(Date.now() / 1000);

type Body = { user?: Record<string, unknown>; email_data?: Record<string, unknown> };
function payload(action: string, over: Body = {}): string {
  return JSON.stringify({
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: ADA, phone: "", user_metadata: {}, is_anonymous: false, ...over.user },
    email_data: { token: CODE, token_hash: HASH, redirect_to: "https://hoppaz.fun", email_action_type: action, site_url: "https://hoppaz.fun", token_new: "", token_hash_new: "", ...over.email_data },
  });
}
const request = (body: string, headers: Record<string, string> = signWebhook(SECRET, "msg_test_1", nowSec(), body)) =>
  new Request("https://hoppaz.fun/api/auth/send-email", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

type Fake = EmailProvider & { calls: OutgoingEmail[] };
function fake(name: string, kinds: Array<"code" | "guest">, answer: (msg: OutgoingEmail, n: number) => Promise<SendResult> | SendResult = () => ({ ok: true, messageId: `${name}_1`, costUsd: 0 })): Fake {
  const calls: OutgoingEmail[] = [];
  return {
    name,
    kinds,
    calls,
    async send(msg) {
      calls.push(msg);
      return answer(msg, calls.length);
    },
  };
}
const never = (): Promise<SendResult> => new Promise(() => {});

type DbCalls = { take: Array<[string, string]>; give: Array<[string, string]> };
function fakeDb(over: { take?: (p: string, k: string) => Promise<boolean>; give?: (p: string, k: string) => Promise<void> } = {}) {
  const calls: DbCalls = { take: [], give: [] };
  const target = {
    async takeCap(p: string, k: string) {
      calls.take.push([p, k]);
      return over.take ? over.take(p, k) : true;
    },
    async giveCap(p: string, k: string) {
      calls.give.push([p, k]);
      if (over.give) await over.give(p, k);
    },
  };
  // The hook may only ever ask for these two things. Anything else (the suppression list, the notify_email flag) would throw.
  const db = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
      throw new Error(`the sign-in hook must not touch the database through ${String(prop)}`);
    },
  });
  return { db, calls };
}

function harness(over: Partial<Omit<HookDeps, "providers">> & { providers?: EmailProvider[]; build?: () => EmailProvider[] } = {}) {
  const { providers: list, build, ...rest } = over;
  const logs: string[] = [];
  const rows: SendRow[] = [];
  const deferred: Promise<unknown>[] = [];
  const sendsRecorded: SendRow[][] = [];
  const d = fakeDb();
  const deps: HookDeps = {
    env: { SEND_EMAIL_HOOK_SECRET: SECRET, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" },
    providers: build ?? (() => list ?? []),
    db: d.db,
    sends: {
      async record(r) {
        sendsRecorded.push(r);
        rows.push(...r);
      },
    },
    log: { warn: (l) => logs.push(l), error: (l) => logs.push(l) },
    defer: (w) => deferred.push(w),
    limits: { deadlineMs: 1500, providerMaxMs: 600, reserveMs: 100, minProviderMs: 150, capMs: 150 },
    ...rest,
  };
  return {
    deps,
    logs,
    rows,
    db: d.calls,
    async call(body: string, headers?: Record<string, string>) {
      const res = await handleSendEmailHook(request(body, headers), deps);
      const text = await res.text();
      await Promise.allSettled(deferred);
      return { res, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
    },
  };
}
const errOf = (j: Record<string, unknown> | null) => (j?.error ?? {}) as { http_code?: number; message?: string };

// ------------------------------------------------------------------ the signature ---
await test("webhooksig: the Standard Webhooks published test vector verifies", () => {
  const headers = new Headers({
    "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
    "webhook-timestamp": "1614265330",
    "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  });
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  eq(verifyWebhook(secret, headers, '{"test": 2432232314}', 1614265330), { ok: true }, "the vector");
  eq(verifyWebhook(secret, headers, '{"test": 2432232315}', 1614265330), { ok: false, reason: "mismatch" }, "one digit changed");
});
await test("webhooksig: Supabase's secret form (v1,whsec_ and base64) and a bare base64 secret both work", () => {
  const body = payload("magiclink");
  const bare = SECRET.replace("v1,whsec_", "");
  for (const s of [SECRET, bare, `whsec_${bare}`]) eq(verifyWebhook(s, new Headers(signWebhook(SECRET, "m", 1000, body)), body, 1000), { ok: true }, `secret form ${s.slice(0, 10)}`);
});
await test("webhooksig: a changed body, a wrong secret, a changed id or timestamp are refused", () => {
  const body = payload("magiclink");
  const h = signWebhook(SECRET, "msg_1", 5000, body);
  const check = (headers: Record<string, string>, b = body, secret = SECRET) => verifyWebhook(secret, new Headers(headers), b, 5000);
  eq(check(h), { ok: true }, "good");
  eq(check(h, body.replace(CODE, "111111")), { ok: false, reason: "mismatch" }, "body changed");
  eq(check(h, `${body} `), { ok: false, reason: "mismatch" }, "a trailing space (raw body, not re-serialised)");
  eq(check(h, body, `v1,whsec_${Buffer.from("another-secret-another-secret-123").toString("base64")}`), { ok: false, reason: "mismatch" }, "wrong secret");
  eq(check({ ...h, "webhook-id": "msg_2" }), { ok: false, reason: "mismatch" }, "id changed");
  eq(check({ ...h, "webhook-timestamp": "5001" }), { ok: false, reason: "mismatch" }, "timestamp changed");
});
await test("webhooksig: missing headers, a bad timestamp, a wrong version and junk signatures are refused and never throw", () => {
  const body = "{}";
  const h = signWebhook(SECRET, "m", 5000, body);
  const check = (headers: Record<string, string>) => verifyWebhook(SECRET, new Headers(headers), body, 5000);
  eq(check({}), { ok: false, reason: "missing_headers" }, "none");
  eq(check({ ...h, "webhook-signature": "" }), { ok: false, reason: "missing_headers" }, "empty signature");
  eq(check({ ...h, "webhook-timestamp": "12x" }), { ok: false, reason: "bad_timestamp" }, "bad timestamp");
  eq(check({ ...h, "webhook-timestamp": "-5000" }), { ok: false, reason: "bad_timestamp" }, "negative timestamp");
  eq(check({ ...h, "webhook-signature": h["webhook-signature"].replace("v1,", "v2,") }), { ok: false, reason: "mismatch" }, "other version");
  for (const junk of ["v1,", "v1,%%%", "v1,AAAA", "nonsense", "v1,AAAA v1,BBBB", ","]) eq(check({ ...h, "webhook-signature": junk }), { ok: false, reason: "mismatch" }, `junk ${junk}`);
});
await test("webhooksig: stale and future timestamps are refused, and the edge of the tolerance is inclusive", () => {
  const body = "{}";
  const at = (ts: number, now: number) => verifyWebhook(SECRET, new Headers(signWebhook(SECRET, "m", ts, body)), body, now);
  eq(at(1000, 1000 + 300), { ok: true }, "exactly 5 minutes old");
  eq(at(1000, 1000 + 301), { ok: false, reason: "stale" }, "5 minutes and a second old");
  eq(at(1000, 1000 - 300), { ok: true }, "5 minutes ahead");
  eq(at(1000, 1000 - 301), { ok: false, reason: "stale" }, "too far ahead");
  eq(at(1000, 1000 + 3600), { ok: false, reason: "stale" }, "an hour old: a replay");
});
await test("webhooksig: a header with several signatures is accepted if any one is right (secret rotation), in either position", () => {
  const body = "{}";
  const good = signWebhook(SECRET, "m", 5000, body)["webhook-signature"];
  const base = signWebhook(SECRET, "m", 5000, body);
  const wrong = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  for (const sig of [`${wrong} ${good}`, `${good} ${wrong}`]) eq(verifyWebhook(SECRET, new Headers({ ...base, "webhook-signature": sig }), body, 5000), { ok: true }, "rotation");
});
await test("webhooksig: with no usable secret everything is refused, even a call signed with the very same text", () => {
  const body = "{}";
  for (const s of [undefined, "", "   ", "v1,whsec_", "whsec_", "v1,whsec_!!!notbase64!!!", "v1,whsec_ not base64"]) {
    eq(secretKey(s), null, `no key from ${JSON.stringify(s)}`);
    eq(verifyWebhook(s, new Headers(signWebhook(SECRET, "m", 5000, body)), body, 5000), { ok: false, reason: "no_secret" }, `refused with ${JSON.stringify(s)}`);
  }
});

// ------------------------------------------------------------------ what each action type becomes ---
const plan = (action: string, over: Body = {}, env: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" }) => planAuthMails(JSON.parse(payload(action, over)), env);

await test("plan: every documented email_action_type is handled (the list is Supabase's, 14 types)", () => {
  eq([...DOCUMENTED_ACTIONS].sort(), [
    "email", "email_change", "email_changed_notification", "identity_linked_notification", "identity_unlinked_notification", "invite", "magiclink",
    "mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification", "password_changed_notification", "phone_changed_notification",
    "reauthentication", "recovery", "signup",
  ].sort(), "the list");
  for (const action of DOCUMENTED_ACTIONS) {
    const p = plan(action, { user: { new_email: NEW } });
    ok(p.ok, `${action} is planned`);
    ok(p.ok && p.mails.length >= 1, `${action} sends something`);
  }
});
await test("plan: magiclink, email and signup, reauthentication give one six digit code to the person", () => {
  for (const [action, variant] of [["magiclink", "sign_in"], ["email", "sign_in"], ["signup", "sign_up"], ["reauthentication", "reauth"]] as const) {
    eq(plan(action), { ok: true, mails: [{ variant, action, to: ADA, code: CODE, ...(action === "signup" ? { name: "" } : {}) }] }, action);
  }
  const named = plan("signup", { user: { user_metadata: { name: "Ada Okoye" } } });
  ok(named.ok && named.mails[0].name === "Ada", "the first name is used for the welcome");
});
await test("plan: email_change with Secure email change OFF sends one code, to the NEW address, whichever token field holds it", () => {
  eq(plan("email_change", { user: { new_email: NEW } }), { ok: true, mails: [{ variant: "email_change_new", action: "email_change", to: NEW, code: CODE }] }, "token");
  eq(plan("email_change", { user: { new_email: NEW }, email_data: { token: "", token_new: CODE2 } }), { ok: true, mails: [{ variant: "email_change_new", action: "email_change", to: NEW, code: CODE2 }] }, "token_new only");
});
await test("plan: email_change with Secure email change ON sends two codes: token to the CURRENT address, token_new to the NEW one", () => {
  const p = plan("email_change", { user: { email: OLD, new_email: NEW }, email_data: { token: CODE, token_new: CODE2, token_hash: HASH, token_hash_new: HASH2 } });
  eq(p, {
    ok: true,
    mails: [
      { variant: "email_change_current", action: "email_change", to: OLD, code: CODE, newEmail: NEW },
      { variant: "email_change_new", action: "email_change", to: NEW, code: CODE2 },
    ],
  }, "two mails, matched to the docs' table (current: token, new: token_new)");
  ok(!JSON.stringify(p).includes(HASH) && !JSON.stringify(p).includes(HASH2), "the hashes are never used for a code email");
});
await test("plan: email_change for a guest with no email yet (the app's updateUser path) is one code to the new address", () => {
  eq(plan("email_change", { user: { email: "", new_email: NEW }, email_data: { token: CODE, token_new: CODE2 } }), { ok: true, mails: [{ variant: "email_change_new", action: "email_change", to: NEW, code: CODE }] }, "one mail");
  ok(!plan("email_change", { user: { email: OLD } }).ok, "no new address is an error, not a code to the old one");
});
await test("plan: recovery has no code and no link; invite has the one link; notices have neither", () => {
  eq(plan("recovery"), { ok: true, mails: [{ variant: "recovery", action: "recovery", to: ADA }] }, "recovery");
  const inv = plan("invite", { user: { email: NEW } });
  ok(inv.ok && inv.mails[0].link === `https://abcd.supabase.co/auth/v1/verify?token=${HASH}&type=invite&redirect_to=${encodeURIComponent("https://hoppaz.fun")}`, "invite link");
  ok(!plan("invite", {}, {}).ok, "invite without the Supabase address is an error");
  ok(!plan("invite", { email_data: { token_hash: "" } }).ok, "invite without a hash is an error");
  const bad = plan("invite", { email_data: { redirect_to: "javascript:alert(1)" } });
  ok(bad.ok && !bad.mails[0].link?.includes("redirect_to"), "a redirect that is not http(s) is dropped");
  const changed = plan("email_changed_notification", { email_data: { old_email: OLD } });
  ok(changed.ok && changed.mails[0].to === OLD, "the email-changed notice goes to the old address");
  const linked = plan("identity_linked_notification", { email_data: { provider: "google" } });
  ok(linked.ok && linked.mails[0].provider === "google" && !linked.mails[0].code, "identity notice, no code");
});
await test("plan: bad input is an error with a plain reason that never repeats the body", () => {
  for (const [what, body, hint] of [
    ["no action", {}, /email_action_type/],
    ["no code", { email_data: { token: "" } }, /six digit/],
    ["a five digit code", { email_data: { token: "12345" } }, /six digit/],
    ["a letter in the code", { email_data: { token: "12345a" } }, /six digit/],
    ["a bad address", { user: { email: "ada at example" } }, /address/],
    ["an address with a space", { user: { email: "a da@example.com" } }, /address/],
  ] as const) {
    const p = what === "no action" ? planAuthMails({}) : plan("magiclink", body as Body);
    ok(!p.ok && hint.test(p.error), `${what}: ${p.ok ? "planned" : p.error}`);
    ok(!p.ok && !p.error.includes(CODE) && !p.error.includes(ADA), `${what}: the error repeats nothing`);
  }
});
await test("plan: a type Supabase adds later is not lost if it carries a code, and a new notice is acknowledged without a send", () => {
  const code = plan("some_new_thing");
  ok(code.ok && code.mails[0].variant === "code_other" && code.mails[0].code === CODE, "a code is sent");
  ok(!plan("some_new_thing", { email_data: { token: "" } }).ok, "no code and unknown: an error");
  const note = plan("sms_changed_notification");
  ok(note.ok && note.mails.length === 0 && /not one we send/.test(note.skipped ?? ""), "a new notice is skipped");
});

// ------------------------------------------------------------------ the emails ---
await test("emails: every code email shows the six digits big, in the subject and in the text, and carries no sign-in link", () => {
  for (const s of AUTH_SAMPLES.filter((x) => (CODE_VARIANTS as readonly string[]).includes(x.mail.variant))) {
    const mail = renderAuthEmail(s.mail);
    const code = s.mail.code!;
    ok(mail.subject === `Your Hoppaz code is ${code}`, `${s.label}: subject`);
    ok(new RegExp(`font-size:38px[^>]*>${code}<`).test(mail.html), `${s.label}: the big block`);
    ok(mail.text.split("\n").includes(code), `${s.label}: the code on a line of its own in the text`);
    ok(mail.html.includes("#FF4D00") && mail.html.includes("#B83600"), `${s.label}: the orange block with the ember lip`);
    const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    ok(hrefs.every((h) => h === "https://hoppaz.fun" || h.startsWith("https://fonts.googleapis.com")), `${s.label}: only the site is linked (${hrefs.join(", ")})`);
    ok(!/verify|ConfirmationURL|token=/i.test(mail.html + mail.text), `${s.label}: no verify link`);
    ok(!/undefined|null|\[object/.test(mail.html + mail.text), `${s.label}: no stray undefined`);
  }
});
await test("emails: the two Secure email change emails say who they are for; the current-address one shows the new address masked", () => {
  const cur = renderAuthEmail(AUTH_SAMPLES.find((s) => s.mail.variant === "email_change_current")!.mail);
  ok(/a\*\*\*@example\.com/.test(cur.text) && !cur.text.includes("ada@example.com is"), "masked new address");
  ok(/second code goes to the new address/.test(cur.text), "says a second code exists");
  const nw = renderAuthEmail(AUTH_SAMPLES.find((s) => s.mail.variant === "email_change_new")!.mail);
  ok(/save this email to your account/.test(nw.text), "new address wording");
});
await test("emails: recovery says there is no password and links only to the site; the notices have no code; the invite has its one link", () => {
  const rec = renderAuthEmail({ variant: "recovery", action: "recovery", to: ADA });
  ok(/no password/i.test(rec.text) && !/\d{6}/.test(rec.text) && !/verify/.test(rec.html), "recovery text");
  const inv = renderAuthEmail(AUTH_SAMPLES.find((s) => s.mail.variant === "invite")!.mail);
  ok(inv.html.includes("sample-not-real") && /Accept the invite/.test(inv.html), "invite link and button");
  for (const s of AUTH_SAMPLES.filter((x) => /notification$/.test(x.mail.action))) {
    const m = renderAuthEmail(s.mail);
    ok(!/\d{6}/.test(m.text) && !/href="https?:\/\/(?!hoppaz\.fun|fonts)/.test(m.html), `${s.label}: no code, no link`);
  }
});
await test("emails: a code variant without a code, or an invite without a link, is never rendered blank", () => {
  for (const v of CODE_VARIANTS) {
    let err = "";
    try {
      renderAuthEmail({ variant: v, action: "x", to: ADA });
    } catch (e) {
      err = (e as Error).message;
    }
    ok(/six digit code/.test(err), `${v} needs a code`);
  }
  let err = "";
  try {
    renderAuthEmail({ variant: "invite", action: "invite", to: ADA });
  } catch (e) {
    err = (e as Error).message;
  }
  ok(/no link/.test(err), "invite needs a link");
});
await test("emails: a hostile name is escaped", () => {
  const m = renderAuthEmail(AUTH_SAMPLES.find((s) => s.label.startsWith("Awkward"))!.mail);
  ok(!m.html.includes("<script>") && m.html.includes("&lt;script&gt;"), "escaped");
});

// ------------------------------------------------------------------ Mailtrap ---
type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown>; signal?: AbortSignal };
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}
const codeMail = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  to: ADA,
  kind: "auth:magiclink",
  payload: {},
  queueId: "",
  dedupeKey: "",
  priority: 1,
  capKind: "code",
  subject: `Your Hoppaz code is ${CODE}`,
  html: "<p>hi</p>",
  text: "hi",
  headers: {},
  ...over,
});

await test("mailtrap: the request is the documented one (url, Bearer key, User-Agent, body), from codes@auth.hoppaz.fun", async () => {
  const f = fakeFetch(200, { success: true, message_ids: ["abc-123"] });
  const p = createMailtrapProvider({ MAILTRAP_API_KEY: "mt-test-key" }, f.fn);
  eq([p.name, [...p.kinds]], ["mailtrap", ["code"]], "name and kinds");
  eq(await p.send(codeMail()), { ok: true, messageId: "abc-123", costUsd: 0 }, "result");
  eq(f.calls[0].url, "https://send.api.mailtrap.io/api/send", "url");
  eq(MAILTRAP_URL, "https://send.api.mailtrap.io/api/send", "exported url");
  eq(f.calls[0].method, "POST", "method");
  eq(f.calls[0].headers.Authorization, "Bearer mt-test-key", "bearer key");
  ok(/Hoppaz/.test(f.calls[0].headers["User-Agent"]), "a User-Agent is sent (the docs say requests without one may be blocked)");
  eq(f.calls[0].headers["Content-Type"], "application/json", "content type");
  eq(f.calls[0].body, {
    from: { email: "codes@auth.hoppaz.fun", name: "Hoppaz" },
    to: [{ email: ADA }],
    reply_to: { email: "hello@hoppaz.fun" },
    subject: `Your Hoppaz code is ${CODE}`,
    text: "hi",
    html: "<p>hi</p>",
    category: "sign-in",
  }, "body");
  eq(DEFAULT_FROM_CODE, "Hoppaz <codes@auth.hoppaz.fun>", "the default code sender matches the guide");
});
await test("mailtrap: NOTIFY_FROM_CODE and NOTIFY_REPLY_TO are used; the timeout asked for reaches the request; nothing about the queue is sent", async () => {
  const f = fakeFetch(200, { success: true, message_ids: ["m"] });
  await createMailtrapProvider({ MAILTRAP_API_KEY: "k", NOTIFY_FROM_CODE: "Hoppaz Codes <c@auth.example.com>", NOTIFY_REPLY_TO: "help@example.com" }, f.fn).send(codeMail({ timeoutMs: 700 }));
  const b = f.calls[0].body;
  eq([b.from, b.reply_to], [{ email: "c@auth.example.com", name: "Hoppaz Codes" }, { email: "help@example.com" }], "sender and reply-to");
  ok(f.calls[0].signal instanceof AbortSignal, "an abort signal is passed");
  ok(!("custom_variables" in b), "no queue id or custom variables");
});
await test("mailtrap: it only sends code mail, needs MAILTRAP_API_KEY, and refuses an empty message", async () => {
  const f = fakeFetch(200, { success: true, message_ids: ["m"] });
  const p = createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, f.fn);
  ok(!(await p.send(codeMail({ capKind: "guest" }))).ok, "guest mail refused");
  ok(!(await p.send(codeMail({ capKind: undefined }))).ok, "no kind counts as guest");
  const empty = await p.send(codeMail({ html: "" }));
  ok(!empty.ok && empty.retryable === false, "an empty message is never retried");
  eq(f.calls.length, 0, "none of those reached the network");
  for (const env of [{}, { MAILTRAP_API_KEY: "  " }]) {
    let err = "";
    try {
      createMailtrapProvider(env, f.fn);
    } catch (e) {
      err = (e as Error).message;
    }
    ok(/MAILTRAP_API_KEY/.test(err), "names the missing variable");
  }
});
await test("mailtrap: how each answer is read (accepted, no id, key refused, rate limit, daily limit, bad recipient, server error)", async () => {
  const run = async (status: number, body: unknown) => createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, fakeFetch(status, body).fn).send(codeMail());
  eq(await run(200, { success: true }), { ok: true, messageId: "unknown", costUsd: 0 }, "accepted without an id is still accepted (no second code from another provider)");
  const refused = await run(401, { success: false, errors: ["Unauthorized"] });
  ok(!refused.ok && !refused.limit && /401/.test(refused.error) && /MAILTRAP_API_KEY/.test(refused.error), "401: an ordinary error that names the key (the unit is handed back)");
  const forbidden = await run(403, { success: false, errors: ["Sending domain not verified"] });
  ok(!forbidden.ok && !forbidden.limit && /403/.test(forbidden.error), "403");
  const rate = await run(429, {});
  ok(!rate.ok && rate.limit === true, "429: the allowance is used up");
  const daily = await run(400, { success: false, errors: ["Daily sending limit exceeded"] });
  ok(!daily.ok && daily.limit === true, "an error that talks about a limit");
  const bad = await run(400, { success: false, errors: ["recipient is invalid"] });
  ok(!bad.ok && bad.retryable === false && !bad.limit, "a bad recipient is never retried");
  const other = await run(400, { success: false, errors: ["subject is required"] });
  ok(!other.ok && !other.limit && other.retryable !== false, "any other 400 is an ordinary error");
  const boom = await run(500, { success: false, errors: ["Internal"] });
  ok(!boom.ok && !boom.limit && /500/.test(boom.error), "500");
  const html = await createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, async () => new Response("<html>bad gateway</html>", { status: 502 })).send(codeMail());
  ok(!html.ok && /502/.test(html.error), "an answer that is not JSON");
});
await test("mailtrap: a network error is an ordinary error, and a request that never answers is cut off at the timeout asked for", async () => {
  const down = await createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, async () => { throw new Error("connect ECONNREFUSED"); }).send(codeMail());
  ok(!down.ok && /network error/.test(down.error) && !down.limit, "network error");
  const hang = (_url: string, init: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  const t0 = Date.now();
  const slow = await createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, hang as never).send(codeMail({ timeoutMs: 120 }));
  const took = Date.now() - t0;
  ok(!slow.ok && /timed out/.test(slow.error), "timed out");
  ok(took >= 100 && took < 1000, `cut off near 120 ms, not 15 seconds (${took} ms)`);
});
await test("mailjet: a sign-in code has no CustomID (there is no queue row), a guest mail still has one", async () => {
  const f = fakeFetch(200, { Messages: [{ Status: "success", To: [{ MessageID: 99 }] }] });
  const p = createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, f.fn);
  await p.send(codeMail());
  await p.send(codeMail({ queueId: "11111111-1111-4111-8111-111111111111" }));
  const first = (f.calls[0].body as { Messages: Array<Record<string, unknown>> }).Messages[0];
  const second = (f.calls[1].body as { Messages: Array<Record<string, unknown>> }).Messages[0];
  ok(!("CustomID" in first), "none for the code");
  eq(second.CustomID, "11111111-1111-4111-8111-111111111111", "kept for a queued mail");
  eq(first.From, { Email: "codes@auth.hoppaz.fun", Name: "Hoppaz" }, "the code sender");
});
await test("providers: mailtrap is registered; named without its key it is left out with a warning; codeProviders puts it before Mailjet whatever the list order", () => {
  const warns: string[] = [];
  const env = { NOTIFY_PROVIDERS: "brevo,mailjet,mailtrap", BREVO_API_KEY: "b", MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "s", MAILTRAP_API_KEY: "m" };
  eq(buildProviders(env, (l) => warns.push(l)).map((p) => p.name), ["brevo", "mailjet", "mailtrap"], "built in the listed order");
  eq(codeProviders(buildProviders(env), env).map((p) => p.name), ["mailtrap", "mailjet"], "codes: mailtrap first, brevo not at all");
  buildProviders({ NOTIFY_PROVIDERS: "mailtrap" }, (l) => warns.push(l));
  ok(warns.some((w) => /mailtrap/.test(w) && /MAILTRAP_API_KEY/.test(w)), "warned about the missing key");
});

// ------------------------------------------------------------------ the route's gate ---
await test("hook: with SEND_EMAIL_HOOK_SECRET unset or unusable, even a correctly signed call is refused and nothing is sent", async () => {
  const mt = fake("mailtrap", ["code"]);
  for (const secret of [undefined, "", "  ", "v1,whsec_", "v1,whsec_%%%"]) {
    const h = harness({ providers: [mt], env: { SEND_EMAIL_HOOK_SECRET: secret, NODE_ENV: "production" } });
    const body = payload("magiclink");
    const { res, json } = await h.call(body, signWebhook(SECRET, "m", nowSec(), body));
    eq(res.status, 500, `status for ${JSON.stringify(secret)}`);
    eq(errOf(json).message, "Sign-in email is not set up", "message");
    ok(h.logs.some((l) => /SEND_EMAIL_HOOK_SECRET is not set/.test(l)), "logged loudly");
  }
  eq(mt.calls.length, 0, "nothing was sent");
});
await test("hook: a call with no signature, a wrong signature, a tampered body or an old timestamp is refused with 401 in Supabase's error shape, and nothing is sent", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const body = payload("magiclink");
  const cases: Array<[string, string, Record<string, string>]> = [
    ["no headers", body, {}],
    ["wrong secret", body, signWebhook(`v1,whsec_${Buffer.from("not-the-secret-not-the-secret-123").toString("base64")}`, "m", nowSec(), body)],
    ["tampered body", payload("magiclink", { email_data: { token: "000000" } }), signWebhook(SECRET, "m", nowSec(), body)],
    ["6 minutes old", body, signWebhook(SECRET, "m", nowSec() - 360, body)],
    ["6 minutes ahead", body, signWebhook(SECRET, "m", nowSec() + 360, body)],
  ];
  for (const [what, b, headers] of cases) {
    const { res, json } = await h.call(b, headers);
    eq(res.status, 401, what);
    eq(errOf(json), { http_code: 401, message: "Invalid signature" }, `${what}: error shape`);
    eq(res.headers.get("content-type"), "application/json", `${what}: JSON, as Supabase requires of every answer`);
  }
  eq(mt.calls.length, 0, "nothing was sent");
  eq(h.db, { take: [], give: [] }, "the database was not touched");
});
await test("hook: an oversized body is refused before anything is read into the allowance", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const body = payload("magiclink", { user: { pad: "x".repeat(300_000) } });
  const { res } = await h.call(body);
  eq(res.status, 413, "too large");
  eq(mt.calls.length, 0, "nothing sent");
});
await test("hook: signed but not JSON, or JSON that is not a usable call, is a clear error and nothing is sent", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const junk = "not json at all";
  const a = await h.call(junk, signWebhook(SECRET, "m", nowSec(), junk));
  eq(a.res.status, 400, "not json");
  const b = await h.call(payload("magiclink", { email_data: { token: "12" } }));
  eq(b.res.status, 400, "no usable code");
  ok(h.logs.some((l) => /SIGN-IN EMAIL NOT SENT/.test(l)), "logged loudly");
  eq(mt.calls.length, 0, "nothing sent");
});

// ------------------------------------------------------------------ sending ---
await test("hook: a sign-in code goes to Mailtrap first, once, with the code in the email, and the answer is 200 {}", async () => {
  const mt = fake("mailtrap", ["code"]);
  const mj = fake("mailjet", ["guest", "code"]);
  const h = harness({ providers: [mj, mt] });
  const { res, text } = await h.call(payload("magiclink"));
  eq(res.status, 200, "status");
  eq(text, "{}", "body");
  eq(res.headers.get("content-type"), "application/json", "JSON");
  eq([mt.calls.length, mj.calls.length], [1, 0], "mailtrap only (listed after mailjet, still first)");
  const m = mt.calls[0];
  eq([m.to, m.capKind, m.kind, m.subject], [ADA, "code", "auth:magiclink", `Your Hoppaz code is ${CODE}`], "message");
  ok(m.html?.includes(CODE) && m.text?.includes(CODE), "the code is in both parts");
  eq([m.payload, m.queueId, m.dedupeKey], [{}, "", ""], "no payload, no queue row, no dedupe key");
  ok(typeof m.timeoutMs === "number" && m.timeoutMs <= 600 && m.timeoutMs >= 150, `a short timeout is asked for (${m.timeoutMs})`);
  eq(h.db.take, [["mailtrap", "code"]], "one unit of the mailtrap code allowance was taken");
  eq(h.db.give, [], "and none handed back");
});
await test("hook: every code type the app uses is sent: signin, signup, reauth, email change", async () => {
  for (const [action, over, to] of [
    ["magiclink", {}, ADA], ["email", {}, ADA], ["signup", {}, ADA], ["reauthentication", {}, ADA],
    ["email_change", { user: { email: "", new_email: NEW } }, NEW],
  ] as Array<[string, Body, string]>) {
    const mt = fake("mailtrap", ["code"]);
    const h = harness({ providers: [mt] });
    const { res } = await h.call(payload(action, over));
    eq(res.status, 200, action);
    eq([mt.calls.length, mt.calls[0].to, mt.calls[0].html?.includes(CODE)], [1, to, true], `${action}: one mail to the right person with the code`);
  }
});
await test("hook: Secure email change sends two emails: token to the current address, token_new to the new address, and spends two units", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const { res } = await h.call(payload("email_change", { user: { email: OLD, new_email: NEW }, email_data: { token: CODE, token_new: CODE2, token_hash: HASH, token_hash_new: HASH2 } }));
  eq(res.status, 200, "status");
  eq(mt.calls.length, 2, "two emails");
  const byTo = Object.fromEntries(mt.calls.map((c) => [c.to, c]));
  ok(byTo[OLD].html?.includes(CODE) && !byTo[OLD].html?.includes(CODE2), "the current address gets `token` only");
  ok(byTo[NEW].html?.includes(CODE2) && !byTo[NEW].html?.includes(CODE), "the new address gets `token_new` only");
  ok(!JSON.stringify(mt.calls).includes(HASH) && !JSON.stringify(mt.calls).includes(HASH2), "no token hash in either");
  eq(h.db.take.length, 2, "two units taken");
  eq(h.rows.filter((r) => r.status === "sent").length, 2, "two sends logged");
});
await test("hook: Secure email change where one of the two cannot be sent is an error (the person asks again), and the log says one did go", async () => {
  const mt = fake("mailtrap", ["code"], (msg) => (msg.to === NEW ? { ok: false, error: "bad", retryable: false } : { ok: true, messageId: "ok", costUsd: 0 }));
  const h = harness({ providers: [mt] });
  const { res } = await h.call(payload("email_change", { user: { email: OLD, new_email: NEW }, email_data: { token: CODE, token_new: CODE2 } }));
  eq(res.status, 500, "error");
  ok(h.logs.some((l) => /One of the two emails of this change did go/.test(l)), "partial named");
});
await test("hook: recovery, invite and the notices are sent, with no code in them, and none of them can be mistaken for a sign-in", async () => {
  for (const action of ["recovery", "invite", "password_changed_notification", "identity_linked_notification", "mfa_factor_enrolled_notification"]) {
    const mt = fake("mailtrap", ["code"]);
    const h = harness({ providers: [mt] });
    const { res } = await h.call(payload(action));
    eq(res.status, 200, action);
    eq(mt.calls.length, 1, `${action}: one mail`);
    ok(!mt.calls[0].text?.includes(CODE) && !mt.calls[0].html?.includes(CODE), `${action}: the unused token is not in it`);
    ok(!/Your Hoppaz code is/.test(mt.calls[0].subject ?? ""), `${action}: not worded as a code`);
  }
});
await test("hook: a notice type Supabase adds later is acknowledged with 200 and nothing is sent", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const { res } = await h.call(payload("sms_changed_notification"));
  eq([res.status, mt.calls.length, h.db.take.length], [200, 0, 0], "skipped quietly");
});

// ------------------------------------------------------------------ failover ---
await test("failover: Mailtrap fails, Mailjet sends, the Mailtrap unit is handed back, and the log shows both", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "mailtrap 500: Internal" }));
  const mj = fake("mailjet", ["guest", "code"]);
  const h = harness({ providers: [mt, mj] });
  const { res } = await h.call(payload("magiclink"));
  eq(res.status, 200, "the person still gets a code");
  eq([mt.calls.length, mj.calls.length], [1, 1], "both tried, in order");
  eq(h.db.take, [["mailtrap", "code"], ["mailjet", "code"]], "takes");
  eq(h.db.give, [["mailtrap", "code"]], "only the failed one handed back");
  eq(h.rows.map((r) => [r.provider, r.status]), [["mailtrap", "failed"], ["mailjet", "sent"]], "both in notify_sends");
  ok(h.logs.some((l) => /only after a provider failed/.test(l)), "and a warning says the backup was used");
});
await test("failover: Mailtrap's allowance is full (the database says no), so Mailjet is used and Mailtrap is not even called", async () => {
  const mt = fake("mailtrap", ["code"]);
  const mj = fake("mailjet", ["guest", "code"]);
  const d = fakeDb({ take: async (p) => p !== "mailtrap" });
  const h = harness({ providers: [mt, mj], db: d.db });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length, mj.calls.length], [200, 0, 1], "straight to the backup");
});
await test("failover: Mailtrap says its own limit is reached (429), Mailjet sends, and the unit is not handed back for the provider that is full", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "mailtrap 429", limit: true }));
  const mj = fake("mailjet", ["guest", "code"]);
  const h = harness({ providers: [mt, mj] });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, h.db.give.length], [200, 0], "sent, nothing handed back");
});
await test("failover: a provider that throws instead of answering counts as failed", async () => {
  const mt = fake("mailtrap", ["code"], () => { throw new Error("boom"); });
  const mj = fake("mailjet", ["guest", "code"]);
  const { res } = await harness({ providers: [mt, mj] }).call(payload("magiclink"));
  eq([res.status, mj.calls.length], [200, 1], "backup used");
});
await test("failover: a bad recipient (never retryable) does not burn the backup's allowance", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "recipient invalid", retryable: false }));
  const mj = fake("mailjet", ["guest", "code"]);
  const h = harness({ providers: [mt, mj] });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mj.calls.length], [500, 0], "stops, with an error");
});
await test("failover: guest-only providers (Brevo) are never used for a code", async () => {
  const brevo = fake("brevo", ["guest"]);
  const mj = fake("mailjet", ["guest", "code"]);
  const { res } = await harness({ providers: [brevo, mj] }).call(payload("magiclink"));
  eq([res.status, brevo.calls.length, mj.calls.length], [200, 0, 1], "mailjet only");
});

await test("errors: every provider fails: 500 in Supabase's shape (never 429 or 503, which it would retry), a loud log, allowances handed back, failures recorded", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "mailtrap 500" }));
  const mj = fake("mailjet", ["guest", "code"], () => ({ ok: false, error: "mailjet 500" }));
  const h = harness({ providers: [mt, mj] });
  const { res, json } = await h.call(payload("magiclink"));
  eq(res.status, 500, "status");
  eq(errOf(json), { http_code: 500, message: "We could not send your sign-in email. Try again in a moment." }, "documented error shape and plain words");
  eq(res.headers.get("content-type"), "application/json", "JSON");
  ok(!/rate limit|too many|seconds|invalid|expired/i.test(errOf(json).message ?? ""), "words the app would misread (auth.ts authText)");
  ok(h.logs.some((l) => /SIGN-IN EMAIL NOT SENT/.test(l) && /mailtrap: mailtrap 500/.test(l) && /mailjet: mailjet 500/.test(l)), "logged loudly, naming both");
  eq(h.db.give.length, 2, "both units handed back");
  eq(h.rows.map((r) => r.status), ["failed", "failed"], "recorded");
  eq([mt.calls.length, mj.calls.length], [1, 1], "no retry loop: each is tried once");
});
await test("errors: every provider is at its daily cap: an error, not a silent success, and the log says why", async () => {
  const mt = fake("mailtrap", ["code"]);
  const mj = fake("mailjet", ["guest", "code"]);
  const d = fakeDb({ take: async () => false });
  const h = harness({ providers: [mt, mj], db: d.db });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length, mj.calls.length], [500, 0, 0], "nothing sent");
  ok(h.logs.some((l) => /SIGN-IN EMAIL NOT SENT/.test(l) && /daily cap/.test(l)), "says the cap");
});

// ------------------------------------------------------------------ the deadline ---
await test("deadline: a provider that never answers (and ignores the timeout it is given) still leaves time for the backup, inside the deadline", async () => {
  const mt = fake("mailtrap", ["code"], never);
  const mj = fake("mailjet", ["guest", "code"]);
  const h = harness({ providers: [mt, mj] });
  const t0 = Date.now();
  const { res } = await h.call(payload("magiclink"));
  const took = Date.now() - t0;
  eq([res.status, mj.calls.length], [200, 1], "backup sent");
  ok(took < 1500, `inside the 1500 ms deadline of this test (${took} ms)`);
  ok(took >= 500, `it did wait for the first one (${took} ms)`);
  eq(h.db.give, [["mailtrap", "code"]], "the hung one's unit handed back");
  ok(h.rows.some((r) => r.provider === "mailtrap" && /timed out/.test(r.error ?? "")), "logged as timed out");
});
await test("deadline: with both providers hanging the answer is an error before the deadline, not a hang", async () => {
  const h = harness({ providers: [fake("mailtrap", ["code"], never), fake("mailjet", ["guest", "code"], never)] });
  const t0 = Date.now();
  const { res } = await h.call(payload("magiclink"));
  const took = Date.now() - t0;
  eq(res.status, 500, "error");
  ok(took < 1500, `answered in time (${took} ms)`);
});
await test("deadline: the real Mailtrap provider with a fetch that never answers is cut off by its own timeout and the real Mailjet sends", async () => {
  const hang = (_url: string, init: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  const mj = fakeFetch(200, { Messages: [{ Status: "success", To: [{ MessageID: 7 }] }] });
  const providers = [createMailtrapProvider({ MAILTRAP_API_KEY: "k" }, hang as never), createMailjetProvider({ MAILJET_API_KEY: "a", MAILJET_SECRET_KEY: "b" }, mj.fn)];
  const h = harness({ providers });
  const t0 = Date.now();
  const { res } = await h.call(payload("magiclink"));
  const took = Date.now() - t0;
  eq(res.status, 200, "sent");
  eq(mj.calls.length, 1, "through mailjet");
  ok(took < 1500, `in time (${took} ms)`);
  ok(DEFAULT_LIMITS.deadlineMs < 5000 && DEFAULT_LIMITS.deadlineMs + DEFAULT_LIMITS.capMs < 5000, "the real deadline is under Supabase's 5 seconds with room for the cold start");
});
await test("deadline: a provider is not started when too little time is left", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt], limits: { deadlineMs: 200, providerMaxMs: 600, reserveMs: 100, minProviderMs: 150, capMs: 150 } });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length], [500, 0], "no time, no call");
});

// ------------------------------------------------------------------ the database never stops a code ---
await test("fail open: the cap call throws: the code is still sent, the problem is logged once, and nothing is 'given back' that was never taken", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "x" }));
  const mj = fake("mailjet", ["guest", "code"]);
  const d = fakeDb({ take: async () => { throw new Error("connection refused"); } });
  const h = harness({ providers: [mt, mj], db: d.db });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length, mj.calls.length], [200, 1, 1], "sent through the backup");
  eq(h.db.give, [], "no give-back for units never taken");
  eq(h.logs.filter((l) => /taking the daily allowance failed/.test(l)).length, 1, "logged once");
});
await test("fail open: the cap call hangs: the code goes after the cap timeout, not after the deadline", async () => {
  const mt = fake("mailtrap", ["code"]);
  const d = fakeDb({ take: () => new Promise<boolean>(() => {}) });
  const h = harness({ providers: [mt], db: d.db });
  const t0 = Date.now();
  const { res } = await h.call(payload("magiclink"));
  const took = Date.now() - t0;
  eq([res.status, mt.calls.length], [200, 1], "sent");
  ok(took < 600, `quickly (${took} ms)`);
});
await test("fail open: the send log write fails: the answer is still 200, and the problem is logged", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt], sends: { record: async () => { throw new Error("relation notify_sends does not exist"); } } });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length], [200, 1], "sent");
  ok(h.logs.some((l) => /writing the send log failed/.test(l)), "logged");
});
await test("fail open: handing back an allowance fails: still the right answer", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "x" }));
  const mj = fake("mailjet", ["guest", "code"]);
  const d = fakeDb({ give: async () => { throw new Error("db down"); } });
  const h = harness({ providers: [mt, mj], db: d.db });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mj.calls.length], [200, 1], "sent");
});
await test("fail open: no database configured at all: the code is still sent", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt], db: null, sends: null });
  const { res } = await h.call(payload("magiclink"));
  eq([res.status, mt.calls.length], [200, 1], "sent");
  ok(h.logs.some((l) => /sending the code anyway/.test(l)), "logged");
});
await test("suppression and the notify_email flag are not read: the database is only asked for the two allowance calls", async () => {
  // fakeDb() is a proxy that throws on any other method. A suppressed address (a bounce long ago) is still sent its code.
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const { res } = await h.call(payload("magiclink", { user: { email: "bounced.long.ago@example.com" } }));
  eq([res.status, mt.calls[0].to], [200, "bounced.long.ago@example.com"], "sent");
  ok(!h.logs.some((l) => /must not touch/.test(l)), "no forbidden call");
});

// ------------------------------------------------------------------ the log of what happened ---
await test("send log: one row per attempt, queue_id never set, provider and status right, kind in the error column as auth:<type>", async () => {
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: "mailtrap 500: Internal" }));
  const mj = fake("mailjet", ["guest", "code"], () => ({ ok: true, messageId: "mj_77", costUsd: 0 }));
  const h = harness({ providers: [mt, mj] });
  await h.call(payload("signup"));
  eq(h.rows, [
    { channel: "email", provider: "mailtrap", status: "failed", provider_message_id: null, cost_usd: 0, error: "auth:signup: mailtrap 500: Internal" },
    { channel: "email", provider: "mailjet", status: "sent", provider_message_id: "mj_77", cost_usd: 0, error: "auth:signup" },
  ], "rows");
  for (const r of h.rows) ok(!("queue_id" in r), "no queue id in the row we build");
  ok(h.rows.every((r) => (r.error?.length ?? 0) <= 500 && r.provider.length <= 40), "within the table's checks");
});
await test("no secrets: nothing the logger or the send log received, or any provider got outside the email itself, holds the code, a token hash or a full address", async () => {
  // Providers that echo the secrets back in their errors, to prove the scrubbing; a database that does too.
  const echo = `bad request for ${ADA}: code ${CODE} hash ${HASH}`;
  const mt = fake("mailtrap", ["code"], () => ({ ok: false, error: echo }));
  const mj = fake("mailjet", ["guest", "code"], () => { throw new Error(`mailjet choked on ${ADA} ${CODE}`); });
  const d = fakeDb({ take: async () => { throw new Error(`rpc failed for ${ADA} ${CODE}`); } });
  const h = harness({ providers: [mt, mj], db: d.db, sends: { record: async () => { throw new Error(`insert failed ${ADA} ${HASH}`); } } });
  const all = [
    await h.call(payload("magiclink", { email_data: { token_hash: HASH } })),
    await h.call(payload("email_change", { user: { email: OLD, new_email: NEW }, email_data: { token: CODE, token_new: CODE2, token_hash: HASH, token_hash_new: HASH2 } })),
    await h.call(payload("invite", { email_data: { token_hash: HASH } })),
    await h.call(payload("magiclink", { email_data: { token: "12" } })),
  ];
  ok(h.logs.length > 3, `the logger did receive lines (${h.logs.length})`);
  const seen = JSON.stringify({ logs: h.logs, rows: h.rows, answers: all.map((a) => a.text) });
  for (const secret of [CODE, CODE2, HASH, HASH2, ADA, OLD, NEW]) ok(!seen.includes(secret), `"${secret}" appears in a log, a row or an answer`);
  ok(h.logs.some((l) => /a\*\*\*@example\.com/.test(l)), "addresses are masked, not dropped");
  // What the providers were handed beyond the rendered email.
  for (const c of [...mt.calls, ...mj.calls]) {
    eq([c.payload, c.queueId, c.dedupeKey], [{}, "", ""], "no payload, queue id or dedupe key");
  }
});
await test("no secrets: the happy path logs nothing at all, and a success answer holds nothing", async () => {
  const mt = fake("mailtrap", ["code"]);
  const h = harness({ providers: [mt] });
  const { text } = await h.call(payload("magiclink"));
  eq([h.logs, text], [[], "{}"], "silent and empty");
  ok(!JSON.stringify(h.rows).includes(CODE) && !JSON.stringify(h.rows).includes(ADA), "the row holds neither");
});
await test("scrub: removes addresses and the named secrets from a line", () => {
  eq(scrub(`x ${ADA} y ${CODE} z <${NEW}>,`, [CODE]), "x *** y *** z <***>,", "scrubbed");
  eq(scrub("plain words", [CODE]), "plain words", "plain text untouched");
});

// ------------------------------------------------------------------ production and fake mode ---
await test("production: the log provider can never take real codes, fake flag or not, and with no real provider the answer is an error, not a success", async () => {
  const log = (await import("../src/lib/notify/log.ts")).createLogProvider(() => {});
  eq(codeProviders([log], { NODE_ENV: "production" }).length, 0, "NODE_ENV production");
  eq(codeProviders([log], { VERCEL_ENV: "production" }).length, 0, "VERCEL_ENV production");
  eq(codeProviders([log], { NODE_ENV: "development" }).length, 1, "development may use it");
  for (const env of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", NEXT_PUBLIC_EVENTS_R1_FAKE: "1" },
    { NODE_ENV: "production", NEXT_PUBLIC_EVENTS_R1_FAKE: "1", NOTIFY_PROVIDERS: "log" },
    { NODE_ENV: "production", NOTIFY_PROVIDERS: "mailtrap" },
  ]) {
    const full = { ...env, SEND_EMAIL_HOOK_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" };
    const h = harness({ env: full, build: () => buildProviders(full, () => {}) });
    const { res, json } = await h.call(payload("magiclink"));
    eq(res.status, 500, `no success for ${JSON.stringify(env)}`);
    eq(errOf(json).message, "Sign-in email is not set up", "says it is not set up");
    ok(h.logs.some((l) => /no provider for codes/.test(l)), "logged loudly");
  }
});
await test("production: in development with fake mode the log provider takes the call, which writes only a masked line (no code)", async () => {
  const lines: string[] = [];
  const logProvider = (await import("../src/lib/notify/log.ts")).createLogProvider((l) => lines.push(l));
  const h = harness({ env: { SEND_EMAIL_HOOK_SECRET: SECRET, NODE_ENV: "development", NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }, providers: [logProvider] });
  const { res } = await h.call(payload("magiclink"));
  eq(res.status, 200, "ok");
  ok(lines.length === 1 && !lines[0].includes(CODE) && !lines[0].includes(ADA), `log line holds no code or address: ${lines[0]}`);
});

await test("route: the real route file refuses with no secret (500), a bad signature (401), and production with no provider (500), without calling anything", async () => {
  const keep = { ...process.env };
  try {
    for (const k of ["SEND_EMAIL_HOOK_SECRET", "NOTIFY_PROVIDERS", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_EVENTS_R1_FAKE", "MAILTRAP_API_KEY", "MAILJET_API_KEY", "MAILJET_SECRET_KEY", "VERCEL_ENV"]) delete process.env[k];
    (process.env as Record<string, string>).NODE_ENV = "production";
    const body = payload("magiclink");
    const post = (headers?: Record<string, string>) => route.POST(request(body, headers));
    eq((await post()).status, 500, "no secret set");
    process.env.SEND_EMAIL_HOOK_SECRET = SECRET;
    eq((await post({})).status, 401, "no signature");
    const bad = await post(signWebhook(SECRET, "m", nowSec() - 4000, body));
    eq(bad.status, 401, "stale");
    process.env.NEXT_PUBLIC_EVENTS_R1_FAKE = "1";
    const res = await post();
    const j = (await res.json()) as { error?: { message?: string } };
    eq([res.status, j.error?.message], [500, "Sign-in email is not set up"], "signed, production, fake flag set, no real provider: an error and not a success");
    eq(res.headers.get("content-type"), "application/json", "JSON");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
