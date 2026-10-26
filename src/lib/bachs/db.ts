import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The SQL side of payments (supabase/events_r1_pay.sql) behind one interface, so the webhook router and the refund code can be
 * checked with a stub and the routes use the real thing. Every method throws on a database error (a webhook then answers 5xx and
 * Bachs tries again); a "no" from a function comes back as data (`ok: false, reason`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/** The columns of ev_orders the server needs to decide things (read with the service key). */
export type OrderRow = {
  id: string;
  buyer_id: string;
  event_id: string;
  status: string;
  gross_kobo: number;
  platform_fee_kobo: number;
  host_account: string;
  bachs_checkout_id: string | null;
  bachs_reference: string;
  bachs_charge_id: string | null;
  payment_method: "card" | "bank_transfer" | null;
  needs_refund: boolean;
  needs_manual_refund: boolean;
};

/** A card refund that has been started but not settled: Bachs has not said paid or failed (the call timed out, or the webhook has not come). */
export type PendingRefund = { orderId: string; reference: string; bachsRefundId: string | null; chargeId: string | null; hostAccount: string; attempts: number };

export type PaidInput = { ref: string; charge: string | null; amount: string; method: string | null; feeKobo: number | null };

export interface PayDb {
  /** True when the event is new. */
  recordEvent(e: { id: string; type: string; account: string | null; createdAt: string | null; raw: unknown }): Promise<boolean>;
  isProcessed(evtId: string): Promise<boolean>;
  markProcessed(evtId: string): Promise<void>;
  hostAccountOf(userId: string): Promise<string | null>;
  hostSaveAccount(userId: string, account: string): Promise<string>;
  hostApplyCapability(account: string, capability: string, status: string, at: string | null): Promise<string>;
  hostApplyRequirements(account: string, outstanding: string[]): Promise<string>;
  /** price_naira of a ticket type (a derived General type has no row: its id is md5 of the event id and it is FREE: an old listing's door price is not a ticket price). Null if not found. */
  ticketPrice(eventId: string, typeId: string): Promise<number | null>;
  orderReserve(i: { userId: string; eventId: string; typeId: string; qty: number; feeKobo: number; answers: Json; referrer: string | null }): Promise<Json>;
  orderAttach(orderId: string, checkoutId: string, checkoutUrl: string, expiresAt: string | null): Promise<string>;
  orderRelease(orderId: string, reason: string): Promise<string>;
  orderRow(orderId: string): Promise<OrderRow | null>;
  /** By Bachs checkout id first, then by our reference. */
  orderByRef(checkoutId: string | null, reference: string | null): Promise<OrderRow | null>;
  orderPaid(i: PaidInput): Promise<Json>;
  orderDetails(i: { charge: string | null; checkout: string; feeKobo: number | null; method: string | null }): Promise<Json>;
  orderExpire(checkoutId: string): Promise<Json>;
  sweep(): Promise<{ order_id: string; checkout_id: string | null }[]>;
  /** Paid orders that are owed a card refund and have none under way (the sweeper retries these). */
  refundsOwedByCard(limit: number): Promise<OrderRow[]>;
  /** The event's host or a Hoppaz admin (the database re-checks this itself in refundStart; asked first so a stranger cannot make us call Bachs). */
  canRefund(orderId: string, userId: string): Promise<boolean>;
  refundStart(orderId: string, actor: string | null): Promise<Json>;
  refundApply(refundId: string | null, reference: string, status: "processing" | "paid" | "failed"): Promise<Json>;
  /** Record a try whose outcome is unknown (timeout, 5xx): nothing is undone. After 10 the database flags the order for a person. */
  refundAttempt(reference: string, note: string): Promise<Json>;
  /** Card refunds under way (refund_pending) that nobody has heard back about for `olderThanSeconds`: the sweeper settles these. */
  refundsUnsettled(limit: number, olderThanSeconds: number): Promise<PendingRefund[]>;
  disputeFlag(charge: string, dispute: string, status: string, amount: string | null): Promise<Json>;
  /** What the host's money screen shows of their bank ("GTBank Plc ending 6789"). */
  hostSetBankLabel(userId: string, label: string): Promise<string>;
  /** Withdrawals the sweeper should move now (each claimed for 10 minutes). */
  payoutsDue(limit: number): Promise<DueWithdrawal[]>;
  payoutTransferred(id: string, transferId: string): Promise<string>;
  payoutPaying(id: string, payoutId: string, amountKobo: number, feeKobo: number | null): Promise<string>;
  payoutNote(id: string, error: string): Promise<string>;
  payoutResult(payoutId: string, status: "paid" | "failed", reason: string | null): Promise<Json>;
}

/** A withdrawal due for the sweeper (ev_payout_due). requested: send the transfer; transferred: send the payout. */
export type DueWithdrawal = {
  id: string;
  reference: string;
  user_id: string;
  status: "requested" | "transferred";
  amount_kobo: number;
  account: string;
  transfer_id: string | null;
  payout_tries: number;
  attempts: number;
};

const ORDER_COLS = "id,buyer_id,event_id,status,gross_kobo,platform_fee_kobo,host_account,bachs_checkout_id,bachs_reference,bachs_charge_id,payment_method,needs_refund,needs_manual_refund";

/** md5 of text as a uuid, the way Postgres does md5(x)::uuid. */
const md5Uuid = (text: string) => {
  const h = createHash("md5").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase client and its rows are untyped here, like queerServer.ts */
export function supabasePayDb(admin: SupabaseClient<any, "public", "public", any, any>): PayDb {
  const rpc = async (fn: string, args: Json): Promise<any> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  const one = async (q: PromiseLike<{ data: any; error: { message: string } | null }>, what: string): Promise<any> => {
    const { data, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  return {
    recordEvent: async (e) => (await rpc("ev_pay_event_record", { p_evt: e.id, p_type: e.type, p_account: e.account, p_created: e.createdAt, p_raw: e.raw })) === true,
    isProcessed: async (id) => {
      const row = await one(admin.from("ev_bachs_events").select("processed_at").eq("evt_id", id).maybeSingle(), "read event");
      return !!row?.processed_at;
    },
    markProcessed: async (id) => void (await rpc("ev_pay_event_processed", { p_evt: id })),
    hostAccountOf: async (userId) => (await one(admin.from("ev_host_payouts").select("bachs_account_id").eq("user_id", userId).maybeSingle(), "read host"))?.bachs_account_id ?? null,
    hostSaveAccount: (userId, account) => rpc("ev_pay_host_save_account", { p_user: userId, p_account: account }),
    hostApplyCapability: (account, capability, status, at) => rpc("ev_pay_host_apply_capability", { p_account: account, p_capability: capability, p_status: status, p_at: at }),
    hostApplyRequirements: (account, outstanding) => rpc("ev_pay_host_apply_requirements", { p_account: account, p_outstanding: outstanding }),
    ticketPrice: async (eventId, typeId) => {
      const row = await one(admin.from("ev_ticket_types").select("price_naira").eq("id", typeId).eq("event_id", eventId).maybeSingle(), "read ticket type");
      if (row) return row.price_naira as number;
      if (typeId !== md5Uuid(`ticket-type:${eventId}`)) return null;
      const ev = await one(admin.from("events").select("id").eq("id", eventId).maybeSingle(), "read event");
      return ev ? 0 : null;
    },
    orderReserve: (i) => rpc("ev_pay_order_reserve", { p_user: i.userId, p_event: i.eventId, p_type: i.typeId, p_qty: i.qty, p_fee_kobo: i.feeKobo, p_answers: i.answers, p_referrer: i.referrer }),
    orderAttach: (orderId, checkoutId, checkoutUrl, expiresAt) => rpc("ev_pay_order_attach", { p_order: orderId, p_checkout_id: checkoutId, p_checkout_url: checkoutUrl, p_expires: expiresAt }),
    orderRelease: (orderId, reason) => rpc("ev_pay_order_release", { p_order: orderId, p_reason: reason }),
    orderRow: async (orderId) => (await one(admin.from("ev_orders").select(ORDER_COLS).eq("id", orderId).maybeSingle(), "read order")) as OrderRow | null,
    orderByRef: async (checkoutId, reference) => {
      if (checkoutId) {
        const row = await one(admin.from("ev_orders").select(ORDER_COLS).eq("bachs_checkout_id", checkoutId).maybeSingle(), "read order");
        if (row) return row as OrderRow;
      }
      if (reference) return (await one(admin.from("ev_orders").select(ORDER_COLS).eq("bachs_reference", reference).maybeSingle(), "read order")) as OrderRow | null;
      return null;
    },
    orderPaid: (i) => rpc("ev_pay_order_paid", { p_ref: i.ref, p_charge: i.charge, p_amount: i.amount, p_method: i.method, p_fee_kobo: i.feeKobo }),
    orderDetails: (i) => rpc("ev_pay_order_details", { p_charge: i.charge, p_checkout: i.checkout, p_fee_kobo: i.feeKobo, p_method: i.method }),
    orderExpire: (checkoutId) => rpc("ev_pay_order_expire", { p_checkout: checkoutId }),
    sweep: async () => ((await rpc("ev_pay_sweep", {}))?.expired ?? []) as { order_id: string; checkout_id: string | null }[],
    refundsOwedByCard: async (limit) =>
      ((await one(admin.from("ev_orders").select(ORDER_COLS).eq("status", "paid").eq("needs_refund", true).eq("needs_manual_refund", false).eq("payment_method", "card").limit(limit), "read owed refunds")) ?? []) as OrderRow[],
    canRefund: async (orderId, userId) => {
      const o = await one(admin.from("ev_orders").select("event_id").eq("id", orderId).maybeSingle(), "read order");
      if (!o) return false;
      const ev = await one(admin.from("events").select("host_id,created_by").eq("id", o.event_id).maybeSingle(), "read event");
      if (ev && (ev.host_id ?? ev.created_by) === userId) return true;
      const p = await one(admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle(), "read profile");
      return p?.is_admin === true;
    },
    refundStart: (orderId, actor) => rpc("ev_pay_refund_start", { p_order: orderId, p_actor: actor }),
    refundApply: (refundId, reference, status) => rpc("ev_pay_refund_apply", { p_refund_id: refundId, p_reference: reference, p_status: status }),
    refundAttempt: (reference, note) => rpc("ev_pay_refund_attempt", { p_reference: reference, p_error: note }),
    refundsUnsettled: async (limit, olderThanSeconds) => {
      const before = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
      const rows = await one(
        admin
          .from("ev_refunds")
          .select("reference,bachs_refund_id,attempts,order_id,ev_orders!inner(id,status,host_account,bachs_charge_id)")
          .eq("method", "card")
          .in("status", ["requested", "processing"])
          .eq("ev_orders.status", "refund_pending")
          .lt("updated_at", before)
          .order("updated_at", { ascending: true })
          .limit(limit),
        "read unsettled refunds"
      );
      return ((rows ?? []) as any[]).map((r) => ({
        orderId: r.order_id as string,
        reference: r.reference as string,
        bachsRefundId: (r.bachs_refund_id as string | null) ?? null,
        chargeId: (r.ev_orders?.bachs_charge_id as string | null) ?? null,
        hostAccount: r.ev_orders?.host_account as string,
        attempts: (r.attempts as number) ?? 0,
      }));
    },
    disputeFlag: (charge, dispute, status, amount) => rpc("ev_pay_dispute_flag", { p_charge: charge, p_dispute: dispute, p_status: status, p_amount: amount }),
    hostSetBankLabel: (userId, label) => rpc("ev_payout_set_bank_label", { p_user: userId, p_label: label }),
    payoutsDue: async (limit) => ((await rpc("ev_payout_due", { p_limit: limit })) ?? []) as DueWithdrawal[],
    payoutTransferred: (id, transferId) => rpc("ev_payout_transferred", { p_id: id, p_transfer: transferId }),
    payoutPaying: (id, payoutId, amountKobo, feeKobo) => rpc("ev_payout_paying", { p_id: id, p_payout: payoutId, p_amount_kobo: amountKobo, p_fee_kobo: feeKobo }),
    payoutNote: (id, error) => rpc("ev_payout_note", { p_id: id, p_error: error }),
    payoutResult: (payoutId, status, reason) => rpc("ev_payout_result", { p_payout: payoutId, p_status: status, p_reason: reason }),
  };
}
