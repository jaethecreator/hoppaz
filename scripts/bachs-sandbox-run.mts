// OUT OF DATE since 26 Oct 2026: written for the old direct-charge model (each host its own Bachs merchant, hosted onboarding). Hoppaz now
// collects every payment and pays hosts out (supabase/events_r1_payouts.sql, src/lib/bachs/payouts.ts); createConnectedAccount and the onboard
// route are gone. The new flow is covered by scripts/bachs-check.mts, scripts/events-r1-check.mts and the 26 Oct sandbox run in the PR. Update before use.
/**
 * Real-path run against a Bachs API (the sandbox by default). No test framework, no secrets printed.
 *   node --no-warnings --env-file=.env.local scripts/bachs-sandbox-run.mts <step> [args]
 * Reads BACHS_SECRET_KEY and BACHS_API_BASE from the environment only (never prints the key; the client logs method, path,
 * status and x-request-id). Point BACHS_API_BASE at the mock (http://127.0.0.1:3415, scripts/bachs-mock.mjs) to run the same
 * steps against it.
 *
 * Steps:
 *   account            GET /v1/accounts/me, then create a connected account (POST /v1/accounts) and a hosted onboarding link.
 *   checkout [acct] [naira]   direct-charge checkout with X-Account-Id and platform_fee (raw pricing); prints the hosted page url.
 *   wait <chk> <acct>  poll GET /v1/checkout-sessions/<chk> until it is completed or expired (up to 6 minutes); pay it in a browser meanwhile.
 *   refund <chk> <acct> [bank]   card refund by POST /v1/refunds, tried without and then with X-Account-Id; then GET it.
 *   fee <ch_...>       GET /v1/platform_fees?charge=...
 *   reconcile <chk> <acct> <reference> [naira]   the buyer's return logic (lib/bachs/confirm.ts) against the real answer for one checkout,
 *                      with an in-memory database: prints what it would hand to ev_pay_order_paid.
 *   mockflow           ONLY against the mock (refuses a bachs.io base). The whole server path with an in-memory database: connect a host,
 *                      checkout, pay on the mock's hosted page, the SIGNED webhook arrives at a local receiver that runs handleWebhook,
 *                      the buyer's return reconciles, a duplicate event, a bad signature, a missed webhook, an expired-then-paid late
 *                      payment, capability events, a card refund with too little balance and then enough. Start the mock first:
 *                      MOCK_WEBHOOK_SECRET=whsec_mock MOCK_WEBHOOK_URL=http://127.0.0.1:3417/api/bachs/webhook node scripts/bachs-mock.mjs
 *                      then: BACHS_API_BASE=http://127.0.0.1:3415 BACHS_SECRET_KEY=sk_mock MOCK_WEBHOOK_SECRET=whsec_mock \
 *                            node --no-warnings scripts/bachs-sandbox-run.mts mockflow
 * Default host account is the sandbox probe account acct_4FWLLecDyJ9aXn8a (or BACHS_TEST_ACCOUNT).
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

const { bachsRequest, BachsError } = await import("../src/lib/bachs/client.ts");
const api = await import("../src/lib/bachs/api.ts");
const { computeFee } = await import("../src/lib/bachs/fee.ts");
const { koboToString, nairaToKobo } = await import("../src/lib/bachs/amounts.ts");

const [step, ...args] = process.argv.slice(2);
const DEFAULT_ACCT = process.env.BACHS_TEST_ACCOUNT || "acct_4FWLLecDyJ9aXn8a";
const feeCfg = { percent: process.env.HOPPAZ_TICKET_FEE_PERCENT || "4.5", fixedNaira: process.env.HOPPAZ_TICKET_FEE_FIXED_NAIRA || "0" };
const say = (label: string, value: unknown) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const tag = Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const v = await fn();
    say(`${label} OK`, v as unknown);
    return v;
  } catch (e) {
    if (e instanceof BachsError) say(`${label} FAILED`, { status: e.status, kind: e.kind, code: e.errorCode, req: e.requestId, detail: e.message });
    else say(`${label} FAILED`, (e as Error).message);
    return null;
  }
}

if (step === "account") {
  const me = await attempt("GET /v1/accounts/me", () => bachsRequest<any>("GET", "/v1/accounts/me"));
  say("platform account", { id: me?.id, country: me?.country });
  const acct = await attempt("create connected account", () => api.createConnectedAccount({ email: `host-${tag}@example.com`, displayName: `Hoppaz test host ${tag}`, idempotencyKey: `acct-${tag}` }));
  if (acct) {
    say("capabilities", Object.fromEntries(Object.entries(acct.capabilities ?? {}).map(([k, v]: any) => [k, v.status])));
    await attempt("account link", () => api.createAccountLink(acct.id, { refreshUrl: "https://example.com/refresh", returnUrl: "https://example.com/return", idempotencyKey: `link-${tag}` }));
  }
} else if (step === "checkout") {
  const acct = args[0] || DEFAULT_ACCT;
  const gross = nairaToKobo(Number(args[1] ?? 5000));
  const fee = computeFee(gross, feeCfg);
  say("gross / fee", `${koboToString(gross)} / ${koboToString(fee)}`);
  const co = await attempt("create checkout", () =>
    api.createCheckout({ accountId: acct, reference: `sbx_${tag}`, idempotencyKey: `co-${tag}`, grossKobo: gross, platformFeeKobo: fee, customer: { email: "buyer@example.com", name: "Test Buyer" }, successUrl: "https://example.com/tickets/return?order=sbx", cancelUrl: "https://example.com/events/x", metadata: { order_id: `sbx_${tag}`, event_id: "evt", buyer_id: "buyer" } })
  );
  if (co) say("OPEN THIS", `${co.checkout_url}  (id ${co.checkout_id})`);
} else if (step === "wait") {
  const [chk, acct = DEFAULT_ACCT] = args;
  const until = Date.now() + 6 * 60_000;
  let last = "";
  while (Date.now() < until) {
    const c = await api.getCheckout(chk, acct);
    const line = `${c.status}/${c.payment_status}`;
    if (line !== last) say("status", `${line} charge=${c.charge?.payment_id} charge_status=${c.charge?.status}`);
    last = line;
    if (c.status === "completed" || c.status === "expired") {
      say("final checkout", { status: c.status, payment_status: c.payment_status, amount: c.amount, platform_fee: c.platform_fee, completed_at: c.completed_at, charge: c.charge && { payment_id: c.charge.payment_id, status: c.charge.status, amount_paid: c.charge.amount_paid, method: c.charge.payment_method_details } });
      break;
    }
    await sleep(3000);
  }
} else if (step === "refund") {
  const [chk, acct = DEFAULT_ACCT, kind] = args;
  const c = await api.getCheckout(chk, acct);
  const charge = c.charge?.payment_id;
  say("charge", `${charge} status=${c.charge?.status} method=${JSON.stringify(c.charge?.payment_method_details)}`);
  const fee = charge ? await attempt("platform fee", () => api.getPlatformFee(charge)) : null;
  say("platform fee seen", !!fee);
  const withoutHeader = charge ? await attempt("refund WITHOUT X-Account-Id", () => api.createRefund({ chargeId: charge, reference: `rf_${tag}_a`, idempotencyKey: `rf-${tag}-a`, reason: "requested_by_customer" })) : null;
  if (!withoutHeader && charge) {
    await attempt("refund WITH X-Account-Id", () => api.createRefund({ chargeId: charge, reference: `rf_${tag}_b`, idempotencyKey: `rf-${tag}-b`, accountId: acct, reason: "requested_by_customer" }));
  }
  void kind;
} else if (step === "fee") {
  await attempt("platform fee", () => api.getPlatformFee(args[0]));
} else if (step === "reconcile") {
  const [chk, acct = DEFAULT_ACCT, reference, naira = "5000"] = args;
  const { reconcileOrder } = await import("../src/lib/bachs/confirm.ts");
  const { makeDb } = await import("./bachs-stub-db.mts");
  const db = makeDb({ host_account: acct, checkout: chk, reference, gross_kobo: nairaToKobo(Number(naira)) });
  const row = { id: db.order.id, buyer_id: "u", event_id: "e", status: "open", gross_kobo: db.order.gross_kobo, platform_fee_kobo: 22500, host_account: acct, bachs_checkout_id: chk, bachs_reference: reference, bachs_charge_id: null, payment_method: null, needs_refund: false, needs_manual_refund: false };
  say("reconcile result", await reconcileOrder(db as never, row as never));
  say("handed to ev_pay_order_paid", db.log.filter((l: string) => l.startsWith("paid")));
  say("wrong gross refused", await reconcileOrder(db as never, { ...row, gross_kobo: row.gross_kobo + 100 } as never));
  say("wrong reference refused", await reconcileOrder(db as never, { ...row, bachs_reference: "ord_other" } as never));
} else if (step === "mockflow") {
  await mockflow();
} else {
  console.log("unknown step; see the comment at the top of the file");
  process.exit(2);
}

async function mockflow() {
  const base = process.env.BACHS_API_BASE ?? "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error("mockflow runs only against the local mock (BACHS_API_BASE=http://127.0.0.1:3415)");
  const secret = process.env.MOCK_WEBHOOK_SECRET ?? "whsec_mock_local";
  const { createServer } = await import("node:http");
  const { handleWebhook } = await import("../src/lib/bachs/webhook.ts");
  const { reconcileOrder } = await import("../src/lib/bachs/confirm.ts");
  const { startRefund } = await import("../src/lib/bachs/refunds.ts");
  const { makeDb } = await import("./bachs-stub-db.mts");
  const eq = (a: unknown, b: unknown, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    console.log(`  ok  ${what}`);
  };

  // One in-memory database per order, found by checkout id or reference, like the SQL does.
  type Db = ReturnType<typeof makeDb>;
  const dbs: Db[] = [];
  const events = new Set<string>();
  const processed = new Set<string>();
  const findDb = (c: string | null, r: string | null) => dbs.find((d) => d.order.checkout === c || d.order.reference === r) ?? null;
  const shared = {
    // The receiver needs one PayDb that routes to the right order; wrap the per-order stubs.
    recordEvent: async (e: { id: string }) => (events.has(e.id) ? false : (events.add(e.id), true)),
    isProcessed: async (id: string) => processed.has(id),
    markProcessed: async (id: string) => void processed.add(id),
  };
  const router = (d: Db | null, keep: Db) => d ?? keep;
  const multi = new Proxy(shared, {
    get(t, k: string) {
      if (k in t) return (t as never)[k];
      return async (...args: unknown[]) => {
        const first = args[0] as { ref?: string; checkout?: string } | string | null;
        const key = typeof first === "string" ? first : first?.ref ?? first?.checkout ?? null;
        const target = router(findDb(key, key), dbs[dbs.length - 1]);
        return (target as never as Record<string, (...a: unknown[]) => unknown>)[k](...args);
      };
    },
  });
  const answers: { type: string; status: number }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const out = await handleWebhook({ rawBody: raw, signatureHeader: req.headers["x-bachs-signature-v2"] as string, secret, db: multi as never, log: (l) => console.log(`    ${l}`) });
      answers.push({ type: JSON.parse(raw).type, status: out.status });
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  }).listen(3417, "127.0.0.1");

  const mock = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const press = async (slug: string, action: string) => fetch(`${base}/c/${slug}/do`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `a=${action}`, redirect: "manual" });
  let n = 0;
  async function newOrder(label: string) {
    n++;
    const reference = `ord_${tag}_${n}`;
    const db = makeDb({ id: `ord-${n}`, host_account: acct.id, checkout: "", reference, status: "open", gross_kobo: 500000 });
    dbs.push(db);
    const fee = computeFee(500000, feeCfg);
    const co = await api.createCheckout({ accountId: acct.id, reference, idempotencyKey: `order:${db.order.id}:co1`, grossKobo: 500000, platformFeeKobo: fee, customer: { email: "b@example.com", name: "B" }, successUrl: "http://127.0.0.1:3410/tickets/return?order=" + db.order.id, cancelUrl: "http://127.0.0.1:3410/event/x", metadata: { order_id: db.order.id } });
    db.order.checkout = co.checkout_id;
    const slug = co.checkout_url!.split("/c/")[1];
    console.log(`- ${label}: ${co.checkout_id}`);
    return { db, co, slug };
  }
  const row = (db: Db) => ({ id: db.order.id, buyer_id: "u1", event_id: "e", status: db.order.status, gross_kobo: db.order.gross_kobo, platform_fee_kobo: 22500, host_account: db.order.host_account, bachs_checkout_id: db.order.checkout, bachs_reference: db.order.reference, bachs_charge_id: db.order.charge, payment_method: db.order.method, needs_refund: db.order.needs_refund, needs_manual_refund: db.order.needs_manual });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  console.log("- connect a host");
  const acct = await api.createConnectedAccount({ email: "host@example.com", displayName: "Mock Host", idempotencyKey: `acct-${tag}` });
  ok(acct.id.startsWith("acct_"), "account id");
  const link = await api.createAccountLink(acct.id, { refreshUrl: "http://127.0.0.1:3410/r", returnUrl: "http://127.0.0.1:3410/host/x?tab=overview" });
  ok(!!link.url, "link url");
  eq((await api.getCapabilities(acct.id)).payouts, "active", "capabilities read");

  const a = await newOrder("1 card payment, webhook then return");
  eq((await api.getCheckout(a.co.checkout_id, acct.id)).status, "open", "checkout open before paying");
  await press(a.slug, "card");
  await wait(300);
  eq([a.db.order.status, a.db.order.issued, a.db.order.method], ["paid", 1, "card"], "signed webhook issued the ticket");
  eq(answers.map((x) => `${x.type}:${x.status}`).slice(-2), ["collection.succeeded:200", "checkout.completed:200"], "both events answered 200");
  const co1 = await api.getCheckout(a.co.checkout_id, acct.id);
  eq([co1.status, co1.payment_status], ["completed", "succeeded"], "GET after payment says completed/succeeded (webhook says paid)");
  eq(await reconcileOrder(a.db as never, row(a.db) as never), "paid", "return after the webhook: already paid, nothing issued twice");
  eq(a.db.order.issued, 1, "still one ticket");
  eq((await api.getPlatformFee(co1.charge!.payment_id!))?.amount, "225.00", "platform fee readable at Bachs");

  const b = await newOrder("2 the same events delivered twice");
  await press(b.slug, "twice");
  await wait(400);
  eq([b.db.order.issued, answers.filter((x) => x.status === 200).length > 0], [1, true], "paid once although delivered twice");

  const c = await newOrder("3 bad signature");
  const before = answers.length;
  await press(c.slug, "badsig");
  await wait(300);
  eq(answers.slice(before).find((x) => x.type === "checkout.completed")?.status, 400, "bad signature answered 400");
  eq(c.db.order.status, "open", "order not paid by a forged event");
  eq(await reconcileOrder(c.db as never, row(c.db) as never), "paid", "the buyer's return asks Bachs and settles it");
  eq(c.db.order.issued, 1, "ticket issued by the return");

  const d = await newOrder("4 webhook never arrives");
  await press(d.slug, "nohook");
  eq(d.db.order.status, "open", "still open before the return");
  eq(await reconcileOrder(d.db as never, row(d.db) as never), "paid", "return settles it");
  eq(await reconcileOrder(d.db as never, row(d.db) as never), "paid", "asking again is harmless");
  eq(d.db.order.issued, 1, "one ticket");

  const e = await newOrder("5 expired, then paid late (bank transfer)");
  await press(e.slug, "late");
  await wait(2800);
  eq([e.db.order.status, e.db.order.needs_refund, e.db.order.needs_manual], ["paid", true, true], "late payment: manual refund owed");

  const f = await newOrder("6 wrong amount is not trusted");
  await press(f.slug, "card");
  await wait(300);
  const forged = { ...row(f.db), gross_kobo: 400000, status: "open" };
  eq(await reconcileOrder(f.db as never, forged as never), "pending", "session amount differs from the order: not settled");

  console.log("- capability events");
  const cap = (await mock("/_mock/capability", { account: acct.id, capability: "payouts", status: "restricted" })) as { status: number };
  await wait(200);
  eq(cap.status, 200, "capability.updated delivered and answered 200");
  eq(dbs[dbs.length - 1].log.some((l) => l.startsWith("capability " + acct.id + " payouts restricted")), true, "capability applied");

  console.log("- refunds (host balance is amount - fees, so one sale cannot refund itself)");
  const g = await newOrder("7 a sale to refund");
  await press(g.slug, "card");
  await wait(300);
  const bal = await api.getAvailableNairaKobo(acct.id);
  console.log(`  host balance ${koboToString(bal)}`);
  g.db.order.method = "card";
  const out = await startRefund(g.db as never, { orderId: g.db.order.id, actor: "host" }, {}, quiet);
  eq(out.ok, true, "refund started (the host holds enough from the other sales)");
  const state = (await (await fetch(`${base}/_mock/state`)).json()) as { refunds: { refund_id: string }[] };
  const refundId = state.refunds[state.refunds.length - 1].refund_id;
  await mock("/_mock/refund-paid", { refund_id: refundId });
  await wait(200);
  eq(g.db.log.some((l) => l.includes("refund_apply") && l.endsWith("paid")), true, "refund.paid reached refund_apply");
  const poor = await api.createConnectedAccount({ email: "poor@example.com", displayName: "Poor Host", idempotencyKey: `acct2-${tag}` });
  const sale = await api.createCheckout({ accountId: poor.id, reference: `ord_${tag}_poor`, idempotencyKey: `poor-${tag}`, grossKobo: 500000, platformFeeKobo: 22500, successUrl: "http://127.0.0.1:3410/r", cancelUrl: "http://127.0.0.1:3410/c", metadata: {} });
  await press(sale.checkout_url!.split("/c/")[1], "nohook");
  const lone = makeDb({ id: "ord-poor", host_account: poor.id, checkout: sale.checkout_id, reference: `ord_${tag}_poor`, status: "paid", method: "card", charge: "ch_x" });
  dbs.push(lone);
  const refused = await startRefund(lone as never, { orderId: "ord-poor", actor: "host" }, {}, quiet);
  eq(refused, { ok: false, reason: "insufficient_host_balance" } as never, "a host whose only sale this is cannot refund it (nothing voided)");

  server.close();
  console.log("mockflow: all steps passed");
}
function ok(c: unknown, what: string) {
  if (!c) throw new Error(what);
  console.log(`  ok  ${what}`);
}
function quiet() {}
