/**
 * A local stand-in for the Bachs API and its hosted checkout page. Node, no dependencies, local use only.
 *
 *   MOCK_WEBHOOK_SECRET=whsec_mock node scripts/bachs-mock.mjs
 *   then run the app with BACHS_API_BASE=http://127.0.0.1:3415 BACHS_SECRET_KEY=sk_mock BACHS_WEBHOOK_SECRET=whsec_mock
 *
 * Env: PORT (3415), MOCK_WEBHOOK_SECRET (default whsec_mock_local), MOCK_WEBHOOK_URL (default http://127.0.0.1:3410/api/bachs/webhook).
 *
 * It copies what the real sandbox was seen to do (notes/luma/11b-bachs-sandbox-findings.md), including the awkward parts:
 *   - POST /v1/checkout-sessions needs X-Account-Id (403 for an unknown account); GET /v1/checkout-sessions/{id} without it is 404.
 *   - Idempotency-Key: the same key and body replays the first answer, the same key with another body is 409 IDEMPOTENCY_CONFLICT.
 *   - A reference can be used once (400 BAD_REQUEST "Duplicate reference").
 *   - platform_fee must be above 0 and below the amount (400 INVALID_PLATFORM_FEE). Raw `pricing` works; product_cart needs product_id.
 *   - After payment GET says status "completed", payment_status "succeeded" (the webhook says "paid"); the charge id is charge.payment_id.
 *   - Host balance = amount - platform fee - Bachs fee (2 percent card, 1.5 percent bank transfer). POST /v1/refunds needs X-Account-Id
 *     (404 "Charge not found" without) and answers 400 INSUFFICIENT_BALANCE when the host holds less than the amount.
 *   - success_url gets ?checkout_id= appended.
 *
 * The hosted page (GET /c/<id>) has buttons:
 *   Pay by card | Pay by bank transfer   mark it completed, send a SIGNED checkout.completed and collection.succeeded, redirect back
 *   Pay and send everything twice        the same two events delivered twice with the same ids (dedupe)
 *   Send a bad signature                 pays, but the checkout.completed carries a wrong signature (the app must answer 400)
 *   Fail                                 a failed attempt (collection.failed, stays open)
 *   Let it expire                        checkout.expired
 *   Expire, then pay late                checkout.expired now, then a paid checkout.completed 2 s later (a late payment)
 *   Pay but skip the webhook             completes it with NO webhook (the buyer's return must settle it)
 * Control endpoints (JSON POST): /_mock/capability {account, capability, status}, /_mock/account-updated {account, outstanding},
 *   /_mock/dispute {checkout_id}, /_mock/refund-paid {refund_id}, /_mock/send {type, data, account?, badSignature?, id?}.
 *   GET /_mock/state lists accounts, checkouts, refunds and every delivery with the app's answer.
 * Events are signed with X-Bachs-Signature-V2: t=<unix>,v1=hex(HMAC-SHA256(secret, `${t}.${rawBody}`)).
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 3415);
const SECRET = process.env.MOCK_WEBHOOK_SECRET || "whsec_mock_local";
const HOOK = process.env.MOCK_WEBHOOK_URL || "http://127.0.0.1:3410/api/bachs/webhook";
const PLATFORM = "acct_mockplatform0001";

const rid = (p, n = 16) => `${p}_${randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n)}`;
const accounts = new Map();
const checkouts = new Map();
const refunds = new Map();
const idem = new Map();
const deliveries = [];

const caps = (status = "active") =>
  Object.fromEntries(["bank_transfer", "ngn_card_collection", "card_collection", "payouts", "transfers"].map((n) => [n, { status, requested: true, status_details: null }]));
const kobo = (s) => Math.round(Number(s) * 100);
const naira = (k) => (k / 100).toFixed(2);
const procFee = (c) => Math.round(c.gross * (c.method === "bank_transfer" ? 0.015 : 0.02));

function acct(id) {
  return accounts.get(id);
}
function balance(a) {
  return a.balanceKobo;
}

function checkoutView(c) {
  const paid = c.status === "completed";
  return {
    checkout_id: c.id,
    status: c.status,
    mode: "payment",
    payment_status: paid ? "succeeded" : "requires_payment_method",
    amount: naira(c.gross),
    currency: "NGN",
    reference: c.reference,
    checkout_url: `http://127.0.0.1:${PORT}/c/${c.slug}`,
    platform_fee: naira(c.fee),
    expires_at: c.expiresAt,
    created_at: c.createdAt,
    completed_at: c.completedAt ?? null,
    metadata: c.metadata ?? null,
    success_url: c.successUrl,
    cancel_url: c.cancelUrl,
    customer_details: c.customer ?? null,
    charge: {
      payment_id: c.chargeId,
      status: paid ? "succeeded" : "open",
      amount: naira(c.gross),
      amount_paid: paid ? naira(c.gross) : "0.00",
      payment_method: paid ? (c.method === "bank_transfer" ? "NGN_BANK_TRANSFER" : "NGN_CARD") : null,
      payment_method_details: null,
      fees: paid ? { amount: naira(procFee(c)), currency: "NGN" } : null,
      platform_fee: paid ? naira(c.fee) : null,
      is_refundable: paid && !c.refunded,
    },
  };
}

// ---------------------------------------------------------------- webhooks ---
async function send(type, data, { account, badSignature = false, id, createdAt } = {}) {
  const body = JSON.stringify({ id: id ?? rid("evt", 24), type, created_at: createdAt ?? new Date().toISOString(), organization_id: account ?? PLATFORM, ...(account ? { account } : {}), data });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", badSignature ? `${SECRET}-wrong` : SECRET).update(`${t}.${body}`).digest("hex");
  const rec = { type, id: JSON.parse(body).id, badSignature, status: null, answer: null };
  deliveries.push(rec);
  try {
    const res = await fetch(HOOK, { method: "POST", headers: { "content-type": "application/json", "x-bachs-signature-v2": `t=${t},v1=${v1}` }, body });
    rec.status = res.status;
    rec.answer = (await res.text()).slice(0, 200);
  } catch (e) {
    rec.status = 0;
    rec.answer = String(e.message);
  }
  console.log(`[mock] webhook ${type} ${rec.id}${badSignature ? " (BAD SIGNATURE)" : ""} -> ${rec.status}`);
  return rec;
}

const completedData = (c) => ({
  checkout_id: c.id, status: "completed", mode: "payment", payment_status: "paid", amount: naira(c.gross), currency: "NGN", reference: c.reference,
  customer_details: c.customer ?? null, charge: { id: c.chargeId, status: "succeeded" }, metadata: c.metadata ?? {}, completed_at: c.completedAt,
  payment_method_details: { type: c.method === "bank_transfer" ? "bank_transfer" : "card" },
});
const succeededData = (c) => ({
  charge_id: c.chargeId, checkout_id: c.id, reference: c.reference, status: "SUCCEEDED", amount: naira(c.gross), currency: "NGN",
  settlement_amount: naira(c.gross - procFee(c)), processing_fee: naira(procFee(c)), fee_bearer: "merchant",
  payment_method_details: { type: c.method === "bank_transfer" ? "bank_transfer" : "card" }, metadata: c.metadata ?? {},
});

function markPaid(c, method) {
  c.status = "completed";
  c.method = method;
  c.completedAt = new Date().toISOString();
  const a = acct(c.account);
  a.balanceKobo += c.gross - c.fee - procFee(c);
}

async function payAndNotify(c, method, opts = {}) {
  markPaid(c, method);
  if (opts.skipWebhook) return;
  const ids = opts.twice ? [rid("evt", 24), rid("evt", 24)] : [undefined];
  const completedId = ids[0];
  const succeededId = opts.twice ? ids[1] : undefined;
  for (let i = 0; i < (opts.twice ? 2 : 1); i++) {
    await send("collection.succeeded", succeededData(c), { account: c.account, id: succeededId });
    await send("checkout.completed", completedData(c), { account: c.account, id: completedId, badSignature: opts.badSignature });
  }
}

// -------------------------------------------------------------------- http ---
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)); });
const reply = (res, status, obj, extra = {}) => {
  res.writeHead(status, { "content-type": "application/json", "x-request-id": rid("mock", 12), ...extra });
  res.end(JSON.stringify(obj));
};
const err = (res, status, code, detail) => reply(res, status, { detail, error_code: code });

async function api(req, res, url) {
  const key = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!key) return err(res, 401, "UNAUTHORIZED", "Missing key");
  const acctId = req.headers["x-account-id"];
  const raw = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : "";
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return err(res, 400, "BAD_REQUEST", "Invalid JSON"); }
  const path = url.pathname;
  const ik = req.headers["idempotency-key"];
  if (req.method === "POST" && ik) {
    const k = `${acctId ?? ""}|${ik}`;
    const hit = idem.get(k);
    if (hit) {
      if (hit.raw !== raw) return reply(res, 409, { success: false, detail: "Idempotency-Key was already used with a different request", error_code: "IDEMPOTENCY_CONFLICT" });
      return reply(res, hit.status, hit.body);
    }
    const orig = res.end.bind(res);
    res.end = (chunk) => { if (res.statusCode >= 200 && res.statusCode < 300) idem.set(k, { raw, status: res.statusCode, body: JSON.parse(chunk) }); return orig(chunk); };
  }

  if (path === "/v1/accounts/me" && req.method === "GET") return reply(res, 200, { id: PLATFORM, country: "NG", name: "Mock platform", capabilities: caps() });
  if (path === "/v1/accounts" && req.method === "POST") {
    if (!body.contact_email) return err(res, 400, "VALIDATION_ERROR", "contact_email required");
    const id = rid("acct", 16);
    accounts.set(id, { id, name: body.display_name ?? "", capabilities: caps(), balanceKobo: 0 });
    return reply(res, 201, { id, name: body.display_name, country: "NG", entity_type: body.entity_type, capabilities: caps(), requirements: { currently_due: ["persons.name"], eventually_due: [], past_due: [] }, parent_organization_id: PLATFORM });
  }
  let m = path.match(/^\/v1\/accounts\/([^/]+)\/account-links$/);
  if (m && req.method === "POST") {
    if (!acct(m[1])) return err(res, 404, "NOT_FOUND", "Account not found");
    if (!body.refresh_url || !body.return_url) return err(res, 400, "VALIDATION_ERROR", "refresh_url and return_url are required");
    return reply(res, 200, { id: rid("alnk", 12), url: `http://127.0.0.1:${PORT}/onboard/${m[1]}?return=${encodeURIComponent(body.return_url)}`, expires_at: new Date(Date.now() + 3600e3).toISOString(), previous_link_superseded: false });
  }
  m = path.match(/^\/v1\/accounts\/([^/]+)(\/capabilities)?$/);
  if (m && req.method === "GET") {
    const a = acct(m[1]);
    if (!a) return err(res, 404, "NOT_FOUND", "Account not found");
    return m[2] ? reply(res, 200, { items: Object.entries(a.capabilities ?? caps()).map(([name, v]) => ({ name, ...v })) }) : reply(res, 200, { id: a.id, name: a.name, capabilities: a.capabilities ?? caps() });
  }
  if (path === "/v1/balances" && req.method === "GET") {
    const a = acctId && acct(acctId);
    if (!a) return err(res, 403, "FORBIDDEN", "X-Account-Id is not an active connected account of this platform");
    return reply(res, 200, { account_id: a.id, balances: [{ currency: "NGN", available_balance: naira(balance(a)), pending_balance: "0.00" }] });
  }
  if (path === "/v1/checkout-sessions" && req.method === "POST") {
    if (!acctId || !acct(acctId)) return err(res, 403, "FORBIDDEN", `X-Account-Id '${acctId ?? ""}' is not an active connected account of this platform`);
    if (body.product_cart) return err(res, 400, "VALIDATION_ERROR", "Missing required field(s): product_cart.0.product_id");
    const gross = kobo(body.pricing?.amount);
    if (!(gross > 0)) return err(res, 400, "VALIDATION_ERROR", "pricing.amount required");
    const fee = body.platform_fee === undefined ? 0 : kobo(body.platform_fee);
    if (body.platform_fee !== undefined && fee <= 0) return err(res, 400, "INVALID_PLATFORM_FEE", `platform_fee must be greater than 0 (got ${body.platform_fee})`);
    if (fee >= gross && body.platform_fee !== undefined) return err(res, 400, "INVALID_PLATFORM_FEE", `platform_fee (${body.platform_fee}) must be less than the charge amount (${body.pricing.amount})`);
    if (!body.reference) return err(res, 400, "VALIDATION_ERROR", "reference required");
    if ([...checkouts.values()].some((c) => c.reference === body.reference)) return err(res, 400, "BAD_REQUEST", `Duplicate reference '${body.reference}'`);
    if (!/^https?:\/\//.test(body.success_url ?? "")) return err(res, 400, "VALIDATION_ERROR", "success_url required");
    const id = rid("chk", 16);
    const c = {
      id, slug: randomBytes(9).toString("base64url"), account: acctId, gross, fee, reference: body.reference, status: "open", chargeId: rid("ch", 24),
      metadata: body.metadata, customer: body.customer, successUrl: body.success_url, cancelUrl: body.cancel_url, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (body.expires_in_minutes ?? 60) * 60e3).toISOString(),
    };
    checkouts.set(id, c);
    return reply(res, 201, { ...checkoutView(c), payment_status: undefined, charge: undefined });
  }
  m = path.match(/^\/v1\/checkout-sessions\/([^/]+)$/);
  if (m && req.method === "GET") {
    const c = checkouts.get(m[1]);
    if (!c || c.account !== acctId) return err(res, 404, "NOT_FOUND", "Checkout not found");
    return reply(res, 200, checkoutView(c));
  }
  if (path === "/v1/refunds" && req.method === "POST") {
    const c = [...checkouts.values()].find((x) => x.chargeId === body.charge_id);
    if (!c || c.account !== acctId || c.status !== "completed") return err(res, 404, "NOT_FOUND", "Charge not found");
    if (c.refunded) return err(res, 400, "BAD_REQUEST", "Charge already refunded");
    if (acct(acctId).balanceKobo < c.gross) return err(res, 400, "INSUFFICIENT_BALANCE", "Insufficient balance to refund");
    acct(acctId).balanceKobo -= c.gross;
    c.refunded = true;
    const r = { refund_id: rid("rfnd", 16), charge_id: c.chargeId, reference: body.reference, status: "processing", requested_amount: naira(c.gross), refunded_amount: null, refund_fee_amount: "0.00", fee_bearer: "org" };
    refunds.set(r.refund_id, { ...r, account: acctId });
    return reply(res, 201, r);
  }
  m = path.match(/^\/v1\/refunds\/([^/]+)$/);
  if (m && req.method === "GET") return refunds.has(m[1]) ? reply(res, 200, refunds.get(m[1])) : err(res, 404, "NOT_FOUND", "Refund not found");
  if (path === "/v1/platform_fees" && req.method === "GET") {
    const q = url.searchParams.get("charge");
    const items = [...checkouts.values()].filter((c) => c.status === "completed" && (!q || c.chargeId === q)).map((c) => ({ id: rid("pf", 12), charge: c.chargeId, collected_from: c.account, earned_by: PLATFORM, amount: naira(c.fee), currency: "NGN", amount_refunded: "0.00", refunded: false }));
    return reply(res, 200, { items, pagination: { has_more: false, total: items.length } });
  }
  return err(res, 404, "NOT_FOUND", "Not found");
}

// ------------------------------------------------------------- hosted page ---
const page = (c, note = "") => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Mock Bachs Checkout</title>
<style>body{font:16px system-ui;max-width:420px;margin:24px auto;padding:0 16px}button{display:block;width:100%;margin:8px 0;padding:12px;font:inherit}small{color:#666}.s{background:#ffe9a8;padding:8px;border-radius:6px}</style>
<p class=s>Mock Bachs sandbox. Nothing here is real.</p><h2>${accounts.get(c.account)?.name || "Host"}</h2><h1>N ${(c.gross / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</h1>
<p><small>${c.id} / ${c.reference} / ${c.status}</small></p>${note ? `<p><b>${note}</b></p>` : ""}
${c.status === "open" ? ["card:Pay by card", "bank_transfer:Pay by bank transfer", "twice:Pay and send everything twice", "badsig:Send a bad signature", "nohook:Pay but skip the webhook", "fail:Fail", "expire:Let it expire", "late:Expire, then pay late"]
  .map((x) => { const [v, l] = x.split(":"); return `<form method=post action=/c/${c.slug}/do><input type=hidden name=a value=${v}><button>${l}</button></form>`; }).join("") : `<p>This checkout is ${c.status}.</p><p><a href="${c.successUrl}${c.successUrl.includes("?") ? "&" : "?"}checkout_id=${c.id}">Back to the shop</a></p>`}`;

async function hosted(req, res, url) {
  const m = url.pathname.match(/^\/c\/([^/]+)(\/do)?$/);
  const c = m && [...checkouts.values()].find((x) => x.slug === m[1]);
  if (!c) { res.writeHead(404); return res.end("no such checkout"); }
  if (req.method === "POST" && m[2]) {
    const a = new URLSearchParams(await readBody(req)).get("a");
    if (c.status === "open") {
      if (a === "card" || a === "bank_transfer") await payAndNotify(c, a);
      else if (a === "twice") await payAndNotify(c, "card", { twice: true });
      else if (a === "badsig") await payAndNotify(c, "card", { badSignature: true });
      else if (a === "nohook") await payAndNotify(c, "card", { skipWebhook: true });
      else if (a === "fail") { await send("collection.failed", { charge_id: c.chargeId, checkout_id: c.id, reference: c.reference, status: "FAILED", reason: "Payment authorization failed" }, { account: c.account }); res.writeHead(303, { location: `/c/${c.slug}` }); return res.end(); }
      else if (a === "expire") { c.status = "expired"; await send("checkout.expired", { checkout_id: c.id, status: "expired", payment_status: null, charge: null, reference: c.reference, metadata: c.metadata ?? {} }, { account: c.account }); res.writeHead(303, { location: `/c/${c.slug}` }); return res.end(); }
      else if (a === "late") {
        c.status = "expired";
        await send("checkout.expired", { checkout_id: c.id, status: "expired", payment_status: null, charge: null, reference: c.reference, metadata: c.metadata ?? {} }, { account: c.account });
        setTimeout(() => { markPaid(c, "bank_transfer"); send("collection.succeeded", succeededData(c), { account: c.account }).then(() => send("checkout.completed", completedData(c), { account: c.account })); }, 2000);
        res.writeHead(303, { location: `/c/${c.slug}` }); return res.end();
      }
    }
    const back = `${c.successUrl}${c.successUrl.includes("?") ? "&" : "?"}checkout_id=${c.id}`;
    res.writeHead(303, { location: back });
    return res.end();
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page(c));
}

async function control(req, res, url) {
  if (url.pathname === "/_mock/state") return reply(res, 200, { accounts: [...accounts.values()], checkouts: [...checkouts.values()], refunds: [...refunds.values()], deliveries });
  const b = JSON.parse((await readBody(req)) || "{}");
  if (url.pathname === "/_mock/capability") {
    const a = acct(b.account);
    if (a) a.capabilities = { ...(a.capabilities ?? caps()), [b.capability]: { status: b.status, requested: true, status_details: null } };
    return reply(res, 200, await send("capability.updated", { account: b.account, capability: b.capability, status: b.status, requested: true }, { account: b.account, createdAt: b.createdAt, badSignature: b.badSignature }));
  }
  if (url.pathname === "/_mock/account-updated") return reply(res, 200, await send("account.updated", { account: b.account, outstanding: b.outstanding ?? [] }, { account: b.account }));
  if (url.pathname === "/_mock/dispute") {
    const c = checkouts.get(b.checkout_id);
    return reply(res, 200, await send("dispute.created", { dispute_id: rid("dsp", 12), charge_id: c.chargeId, amount: naira(c.gross), currency: "NGN", status: "needs_response", reason: "fraudulent" }, { account: c.account }));
  }
  if (url.pathname === "/_mock/refund-paid") {
    const r = refunds.get(b.refund_id);
    return reply(res, 200, await send("refund.paid", { refund_id: r.refund_id, charge_id: r.charge_id, reference: r.reference, status: "paid", requested_amount: r.requested_amount, refunded_amount: r.requested_amount }, { account: r.account }));
  }
  if (url.pathname === "/_mock/send") return reply(res, 200, await send(b.type, b.data ?? {}, { account: b.account, badSignature: b.badSignature, id: b.id, createdAt: b.createdAt }));
  return err(res, 404, "NOT_FOUND", "Unknown control");
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/v1/")) return await api(req, res, url);
    if (url.pathname.startsWith("/c/")) return await hosted(req, res, url);
    if (url.pathname.startsWith("/_mock/")) return await control(req, res, url);
    if (url.pathname.startsWith("/onboard/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>Mock hosted onboarding. <a href='" + (url.searchParams.get("return") || "/") + "'>Finish</a></p>"); }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error("[mock] error", e);
    res.writeHead(500); res.end("mock error");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`[mock] Bachs mock on http://127.0.0.1:${PORT}, webhooks to ${HOOK}`));
