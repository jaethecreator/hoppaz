/**
 * Real paid tickets (Bachs). Money moves only through the Next.js route handlers (src/app/api/events-r1/pay/*), called with
 * the signed-in session's access token. Reads go straight to the database (ev_pay_* functions, supabase/events_r1_pay.sql).
 */
import type { Checkout, HostPayout, Order, PayApi, Quote, RefundResult, Sales } from "../pay";
import { accessToken, emit, rpc, UUID } from "./core";
import { iso } from "./map";

type Row = Record<string, unknown>;

/** In a page the routes are on the same origin. A Node script sets EVENTS_R1_API_BASE (for example http://127.0.0.1:3420). */
const base = () => (typeof window === "undefined" ? (process.env.EVENTS_R1_API_BASE ?? "") : "");

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
  };
}

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

  async startOnboarding(returnPath) {
    return post<{ url: string }>("onboard", { returnPath });
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
        ({ no_session: "Sign in first", not_found: "Order not found", not_allowed: "Not allowed", nothing_to_mark: "Nothing to mark" } as Record<string, string>)[String(code)] ??
          "That did not work. Try again"
      );
    }
    emit();
  },
};
