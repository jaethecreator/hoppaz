/**
 * An in-memory stand-in for the SQL layer (PayDb), shared by scripts/bachs-check.mts and the mock flow in bachs-sandbox-run.mts.
 * It copies the rules that matter from supabase/events_r1_pay.sql: ev_pay_order_paid is idempotent, a paid order is never expired,
 * a late payment on an expired order owes a refund, an amount below the gross is flagged, never issued.
 */
const ACCT = "acct_4FWLLecDyJ9aXn8a";
export type Order = { id: string; status: string; host_account: string; gross_kobo: number; checkout: string; reference: string; method: "card" | "bank_transfer" | null; charge: string | null; issued: number; needs_refund: boolean; needs_manual: boolean };
export function makeDb(seed?: Partial<Order>) {
  const log: string[] = [];
  const events = new Map<string, { processed: boolean }>();
  const order: Order = { id: "ord-1", status: "open", host_account: ACCT, gross_kobo: 500000, checkout: "chk_1", reference: "ord_1", method: null, charge: null, issued: 0, needs_refund: false, needs_manual: false, ...seed };
  const row = () => ({ id: order.id, buyer_id: "u1", event_id: "e1", status: order.status, gross_kobo: order.gross_kobo, platform_fee_kobo: 22500, host_account: order.host_account, bachs_checkout_id: order.checkout, bachs_reference: order.reference, bachs_charge_id: order.charge, payment_method: order.method, needs_refund: order.needs_refund, needs_manual_refund: order.needs_manual });
  const refunds: { reference: string; status: string }[] = [];
  // Host withdrawals (events_r1_payouts.sql): just enough state for runDuePayouts.
  const withdrawals: { id: string; reference: string; user_id: string; status: string; amount_kobo: number; account: string; transfer_id: string | null; payout_tries: number; attempts: number; payout_id?: string; payout_amount?: number; fee?: number | null; note?: string }[] = [];
  const db = {
    withdrawals,
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
    refundAttempt: async (ref: string, note: string) => { log.push(`refund_attempt ${ref} ${note}`); return { ok: true }; },
    refundsUnsettled: async () => [] as { orderId: string; reference: string; bachsRefundId: string | null; chargeId: string | null; hostAccount: string; attempts: number }[],
    disputeFlag: async (c: string, d: string, s: string) => { log.push(`dispute ${c} ${d} ${s}`); return { ok: true }; },
    hostSetBankLabel: async () => "ok",
    payoutsDue: async () => withdrawals.filter((w) => w.status === "requested" || w.status === "transferred").map((w) => ({ ...w })),
    payoutTransferred: async (id: string, t: string) => { const w = withdrawals.find((x) => x.id === id); if (!w || w.status !== "requested") return "not_requested"; w.status = "transferred"; w.transfer_id = t; log.push(`transferred ${id} ${t}`); return "ok"; },
    payoutPaying: async (id: string, p: string, amount: number, fee: number | null) => { const w = withdrawals.find((x) => x.id === id); if (!w || w.status !== "transferred") return "not_transferred"; w.status = "paying"; w.payout_id = p; w.payout_amount = amount; w.fee = fee; w.payout_tries++; log.push(`paying ${id} ${p} ${amount} ${fee}`); return "ok"; },
    payoutNote: async (id: string, e: string) => { const w = withdrawals.find((x) => x.id === id); if (w) w.note = e; log.push(`note ${id} ${e}`); return "ok"; },
    payoutResult: async (p: string, st: string) => { const w = withdrawals.find((x) => x.payout_id === p); if (!w) return { ok: false, reason: "not_found" }; if (w.status === "paid") return { ok: true, changed: false }; w.status = st === "paid" ? "paid" : "transferred"; log.push(`payout ${p} ${st}`); return { ok: true, changed: true }; },
  };
  return db;
}
