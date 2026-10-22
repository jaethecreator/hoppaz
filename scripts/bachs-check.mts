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
const { startRefund } = await import("../src/lib/bachs/refunds.ts");

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
  const base = { accountId: ACCT, reference: "ord_1", idempotencyKey: "k", grossKobo: 500000, platformFeeKobo: 22500, successUrl: "https://x.test/r", cancelUrl: "https://x.test/c", metadata: { order_id: "1" } };
  await throws(() => api.createCheckout({ ...base, accountId: "" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "empty");
  await throws(() => api.createCheckout({ ...base, accountId: "org_123456789" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "wrong prefix");
  await throws(() => api.createCheckout({ ...base, accountId: "acct_" }, { config, fetchImpl: f.impl, log: quiet }), /X-Account-Id/, "too short");
  await throws(() => bachsRequest("POST", "/v1/checkout-sessions", { body: {}, idempotencyKey: "k" }, { config, fetchImpl: f.impl, log: quiet }), /needs X-Account-Id/, "raw call without account");
  await throws(() => api.createCheckout({ ...base, platformFeeKobo: 0 }, { config, fetchImpl: f.impl, log: quiet }), /platform_fee must be above 0/, "zero fee");
  await throws(() => api.createCheckout({ ...base, platformFeeKobo: 500000 }, { config, fetchImpl: f.impl, log: quiet }), /below the gross/, "fee equal to gross");
  eq(f.calls.length, 0, "no request was sent");
  guardRequest("GET", "/v1/accounts/me", undefined); // a GET without an account is allowed (platform calls)
});
await test("createCheckout: sends the direct-charge request Bachs expects", async () => {
  const f = fakeFetch([{ status: 201, body: { checkout_id: "chk_1", checkout_url: "https://c.test/x", status: "open" } }]);
  const out = await api.createCheckout(
    { accountId: ACCT, reference: "ord_abc", idempotencyKey: "order:abc:co1", grossKobo: 500000, platformFeeKobo: 22500, customer: { email: "b@x.test", name: "B" }, successUrl: "https://x.test/tickets/return?order=abc", cancelUrl: "https://x.test/event/e", metadata: { order_id: "abc", event_id: "e", buyer_id: "u" } },
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
type Order = { id: string; status: string; host_account: string; gross_kobo: number; checkout: string; reference: string; method: "card" | "bank_transfer" | null; charge: string | null; issued: number; needs_refund: boolean; needs_manual: boolean };
function makeDb(seed?: Partial<Order>) {
  const log: string[] = [];
  const events = new Map<string, { processed: boolean }>();
  const order: Order = { id: "ord-1", status: "open", host_account: ACCT, gross_kobo: 500000, checkout: "chk_1", reference: "ord_1", method: null, charge: null, issued: 0, needs_refund: false, needs_manual: false, ...seed };
  const row = () => ({ id: order.id, buyer_id: "u1", event_id: "e1", status: order.status, gross_kobo: order.gross_kobo, platform_fee_kobo: 22500, host_account: order.host_account, bachs_checkout_id: order.checkout, bachs_reference: order.reference, bachs_charge_id: order.charge, payment_method: order.method, needs_refund: order.needs_refund, needs_manual_refund: order.needs_manual });
  const refunds: { reference: string; status: string }[] = [];
  const db = {
    log,
    order,
    refunds,
    events,
    recordEvent: async (e: { id: string }) => { log.push(`record ${e.id}`); if (events.has(e.id)) return false; events.set(e.id, { processed: false }); return true; },
    isProcessed: async (id: string) => !!events.get(id)?.processed,
    markProcessed: async (id: string) => { events.get(id)!.processed = true; log.push(`processed ${id}`); },
    hostAccountOf: async () => null, hostSaveAccount: async () => "ok",
    hostApplyCapability: async (a: string, c: string, s: string, at: string | null) => { log.push(`capability ${a} ${c} ${s} ${at}`); return "ok"; },
    hostApplyRequirements: async (a: string, o: string[]) => { log.push(`requirements ${a} ${o.join("|")}`); return "ok"; },
    ticketPrice: async () => 5000,
    orderReserve: async () => ({ ok: false }), orderAttach: async () => "ok", orderRelease: async () => "ok",
    orderRow: async (id: string) => (id === order.id ? row() : null),
    orderByRef: async (c: string | null, r: string | null) => (c === order.checkout || r === order.reference ? row() : null),
    orderPaid: async (i: { ref: string; charge: string | null; amount: string; method: string | null }) => {
      log.push(`paid ${i.ref} ${i.charge} ${i.amount} ${i.method}`);
      if (["paid", "refund_pending", "refunded"].includes(order.status)) return { ok: true, order_id: order.id, issued: false, needs_refund: order.needs_refund };
      if (i.amount !== "5000.00") return { ok: true, order_id: order.id, issued: false, needs_refund: false, flag_review: true, reason: "amount_mismatch" };
      const late = order.status === "expired";
      order.status = "paid"; order.charge = i.charge; order.method = (i.method as Order["method"]) ?? order.method;
      if (late) { order.needs_refund = true; order.needs_manual = order.method === "bank_transfer"; return { ok: true, order_id: order.id, issued: false, late: true, needs_refund: true }; }
      order.issued++;
      return { ok: true, order_id: order.id, issued: true, needs_refund: false };
    },
    orderDetails: async (i: { charge: string | null; checkout: string; feeKobo: number | null; method: string | null }) => { log.push(`details ${i.charge} ${i.feeKobo} ${i.method}`); return { ok: true }; },
    orderExpire: async (c: string) => { log.push(`expire ${c}`); if (order.status === "open") { order.status = "expired"; return { ok: true, changed: true }; } return { ok: true, changed: false }; },
    sweep: async () => [], refundsOwedByCard: async () => [],
    canRefund: async () => true,
    refundStart: async (id: string, actor: string | null) => {
      log.push(`refund_start ${id} ${actor}`);
      if (order.status !== "paid") return { ok: false, reason: "not_paid" };
      if (order.method === "card") { order.status = "refund_pending"; order.needs_refund = false; refunds.push({ reference: "rf_ord1", status: "requested" }); return { ok: true, method: "card", reference: "rf_ord1", charge_id: order.charge, host_account: order.host_account }; }
      order.needs_refund = true; order.needs_manual = true; return { ok: true, method: "manual" };
    },
    refundApply: async (rid: string | null, ref: string, status: string) => { log.push(`refund_apply ${rid} ${ref} ${status}`); return { ok: true, status }; },
    disputeFlag: async (c: string, d: string, s: string) => { log.push(`dispute ${c} ${d} ${s}`); return { ok: true }; },
  };
  return db;
}
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
  eq((await go("payout.paid", {})).action, "ignored", "unknown type");
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
await test("refund: a stranger is refused before Bachs or the database is asked", async () => {
  const db = makeDb({ status: "paid", method: "card", charge: "ch_1" });
  db.canRefund = async () => false;
  const g = fakeFetch([{ status: 500 }]);
  eq(await startRefund(db as never, { orderId: "ord-1", actor: "stranger" }, { config, fetchImpl: g.impl, log: quiet }, quiet), { ok: false, reason: "not_allowed" }, "refused");
  eq([g.calls.length, db.log.length], [0, 0], "nothing called");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
