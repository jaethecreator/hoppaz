/**
 * One REAL Bachs sandbox purchase (then more, a refund and a bank transfer) through OUR route handlers and the LOCAL Supabase.
 * Not the mock: BACHS_SECRET_KEY / BACHS_API_BASE come from .env.local (the sandbox key; it is never printed). Run from the repo root:
 *
 *   node --no-warnings scripts/events-r1-real-sandbox.mts
 *
 * Route handlers (pay/onboard, quote, checkout, confirm, refund, and api/bachs/webhook) are called in this process with Request
 * objects, like scripts/events-r1-real-check.mts. Only the local database (127.0.0.1) and the Bachs sandbox are touched. There is no
 * public tunnel and Bachs has given us no webhook secret, so webhooks are LOCALLY SIGNED requests with a secret made fresh for the
 * run (kept in memory only). The buyer is never redirected anywhere: success_url is https://example.com (Bachs refuses a loopback
 * address) and the app learns of payment by the confirm route, which asks Bachs itself.
 *
 * The script stops at each hosted payment: it prints a line "PAY NOW <label> <url>" and waits (up to 15 minutes) for someone to pay
 * that page in a browser (card 5531 8866 5214 2950, 09/32, 564, or Bank Transfer), polling the confirm route every 3 seconds.
 * RESUME_STATE=<file> keeps the throwaway local people and the event between runs (no secrets in it).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

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

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
// Run-only settings, in memory. The webhook secret is ours, made up for this process; Bachs never sees it.
process.env.BACHS_RETURN_ORIGIN = "https://example.com";
const WEBHOOK_SECRET = `whsec_local_${randomBytes(16).toString("hex")}`;
process.env.BACHS_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.HOPPAZ_TICKET_FEE_PERCENT ||= "4.5";
process.env.HOPPAZ_TICKET_FEE_FIXED_NAIRA ||= "0";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const dbHost = new URL(URL_).hostname;
if (dbHost !== "127.0.0.1" && dbHost !== "localhost") {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the local stack (${dbHost}).`);
  process.exit(1);
}
const apiBase = process.env.BACHS_API_BASE ?? "";
if (apiBase !== "https://sandbox-api.bachs.io" || !(process.env.BACHS_SECRET_KEY ?? "").startsWith("sk_sandbox_")) {
  console.error("Refusing to run: this script talks to the Bachs SANDBOX only (BACHS_API_BASE and a sk_sandbox_ key).");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP = "http://app.test";
process.env.EVENTS_R1_API_BASE = APP;

const jar = new Map<string, string>();
const doc = {
  get cookie() {
    return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  },
  set cookie(line: string) {
    const [pair, ...attrs] = line.split(";");
    const eqAt = pair.indexOf("=");
    const name = pair.slice(0, eqAt).trim();
    const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || attrs.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now());
    if (gone) jar.delete(name);
    else jar.set(name, pair.slice(eqAt + 1).trim());
  },
  visibilityState: "visible",
};
Object.assign(globalThis, { document: doc, window: { document: doc, location: { origin: APP, pathname: "/", search: "" } } });

const { createClient } = await import("@supabase/supabase-js");
const { realApi: api } = await import("../src/lib/events-r1/real/index.ts");
const core = await import("../src/lib/events-r1/real/core.ts");
const { getSupabase } = await import("../src/lib/supabase/client.ts");
const bachs = await import("../src/lib/bachs/api.ts");
const { signatureHeader } = await import("../src/lib/bachs/signature.ts");
const { bachsRequest } = await import("../src/lib/bachs/client.ts");

/* ------------------------------------------------------------------ plumbing -- */

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const sb = getSupabase()!;
const HOUR = 3.6e6;
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const out = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ->  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
async function step<T>(what: string, fn: () => Promise<T>, show?: (v: T) => string): Promise<T> {
  try {
    const v = await fn();
    out(true, what, show ? show(v) : "");
    return v;
  } catch (e) {
    out(false, what, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
async function refuses(what: string, fn: () => Promise<unknown>, message: string | RegExp) {
  try {
    await fn();
    out(false, what, "did not fail");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    out(typeof message === "string" ? m === message : message.test(m), what, `"${m}"`);
  }
}

type Person = { id: string; email: string; password: string; name: string };
const tag = randomBytes(3).toString("hex");
async function makeUser(label: string, name: string): Promise<Person> {
  // Bachs refuses reserved domains (example.test, example.com) as a contact email, and the route hands it the host's own address.
  const email = `r1-${label}-${tag}@mailinator.com`;
  const password = `${randomBytes(12).toString("base64url")}Aa1`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const up = await admin.from("profiles").update({ display_name: name }).eq("id", data.user.id);
  if (up.error) throw new Error(`profile ${label}: ${up.error.message}`);
  return { id: data.user.id, email, password, name };
}
async function login(p: Person) {
  const { error } = await sb.auth.signInWithPassword({ email: p.email, password: p.password });
  if (error) throw new Error(`sign in ${p.name}: ${error.message}`);
  await core.ready();
  await sleep(150);
}

const realFetch = globalThis.fetch;
const routes: Record<string, Record<string, (req: Request) => Promise<Response>>> = {};
async function route(path: string) {
  if (!routes[path]) routes[path] = (await import(`../src/app${path}/route.ts`)) as Record<string, (req: Request) => Promise<Response>>;
  return routes[path];
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(APP)) return realFetch(input, init);
  const mod = await route(new URL(url).pathname);
  const handler = mod[(init?.method ?? "GET").toUpperCase()];
  if (!handler) return new Response("{}", { status: 405 });
  return handler(new Request(url, init));
}) as typeof fetch;

/** Call a pay route directly (to see the whole answer, which the data layer trims). Returns status and body. */
async function payRoute(name: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, any> }> {
  const token = await core.accessToken();
  const res = await fetch(`${APP}/api/events-r1/pay/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

/** A LOCALLY signed webhook, handed to the real webhook route file. `secret` defaults to the run's own secret. */
async function webhook(type: string, data: Record<string, unknown>, account: string | undefined, opts: { id?: string; secret?: string } = {}) {
  const event = { id: opts.id ?? `evt_local_${randomBytes(8).toString("hex")}`, type, created_at: new Date().toISOString(), ...(account ? { account, organization_id: account } : {}), data };
  const raw = JSON.stringify(event);
  const header = signatureHeader(opts.secret ?? WEBHOOK_SECRET, raw, Math.floor(Date.now() / 1000));
  const mod = await route("/api/bachs/webhook");
  const res = await mod.POST(new Request(`${APP}/api/bachs/webhook`, { method: "POST", headers: { "x-bachs-signature-v2": header, "content-type": "application/json" }, body: raw }));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any>, id: event.id };
}

const orderRow = async (id: string) => (await admin.from("ev_orders").select("*").eq("id", id).single()).data as Record<string, any>;
const refundRows = async (orderId: string) => ((await admin.from("ev_refunds").select("*").eq("order_id", orderId).order("created_at")).data ?? []) as Record<string, any>[];
const snapshot = async (orderId: string, eventId: string) => {
  const o = await orderRow(orderId);
  const regs = ((await admin.from("ev_registrations").select("id,quantity,status").eq("event_id", eventId)).data ?? []) as Record<string, any>[];
  const tix = ((await admin.from("ev_tickets").select("id,status").eq("order_id", orderId)).data ?? []) as Record<string, any>[];
  return JSON.stringify({ status: o.status, charge: o.bachs_charge_id, issued: o.issued_seats, fee: o.processing_fee_kobo, method: o.payment_method, regs, tix: tix.length });
};

const naira = (kobo: number | null | undefined) => (kobo === null || kobo === undefined ? "?" : (Number(kobo) / 100).toFixed(2));
const hostBalance = async (account: string) => Number((await bachs.getAvailableNairaKobo(account)) ?? 0);

/* --------------------------------------------------------------------- setup -- */

type State = { host: Person; buyer: Person; eventId?: string; typeId?: string };
const STATE_FILE = process.env.RESUME_STATE;
let state: State | null = STATE_FILE && existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : null;
const save = () => STATE_FILE && state && writeFileSync(STATE_FILE, JSON.stringify(state));

console.log(`\n== setup (local stack ${dbHost}, Bachs sandbox, run ${tag})`);
const secretSet = await admin.rpc("ev_set_ticket_secret", { p_secret: randomBytes(32).toString("hex") });
void secretSet;
if (!state) {
  state = { host: await makeUser("rhost", "Real Host"), buyer: await makeUser("rbuyer", "Real Buyer") };
  save();
}
const host = state.host;
const buyer = state.buyer;
console.log(`   throwaway people: host ${host.email}, buyer ${buyer.email}`);

const results: string[] = [];
try {
  await step("paid switch on (local database setting)", async () => (await admin.rpc("ev_set_setting", { p_key: "paid_tickets", p_value: "on" })).data, (v) => String(v));

  /* ---- 1. host connects: REAL sandbox account + REAL onboarding link, then capabilities ---- */
  console.log("\n== 1. host: connect, payouts ready, paid event");
  await login(host);
  const p0 = await api.pay.hostPayout();
  out(!p0.can_sell, "before onboarding the host cannot sell", `status=${p0.status}`);
  const ob = await step("POST onboard route -> REAL connected account + hosted onboarding link", () => api.pay.startOnboarding("/host/onboarded"), (o) => o.url.replace(/(\/setup\/c\/[^/]*\/).*/, "$1..."));
  const account = (await admin.from("ev_host_payouts").select("bachs_account_id").eq("user_id", host.id).maybeSingle()).data?.bachs_account_id as string;
  out(/^acct_/.test(account ?? ""), "the connected account is saved for the host", account ? `${account.slice(0, 9)}...` : "none");
  out(ob.url.startsWith("https://"), "onboarding link is a https page on Bachs");
  const caps = await step("GET capabilities from the sandbox (the real statuses)", () => bachs.getCapabilities(account), (c) => JSON.stringify(c));
  for (const capability of ["bank_transfer", "ngn_card_collection", "payouts"]) {
    const w = await webhook("capability.updated", { account, capability, status: caps[capability] ?? "unrequested" }, account);
    out(w.status === 200, `locally signed capability.updated ${capability}=${caps[capability]}`, `${w.status} ${JSON.stringify(w.body)}`);
  }
  const p1 = await api.pay.hostPayout();
  out(p1.can_sell === true, "ev_host_payouts.can_sell is now true", `status=${p1.status} caps=${JSON.stringify(p1.capabilities)}`);

  if (!state.eventId) {
    const start = Date.now() + 48 * HOUR;
    const ev = await step(
      "events.create with a paid type (3000 naira, 10 seats)",
      () => api.events.create({ title: `Real Sandbox Night ${tag}`, starts_at: iso(start), ends_at: iso(start + 4 * HOUR), place_name: "VI, Lagos", area: "Victoria Island", tickets: [{ name: "Regular", price_naira: 3000, capacity: 10 }] }),
      (e: any) => e.ticket_types.map((t: any) => `${t.name} N${t.price_naira} cap ${t.capacity}`).join(", ")
    );
    state.eventId = ev.id;
    state.typeId = ev.ticket_types[0].id;
    save();
  }
  const eventId = state.eventId!;
  const typeId = state.typeId!;

  /* ---- a purchase through the hosted page ---- */
  async function buy(label: string, expect: "card" | "bank_transfer") {
    console.log(`\n-- purchase ${label}`);
    await login(buyer);
    const q = await api.pay.quote(eventId, typeId, 1);
    out(q.gross_naira === 3000 && q.platform_fee_naira === 135, "quote: 3000 gross, 135 Hoppaz fee (4.5 percent)", JSON.stringify(q));
    const co = await step("POST checkout route -> REAL sandbox checkout session (X-Account-Id + platform_fee)", () => api.pay.checkout(eventId, typeId, 1), (x) => `order=${x.order_id} host_page=${new URL(x.checkout_url).host}`);
    const row = await orderRow(co.order_id);
    out(row.status === "open" && String(row.bachs_checkout_id).startsWith("chk_") && row.host_account === account, "order open with the Bachs checkout id saved", `${row.bachs_checkout_id} ref=${row.bachs_reference} gross=${naira(row.gross_kobo)} fee=${naira(row.platform_fee_kobo)}`);
    const sess = await bachs.getCheckout(row.bachs_checkout_id, account);
    out(sess.platform_fee === "135.00" && sess.amount === "3000.00" && sess.reference === row.bachs_reference, "Bachs holds the same amount, fee and reference", `status=${sess.status} amount=${sess.amount} platform_fee=${sess.platform_fee}`);
    console.log(`PAY NOW ${label} (${expect === "card" ? "card" : "Bank Transfer"}) ${co.checkout_url}`);
    const until = Date.now() + 15 * 60_000;
    let last = "";
    let r = await payRoute("confirm", { order_id: co.order_id });
    while (Date.now() < until) {
      const line = `${r.body.checked}/${r.body.order?.status}`;
      if (line !== last) console.log(`   confirm route: checked=${r.body.checked} order=${r.body.order?.status}`);
      last = line;
      if (r.body.order?.status === "paid") break;
      await sleep(3000);
      r = await payRoute("confirm", { order_id: co.order_id });
    }
    out(r.body.order?.status === "paid" && r.body.checked === "paid", "confirm route: Bachs says completed and paid, order is paid", `checked=${r.body.checked} method=${r.body.order?.payment_method}`);
    const o = r.body.order;
    out(o.payment_method === expect, `paid by ${expect}`, `${o.payment_method}`);
    console.log(`   money: gross=${o.gross_naira} hoppaz_fee=${o.platform_fee_naira} processing_fee=${o.processing_fee_naira} host_net=${o.host_net_naira}`);
    return { orderId: co.order_id as string, checkoutId: String(row.bachs_checkout_id), reference: String(row.bachs_reference) };
  }

  /* ---- 2. purchase A: card, then the buyer-side checks ---- */
  console.log("\n== 2. purchase A (card): confirm, tickets once, sales, idempotency, signature");
  const A = await buy("A", "card");
  const tixA = await api.registrations.ticketsFor(eventId);
  out(tixA.length === 1, "ev_my_tickets: exactly one ticket issued", tixA.map((t: any) => `${t.code} seat ${t.seat_no ?? t.seat}`).join(" "));
  const vs = await api.events.viewerState(eventId);
  out(vs.button === "going" && vs.registration?.quantity === 1, "registration: going, quantity 1", `${vs.button} qty=${vs.registration?.quantity}`);
  await login(host);
  const s1 = await api.pay.sales(eventId);
  out(s1.totals.sold === 1 && s1.totals.gross_naira === 3000 && s1.totals.platform_fee_naira === 135 && (s1.totals.processing_fee_naira ?? 0) > 0, "sales: 1 sold, gross 3000, Hoppaz fee 135, processing fee known", JSON.stringify(s1.totals));
  const before = await snapshot(A.orderId, eventId);
  await login(buyer);
  const again = await payRoute("confirm", { order_id: A.orderId });
  out(again.status === 200 && again.body.order?.status === "paid", "SECOND confirm call: order stays paid", `checked=${again.body.checked}`);
  const sessA = await bachs.getCheckout(A.checkoutId, account);
  const done = { checkout_id: A.checkoutId, status: "completed", payment_status: "paid", mode: "payment", amount: sessA.amount, currency: "NGN", reference: A.reference, charge: { id: sessA.charge?.payment_id, status: "succeeded" }, payment_method_details: { type: "card" }, metadata: { order_id: A.orderId } };
  const w1 = await webhook("checkout.completed", done, account);
  out(w1.status === 200, "locally signed checkout.completed (fresh event id) is accepted", `${w1.status} ${JSON.stringify(w1.body)}`);
  const w2 = await webhook("checkout.completed", done, account, { id: w1.id });
  out(w2.status === 200 && w2.body.duplicate === true, "the same event id again is a recorded duplicate", `${w2.status} ${JSON.stringify(w2.body)}`);
  eqOut("duplicate webhook and second confirm changed nothing (order, tickets, registration)", await snapshot(A.orderId, eventId), before);
  const bad = await webhook("checkout.completed", done, account, { secret: "whsec_not_the_real_one" });
  out(bad.status === 400, "a webhook with a wrong signature gets 400", `${bad.status} ${JSON.stringify(bad.body)}`);

  /* ---- 3. refund of A before the host holds enough ---- */
  console.log("\n== 3. refund A: the host's balance (first sale)");
  await login(host);
  const bal1 = await hostBalance(account);
  console.log(`   host Bachs balance now N${naira(bal1)} (gross 3000)`);
  let rf = await payRoute("refund", { order_id: A.orderId });
  if (bal1 < 300000) {
    out(rf.status === 409 && rf.body.reason === "insufficient_host_balance", "refund route says insufficient_host_balance (balance lower than the gross)", `${rf.status} ${rf.body.reason}`);
    const o = await orderRow(A.orderId);
    out(o.status === "paid", "order A is untouched (still paid, tickets alone)", o.status);
    results.push("first refund of A: insufficient_host_balance, as the findings said");
  } else {
    out(rf.status === 200, "balance already covers the gross: refund started at once", `${rf.status} ${JSON.stringify(rf.body)}`);
  }

  /* ---- 4. purchase B (card), door scan of B, then refund A again ---- */
  console.log("\n== 4. purchase B (card), door scan, refund A with enough balance");
  let B = await buy("B", "card");
  let extra = 0;
  await login(host);
  while (rf.status !== 200 && (await hostBalance(account)) < 300000 && extra < 2) {
    extra++;
    console.log(`   balance still short, extra purchase ${extra}`);
    await buy(`B${extra + 1}`, "card");
    await login(host);
  }
  console.log(`   host Bachs balance now N${naira(await hostBalance(account))}`);
  await login(buyer);
  const tixAB = await api.registrations.ticketsFor(eventId);
  const bTicket = tixAB.find((t: any) => !tixA.some((a: any) => a.id === t.id)) ?? tixAB[tixAB.length - 1];
  out(tixAB.length >= 2, "buyer holds the tickets of both purchases", `${tixAB.length} tickets`);
  const vs2 = await api.events.viewerState(eventId);
  out(vs2.registration?.quantity === tixAB.length, "one registration, quantity grows with each paid order", `qty=${vs2.registration?.quantity}`);
  await login(host);
  const scan = await api.door.scan(eventId, bTicket.token, "express");
  out(scan.ok === true && scan.kind === "checked_in", "door scan as host: ticket of purchase B checks in", JSON.stringify(scan));
  const scan2 = await api.door.scan(eventId, bTicket.token, "express");
  out(scan2.kind !== "checked_in", "scanning it again does not check in twice", JSON.stringify(scan2));

  if (rf.status !== 200) {
    rf = await payRoute("refund", { order_id: A.orderId });
    out(rf.status === 200 && rf.body.method === "card" && rf.body.status === "refund_pending", "refund route: card refund started at Bachs, refund_pending", `${rf.status} ${JSON.stringify(rf.body)}`);
  }
  let oA = await orderRow(A.orderId);
  out(oA.status === "refund_pending", "order A is refund_pending", oA.status);
  const rfs = await refundRows(A.orderId);
  const live = rfs.find((r) => r.method === "card");
  out(!!live?.bachs_refund_id && String(live.bachs_refund_id).length > 3, "the refund row holds Bachs's refund id", `${live?.bachs_refund_id} status=${live?.status} reference=${live?.reference}`);
  await login(buyer);
  const tixAfter = await api.registrations.ticketsFor(eventId);
  out(!tixAfter.some((t: any) => tixA.some((a: any) => a.id === t.id)), "ticket A is void for the buyer; the others stay", `${tixAfter.length} left`);
  try {
    const gr: any = await bachsRequest("GET", `/v1/refunds/${live.bachs_refund_id}`, { accountId: account });
    console.log(`   GET /v1/refunds/${live.bachs_refund_id}: status=${gr.status}`);
    results.push(`GET refund status at Bachs right after: ${gr.status}`);
  } catch (e) {
    console.log(`   GET refund failed: ${(e as Error).message}`);
  }
  const wr = await webhook("refund.paid", { refund_id: live.bachs_refund_id, reference: live.reference, status: "paid", charge_id: oA.bachs_charge_id }, account);
  out(wr.status === 200, "locally signed refund.paid accepted", `${wr.status} ${JSON.stringify(wr.body)}`);
  oA = await orderRow(A.orderId);
  out(oA.status === "refunded", "order A is now refunded", oA.status);
  await login(host);
  const s2 = await api.pay.sales(eventId);
  out(s2.totals.refunded_naira === 3000, "sales show 3000 refunded", JSON.stringify(s2.totals));

  /* ---- 5. bank transfer purchase ---- */
  console.log("\n== 5. purchase C (bank transfer): completes by itself, refund goes manual");
  const C = await buy("C", "bank_transfer");
  await login(buyer);
  const tixC = await api.registrations.ticketsFor(eventId);
  out(tixC.length === tixAfter.length + 1, "bank transfer ticket issued", `${tixC.length} tickets`);
  await login(host);
  const rc = await payRoute("refund", { order_id: C.orderId });
  out(rc.status === 200 && rc.body.method === "manual" && rc.body.status === "manual_needed", "refund route on a bank transfer: manual_needed (no Bachs call)", `${rc.status} ${JSON.stringify(rc.body)}`);
  const oC = await orderRow(C.orderId);
  out(oC.needs_manual_refund === true, "order C is marked for a manual refund", `status=${oC.status} needs_manual_refund=${oC.needs_manual_refund}`);
  await api.pay.markManualRefundDone(C.orderId);
  const oC2 = await orderRow(C.orderId);
  out(oC2.status === "refunded", "host marks the manual refund done: order C refunded", oC2.status);
  const sFinal = await api.pay.sales(eventId);
  console.log(`   final sales totals: ${JSON.stringify(sFinal.totals)}`);
  console.log(`   final host Bachs balance N${naira(await hostBalance(account))}`);
} catch (e) {
  out(false, "run aborted", e instanceof Error ? e.message : String(e));
} finally {
  const off = await admin.rpc("ev_set_setting", { p_key: "paid_tickets", p_value: "off" });
  console.log(`paid_tickets switched off again: ${off.error ? off.error.message : JSON.stringify(off.data)}`);
}
for (const r of results) console.log(`NOTE ${r}`);
console.log(`\n${fail ? "FAILED" : "ALL GOOD"}: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);

function eqOut(what: string, a: string, b: string) {
  out(a === b, what, a === b ? a : `${a} != ${b}`);
}
