/**
 * Real paid tickets (Bachs). Money moves only through the Next.js route handlers (src/app/api/events-r1/pay/*), called with
 * the signed-in session's access token. Reads go straight to the database (ev_pay_* functions, supabase/events_r1_pay.sql).
 */
import type { Checkout, HostPayout, Order, PayApi, PayoutSummary, Quote, RefundResult, Sales, Withdrawal } from "../pay";
import { accessToken, emit, rpc, UUID } from "./core";
import { iso } from "./map";

type Row = Record<string, unknown>;

/** In a page the routes are on the same origin. A Node script sets EVENTS_R1_API_BASE (for example http://127.0.0.1:3420). */
const base = () => process.env.EVENTS_R1_API_BASE ?? "";

/** POST to a route. The route answers { error, reason? } when it says no; the error text is already plain words. */
async function post<T>(path: string, body: Record<string, unknown>, signedIn = true): Promise<T> {
  const token = await accessToken();
  if (signedIn && !token) throw new Error("Sign in first");
  let res: Response;
  try {
    res = await fetch(`${base()}/api/events-r1/pay/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("No connection. Try again");
  }
  const out = (await res.json().catch(() => ({}))) as Row;
  if (!res.ok) throw new Error(typeof out.error === "string" && out.error ? out.error : "That did not work. Try again");
  return out as T;
}

const n = (v: unknown, d = 0) => (v === null || v === undefined || v === "" ? d : Number(v) || d);
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapOrder(j: Row): Order {
  return {
    id: String(j.id),
    event_id: String(j.event_id),
    event_title: String(j.event_title ?? ""),
    buyer_id: String(j.buyer_id),
    buyer_name: String(j.buyer_name ?? ""),
    ticket_type_id: String(j.ticket_type_id),
    ticket_name: String(j.ticket_name ?? ""),
    quantity: n(j.quantity, 1),
    unit_price_naira: n(j.unit_price_naira),
    gross_naira: n(j.gross_naira),
    platform_fee_naira: n(j.platform_fee_naira),
    processing_fee_naira: nOrNull(j.processing_fee_naira),
    host_net_naira: nOrNull(j.host_net_naira),
    status: j.status as Order["status"],
    payment_method: (j.payment_method as Order["payment_method"]) ?? null,
    created_at: iso(j.created_at) ?? "",
    expires_at: iso(j.expires_at) ?? "",
    paid_at: iso(j.paid_at),
    checkout_url: (j.checkout_url as string | null) ?? null,
    needs_refund: !!j.needs_refund,
    needs_manual_refund: !!j.needs_manual_refund,
    refund_reason: j.refund_reason === "late" || j.refund_reason === "failed" ? j.refund_reason : null,
  };
}

function mapWithdrawal(j: Row): Withdrawal {
  return {
    id: String(j.id),
    amount_naira: n(j.amount_naira),
    status: j.status as Withdrawal["status"],
    execute_after: iso(j.execute_after) ?? "",
    received_naira: nOrNull(j.received_naira),
    fee_naira: nOrNull(j.fee_naira),
    created_at: iso(j.created_at) ?? "",
    paid_at: iso(j.paid_at),
  };
}

/** GET a route with the session (the bank list). */
async function getRoute<T>(path: string): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in first");
  let res: Response;
  try {
    res = await fetch(`${base()}/api/events-r1/pay/${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new Error("No connection. Try again");
  }
  const out = (await res.json().catch(() => ({}))) as Row;
  if (!res.ok) throw new Error(typeof out.error === "string" && out.error ? out.error : "That did not work. Try again");
  return out as T;
}

const WITHDRAW_NO: Record<string, string> = {
  no_session: "Sign in first",
  needs_bank: "Add your bank details first",
  already_requested: "A withdrawal is already on its way",
};

const orderId = (id: string) => {
  if (!UUID.test(id)) throw new Error("Order not found");
  return id;
};

export const pay: PayApi = {
  async hostPayout() {
    const j = await rpc<Row | null>("ev_pay_host_status");
    if (!j) throw new Error("Sign in first");
    return {
      status: j.status as HostPayout["status"],
      capabilities: (j.capabilities as Record<string, string>) ?? {},
      requirements_due: Array.isArray(j.requirements_due) ? (j.requirements_due as string[]) : [],
      can_sell: !!j.can_sell,
      dashboard_url: String(j.dashboard_url ?? "https://dashboard.bachs.io"),
    };
  },

  async payoutSummary() {
    const j = await rpc<Row | null>("ev_payout_summary");
    if (!j) throw new Error("Sign in first");
    const a = (j.account as Row) ?? {};
    const rules = (j.rules as Row) ?? {};
    return {
      account: {
        has_account: !!a.has_account,
        ready: !!a.ready,
        bank_label: (a.bank_label as string | null) ?? null,
        requirements_due: Array.isArray(a.requirements_due) ? (a.requirements_due as string[]) : [],
      },
      earned_naira: n(j.earned_naira),
      reserved_naira: n(j.reserved_naira),
      reserve_until: iso(j.reserve_until),
      withdrawn_naira: n(j.withdrawn_naira),
      available_naira: n(j.available_naira),
      balance_naira: n(j.balance_naira),
      open_withdrawal: j.open_withdrawal ? mapWithdrawal(j.open_withdrawal as Row) : null,
      recent: Array.isArray(j.recent) ? (j.recent as Row[]).map(mapWithdrawal) : [],
      rules: { reserve_percent: n(rules.reserve_percent, 5), reserve_days: n(rules.reserve_days, 30), delay_hours: n(rules.delay_hours, 24), min_naira: n(rules.min_naira, 1000) },
    } satisfies PayoutSummary;
  },

  async banks() {
    return (await getRoute<{ banks: { name: string; code: string }[] }>("banks")).banks ?? [];
  },

  async checkAccount(bankCode, accountNumber) {
    return post<{ account_name: string }>("banks", { bankCode, accountNumber });
  },

  async setupPayout(d) {
    const out = await post<{ ready: boolean; bank_label: string; account_name: string }>("payout-setup", { ...d });
    emit();
    return out;
  },

  async requestWithdrawal() {
    const j = await rpc<Row | null>("ev_payout_request");
    if (!j?.ok) {
      const reason = String(j?.reason ?? "");
      if (reason === "too_small") throw new Error(`You need at least ₦1,000 to withdraw (you have ₦${Math.floor(n(j?.available_naira)).toLocaleString("en-NG")})`);
      throw new Error(WITHDRAW_NO[reason] ?? "That did not work. Try again");
    }
    emit();
    return mapWithdrawal(j.withdrawal as Row);
  },

  async quote(eventId, ticketTypeId, quantity) {
    return post<Quote>("quote", { eventId, ticketTypeId, quantity }, false);
  },

  async checkout(eventId, ticketTypeId, quantity, opts) {
    const out = await post<Checkout>("checkout", { eventId, ticketTypeId, quantity, answers: opts?.answers, referrerId: opts?.referrerId ?? undefined });
    emit();
    return { order_id: out.order_id, checkout_url: out.checkout_url, expires_at: out.expires_at };
  },

  /** The server asks Bachs first (the buyer's return), then the order is read back. */
  async order(id) {
    const out = await post<{ order: Row | null }>("confirm", { order_id: orderId(id) });
    if (!out.order) throw new Error("Order not found");
    emit();
    return mapOrder(out.order);
  },

  async myOrders() {
    const rows = await rpc<Row[] | null>("ev_pay_my_orders");
    return (rows ?? []).map(mapOrder);
  },

  async eventOrders(eventId) {
    const rows = await rpc<Row[] | null>("ev_pay_event_orders", { p_event: eventId });
    return (rows ?? []).map(mapOrder);
  },

  async sales(eventId) {
    const j = await rpc<Row | null>("ev_pay_sales", { p_event: eventId });
    if (!j) throw new Error("Not allowed");
    return j as unknown as Sales;
  },

  async refund(id) {
    const out = await post<RefundResult>("refund", { order_id: orderId(id) });
    emit();
    return out;
  },

  async markManualRefundDone(id) {
    const code = await rpc<string | null>("ev_pay_mark_manual_refund", { p_order: orderId(id) });
    if (code !== "ok") {
      throw new Error(
        ({ no_session: "Sign in first", not_found: "Order not found", not_allowed: "Not allowed", nothing_to_mark: "Nothing to mark", not_open: "Not open yet" } as Record<string, string>)[String(code)] ??
          "That did not work. Try again"
      );
    }
    emit();
  },
};
