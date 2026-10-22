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
} else {
  console.log("unknown step; see the comment at the top of the file");
  process.exit(2);
}
