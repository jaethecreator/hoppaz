/**
 * Plain checks for notification step 3: the signed unsubscribe link, the unsubscribe route, the provider webhooks (parsing, the secret, the
 * route) and the settings page's fake store. No test framework, no network, no database. Run from the repo root:
 *   node --no-warnings scripts/notify-unsub-check.mts
 * The unsubscribe PAGE is a React page that Node cannot import: it is checked here by reading its source, and by looking at it in the running
 * app. The SQL half is supabase/tests/events_r1_notify_prefs_test.sql (it needs the local database).
 * Sample webhook payloads marked DOCS are copied from the providers' own pages (Brevo's transactional webhooks page); marked BUILT are made
 * from the field names those docs list, because Mailjet's pages give excerpts and no whole payloads.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server" || specifier === "next/navigation") return nextResolve(`${specifier}.js`, context);
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

const SECRET = "test-unsub-secret-not-real-0001";
const HOOK_SECRET = "test-hook-secret-not-real-0001";
process.env.NOTIFY_UNSUB_SECRET = SECRET;
process.env.NOTIFY_HOOK_SECRET = HOOK_SECRET;
process.env.NEXT_PUBLIC_SITE_URL = "https://hoppaz.example";
process.env.NEXT_PUBLIC_EVENTS_R1_FAKE = "1";
delete process.env.NODE_ENV;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { signUnsubToken, verifyUnsubToken, unsubSecret, SETTING_FOR_KIND } = await import("../src/lib/notify/unsubToken.ts");
const { unsubscribeUrlFor, unsubscribeLinksFor } = await import("../src/lib/notify/templates/unsubscribe.ts");
const { renderEmail, TEMPLATE_KINDS, UNSUBSCRIBE_KINDS } = await import("../src/lib/notify/templates/index.ts");
const { SAMPLES } = await import("../src/lib/notify/templates/samples.ts");
const { readUnsub, applyUnsub, fakePrefStore, prefStoreFor, fakeDev } = await import("../src/lib/notify/prefs.ts");
const hooks = await import("../src/lib/notify/hooks.ts");
const { fakePrefs, FAKE_PREFS_KEY } = await import("../src/lib/notify/myPrefs.ts");
const unsubRoute = await import("../src/app/api/notify/unsubscribe/route.ts");
const hookRoute = await import("../src/app/api/notify/hook/[provider]/route.ts");

let pass = 0;
let fail = 0;
// Keys are put in order first, so two objects with the same content are equal whatever order they were built in.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)])) : v;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
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

const ADA = "6f1c2a3e-1b2c-4d5e-8f60-7a8b9c0d1e2f";
const BOB = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const url = (path: string, init?: RequestInit) => new Request(`https://hoppaz.example${path}`, init);
const tokenOf = (u: string) => new URL(u).searchParams.get("t") ?? "";
const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
const state = async (user: string) => (await fakePrefStore().get(user))!;

// ------------------------------------------------------------------ the signed token ---
await test("token: signed for a person and a setting, read back, and no email address or name in it", () => {
  const r = signUnsubToken(ADA, "reminders")!;
  const p = signUnsubToken(ADA, "pops")!;
  eq(verifyUnsubToken(r), { userId: ADA, setting: "reminders" }, "reminders token");
  eq(verifyUnsubToken(p), { userId: ADA, setting: "pops" }, "pops token");
  ok(r !== p && r !== signUnsubToken(BOB, "reminders"), "different setting, different person, different token");
  ok(!/@/.test(r) && /^[A-Za-z0-9_.-]+$/.test(r), "url safe, no address");
  eq(signUnsubToken(ADA.toUpperCase(), "reminders"), r, "a person id in capitals signs the same");
});
await test("token: any change is refused (letter, person, signature, shape, length)", () => {
  const t = signUnsubToken(ADA, "reminders")!;
  const [l, u, m] = t.split(".");
  const bad: Array<[string, string | null | undefined]> = [
    ["the setting letter changed", `p.${u}.${m}`],
    ["another person with this signature", `${l}.${BOB}.${m}`],
    ["last character of the signature changed", `${l}.${u}.${m.slice(0, -1)}${m.endsWith("A") ? "B" : "A"}`],
    ["first character of the signature changed", `${l}.${u}.${m.startsWith("A") ? "B" : "A"}${m.slice(1)}`],
    ["signature cut short", `${l}.${u}.${m.slice(0, 20)}`],
    ["signature missing", `${l}.${u}.`],
    ["a fourth part", `${t}.x`],
    ["two parts", `${l}.${u}`],
    ["capital letter for the setting", `R.${u}.${m}`],
    ["person in capitals (not what we sign)", `${l}.${u.toUpperCase()}.${m}`],
    ["not a uuid", `${l}.not-a-person.${m}`],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["very long", "r.".padEnd(5000, "a")],
  ];
  for (const [why, tok] of bad) eq(verifyUnsubToken(tok), null, why);
});
await test("token: another secret, no secret, or a short secret: nothing signs and nothing verifies", () => {
  const t = signUnsubToken(ADA, "pops")!;
  eq(verifyUnsubToken(t, { NOTIFY_UNSUB_SECRET: "another-secret-entirely-0002" }), null, "another secret");
  eq(verifyUnsubToken(t, {}), null, "no secret");
  eq(signUnsubToken(ADA, "pops", {}), null, "signing without a secret");
  eq(signUnsubToken(ADA, "pops", { NOTIFY_UNSUB_SECRET: "short" }), null, "a short secret counts as not set");
  eq(unsubSecret({ NOTIFY_UNSUB_SECRET: "   " }), null, "blank");
  eq(signUnsubToken("not-a-uuid", "pops"), null, "a person id that is not a uuid");
  const src = readFileSync(new URL("../src/lib/notify/unsubToken.ts", import.meta.url), "utf8");
  ok(/timingSafeEqual/.test(src), "the signature is compared in constant time");
  ok(!/expire|exp:|Date\.now/.test(src.replace(/NO EXPIRY[\s\S]*?single-line/, "")) || /NO EXPIRY, on purpose/.test(src), "the no-expiry choice is written down");
});

// ------------------------------------------------------------------ links and headers on the emails ---
await test("emails: List-Unsubscribe, the one-click header and the footer link on exactly G10, G11, G12 and G15", () => {
  const withLinks: string[] = [];
  for (const s of SAMPLES) {
    const mail = renderEmail(s.kind, s.payload, { userId: ADA, to: s.to });
    const has = "List-Unsubscribe" in mail.headers;
    if (has) withLinks.push(s.kind);
    if ((UNSUBSCRIBE_KINDS as readonly string[]).includes(s.kind)) {
      const m = /^<(https:\/\/hoppaz\.example\/api\/notify\/unsubscribe\?t=[^>]+)>$/.exec(mail.headers["List-Unsubscribe"] ?? "");
      ok(m, `${s.label}: header points at the one-click route`);
      eq(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click", `${s.label}: one-click header`);
      eq(Object.keys(mail.headers).sort(), ["List-Unsubscribe", "List-Unsubscribe-Post"], `${s.label}: exactly those two`);
      const t = tokenOf(m![1]);
      const want = SETTING_FOR_KIND[s.kind];
      eq(verifyUnsubToken(t), { userId: ADA, setting: want }, `${s.label}: the token is this person's, for ${want}`);
      ok(mail.html.includes(`href="https://hoppaz.example/unsubscribe?t=${encodeURIComponent(t)}"`), `${s.label}: footer link goes to the page`);
      ok(mail.text.includes(`https://hoppaz.example/unsubscribe?t=${t}`), `${s.label}: text version has the link`);
      ok(!m![1].includes("ada") && !m![1].includes("@") && !m![1].includes("example.com/ada"), `${s.label}: no address in the link`);
    } else {
      eq(mail.headers, {}, `${s.label}: no headers`);
      ok(!/nsubscribe/.test(mail.html) && !/nsubscribe/.test(mail.text), `${s.label}: no unsubscribe link`);
    }
  }
  eq(withLinks.sort(), ["host_pop", "reminder_day", "reminder_hour", "thanks"], "the kinds that carry headers");
});
await test("emails: reminders switch reminders, a Pop switches Pops, and every other kind has no link at all", () => {
  eq([SETTING_FOR_KIND.reminder_day, SETTING_FOR_KIND.reminder_hour, SETTING_FOR_KIND.thanks, SETTING_FOR_KIND.host_pop], ["reminders", "reminders", "reminders", "pops"], "settings");
  for (const k of TEMPLATE_KINDS) {
    const l = unsubscribeLinksFor({ kind: k, userId: ADA });
    if ((UNSUBSCRIBE_KINDS as readonly string[]).includes(k)) ok(l && l.page.startsWith("https://hoppaz.example/unsubscribe?t=") && l.oneClick.startsWith("https://hoppaz.example/api/notify/unsubscribe?t="), `${k}: both links`);
    else eq([k, l, unsubscribeUrlFor({ kind: k, userId: ADA })], [k, null, null], `${k}: nothing`);
  }
  eq(unsubscribeUrlFor({ kind: "constructor", userId: ADA }), null, "a kind named like an object property");
  eq(unsubscribeUrlFor({ kind: "reminder_day" }), null, "no person, no link");
});
await test("emails: without NOTIFY_UNSUB_SECRET there is no link and no header, not a half one", () => {
  const keep = process.env.NOTIFY_UNSUB_SECRET;
  delete process.env.NOTIFY_UNSUB_SECRET;
  try {
    for (const s of SAMPLES) {
      const mail = renderEmail(s.kind, s.payload, { userId: ADA });
      eq(mail.headers, {}, `${s.label}: no headers`);
      ok(!/nsubscribe/.test(mail.html) && !/nsubscribe/.test(mail.text), `${s.label}: no link`);
    }
    eq(unsubscribeUrlFor({ kind: "reminder_day", userId: ADA }), null, "the helper");
  } finally {
    process.env.NOTIFY_UNSUB_SECRET = keep;
  }
});

// ------------------------------------------------------------------ reading and doing ---
type Spy = { gets: number; sets: Array<[string, string, boolean]>; store: Parameters<typeof readUnsub>[1] };
function spy(over: { person?: boolean; throws?: boolean } = {}): Spy {
  const s: Spy = {
    gets: 0,
    sets: [],
    store: {
      async get() {
        s.gets++;
        if (over.throws) throw new Error("db down");
        return over.person === false ? null : { reminders: true, pops: true };
      },
      async set(u: string, k: string, on: boolean) {
        s.sets.push([u, k, on]);
        if (over.throws) throw new Error("db down");
        return over.person !== false;
      },
    },
  };
  return s;
}
await test("page logic: reading a link changes nothing, and a bad link never reaches the store", async () => {
  const sp = spy();
  const t = signUnsubToken(ADA, "reminders")!;
  eq(await readUnsub(t, sp.store), { ok: true, setting: "reminders", on: true }, "valid link: shows the state");
  eq(sp.sets, [], "and wrote nothing");
  for (const bad of ["", "junk", t.slice(0, -2), `p.${ADA}.${t.split(".")[2]}`]) {
    const s2 = spy();
    eq(await readUnsub(bad, s2.store), { ok: false, reason: "bad_link" }, `read of "${bad.slice(0, 12)}"`);
    eq(await applyUnsub(bad, false, s2.store), { ok: false, reason: "bad_link" }, `apply of "${bad.slice(0, 12)}"`);
    eq([s2.gets, s2.sets], [0, []], "the store was never asked");
  }
});
await test("page logic: apply switches only the link's setting, back on too; unknown person and a failing database are told apart", async () => {
  const sp = spy();
  eq(await applyUnsub(signUnsubToken(ADA, "pops")!, false, sp.store), { ok: true, setting: "pops", on: false }, "pops off");
  eq(await applyUnsub(signUnsubToken(ADA, "reminders")!, true, sp.store), { ok: true, setting: "reminders", on: true }, "reminders on");
  eq(sp.sets, [[ADA, "pops", false], [ADA, "reminders", true]], "exactly those writes");
  eq(await applyUnsub(signUnsubToken(ADA, "pops")!, false, spy({ person: false }).store), { ok: false, reason: "no_person" }, "no such person");
  eq(await applyUnsub(signUnsubToken(ADA, "pops")!, false, spy({ throws: true }).store), { ok: false, reason: "unavailable" }, "database error");
  eq(await readUnsub(signUnsubToken(ADA, "pops")!, spy({ throws: true }).store), { ok: false, reason: "unavailable" }, "database error on read");
  eq(await applyUnsub(signUnsubToken(ADA, "pops")!, false, null), { ok: false, reason: "unavailable" }, "no store configured");
});
await test("fake mode exists only off production", () => {
  ok(fakeDev({ NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }), "dev with the switch");
  ok(!fakeDev({ NEXT_PUBLIC_EVENTS_R1_FAKE: "1", NODE_ENV: "production" }), "never in a production build");
  ok(!fakeDev({}), "off by default");
  eq(prefStoreFor({ NEXT_PUBLIC_EVENTS_R1_FAKE: "1", NODE_ENV: "production" }), null, "production with no database: no store at all");
});

// ------------------------------------------------------------------ the route ---
await test("route: GET changes nothing, even with a valid token, and only sends the browser to the page", async () => {
  const t = signUnsubToken(ADA, "reminders")!;
  const before = await state(ADA);
  const res = await unsubRoute.GET(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`));
  eq(res.status, 303, "redirect");
  eq(res.headers.get("location"), `/unsubscribe?t=${encodeURIComponent(t)}`, "to the page, same token");
  ok(res.headers.get("referrer-policy") === "no-referrer" && /no-store/.test(res.headers.get("cache-control") ?? ""), "no referrer, no cache");
  eq(await state(ADA), before, "nothing changed");
  eq((await state(ADA)).reminders, true, "still on");
  const res2 = await unsubRoute.GET(url(`/api/notify/unsubscribe`));
  eq(res2.headers.get("location"), "/unsubscribe", "no token: the page, which explains");
});
await test("route: the one-click POST from a mail app (RFC 8058) does it, with no cookie and no sign-in", async () => {
  const t = signUnsubToken(ADA, "reminders")!;
  const res = await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`, form({ "List-Unsubscribe": "One-Click" })));
  eq(res.status, 200, "2xx");
  eq(await res.json(), { ok: true, setting: "reminders", on: false }, "answer");
  eq(await state(ADA), { reminders: false, pops: true }, "reminders off, Pops untouched");
  const again = await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`, form({ "List-Unsubscribe": "One-Click" })));
  eq(again.status, 200, "a mail app that posts twice");
  eq(await state(ADA), { reminders: false, pops: true }, "still off, nothing else moved");
});
await test("route: the page's button turns it back on, and the browser is sent to the page", async () => {
  const t = signUnsubToken(ADA, "reminders")!;
  const res = await unsubRoute.POST(url(`/api/notify/unsubscribe`, form({ t, do: "on", from: "page" })));
  eq(res.status, 303, "redirect");
  eq(res.headers.get("location"), `/unsubscribe?t=${encodeURIComponent(t)}&done=on`, "back to the page, done=on");
  eq(await state(ADA), { reminders: true, pops: true }, "on again");
  const off = await unsubRoute.POST(url(`/api/notify/unsubscribe`, form({ t, do: "off", from: "page" })));
  eq(off.headers.get("location"), `/unsubscribe?t=${encodeURIComponent(t)}&done=off`, "done=off");
  eq((await state(ADA)).reminders, false, "off");
});
await test("route: a Pop link switches Pops only", async () => {
  const t = signUnsubToken(BOB, "pops")!;
  await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST" }));
  eq(await state(BOB), { reminders: true, pops: false }, "Pops off, reminders on");
});
await test("route: a bad or altered token gets a plain refusal and changes nothing", async () => {
  const t = signUnsubToken(BOB, "reminders")!;
  const before = JSON.stringify([await state(BOB), await state(ADA)]);
  const forged = `${t.split(".")[0]}.${ADA}.${t.split(".")[2]}`;
  for (const bad of [forged, "garbage", "", `${t}x`]) {
    const res = await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(bad)}`, form({ "List-Unsubscribe": "One-Click" })));
    eq(res.status, 400, `one-click with "${bad.slice(0, 10)}"`);
    eq((await res.json()).error, "This link is not valid", "plain message");
    const viaPage = await unsubRoute.POST(url(`/api/notify/unsubscribe`, form({ t: bad, do: "off", from: "page" })));
    eq(viaPage.status, 303, "the page's form is sent back to the page, which says so");
    ok(!/done=/.test(viaPage.headers.get("location") ?? ""), "without a done flag");
  }
  eq(JSON.stringify([await state(BOB), await state(ADA)]), before, "nothing changed anywhere");
  const none = await unsubRoute.POST(url(`/api/notify/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  eq(none.status, 400, "no token at all");
});
await test("route: with no secret, or a production build with no database, it refuses without touching anything", async () => {
  const t = signUnsubToken(BOB, "reminders")!;
  const keep = { s: process.env.NOTIFY_UNSUB_SECRET, n: process.env.NODE_ENV };
  try {
    delete process.env.NOTIFY_UNSUB_SECRET;
    eq((await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`, form({ a: "b" })))).status, 400, "no secret: not valid");
    process.env.NOTIFY_UNSUB_SECRET = keep.s;
    (process.env as Record<string, string>).NODE_ENV = "production";
    eq((await unsubRoute.POST(url(`/api/notify/unsubscribe?t=${encodeURIComponent(t)}`, form({ a: "b" })))).status, 503, "production, no database: not available");
  } finally {
    process.env.NOTIFY_UNSUB_SECRET = keep.s;
    delete process.env.NODE_ENV;
  }
  eq((await state(BOB)).reminders, true, "nothing changed");
});
await test("page: opening it (GET) can only read; the change is a form POST to the route; it says tickets still arrive", () => {
  const src = readFileSync(new URL("../src/app/unsubscribe/page.tsx", import.meta.url), "utf8");
  ok(!/applyUnsub/.test(src) && !/\.set\(/.test(src) && !/\bsb\.rpc\b/.test(src), "the page has no way to write");
  ok(/readUnsub\(/.test(src), "it reads");
  ok(/method="post"/.test(src) && /action="\/api\/notify\/unsubscribe"/.test(src), "the button is a POST to the route");
  ok(/still arrive/.test(src) && /tickets/.test(src), "the page says tickets and changes still arrive");
  ok(/robots/.test(src) && /no-referrer/.test(src), "kept out of search and out of the Referer");
  ok(!/"use client"/.test(src), "a server page: no script needed to read the state");
  const route = readFileSync(new URL("../src/app/api/notify/unsubscribe/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  ok(!/applyUnsub|prefStoreFor/.test(get), "GET in the route never reaches the store");
});

// ------------------------------------------------------------------ webhooks: sample payloads ---
// DOCS: copied from https://developers.brevo.com/docs/transactional-webhooks (the id placeholder xxxxx made 123456).
const brevoDocs = {
  delivered: { event: "delivered", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, subject: "My first Transactional", "X-Mailin-custom": "some_custom_header", sending_ip: "xxx.xxx.xxx.xxx", template_id: 22, tags: ["transac_messages"] },
  hard_bounce: { event: "hard_bounce", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, subject: "My first Transactional", "X-Mailin-custom": "some_custom_header", sending_ip: "xxx.xxx.xxx.xxx", template_id: 22, tags: ["transac_messages"], reason: "server is down", ts_epoch: 1604933653 },
  soft_bounce: { event: "soft_bounce", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, subject: "My first Transactional", "X-Mailin-custom": "some_custom_header", sending_ip: "xxx.xxx.xxx.xxx", template_id: 22, tags: ["transac_messages"], reason: "server is down" },
  spam: { event: "spam", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, "X-Mailin-custom": "some_custom_header", tags: ["transac_messages"] },
  blocked: { event: "blocked", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, subject: "My first Transactional", "X-Mailin-custom": "some_custom_header", template_id: 22, tags: ["transac_messages"], ts_epoch: 1604933623 },
  invalid_email: { event: "invalid_email", email: "example@domain.com", id: 123456, date: "2020-10-09 00:00:00", ts: 1604933619, "message-id": "201798300811.5787683@relay.domain.com", ts_event: 1604933654, subject: "My first Transactional", "X-Mailin-custom": "some_custom_header", template_id: 22, tags: ["transac_messages"], ts_epoch: 1604933623 },
  opened: { event: "opened", email: "example@domain.com", "message-id": "201798300811.5787683@relay.domain.com" },
  click: { event: "click", email: "example@domain.com", "message-id": "201798300811.5787683@relay.domain.com", link: "https://x.test" },
  deferred: { event: "deferred", email: "example@domain.com", "message-id": "201798300811.5787683@relay.domain.com", reason: "greylisted" },
  unsubscribed: { event: "unsubscribed", email: "example@domain.com", "message-id": "201798300811.5787683@relay.domain.com" },
};
const Q = "11111111-1111-4111-8111-111111111111";
// BUILT: from the Mailjet field names (event, time, MessageID, Message_GUID, email, CustomID, Payload, hard_bounce, blocked, error_related_to, error, comment, source).
const mj = (extra: Record<string, unknown>) => ({ time: 1433333949, MessageID: 19421777835146490, Message_GUID: "1ab23cd4-e567-8901-2345-6789f0gh1i2j", email: "Guest@Example.COM", mj_campaign_id: 7257, mj_contact_id: 4, customcampaign: "", CustomID: Q, Payload: "", ...extra });
const mailjetBuilt = {
  sent: mj({ event: "sent", smtp_reply: "sent (250 2.0.0 OK 1433333948 fa5si855896wjc.199 - gsmtp)" }),
  hard: mj({ event: "bounce", blocked: true, hard_bounce: true, error_related_to: "recipient", error: "user unknown", comment: "550 5.1.1 <guest@example.com> user unknown" }),
  soft: mj({ event: "bounce", blocked: false, hard_bounce: false, error_related_to: "recipient", error: "quota exceeded", comment: "452 mailbox full" }),
  blockedDead: mj({ event: "blocked", error_related_to: "recipient", error: "user unknown" }),
  blockedGrey: mj({ event: "blocked", error_related_to: "system", error: "greylisted" }),
  spam: mj({ event: "spam", source: "JMRPP" }),
  open: mj({ event: "open", ip: "1.2.3.4", geo: "NG", agent: "x" }),
  click: mj({ event: "click", url: "https://x.test" }),
  unsub: mj({ event: "unsub", mj_list_id: 1 }),
};

await test("brevo (DOCS payloads): delivered, hard and soft bounce, invalid email, blocked, spam; opens, clicks, deferred and unsubscribed are not kept", () => {
  const one = (p: unknown) => hooks.parseBrevo(p);
  const base = { message_id: "201798300811.5787683@relay.domain.com", queue_id: null, address: "example@domain.com" };
  eq(one(brevoDocs.delivered), [{ ...base, event: "delivered", hard: false, reason: null }], "delivered");
  eq(one(brevoDocs.hard_bounce), [{ ...base, event: "bounced", hard: true, reason: "server is down" }], "hard bounce");
  eq(one(brevoDocs.soft_bounce), [{ ...base, event: "bounced", hard: false, reason: "server is down" }], "soft bounce");
  eq(one(brevoDocs.invalid_email), [{ ...base, event: "bounced", hard: true, reason: "invalid email" }], "invalid email is a dead address");
  eq(one(brevoDocs.blocked), [{ ...base, event: "bounced", hard: false, reason: "blocked" }], "blocked is soft (Brevo refused to send, we learn nothing about the address)");
  eq(one(brevoDocs.spam), [{ ...base, event: "complained", hard: false, reason: null }], "spam is a complaint");
  for (const k of ["opened", "click", "deferred", "unsubscribed"] as const) eq(one(brevoDocs[k]), [], `${k} is not kept`);
});
await test("brevo: our queue id comes back through X-Mailin-custom, and only if it is a uuid; the event name may be written either way", () => {
  eq(hooks.parseBrevo({ ...brevoDocs.spam, "X-Mailin-custom": Q.toUpperCase() })[0].queue_id, Q, "uuid, lower case");
  eq(hooks.parseBrevo({ ...brevoDocs.spam, "X-Mailin-custom": "some_custom_header" })[0].queue_id, null, "anything else is not a queue id");
  eq(hooks.parseBrevo({ ...brevoDocs.hard_bounce, event: "hardBounce" })[0].hard, true, "hardBounce (the name the create-webhook call uses)");
  eq(hooks.parseBrevo({ ...brevoDocs.delivered, email: "  Ada@Example.COM " })[0].address, "ada@example.com", "address lower case and trimmed");
  eq(hooks.parseBrevo({ ...brevoDocs.delivered, email: "not an address" })[0].address, null, "a bad address is dropped");
});
await test("brevo: a batch (a bare array, or { events: [...] }) is read event by event", () => {
  eq(hooks.parseBrevo([brevoDocs.delivered, brevoDocs.opened, brevoDocs.hard_bounce]).map((e) => e.event), ["delivered", "bounced"], "array");
  eq(hooks.parseBrevo({ events: [brevoDocs.spam, brevoDocs.soft_bounce] }).map((e) => e.event), ["complained", "bounced"], "wrapper");
});
await test("mailjet (BUILT payloads): sent is delivered; bounce is hard only when hard_bounce says so; blocked is hard only for an address that does not exist; spam is a complaint", () => {
  const p = hooks.parseMailjet;
  const base = { message_id: "19421777835146490", queue_id: Q, address: "guest@example.com" };
  eq(p(mailjetBuilt.sent), [{ ...base, event: "delivered", hard: false, reason: null }], "sent");
  eq(p(mailjetBuilt.hard), [{ ...base, event: "bounced", hard: true, reason: "recipient: user unknown" }], "hard bounce");
  eq(p(mailjetBuilt.soft), [{ ...base, event: "bounced", hard: false, reason: "recipient: quota exceeded" }], "soft bounce (quota exceeded is a full mailbox)");
  eq(p(mailjetBuilt.blockedDead)[0].hard, true, "blocked, user unknown");
  eq(p(mailjetBuilt.blockedGrey)[0].hard, false, "blocked, greylisted");
  eq(p(mailjetBuilt.spam), [{ ...base, event: "complained", hard: false, reason: "JMRPP" }], "spam");
  for (const k of ["open", "click", "unsub"] as const) eq(p(mailjetBuilt[k]), [], `${k} is not kept`);
  eq(p({ ...mailjetBuilt.hard, hard_bounce: "true" })[0].hard, true, "hard_bounce written as a string");
  eq(p({ ...mailjetBuilt.hard, hard_bounce: "false" })[0].hard, false, "hard_bounce written as the string false");
  eq(p({ ...mailjetBuilt.hard, hard_bounce: undefined })[0].hard, false, "hard_bounce missing is not hard");
  eq(p({ ...mailjetBuilt.sent, MessageID: "abc-123" })[0].message_id, "abc-123", "a message id that is already text");
});
await test("mailjet: grouped events arrive as an array", () => {
  eq(hooks.parseMailjet([mailjetBuilt.sent, mailjetBuilt.open, mailjetBuilt.spam, mailjetBuilt.hard]).map((e) => e.event), ["delivered", "complained", "bounced"], "array");
});
await test("parsing: nothing breaks on rubbish, and no more than MAX_EVENTS are read", () => {
  for (const junk of [null, undefined, "x", 42, true, [], {}, [1, "a", null], { event: 5 }, { events: "no" }]) {
    eq([hooks.parseBrevo(junk), hooks.parseMailjet(junk)], [[], []], `junk ${JSON.stringify(junk)}`);
  }
  eq(hooks.parseBrevo(Array.from({ length: hooks.MAX_EVENTS + 50 }, () => brevoDocs.delivered)).length, hooks.MAX_EVENTS, "capped");
  const wild = hooks.parseBrevo({ ...brevoDocs.hard_bounce, reason: "x".repeat(900), "message-id": "m".repeat(900) })[0];
  ok((wild.reason?.length ?? 0) <= 200 && (wild.message_id?.length ?? 0) <= 200, "long fields are cut");
  eq(hooks.parseBrevo({ ...brevoDocs.hard_bounce, reason: "line\r\nbreak" })[0].reason, "line break", "control characters become spaces");
});

// ------------------------------------------------------------------ webhooks: who may call, and the whole call ---
const hookReq = (path: string, headers: Record<string, string> = {}, body: unknown = brevoDocs.spam) =>
  new Request(`https://hoppaz.example${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

await test("hook secret: bearer token, basic auth password and ?key= are accepted; anything else, or no secret set, is refused", () => {
  const env = { NOTIFY_HOOK_SECRET: HOOK_SECRET };
  const allowed = (path: string, h: Record<string, string> = {}, e: Record<string, string | undefined> = env) => hooks.hookAllowed(hookReq(path, h), e);
  ok(allowed("/h", { Authorization: `Bearer ${HOOK_SECRET}` }), "bearer (Brevo)");
  ok(allowed("/h", { Authorization: basic("brevo", HOOK_SECRET) }), "basic auth in the URL (Brevo)");
  ok(allowed("/h", { Authorization: basic("anything-at-all", HOOK_SECRET) }), "basic auth, any user name (Mailjet)");
  ok(allowed(`/h?key=${HOOK_SECRET}`), "?key=");
  ok(!allowed("/h"), "nothing");
  ok(!allowed("/h", { Authorization: "Bearer wrong-secret-wrong-secret" }), "wrong bearer");
  ok(!allowed("/h", { Authorization: basic("u", "wrong-secret-wrong-secret") }), "wrong password");
  ok(!allowed("/h?key=wrong-secret-wrong-secret"), "wrong key");
  ok(!allowed("/h", { Authorization: `Bearer ${HOOK_SECRET}x` }), "the secret with something added");
  ok(!allowed("/h", { Authorization: `Bearer ${HOOK_SECRET.slice(0, -1)}` }), "the secret cut short");
  ok(!allowed("/h", { Authorization: basic(HOOK_SECRET, "") }), "the secret as the user name is not the password");
  ok(!allowed("/h?key=", { Authorization: "Bearer " }), "empty values");
  ok(!allowed("/h", { Authorization: `Bearer ${HOOK_SECRET}` }, {}), "no secret configured: even the right word is refused");
  ok(!allowed("/h", { Authorization: "Bearer short" }, { NOTIFY_HOOK_SECRET: "short" }), "a short secret counts as not set");
  const src = readFileSync(new URL("../src/lib/notify/hooks.ts", import.meta.url), "utf8");
  ok(/timingSafeEqual/.test(src), "constant time");
});

function applySpy(over: { throws?: string } = {}) {
  const calls: Array<{ provider: string; events: unknown[] }> = [];
  return {
    calls,
    apply: async (provider: string, events: unknown[]) => {
      calls.push({ provider, events });
      if (over.throws) throw new Error(over.throws);
      return { applied: events.length, duplicate: 0, unmatched: 0, ignored: 0 };
    },
  };
}
const auth = { Authorization: `Bearer ${HOOK_SECRET}` };

await test("hook call: unknown providers are refused (SES is not built), bad secrets are refused before the body is read", async () => {
  const s = applySpy();
  for (const name of ["ses", "sendgrid", "", "Brevo", "brevo/x", "__proto__", "constructor"]) {
    const res = await hooks.handleHook(hookReq("/x", auth), name, { apply: s.apply as never });
    eq(res.status, 404, `provider "${name}"`);
  }
  eq((await hooks.handleHook(hookReq("/x", auth), "ses", { apply: s.apply as never })).status, 404, "ses with the right secret");
  let read = false;
  const spyReq = hookReq("/x", {}, "{not json at all");
  const orig = spyReq.text.bind(spyReq);
  spyReq.text = async () => ((read = true), orig());
  eq((await hooks.handleHook(spyReq, "brevo", { apply: s.apply as never })).status, 401, "no secret: 401, not 400 for the bad body");
  eq(read, false, "the body was not even read");
  eq((await hooks.handleHook(hookReq("/x", { Authorization: "Bearer nope-nope-nope-nope" }), "mailjet", { apply: s.apply as never })).status, 401, "wrong secret");
  eq(s.calls.length, 0, "nothing was applied by any of those");
});
await test("hook call: a good call is applied once with the provider and the events, and answers 200 with the counts", async () => {
  const s = applySpy();
  const res = await hooks.handleHook(hookReq("/x", auth, [brevoDocs.hard_bounce, brevoDocs.opened, brevoDocs.delivered]), "brevo", { apply: s.apply as never });
  eq(res.status, 200, "200");
  eq(await res.json(), { ok: true, received: 2, applied: 2, duplicate: 0, unmatched: 0, ignored: 0 }, "answer");
  eq(s.calls.length, 1, "one database call for the whole batch");
  eq(s.calls[0].provider, "brevo", "provider");
  eq((s.calls[0].events as Array<{ event: string }>).map((e) => e.event), ["bounced", "delivered"], "the kept events");
  const mjRes = await hooks.handleHook(hookReq("/x?key=" + HOOK_SECRET, {}, mailjetBuilt.spam), "mailjet", { apply: s.apply as never });
  eq(mjRes.status, 200, "mailjet with ?key=");
  eq(s.calls[1].provider, "mailjet", "mailjet provider");
});
await test("hook call: a body with nothing to keep (opens, clicks) is handled with 200 and no database call; not JSON is 400; too big is 413", async () => {
  const s = applySpy();
  const res = await hooks.handleHook(hookReq("/x", auth, [brevoDocs.opened, brevoDocs.click]), "brevo", { apply: s.apply as never });
  eq([res.status, (await res.json()).received], [200, 0], "opens only");
  eq((await hooks.handleHook(hookReq("/x", auth, "{broken"), "brevo", { apply: s.apply as never })).status, 400, "not JSON");
  eq((await hooks.handleHook(hookReq("/x", auth, " ".repeat(1_000_001)), "brevo", { apply: s.apply as never })).status, 413, "too large");
  eq(s.calls.length, 0, "no database call");
  eq((await hooks.handleHook(hookReq("/x", auth), "brevo", { apply: null })).status, 503, "no database configured");
});
await test("hook call: a database failure answers 500 (so the provider tries again) and the log holds no email address", async () => {
  const lines: string[] = [];
  const warn = console.warn;
  const log = console.log;
  console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const s = applySpy({ throws: "notify_apply_events: duplicate key for ada.okoye@example.com and 'other@x.test'" });
    const res = await hooks.handleHook(hookReq("/x", auth, brevoDocs.hard_bounce), "brevo", { apply: s.apply as never });
    eq(res.status, 500, "500");
    ok(lines.length >= 1, "it logged");
    ok(lines.every((l) => !/@/.test(l)) && lines.some((l) => l.includes("***")), `no address in the log: ${lines.join(" | ")}`);
    const bodyText = JSON.stringify(await res.json());
    ok(!/@|example/.test(bodyText), "or in the answer");
  } finally {
    console.warn = warn;
    console.log = log;
  }
});
await test("hook route: wired to the same rules (unknown provider 404, no secret 401, nothing configured is never a 200 write)", async () => {
  const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
  eq((await hookRoute.POST(hookReq("/api/notify/hook/ses", auth), ctx("ses"))).status, 404, "ses");
  eq((await hookRoute.POST(hookReq("/api/notify/hook/brevo"), ctx("brevo"))).status, 401, "no secret");
  eq((await hookRoute.POST(hookReq("/api/notify/hook/brevo", auth), ctx("brevo"))).status, 503, "right secret, no database in this check");
  eq((await hookRoute.POST(hookReq("/api/notify/hook/mailjet", auth, [mailjetBuilt.open]), ctx("mailjet"))).status, 200, "right secret, nothing to keep");
  ok(!("GET" in hookRoute), "only POST exists");
});

// ------------------------------------------------------------------ the settings page's fake store ---
await test("settings page, fake data: both on by default, kept per person, a patch changes one, bad storage is survived", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const f = fakePrefs(store);
  eq(f.load("ada"), { email_reminders: true, email_pops: true }, "default");
  eq(f.save("ada", { email_reminders: false }), { email_reminders: false, email_pops: true }, "one changed");
  eq(f.load("bob"), { email_reminders: true, email_pops: true }, "someone else untouched");
  eq(fakePrefs(store).load("ada"), { email_reminders: false, email_pops: true }, "kept");
  eq(f.save("ada", { email_pops: false }), { email_reminders: false, email_pops: false }, "the other one");
  mem.set(FAKE_PREFS_KEY, "{broken");
  eq(f.load("ada"), { email_reminders: true, email_pops: true }, "corrupt storage reads as the defaults");
  eq(fakePrefs(null).save("ada", { email_pops: false }), { email_reminders: true, email_pops: false }, "no storage at all");
});

// ------------------------------------------------------------------ house rules ---
await test("house rules: no em dash in any file this step added or edited", () => {
  const roots = ["src/lib/notify", "src/app/api/notify", "src/app/unsubscribe", "src/app/account/notifications", "src/app/dev/emails", "scripts/notify-check.mts", "scripts/notify-emails-check.mts", "scripts/notify-unsub-check.mts", "supabase/events_r1_notify_prefs.sql", "supabase/tests/events_r1_notify_prefs_test.sql"];
  const files: string[] = [];
  const walk = (p: string) => {
    const full = new URL(`../${p}`, import.meta.url);
    if (statSync(full).isDirectory()) for (const n of readdirSync(full)) walk(`${p}/${n}`);
    else files.push(p);
  };
  roots.forEach(walk);
  const bad = files.filter((f) => /\u2014/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  eq(bad, [], "files with an em dash");
  ok(files.length > 25, "looked at the files");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
