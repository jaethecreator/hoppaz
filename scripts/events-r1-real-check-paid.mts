/**
 * Part B of scripts/events-r1-real-check.mts (RUN_PAID=1): paid tickets through the REAL layer, the real route handlers (called in
 * this process) and the mock Bachs server (scripts/bachs-mock.mjs on 3415). Not run on its own.
 *
 * Start the mock first (it sends its signed webhooks to the receiver this file opens on 3417, which hands them to the webhook route):
 *   MOCK_WEBHOOK_SECRET=whsec_mock MOCK_WEBHOOK_URL=http://127.0.0.1:3417/api/bachs/webhook node scripts/bachs-mock.mjs
 * then: RUN_PAID=1 node --no-warnings scripts/events-r1-real-check.mts
 */
import { createServer } from "node:http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

// 3415 unless MOCK_PORT says otherwise (another project may hold 3415: then start the mock with PORT=<free port> and run this with the same MOCK_PORT).
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT || 3415}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(c: Ctx) {
  const { api, admin, step, refuses, eq, out, login, makeUser, host, buyer, iso } = c;
  const HOUR = 3.6e6;
  const mock = async (path: string, body: unknown) => (await fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

  // The webhook receiver: whatever the mock sends goes to the route file.
  const hook = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const mod = (await import("../src/app/api/bachs/webhook/route.ts")) as { POST: (r: Request) => Promise<Response> };
    const r = await mod.POST(new Request("http://app.test/api/bachs/webhook", { method: "POST", headers: req.headers as Record<string, string>, body: raw }));
    res.writeHead(r.status);
    res.end(await r.text());
  }).listen(3417, "127.0.0.1");

  try {
    console.log("\n== E. Paid tickets: real layer + real routes + mock Bachs");
    await step("paid switch on (local database setting)", async () => (await admin.rpc("ev_set_setting", { p_key: "paid_tickets", p_value: "on" })).data, (v: unknown) => String(v));
    const cal = await makeUser("pcal", "Cal Payer");

    await login(host);
    const p0 = await step("pay.hostPayout before onboarding", () => api.pay.hostPayout(), (p: { status: string; can_sell: boolean }) => `status=${p.status} can_sell=${p.can_sell}`);
    await refuses("a paid type before payouts are ready", () => api.events.create({ title: "Paid early", tickets: [{ name: "VIP", price_naira: 5000, capacity: null }] }), "Set up payouts before you sell paid tickets");
    const ob = await step("pay.startOnboarding (route -> mock Bachs)", () => api.pay.startOnboarding("/host/onboarded"), (o: { url: string }) => o.url.replace(/\?.*/, ""));
    out(!!ob?.url, "onboarding link points at the mock", ob?.url.slice(0, 40));
    const acct = (await admin.from("ev_host_payouts").select("bachs_account_id").eq("user_id", host.id).maybeSingle()).data as { bachs_account_id?: string } | null;
    const account = acct?.bachs_account_id;
    out(!!account && account.startsWith("acct_"), "the host's Bachs account is saved", account ? `${account.slice(0, 9)}...` : "none");
    for (const capability of ["bank_transfer", "ngn_card_collection", "payouts"]) await mock("/_mock/capability", { account, capability, status: "active" });
    await sleep(300);
    const p1 = await step("pay.hostPayout after the capability webhooks", () => api.pay.hostPayout(), (p: { status: string; can_sell: boolean }) => `status=${p.status} can_sell=${p.can_sell}`);
    out(p1?.can_sell === true && p0?.can_sell === false, "payouts went from not ready to ready");

    const start = Date.now() + 48 * HOUR;
    const ev = await step(
      "events.create with a paid type",
      () => api.events.create({ title: `Paid Night ${Date.now().toString(36)}`, starts_at: iso(start), ends_at: iso(start + 4 * HOUR), place_name: "VI, Lagos", area: "Victoria Island", tickets: [{ name: "Regular", price_naira: 5000, capacity: 10 }] }),
      (e: { ticket_types: { name: string; price_naira: number }[] }) => e.ticket_types.map((t) => `${t.name} N${t.price_naira}`).join(", ")
    );
    const type = ev.ticket_types[0];

    // Bea buys 2
    await login(buyer);
    await refuses("registrations.register on a paid type", () => api.registrations.register(ev.id, { ticketTypeId: type.id }), "Buy this ticket with checkout");
    const q = await step("pay.quote x2", () => api.pay.quote(ev.id, type.id, 2), (x: unknown) => JSON.stringify(x));
    const co = await step("pay.checkout x2 (reserves seats, asks the mock)", () => api.pay.checkout(ev.id, type.id, 2), (x: { order_id: string; checkout_url: string }) => `order=${x.order_id.slice(0, 8)} ${x.checkout_url}`);
    const open = await api.pay.order(co.order_id);
    out(open.status === "open", "order is open before payment (confirm asked Bachs: not paid)", `${open.status} gross=${open.gross_naira}`);
    eq("no ticket before payment", await api.registrations.ticketsFor(ev.id), []);
    const slug = co.checkout_url.split("/c/")[1];
    await fetch(`${MOCK}/c/${slug}/do`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=card", redirect: "manual" });
    let paid = await api.pay.order(co.order_id);
    for (let i = 0; i < 20 && paid.status !== "paid"; i++) {
      await sleep(250);
      paid = await api.pay.order(co.order_id);
    }
    out(paid.status === "paid", "order is paid after the mock's signed webhook", `status=${paid.status} method=${paid.payment_method} gross=${paid.gross_naira} platform_fee=${paid.platform_fee_naira} processing_fee=${paid.processing_fee_naira} host_net=${paid.host_net_naira}`);
    const tix = await api.registrations.ticketsFor(ev.id);
    out(tix.length === 2 && tix[0].seats === 2, "two tickets, seats 1 and 2 of 2", tix.map((t: { seat_no?: number; seats?: number; code: string }) => `${t.seat_no}/${t.seats} ${t.code}`).join(" "));
    eq("myOrders has it", (await api.pay.myOrders()).map((o: { id: string }) => o.id), [co.order_id]);
    const reg = await api.events.viewerState(ev.id);
    out(reg.button === "going" && reg.registration?.quantity === 2, "viewerState: going with quantity 2", `${reg.button} qty=${reg.registration?.quantity}`);

    await login(host);
    const door = await step("door.scan seat 1 (express)", () => api.door.scan(ev.id, tix[0].token, "express"), (r: unknown) => JSON.stringify(r));
    out(door.ok === true && door.kind === "checked_in", "the paid ticket checks in");
    const orders = await step("pay.eventOrders (host)", () => api.pay.eventOrders(ev.id), (l: { status: string; quantity: number }[]) => l.map((o) => `${o.status} x${o.quantity}`).join(", "));
    void orders;
    const sales = await step("pay.sales (host)", () => api.pay.sales(ev.id), (s: { totals: Record<string, number>; rows: unknown[] }) => JSON.stringify(s.totals));
    out(sales?.totals.sold === 2 && sales.totals.gross_naira === 10000, "sales: 2 sold, N10000 gross");
    // NOTE: the route asks Bachs for the host's balance before the database's used-ticket rule, so with a low balance that message wins.
await refuses("refund an order with a used ticket", () => api.pay.refund(co.order_id), /already used at the door|balance is lower/);

    // Cal buys 1, then the host refunds it (card)
    await login(cal);
    const co2 = await api.pay.checkout(ev.id, type.id, 1);
    await fetch(`${MOCK}/c/${co2.checkout_url.split("/c/")[1]}/do`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=card", redirect: "manual" });
    let o2 = await api.pay.order(co2.order_id);
    for (let i = 0; i < 20 && o2.status !== "paid"; i++) {
      await sleep(250);
      o2 = await api.pay.order(co2.order_id);
    }
    out(o2.status === "paid", "Cal's order is paid", o2.status);
    await login(host);
    const rf = await step("pay.refund (card, through the route)", () => api.pay.refund(co2.order_id), (r: unknown) => JSON.stringify(r));
    out(rf?.method === "card" && rf.status === "refund_pending", "refund is pending");
    const state = (await (await fetch(`${MOCK}/_mock/state`)).json()) as { refunds: { refund_id: string }[] };
    await mock("/_mock/refund-paid", { refund_id: state.refunds[state.refunds.length - 1].refund_id });
    await sleep(400);
    const after = (await api.pay.eventOrders(ev.id)).find((o: { id: string }) => o.id === co2.order_id);
    out(after?.status === "refunded", "after refund.paid the order is refunded", after?.status);
    await login(cal);
    eq("Cal's ticket is void", await api.registrations.ticketsFor(ev.id), []);
    await login(host);
    const s2 = await api.pay.sales(ev.id);
    out(s2.totals.refunded_naira === 5000, "sales show N5000 refunded", JSON.stringify(s2.totals));
  } finally {
    await admin.rpc("ev_set_setting", { p_key: "paid_tickets", p_value: "off" });
    hook.close();
  }
}
