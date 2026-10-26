/**
 * Plain checks for the Bachs server package (src/lib/bachs). No test framework, no network, no database.
 * Run from the repo root:  node --no-warnings scripts/bachs-check.mts
 * Covers: amounts, the platform fee, webhook signature vectors, the X-Account-Id guard and client behaviour (with an injected
 * fetch), the webhook routing table (against a stub of the SQL layer), dedupe and idempotency.
 * The real-path sequences are scripts/bachs-sandbox-run.mts (sandbox or mock) and the mock is scripts/bachs-mock.mjs.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context); // the route files import it extensionless
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

const { koboToString, stringToKobo, nairaToKobo } = await import("../src/lib/bachs/amounts.ts");
const { computeFee } = await import("../src/lib/bachs/fee.ts");
const { computeSignature, signatureHeader, verifySignature, parseSignatureHeader } = await import("../src/lib/bachs/signature.ts");
const { bachsRequest, BachsError, guardRequest } = await import("../src/lib/bachs/client.ts");
const api = await import("../src/lib/bachs/api.ts");
const { routeBachsEvent } = await import("../src/lib/bachs/webhookRouter.ts");
const { handleWebhook } = await import("../src/lib/bachs/webhook.ts");
const { startRefund, reconcileRefund } = await import("../src/lib/bachs/refunds.ts");
const { makeDb } = await import("./bachs-stub-db.mts");
const { runDuePayouts, shortBy } = await import("../src/lib/bachs/payouts.ts");

let pass = 0;
let fail = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (c: unknown, what: string) => {
  if (!c) throw new Error(what);
};
async function throws(fn: () => unknown, match: RegExp, what: string) {
  try {
    await fn();
  } catch (e) {
    if (!match.test((e as Error).message)) throw new Error(`${what}: wrong error "${(e as Error).message}"`);
    return;
  }
  throw new Error(`${what}: expected it to throw`);
}
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

// ------------------------------------------------------------------ amounts ---
await test("amounts: kobo to decimal string and back", () => {
  eq(koboToString(500000), "5000.00", "5000");
  eq(koboToString(1), "0.01", "one kobo");
  eq(koboToString(12345), "123.45", "123.45");
  eq(koboToString(0), "0.00", "zero");
  eq(stringToKobo("5000.00"), 500000, "parse");
  eq(stringToKobo("5000"), 500000, "no decimals");
  eq(stringToKobo("0.5"), 50, "one decimal");
  eq(nairaToKobo(5000), 500000, "naira to kobo");
  eq(nairaToKobo(19.99), 1999, "float safe");
});
await test("amounts: refuses what is not money", async () => {
  await throws(() => koboToString(1.5), /Not a kobo/, "fraction");
  await throws(() => koboToString(-1), /Not a kobo/, "negative");
  await throws(() => stringToKobo("5,000.00"), /Not a naira/, "comma");
  await throws(() => stringToKobo("1.234"), /Not a naira/, "three decimals");
  await throws(() => stringToKobo("-5"), /Not a naira/, "sign");
  await throws(() => stringToKobo("1e5"), /Not a naira/, "exponent");
});

// ---------------------------------------------------------------------- fee ---
const cfg = (percent: string, fixed = "0") => ({ percent, fixedNaira: fixed });
await test("fee: percent, half up, fixed part", () => {
  eq(computeFee(1000000, cfg("4.5")), 45000, "4.5 percent of 10,000");
  eq(computeFee(1000000, cfg("2.5")), 25000, "2.5 percent");
  eq(computeFee(1001, cfg("4.5")), 45, "45.045 rounds down");
  eq(computeFee(1011, cfg("4.5")), 45, "45.495 rounds down");
  eq(computeFee(1012, cfg("4.5")), 46, "45.54 rounds up");
  eq(computeFee(1111, cfg("4.5")), 50, "50.0 exactly");
  eq(computeFee(1000, cfg("0.05")), 1, "0.5 kobo rounds half up to 1");
  eq(computeFee(1000000, cfg("2.5", "100")), 35000, "percent plus fixed naira");
  eq(computeFee(1000000, cfg("0", "150.50")), 15050, "fixed only");
});
await test("fee: clamped so it is above 0 and below the gross", () => {
  eq(computeFee(100, cfg("0", "1")), 99, "fixed 100 kobo on a 100 kobo gross is clamped to 99");
  eq(computeFee(2, cfg("100")), 1, "100 percent of 2 kobo is clamped to 1");
  eq(computeFee(50000, cfg("100")), 49999, "100 percent clamps below gross");
  for (const g of [2, 3, 99, 500, 50000, 999999]) {
    const f = computeFee(g, cfg("4.5", "100"));
    ok(f > 0 && f < g, `fee ${f} outside (0, ${g})`);
  }
});
await test("fee: nothing set, bad values and a zero result throw", async () => {
  await throws(() => computeFee(100000, cfg("0", "0")), /comes to nothing/, "zero fee");
  await throws(() => computeFee(100000, cfg("abc")), /not a percentage/, "bad percent");
  await throws(() => computeFee(100000, cfg("101")), /over 100/, "over 100");
  await throws(() => computeFee(100000, cfg("4.5", "-1")), /not an amount/, "negative fixed");
  await throws(() => computeFee(1, cfg("4.5")), /too small/, "gross of one kobo");
  await throws(() => computeFee(0, cfg("4.5")), /too small/, "gross zero");
  await throws(() => computeFee(100000, { percent: "", fixedNaira: "" }), /comes to nothing|not a percentage/, "empty config");
});

// ---------------------------------------------------------------- signature ---
const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"checkout.completed","data":{"checkout_id":"chk_1"}}';
const T = 1_800_000_000;
await test("signature: a valid V2 header passes (known vector)", () => {
  const hex = computeSignature(SECRET, T, BODY);
  eq(hex.length, 64, "hex length");
  eq(computeSignature(SECRET, T, BODY), hex, "stable");
  eq(verifySignature({ header: `t=${T},v1=${hex}`, rawBody: BODY, secret: SECRET, now: T }), { ok: true }, "valid");
  eq(verifySignature({ header: `t=${T},v1=${hex}`, rawBody: BODY, secret: SECRET, now: T + 299 }), { ok: true }, "299 s late");
  eq(verifySignature({ header: `t=${T},v1=${hex}`, rawBody: BODY, secret: SECRET, now: T - 299 }), { ok: true }, "299 s early");
});
await test("signature: wrong secret, tampered body, stale and malformed are refused", () => {
  const good = signatureHeader(SECRET, BODY, T);
  eq(verifySignature({ header: signatureHeader("other", BODY, T), rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "mismatch" }, "wrong secret");
  eq(verifySignature({ header: good, rawBody: BODY.replace("chk_1", "chk_2"), secret: SECRET, now: T }), { ok: false, reason: "mismatch" }, "tampered body");
  eq(verifySignature({ header: good, rawBody: BODY, secret: SECRET, now: T + 301 }), { ok: false, reason: "stale" }, "301 s old");
  eq(verifySignature({ header: good, rawBody: BODY, secret: SECRET, now: T - 301 }), { ok: false, reason: "stale" }, "301 s in the future");
  eq(verifySignature({ header: null, rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "missing" }, "no header");
  eq(verifySignature({ header: "garbage", rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "malformed" }, "garbage header");
  eq(verifySignature({ header: `t=${T}`, rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "malformed" }, "no v1");
  eq(verifySignature({ header: `t=${T},v1=zz`, rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "malformed" }, "v1 not hex of 64");
  eq(verifySignature({ header: good, rawBody: BODY, secret: undefined, now: T }), { ok: false, reason: "no_secret" }, "secret unset");
});
await test("signature: two v1 values (secret rotation), either may match", () => {
  const old = computeSignature("old_secret", T, BODY);
  const current = computeSignature(SECRET, T, BODY);
  eq(verifySignature({ header: `t=${T},v1=${old},v1=${current}`, rawBody: BODY, secret: SECRET, now: T }), { ok: true }, "second matches");
  eq(verifySignature({ header: `t=${T},v1=${current},v1=${old}`, rawBody: BODY, secret: SECRET, now: T }), { ok: true }, "first matches");
  eq(verifySignature({ header: `t=${T},v1=${old},v1=${old}`, rawBody: BODY, secret: SECRET, now: T }), { ok: false, reason: "mismatch" }, "neither matches");
  eq(parseSignatureHeader(`t=${T}, v1=${old} ,v1=${current}`).v1.length, 2, "spaces tolerated");
});

// ------------------------------------------------------- client and the guard ---
const ACCT = "acct_4FWLLecDyJ9aXn8a";
const config = { apiBase: "https://sandbox-api.test", secretKey: "sk_sandbox_SECRETVALUE" };
type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
function fakeFetch(responses: { status: number; body?: unknown; headers?: Record<string, string>; throws?: boolean }[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r.throws) throw new DOMException("timeout", "TimeoutError");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "x-request-id": "req-123", ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

await test("guard: a charge without a valid X-Account-Id never leaves the building", async () => {
  const f = fakeFetch([{ status: 201, body: {} }]);
  const base = { account: ACCT, reference: "ord_1", idempotencyKey: "k", grossKobo: 500000, platformFeeKobo: 22500, successUrl: "https://x.test/r", cancelUrl: "https://x.test/c", metadata: { order_id: "1" } };
  await throws(() => api.createCheckout({ ...base, account: "" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "empty");
  await throws(() => api.createCheckout({ ...base, account: "org_123456789" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "wrong prefix");
  await throws(() => api.createCheckout({ ...base, account: "acct_" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "too short");
  await throws(() => bachsRequest("POST", "/v1/checkout-sessions", { body: {}, idempotencyKey: "k", accountId: ACCT, asPlatform: true }, { config, fetchImpl: f.impl, log: quiet }), /not both/, "a host's and Hoppaz's at once");
  await throws(() => bachsRequest("POST", "/v1/checkout-sessions", { body: {}, idempotencyKey: "k" }, { config, fetchImpl: f.impl, log: quiet }), /needs X-Account-Id/, "raw call without account");
  await throws(() => api.createCheckout({ ...base, platformFeeKobo: 0 }, { config, fetchImpl: f.impl, log: quiet }), /platform_fee must be above 0/, "zero fee");
  await throws(() => api.createCheckout({ ...base, platformFeeKobo: 500000 }, { config, fetchImpl: f.impl, log: quiet }), /below the gross/, "fee equal to gross");
  eq(f.calls.length, 0, "no request was sent");
  guardRequest("GET", "/v1/accounts/me", undefined); // a GET without an account is allowed (platform calls)
});
await test("guard: refunds and balances name the host too, whatever the method", async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  const d = { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} };
  await throws(() => bachsRequest("POST", "/v1/refunds", { body: {}, idempotencyKey: "k" }, d), /needs X-Account-Id/, "refund without account");
  await throws(() => bachsRequest("GET", "/v1/refunds/rfnd_1", {}, d), /needs X-Account-Id/, "reading a refund without account");
  await throws(() => bachsRequest("GET", "/v1/balances", {}, d), /needs X-Account-Id/, "balances without account");
  await throws(() => api.getAvailableNairaKobo("", d), /X-Account-Id/, "balances with an empty account");
  await throws(() => api.getRefund("rfnd_1", "org_nope", d), /X-Account-Id/, "a bad account id");
  await throws(() => api.createRefund({ chargeId: "ch_1", reference: "rf_1", idempotencyKey: "k", account: undefined as never }, d), /needs X-Account-Id/, "createRefund with no account at all");
  eq(f.calls.length, 0, "nothing was sent");
  guardRequest("GET", "/v1/platform_fees", undefined); // platform calls without a host stay allowed
  await api.getRefund("rfnd_1", ACCT, d);
  eq(f.calls[0].headers["X-Account-Id"], ACCT, "with the account it goes");
});
await test("createCheckout: an old order on a host's account still sends the direct-charge request", async () => {
  const f = fakeFetch([{ status: 201, body: { checkout_id: "chk_1", checkout_url: "https://c.test/x", status: "open" } }]);
  const out = await api.createCheckout(
    { account: ACCT, reference: "ord_abc", idempotencyKey: "order:abc:co1", grossKobo: 500000, platformFeeKobo: 22500, customer: { email: "b@x.test", name: "B" }, successUrl: "https://x.test/tickets/return?order=abc", cancelUrl: "https://x.test/event/e", metadata: { order_id: "abc", event_id: "e", buyer_id: "u" } },
    { config, fetchImpl: f.impl, log: quiet }
  );
  eq(out.checkout_id, "chk_1", "response passed through");
  const c = f.calls[0];
  eq(c.method, "POST", "method");
  eq(c.url, "https://sandbox-api.test/v1/checkout-sessions", "url");
  eq(c.headers["X-Account-Id"], ACCT, "host account header");
  eq(c.headers["Idempotency-Key"], "order:abc:co1", "idempotency header");
  eq(c.headers.Authorization, "Bearer sk_sandbox_SECRETVALUE", "bearer");
  const body = JSON.parse(c.body!);
  eq(body.pricing, { currency: "NGN", amount: "5000.00" }, "amount as a decimal string");
  eq(body.platform_fee, "225.00", "platform fee as a decimal string");
  eq(body.reference, "ord_abc", "reference");
  eq(body.expires_in_minutes, 15, "15 minute hold");
  eq(body.payment_method_types, ["NGN_BANK_TRANSFER", "NGN_CARD"], "methods");
  ok(!("transfer_data" in body), "no transfer_data (contradictory charge type)");
  ok(!("customer_bears_fee" in body), "host pays Bachs's fee by default");
});
await test("createCheckout: Hoppaz collects: its own checkout, no platform_fee, the buyer pays Bachs's fee on top", async () => {
  const f = fakeFetch([{ status: 201, body: { checkout_id: "chk_2", checkout_url: "https://c.test/y", status: "open" } }]);
  await api.createCheckout(
    { account: api.PLATFORM, reference: "ord_p", idempotencyKey: "order:p:co1", grossKobo: 1000000, platformFeeKobo: 45000, successUrl: "https://x.test/r", cancelUrl: "https://x.test/c", metadata: { order_id: "p" } },
    { config, fetchImpl: f.impl, log: quiet }
  );
  const c = f.calls[0];
  ok(!("X-Account-Id" in c.headers), "no X-Account-Id: the charge is Hoppaz's");
  const body = JSON.parse(c.body!);
  eq(body.pricing, { currency: "NGN", amount: "10000.00" }, "the ticket price");
  ok(!("platform_fee" in body), "no platform_fee: Hoppaz's cut is what it does not pay the host");
  eq(body.customer_bears_fee, true, "the buyer pays Bachs's fee on top");
});
await test("guard: Hoppaz's own refunds and balances go only when asPlatform says so", async () => {
  const f = fakeFetch([{ status: 200, body: { balances: [{ currency: "NGN", available_balance: "10000.00" }], account_id: "acct_PLATFORM000" } }]);
  const d = { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} };
  eq(await api.getAvailableNairaKobo(api.PLATFORM, d), 1000000, "Hoppaz's available balance");
  ok(!("X-Account-Id" in f.calls[0].headers), "read as Hoppaz");
  eq(await api.platformAccountId(d), "acct_PLATFORM000", "Hoppaz's account id from the balances");
});
await test("payouts: the shortfall in Bachs's refusal is read in kobo", async () => {
  eq(shortBy("Insufficient NGN balance: 9550.00 available, 9600.00 needed (amount 9550.00 + fee 50.00), 50.00 short"), 5000, "sandbox wording, 26 Oct");
  eq(shortBy("1,250.50 short"), 125050, "thousands");
  eq(shortBy("nothing here"), null, "no number");
});
await test("payouts: a due withdrawal is transferred, then paid out less the fee, to the default usable bank", async () => {
  const db = makeDb();
  db.withdrawals.push({ id: "w1", reference: "wd_aaaa", user_id: "u1", status: "requested", amount_kobo: 955000, account: ACCT, transfer_id: null, payout_tries: 0, attempts: 1 });
  const f = fakeFetch([
    { status: 201, body: { id: "tr_1", destination: ACCT, amount: "9550.00", currency: "NGN", status: "paid" } },
    { status: 200, body: { destinations: [{ id: "pd_old", type: "bank_account", currency: "NGN", is_usable: false, is_default: false }, { id: "pd_1", type: "bank_account", currency: "NGN", is_usable: true, is_default: true }] } },
    { status: 200, body: { balances: [{ currency: "NGN", available_balance: "9550.00" }] } },
    { status: 200, body: { id: "pay_1", status: "processing", amount: "9500.00", fee: "50.00", total_debited: "9550.00" } },
  ]);
  const out = await runDuePayouts(db as never, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
  eq(out, { transferred: 1, payouts: 1, seen: 1 }, "one transfer, one payout");
  const t = JSON.parse(f.calls[0].body!);
  eq([f.calls[0].url.endsWith("/v1/transfers"), t.destination, t.amount, t.transfer_group], [true, ACCT, "9550.00", "wd_aaaa"], "the transfer");
  eq(f.calls[0].headers["Idempotency-Key"], "wd_aaaa:transfer", "a retry is the same transfer");
  eq(f.calls[3].headers["X-Account-Id"], ACCT, "the payout is made as the host");
  const p = JSON.parse(f.calls[3].body!);
  eq([p.destination, p.amount, p.reference], ["pd_1", "9500.00", "wd_aaaa_1"], "to the default usable bank, the balance less N50");
  eq([db.withdrawals[0].status, db.withdrawals[0].payout_id, db.withdrawals[0].fee], ["paying", "pay_1", 5000], "saved as paying");
});
await test("payouts: a transfer refused for INSUFFICIENT_BALANCE waits (Hoppaz's payments not settled yet)", async () => {
  const db = makeDb();
  db.withdrawals.push({ id: "w2", reference: "wd_bbbb", user_id: "u1", status: "requested", amount_kobo: 500000, account: ACCT, transfer_id: null, payout_tries: 0, attempts: 1 });
  const f = fakeFetch([{ status: 400, body: { error_code: "INSUFFICIENT_BALANCE", detail: "Insufficient NGN balance" } }]);
  const out = await runDuePayouts(db as never, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
  eq(out, { transferred: 0, payouts: 0, seen: 1 }, "nothing moved");
  eq(db.withdrawals[0].status, "requested", "still requested, tried again later");
  ok(String(db.withdrawals[0].note).includes("settle"), "the reason is noted");
});
await test("payouts: a different withdrawal fee is read from the refusal and the payout is sent once more, lower", async () => {
  const db = makeDb();
  db.withdrawals.push({ id: "w3", reference: "wd_cccc", user_id: "u1", status: "transferred", amount_kobo: 955000, account: ACCT, transfer_id: "tr_9", payout_tries: 0, attempts: 2 });
  const f = fakeFetch([
    { status: 200, body: { destinations: [{ id: "pd_1", type: "bank_account", currency: "NGN", is_usable: true, is_default: true }] } },
    { status: 200, body: { balances: [{ currency: "NGN", available_balance: "9550.00" }] } },
    { status: 400, body: { error_code: "INSUFFICIENT_BALANCE", detail: "Insufficient NGN balance: 9550.00 available, 9600.00 needed (amount 9500.00 + fee 100.00), 50.00 short" } },
    { status: 200, body: { id: "pay_2", status: "processing", amount: "9450.00", fee: "100.00" } },
  ]);
  await runDuePayouts(db as never, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
  eq(JSON.parse(f.calls[3].body!).amount, "9450.00", "50 less on the second try");
  eq(db.withdrawals[0].status, "paying", "then paying");
});
await test("router: payout.paid and payout.failed settle the withdrawal by Bachs's payout id", async () => {
  const db = makeDb();
  db.withdrawals.push({ id: "w4", reference: "wd_dddd", user_id: "u1", status: "paying", amount_kobo: 100000, account: ACCT, transfer_id: "tr_1", payout_tries: 1, attempts: 2, payout_id: "pay_9" });
  const failed = await routeBachsEvent({ id: "evt_p1", type: "payout.failed", data: { withdrawal_id: "pay_9", status: "failed" } } as never, db as never, { config, fetchImpl: fakeFetch([{ status: 500 }]).impl, log: quiet, sleep: async () => {} }, quiet);
  eq([failed.action, db.withdrawals[0].status], ["payout_failed", "transferred"], "failed: back to transferred, paid out again next sweep");
  db.withdrawals[0].status = "paying";
  const paid = await routeBachsEvent({ id: "evt_p2", type: "payout.paid", data: { withdrawal_id: "pay_9", status: "completed" } } as never, db as never, { config, fetchImpl: fakeFetch([{ status: 500 }]).impl, log: quiet, sleep: async () => {} }, quiet);
  eq([paid.action, db.withdrawals[0].status], ["payout_paid", "paid"], "paid");
  eq((await routeBachsEvent({ id: "evt_p3", type: "payout.paid", data: { withdrawal_id: "pay_other" } } as never, db as never, { config, fetchImpl: fakeFetch([{ status: 500 }]).impl, log: quiet, sleep: async () => {} }, quiet)).action, "payout_not_found", "not ours");
});
await test("client: the key is never logged, request ids are", async () => {
  const lines: string[] = [];
  const f = fakeFetch([{ status: 200, body: { id: ACCT } }]);
  await api.getAccount(ACCT, { config, fetchImpl: f.impl, log: (l) => lines.push(l) });
  ok(lines.length === 1 && lines[0].includes("req=req-123") && lines[0].includes("200"), `log line: ${lines[0]}`);
  ok(!lines.join("\n").includes("SECRETVALUE") && !/bearer/i.test(lines.join("\n")), "secret or Authorization in the log");
});
await test("client: error_code mapping", async () => {
  const kinds: [number, string, string][] = [
    [403, "PAYMENT_METHOD_NOT_ALLOWED", "host_not_ready"],
    [400, "INVALID_PLATFORM_FEE", "invalid"],
    [400, "INSUFFICIENT_BALANCE", "insufficient_balance"],
    [409, "IDEMPOTENCY_CONFLICT", "conflict"],
    [403, "FORBIDDEN", "auth"],
    [401, "UNAUTHORIZED", "auth"],
    [404, "NOT_FOUND", "not_found"],
    [400, "VALIDATION_ERROR", "invalid"],
    [500, "INTERNAL", "unavailable"],
  ];
  for (const [status, code, kind] of kinds) {
    const f = fakeFetch([{ status, body: { error_code: code, detail: "d" } }]);
    try {
      await bachsRequest("POST", "/v1/refunds", { body: {}, idempotencyKey: "k", accountId: ACCT }, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} });
      throw new Error("did not throw");
    } catch (e) {
      ok(e instanceof BachsError, "BachsError");
      eq((e as InstanceType<typeof BachsError>).kind, kind, `${status} ${code}`);
      eq((e as InstanceType<typeof BachsError>).requestId, "req-123", "request id kept");
    }
  }
});
await test("client: 429 waits Retry-After then succeeds; 5xx on a POST with a key is retried once with the same key", async () => {
  const waits: number[] = [];
  const a = fakeFetch([{ status: 429, headers: { "retry-after": "2" }, body: { error_code: "RATE_LIMITED" } }, { status: 200, body: { ok: 1 } }]);
  await bachsRequest("GET", "/v1/accounts/me", {}, { config, fetchImpl: a.impl, log: quiet, sleep: async (ms) => void waits.push(ms) });
  eq(waits, [2000], "waited 2000 ms");
  eq(a.calls.length, 2, "two requests");
  const b = fakeFetch([{ status: 503, body: {} }, { status: 201, body: { checkout_id: "chk_9" } }]);
  const out = await bachsRequest<{ checkout_id: string }>("POST", "/v1/checkout-sessions", { accountId: ACCT, idempotencyKey: "same", body: {} }, { config, fetchImpl: b.impl, log: quiet, sleep: async () => {} });
  eq(out.checkout_id, "chk_9", "second try answered");
  eq([b.calls[0].headers["Idempotency-Key"], b.calls[1].headers["Idempotency-Key"]], ["same", "same"], "same key both times");
  const c = fakeFetch([{ status: 503, body: {} }]);
  await throws(() => bachsRequest("POST", "/v1/refunds", { accountId: ACCT, body: {} }, { config, fetchImpl: c.impl, log: quiet, sleep: async () => {} }), /Bachs answered 503/, "a POST with no key is not repeated");
  eq(c.calls.length, 1, "one request only");
});
await test("client: a timeout becomes a retryable error, not a crash", async () => {
  const f = fakeFetch([{ status: 0, throws: true }]);
  try {
    await bachsRequest("GET", "/v1/accounts/me", {}, { config, fetchImpl: f.impl, log: quiet });
    throw new Error("did not throw");
  } catch (e) {
    ok(e instanceof BachsError && e.kind === "unavailable" && e.retryable, "unavailable and retryable");
  }
  eq(f.calls.length, 2, "a GET is tried twice");
});

// ---------------------------------------------------- webhook routing (stub) ---
const completed = (extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  id: "evt_c1", type: "checkout.completed", created_at: new Date().toISOString(), account: ACCT, organization_id: ACCT,
  data: { checkout_id: "chk_1", status: "completed", payment_status: "paid", amount: "5000.00", currency: "NGN", reference: "ord_1", charge: { id: "ch_1", status: "succeeded" }, metadata: { order_id: "ord-1" }, ...extra }, ...top,
});
const noBachs = { config, fetchImpl: fakeFetch([{ status: 500 }]).impl, log: quiet, sleep: async () => {} };

await test("router: checkout.completed paid issues once, a repeat changes nothing", async () => {
  const db = makeDb();
  const e = completed({ payment_method_details: { type: "bank_transfer" } });
  const a = await routeBachsEvent(e as never, db as never, noBachs, quiet);
  eq(a.action, "tickets_issued", "first");
  const b = await routeBachsEvent(e as never, db as never, noBachs, quiet);
  eq(b.action, "already_paid_or_flagged", "second");
  eq(db.order.issued, 1, "tickets issued exactly once");
  eq(db.log[0], "paid chk_1 ch_1 5000.00 bank_transfer", "arguments to ev_pay_order_paid");
});
await test("router: not paid, wrong host account, wrong amount", async () => {
  const db = makeDb();
  eq((await routeBachsEvent(completed({ payment_status: "requires_payment_method" }) as never, db as never, noBachs, quiet)).action, "ignored_not_paid", "not paid");
  eq((await routeBachsEvent(completed({}, { account: "acct_someoneelse1" }) as never, db as never, noBachs, quiet)).action, "account_mismatch", "other host's event");
  eq(db.order.issued, 0, "nothing issued");
  const r = await routeBachsEvent(completed({ amount: "4000.00" }) as never, db as never, noBachs, quiet);
  eq(r.action, "already_paid_or_flagged", "short amount is flagged, not issued");
  eq(db.order.issued, 0, "nothing issued for a short amount");
});
await test("router: an unknown order is retried (5xx), found by reference when the checkout id is not attached yet", async () => {
  const db = makeDb();
  const r = await routeBachsEvent(completed({ checkout_id: "chk_zzz", reference: "ord_zzz" }) as never, db as never, noBachs, quiet);
  eq(r, { action: "order_not_found", retry: true }, "retry");
  const early = makeDb({ checkout: "" });
  const r2 = await routeBachsEvent(completed({ checkout_id: "chk_new" }) as never, early as never, noBachs, quiet);
  eq(r2.action, "tickets_issued", "matched by reference before attach");
});
await test("router: collection.succeeded saves details and never issues", async () => {
  const db = makeDb();
  const r = await routeBachsEvent({ id: "evt_s1", type: "collection.succeeded", account: ACCT, data: { charge_id: "ch_1", checkout_id: "chk_1", reference: "ord_1", status: "SUCCEEDED", processing_fee: "75.00", payment_method_details: { type: "card" } } } as never, db as never, noBachs, quiet);
  eq(r.action, "details_saved", "action");
  eq(db.log, ["details ch_1 7500 card"], "fee in kobo and method");
  eq(db.order.issued, 0, "no tickets");
});
await test("router: checkout.expired, never over a paid order", async () => {
  const db = makeDb();
  eq((await routeBachsEvent({ id: "evt_x", type: "checkout.expired", data: { checkout_id: "chk_1" } } as never, db as never, noBachs, quiet)).action, "order_expired", "open to expired");
  const paid = makeDb({ status: "paid" });
  eq((await routeBachsEvent({ id: "evt_x", type: "checkout.expired", data: { checkout_id: "chk_1" } } as never, paid as never, noBachs, quiet)).action, "expire_no_change", "paid stays paid");
});
await test("router: a late payment on an expired order: bank transfer owes a manual refund, card is refunded at once", async () => {
  const bank = makeDb({ status: "expired" });
  const r = await routeBachsEvent(completed({ payment_method_details: { type: "bank_transfer" } }) as never, bank as never, noBachs, quiet);
  eq(r.action, "late_payment_refund", "action");
  eq(bank.order.needs_manual, true, "manual refund owed");
  ok(!bank.log.some((l) => l.startsWith("refund_start")), "no Bachs refund for a bank transfer");
  const f = fakeFetch([{ status: 200, body: { balances: [{ currency: "NGN", available_balance: "9000.00" }] } }, { status: 201, body: { refund_id: "rfnd_1", status: "processing" } }]);
  const card = makeDb({ status: "expired" });
  const r2 = await routeBachsEvent(completed({ payment_method_details: { type: "card" } }) as never, card as never, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
  eq(r2.action, "late_payment_refund", "card action");
  ok(card.log.includes("refund_start ord-1 null"), "refund started by the system");
  ok(card.log.includes("refund_apply rfnd_1 rf_ord1 processing"), "Bachs refund recorded");
  const post = f.calls.find((c) => c.method === "POST")!;
  eq(post.headers["X-Account-Id"], ACCT, "refund is sent as the host account");
  eq(JSON.parse(post.body!).charge_id, "ch_1", "refund names the charge");
});
await test("router: refund.*, dispute.*, capability.updated, account.updated, unknown", async () => {
  const db = makeDb();
  const go = (type: string, data: object, extra: object = {}) => routeBachsEvent({ id: "evt_" + type, type, created_at: "2026-10-22T10:00:00Z", account: ACCT, data, ...extra } as never, db as never, noBachs, quiet);
  eq((await go("refund.created", { refund_id: "rfnd_1", reference: "rf_1", status: "processing" })).action, "refund_processing", "created");
  eq((await go("refund.paid", { refund_id: "rfnd_1", reference: "rf_1", status: "success" })).action, "refund_paid", "paid");
  eq((await go("refund.failed", { refund_id: "rfnd_1", reference: "rf_1", status: "failed" })).action, "refund_failed", "failed");
  eq((await go("dispute.created", { dispute_id: "dsp_1", charge_id: "ch_1", status: "needs_response", amount: "5000.00" })).action, "dispute_flagged", "dispute");
  eq((await go("capability.updated", { account: ACCT, capability: "payouts", status: "active" })).action, "capability_ok", "capability");
  eq((await go("account.updated", { account: ACCT, outstanding: ["persons.name", "payout_destination"] })).action, "requirements_ok", "account");
  eq((await go("collection.failed", { reason: "x" })).action, "ignored", "collection.failed is only logged");
  eq((await go("subscription.created", {})).action, "ignored", "unknown type");
  eq((await go("payout.paid", {})).action, "ignored_no_payout", "a payout event with no payout id");
  ok(db.log.includes("capability " + ACCT + " payouts active 2026-10-22T10:00:00Z"), "capability gets the event's time");
  ok(db.log.includes("requirements " + ACCT + " persons.name|payout_destination"), "outstanding list passed");
  ok(db.log.includes("refund_apply rfnd_1 rf_1 paid") && db.log.includes("refund_apply rfnd_1 rf_1 failed") && db.log.includes("refund_apply rfnd_1 rf_1 processing"), "refund statuses come from the event type");
});

// ------------------------------------------------ the whole webhook function ---
const NOW = 1_800_000_000;
const send = (db: ReturnType<typeof makeDb>, evt: object, opts: { secret?: string; t?: number; header?: string | null } = {}) => {
  const raw = JSON.stringify(evt);
  const t = opts.t ?? NOW;
  return handleWebhook({ rawBody: raw, signatureHeader: opts.header === undefined ? signatureHeader(opts.secret ?? SECRET, raw, t) : opts.header, secret: SECRET, db: db as never, now: NOW, bachs: noBachs, log: quiet });
};
await test("webhook: 400 on a bad signature, nothing is stored or changed", async () => {
  const db = makeDb();
  eq((await send(db, completed(), { secret: "wrong" })).status, 400, "wrong secret");
  eq((await send(db, completed(), { t: NOW - 400 })).status, 400, "old timestamp");
  eq((await send(db, completed(), { header: null })).status, 400, "no header");
  eq(db.log.length, 0, "database untouched");
  eq(db.order.issued, 0, "no tickets");
});
await test("webhook: 2xx after commit; the same event twice issues once (dedupe) and says duplicate", async () => {
  const db = makeDb();
  const e = completed();
  const a = await send(db, e);
  eq([a.status, a.body.action], [200, "tickets_issued"], "first");
  const b = await send(db, e);
  eq([b.status, b.body.duplicate], [200, true], "second is a duplicate");
  eq(db.order.issued, 1, "issued once");
});
await test("webhook: checkout.completed twice with different event ids still issues once (idempotent function)", async () => {
  const db = makeDb();
  await send(db, completed());
  const r = await send(db, { ...completed(), id: "evt_c2" });
  eq(r.status, 200, "ok");
  eq(db.order.issued, 1, "issued once");
});
await test("webhook: a database failure answers 5xx and the retry is run again, not dropped", async () => {
  const db = makeDb();
  let first = true;
  const orig = db.orderPaid;
  db.orderPaid = async (i) => { if (first) { first = false; throw new Error("db down"); } return orig(i); };
  const a = await send(db, completed());
  eq(a.status, 500, "5xx so Bachs retries");
  eq(db.events.get("evt_c1")!.processed, false, "not marked processed");
  const b = await send(db, completed());
  eq([b.status, b.body.action], [200, "tickets_issued"], "retry processes it");
  eq(db.order.issued, 1, "issued once");
});
await test("webhook: out-of-order and late: paid then expired keeps the order paid; expired then paid is a late payment", async () => {
  const db = makeDb();
  await send(db, completed());
  await send(db, { id: "evt_e1", type: "checkout.expired", created_at: new Date().toISOString(), data: { checkout_id: "chk_1" } });
  eq(db.order.status, "paid", "paid is not overwritten");
  const late = makeDb();
  await send(late, { id: "evt_e2", type: "checkout.expired", created_at: new Date().toISOString(), data: { checkout_id: "chk_1" } });
  eq(late.order.status, "expired", "expired");
  const r = await send(late, { ...completed({ payment_method_details: { type: "bank_transfer" } }), id: "evt_c9" });
  eq(r.body.action, "late_payment_refund", "late payment found");
  eq(late.order.needs_manual, true, "manual refund queued");
});
await test("webhook: unknown order is 5xx while young, 200 once the event is old; unknown type is 200", async () => {
  const db = makeDb();
  const e = { ...completed({ checkout_id: "chk_nope", reference: "ord_nope" }), created_at: new Date((NOW - 60) * 1000).toISOString() };
  eq((await send(db, e)).status, 500, "young");
  const old = { ...completed({ checkout_id: "chk_nope", reference: "ord_nope" }), id: "evt_old", created_at: new Date((NOW - 4 * 3600) * 1000).toISOString() };
  eq((await send(db, old)).status, 200, "old events are let go");
  eq((await send(db, { id: "evt_u", type: "something.new", data: {} })).status, 200, "unknown type");
});

// ----------------------------------------------------------------- refunds ---
await test("refund: a host balance below the gross is refused before anything is voided", async () => {
  const f = fakeFetch([{ status: 200, body: { balances: [{ currency: "NGN", available_balance: "4675.00" }] } }]);
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  const r = await startRefund(db as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: f.impl, log: quiet }, quiet);
  eq(r, { ok: false, reason: "insufficient_host_balance" }, "refused");
  ok(!db.log.some((l) => l.startsWith("refund_start")), "tickets not voided");
});
await test("refund: card goes to Bachs as the host; bank transfer is a manual task with no Bachs call", async () => {
  const f = fakeFetch([{ status: 200, body: { balances: [{ currency: "NGN", available_balance: "9350.00" }] } }, { status: 201, body: { refund_id: "rfnd_7", status: "processing" } }]);
  const card = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  eq(await startRefund(card as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: f.impl, log: quiet }, quiet), { ok: true, method: "card", status: "refund_pending", orderId: "ord-1" }, "card");
  const post = f.calls.find((c) => c.method === "POST")!;
  eq([post.url.endsWith("/v1/refunds"), post.headers["X-Account-Id"], post.headers["Idempotency-Key"]], [true, ACCT, "refund:rf_ord1"], "refund request");
  const g = fakeFetch([{ status: 500 }]);
  const bank = makeDb({ status: "paid", method: "bank_transfer", charge: "ch_2" });
  eq(await startRefund(bank as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: g.impl, log: quiet }, quiet), { ok: true, method: "manual", status: "manual_needed", orderId: "ord-1" }, "bank");
  eq(g.calls.length, 0, "Bachs not called for a bank transfer");
});
await test("refund: Bachs refusing puts the order back to owed (refund_apply failed), never stuck pending", async () => {
  const f = fakeFetch([{ status: 200, body: { balances: [{ currency: "NGN", available_balance: "9350.00" }] } }, { status: 400, body: { error_code: "INSUFFICIENT_BALANCE", detail: "Insufficient balance to refund" } }]);
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  const r = await startRefund(db as never, { orderId: "ord-1", actor: null }, { config, fetchImpl: f.impl, log: quiet }, quiet);
  eq(r, { ok: false, reason: "insufficient_host_balance" }, "reason");
  ok(db.log.includes("refund_apply null rf_ord1 failed"), "restored");
});
const balanceOk = { status: 200, body: { balances: [{ currency: "NGN", available_balance: "9350.00" }] } };
await test("refund: a timeout or 5xx is an UNKNOWN outcome: nothing is undone, the try is recorded, the order is not put back to paid", async () => {
  for (const bad of [{ status: 0, throws: true }, { status: 503, body: {} }]) {
    const f = fakeFetch([balanceOk, bad]);
    const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
    const r = await startRefund(db as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
    eq(r, { ok: true, method: "card", status: "refund_pending", orderId: "ord-1", unconfirmed: true }, "pending, unconfirmed");
    ok(!db.log.some((l) => l.includes("failed")), `refund_apply failed must not be called: ${db.log.join(" | ")}`);
    ok(db.log.some((l) => l.startsWith("refund_attempt rf_ord1")), "the attempt is recorded");
    eq(db.order.status, "refund_pending", "the order stays refund_pending");
    const posts = f.calls.filter((c) => c.method === "POST");
    ok(posts.length >= 1 && posts.every((c) => c.headers["Idempotency-Key"] === "refund:rf_ord1"), "every send used the same key");
  }
});
await test("refund: timeout, then refund.paid arrives: the refund is paid, never failed", async () => {
  const f = fakeFetch([balanceOk, { status: 0, throws: true }]);
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  await startRefund(db as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: f.impl, log: quiet, sleep: async () => {} }, quiet);
  const res = await routeBachsEvent({ id: "evt_rp", type: "refund.paid", data: { refund_id: "rfnd_7", reference: "rf_ord1" } } as never, db as never, {}, quiet);
  eq(res.action, "refund_paid", "routed as paid");
  ok(db.log.includes("refund_apply rfnd_7 rf_ord1 paid") && !db.log.some((l) => l.endsWith(" failed")), `log: ${db.log.join(" | ")}`);
});
await test("refund: timeout, then the sweeper retries with the SAME reference and the SAME idempotency key (never a new one)", async () => {
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  const g = fakeFetch([{ status: 201, body: { refund_id: "rfnd_9", status: "processing" } }]);
  const pending = { orderId: "ord-1", reference: "rf_ord1", bachsRefundId: null, chargeId: "ch_1", hostAccount: ACCT, attempts: 1 };
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: g.impl, log: quiet, sleep: async () => {} }, quiet), "processing", "answered");
  const c = g.calls[0];
  const body = JSON.parse(c.body!);
  eq([c.method, c.url.endsWith("/v1/refunds"), c.headers["Idempotency-Key"], c.headers["X-Account-Id"], body.reference, body.charge_id], ["POST", true, "refund:rf_ord1", ACCT, "rf_ord1", "ch_1"], "same reference, same key, as the host");
  ok(db.log.includes("refund_apply rfnd_9 rf_ord1 processing"), "recorded with the id Bachs gave");
  // Still no answer: recorded again, still pending.
  const h = fakeFetch([{ status: 502, body: {} }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: h.impl, log: quiet, sleep: async () => {} }, quiet), "unknown", "no answer");
  ok(db.log.filter((l) => l.startsWith("refund_attempt rf_ord1")).length === 1 && !db.log.some((l) => l.endsWith(" failed")), "attempt recorded, nothing undone");
  // A retry that Bachs REFUSES for another reason (for example "already refunded") does not undo anything: the first try may have gone through.
  const k = fakeFetch([{ status: 400, body: { error_code: "VALIDATION_ERROR", detail: "charge already refunded" } }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: k.impl, log: quiet, sleep: async () => {} }, quiet), "unknown", "a refusal on a retry is still unknown");
  ok(!db.log.some((l) => l.endsWith(" failed")), "and still nothing undone");
  // Only INSUFFICIENT_BALANCE is a sure no, even on a retry.
  const m = fakeFetch([{ status: 400, body: { error_code: "INSUFFICIENT_BALANCE", detail: "Insufficient balance to refund" } }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: m.impl, log: quiet, sleep: async () => {} }, quiet), "failed", "insufficient balance on a retry");
  ok(db.log.includes("refund_apply null rf_ord1 failed"), "that one restores the order");
});
await test("refund: the sweeper asks Bachs by refund id when it has one (GET /v1/refunds/{id} as the host)", async () => {
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  const pending = { orderId: "ord-1", reference: "rf_ord1", bachsRefundId: "rfnd_5", chargeId: "ch_1", hostAccount: ACCT, attempts: 2 };
  const paid = fakeFetch([{ status: 200, body: { refund_id: "rfnd_5", status: "paid" } }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: paid.impl, log: quiet }, quiet), "paid", "paid");
  eq([paid.calls[0].method, paid.calls[0].url.endsWith("/v1/refunds/rfnd_5"), paid.calls[0].headers["X-Account-Id"]], ["GET", true, ACCT], "a GET as the host, no POST");
  ok(db.log.includes("refund_apply rfnd_5 rf_ord1 paid"), "recorded paid");
  const failed = fakeFetch([{ status: 200, body: { refund_id: "rfnd_5", status: "failed" } }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: failed.impl, log: quiet }, quiet), "failed", "Bachs says failed");
  const still = fakeFetch([{ status: 200, body: { refund_id: "rfnd_5", status: "processing" } }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: still.impl, log: quiet }, quiet), "processing", "still processing");
  const down = fakeFetch([{ status: 500, body: {} }]);
  eq(await reconcileRefund(db as never, pending, { config, fetchImpl: down.impl, log: quiet, sleep: async () => {} }, quiet), "unknown", "Bachs down");
});
await test("refund: a definite Bachs refusal on the first try (400 bad request) undoes it; the 502 text no longer says the tickets stay void", async () => {
  const f = fakeFetch([balanceOk, { status: 400, body: { error_code: "VALIDATION_ERROR", detail: "bad request" } }]);
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  eq(await startRefund(db as never, { orderId: "ord-1", actor: "u9" }, { config, fetchImpl: f.impl, log: quiet }, quiet), { ok: false, reason: "bachs_refused" }, "refused");
  ok(db.log.includes("refund_apply null rf_ord1 failed"), "restored");
  const src = (await import("node:fs")).readFileSync(new URL("../src/app/api/events-r1/pay/refund/route.ts", import.meta.url), "utf8");
  ok(!/bachs_refused: \[.*stay void/.test(src) && /bachs_refused: \[502, ".*valid again/.test(src), "the misleading text is gone");
});
await test("router: collection.succeeded that says card for a payment held as a manual refund hands it to the automatic card refund", async () => {
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1", needs_refund: true });
  db.orderDetails = async () => ({ ok: true, order_id: "ord-1", refund_by_card: true });
  const f = fakeFetch([balanceOk, { status: 201, body: { refund_id: "rfnd_3", status: "processing" } }]);
  const r = await routeBachsEvent({ id: "evt_s1", type: "collection.succeeded", account: ACCT, data: { checkout_id: "chk_1", charge_id: "ch_1", payment_method_details: { type: "card" } } } as never, db as never, { config, fetchImpl: f.impl, log: quiet }, quiet);
  eq(r.action, "details_saved_refund_card", "routed");
  ok(db.log.some((l) => l.startsWith("refund_start ord-1")) && db.log.includes("refund_apply rfnd_3 rf_ord1 processing"), `log: ${db.log.join(" | ")}`);
});
await test("refund: a stranger is refused before Bachs or the database is asked", async () => {
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  db.canRefund = async () => false;
  const g = fakeFetch([{ status: 500 }]);
  eq(await startRefund(db as never, { orderId: "ord-1", actor: "stranger" }, { config, fetchImpl: g.impl, log: quiet }, quiet), { ok: false, reason: "not_allowed" }, "refused");
  eq([g.calls.length, db.log.length], [0, 0], "nothing called");
});

// ------------------------------------------- the route files themselves (no database) ---
// Environment for the route tests: a webhook secret, a cron secret, and a database address that refuses connections at once.
process.env.BACHS_WEBHOOK_SECRET = SECRET;
process.env.HOPPAZ_CRON_SECRET = "cron_test_secret";
process.env.BACHS_SECRET_KEY = "sk_sandbox_SECRETVALUE";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pub";
process.env.SUPABASE_SECRET_KEY = "svc";
process.env.NEXT_PUBLIC_SITE_URL = "https://hoppaz.test";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const webhookRoute = await import("../src/app/api/bachs/webhook/route.ts");
const payoutSetupRoute = await import("../src/app/api/events-r1/pay/payout-setup/route.ts");
const banksRoute = await import("../src/app/api/events-r1/pay/banks/route.ts");
const checkoutRoute = await import("../src/app/api/events-r1/pay/checkout/route.ts");
const confirmRoute = await import("../src/app/api/events-r1/pay/confirm/route.ts");
const refundRoute = await import("../src/app/api/events-r1/pay/refund/route.ts");
const sweepRoute = await import("../src/app/api/events-r1/pay/sweep/route.ts");
const quoteRoute = await import("../src/app/api/events-r1/pay/quote/route.ts");
const UID = "11111111-1111-4111-8111-111111111111";

await test("route webhook: bad or missing signature is 400 before anything else", async () => {
  const raw = JSON.stringify(completed());
  const t = Math.floor(Date.now() / 1000);
  const bad = new Request("https://hoppaz.test/api/bachs/webhook", { method: "POST", body: raw, headers: { "x-bachs-signature-v2": signatureHeader("wrong", raw, t) } });
  eq((await webhookRoute.POST(bad)).status, 400, "wrong secret");
  eq((await webhookRoute.POST(new Request("https://hoppaz.test/api/bachs/webhook", { method: "POST", body: raw }))).status, 400, "no header");
  const good = new Request("https://hoppaz.test/api/bachs/webhook", { method: "POST", body: raw, headers: { "x-bachs-signature-v2": signatureHeader(SECRET, raw, t) } });
  const res = await webhookRoute.POST(good);
  eq(res.status, 500, "a correct signature reaches our own code, which fails here (no database): 5xx so Bachs retries");
});
await test("route sweep: 401 without the shared secret, with a wrong one; with the right one it reaches the database", async () => {
  eq((await sweepRoute.POST(new Request("https://hoppaz.test/x", { method: "POST" }))).status, 401, "none");
  eq((await sweepRoute.POST(new Request("https://hoppaz.test/x", { method: "POST", headers: { authorization: "Bearer nope" } }))).status, 401, "wrong bearer");
  eq((await sweepRoute.POST(new Request("https://hoppaz.test/x", { method: "POST", headers: { "x-hoppaz-cron-secret": "nope" } }))).status, 401, "wrong header");
  eq((await sweepRoute.GET(new Request("https://hoppaz.test/x", { headers: { authorization: "Bearer cron_test_secret" } }))).status, 500, "right secret passes the gate (and our own failure with no database is 500, not a crash)");
});
await test("routes: no session is 401, a foreign Origin is 403, bad input is 400", async () => {
  const url = "https://hoppaz.test/api/events-r1/pay/";
  for (const [name, route] of [["checkout", checkoutRoute], ["confirm", confirmRoute], ["refund", refundRoute], ["payout-setup", payoutSetupRoute], ["banks", banksRoute]] as const) {
    eq((await route.POST(post(url + name, {}))).status, 401, `${name} without a bearer`);
    eq((await route.POST(post(url + name, {}, { origin: "https://evil.test", authorization: "Bearer x" }))).status, 403, `${name} from another site`);
  }
  eq((await quoteRoute.POST(post(url + "quote", { eventId: "x" }))).status, 400, "quote bad input");
  eq((await quoteRoute.POST(post(url + "quote", { eventId: UID, ticketTypeId: UID, quantity: 9 }))).status, 400, "quote quantity 9");
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
