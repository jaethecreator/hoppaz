/**
 * Fake paid tickets (the PayApi): host payout setup, quote, checkout, orders, sales, refunds. It behaves like the real
 * server routes in src/app/api/events-r1/pay and src/lib/bachs, with no money anywhere.
 *
 * The one rule that matters: a ticket is issued only when the (fake) webhook says the order is paid, never by checkout().
 * The fake webhook is completeCheckout() below, called by the dev page /dev/fake-bachs/checkout/<orderId>.
 *
 * Amounts are whole naira. Seats held by an open order count against capacity until expires_at (15 minutes of fake
 * time); an order past that flips to expired the next time anything reads it.
 */
import type { PayApi, Order, PayMethod, Quote, RefundResult, Sales, SalesRow } from "../pay";
import { PAID_UNAVAILABLE } from "../constants";
import { paidTicketsOn } from "../flags";
import { platformFeeNaira, processingFeeNaira } from "../payFee";
import type { Registration } from "../types";
import { canSell, payoutFor } from "./payouts";
import { cleanAnswers } from "./registrations";
import {
  assertManage, canOpen, eventEnd, fillFromWaitlist, findEvent, isGoing, regOf, requireViewer, seatsOf, ticketIdFor,
  ticketsOfReg, typeSpotsLeft, typesOf, userById, voidTicket,
} from "./rules";
import type { EventRec, OrderRec, TicketRec, TicketTypeRec } from "./store";
import { emit, now, persist, S, viewer } from "./store";
import { clone, newId } from "./util";

const HOLD_MS = 15 * 60_000;
/** A card refund settles this long after it starts (fake time). */
const REFUND_SETTLE_MS = 60_000;
const MAX_QUANTITY = 5;

const iso = (ms: number) => new Date(ms).toISOString();

/* ---------------------------------------------------------------- state -- */

/**
 * Lazy changes on read: an open order past its time becomes expired, a card refund past its time becomes refunded.
 * Saved without telling subscribers (the held seats were already not counted once the time passed).
 */
function sweep(): void {
  const t = now();
  let changed = false;
  for (const o of Object.values(S().orders)) {
    if (o.status === "open" && Date.parse(o.expires_at) <= t) {
      o.status = "expired";
      changed = true;
    } else if (o.status === "refund_pending" && o.refund_started_ms !== null && t - o.refund_started_ms >= REFUND_SETTLE_MS) {
      o.status = "refunded";
      changed = true;
    }
  }
  if (changed) persist();
}

/** What a screen gets. The pay link goes only to the buyer, and only while the order is open. */
function view(o: OrderRec, forBuyer: boolean): Order {
  const { host_id, answers, referrer_id, refund_started_ms, ...rest } = o;
  void host_id;
  void answers;
  void referrer_id;
  void refund_started_ms;
  return clone({ ...rest, checkout_url: forBuyer && o.status === "open" ? o.checkout_url : null });
}

function orderRec(id: string): OrderRec {
  sweep();
  const o = S().orders[id];
  if (!o) throw new Error("Order not found");
  return o;
}

/** The buyer, the host and staff may read an order. Anyone else gets "not found". */
function readable(o: OrderRec): void {
  const v = viewer();
  if (!v || (o.buyer_id !== v.id && o.host_id !== v.id && !v.staff)) throw new Error("Order not found");
}

function checkQuantity(q: number): void {
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw new Error(`Pick 1 to ${MAX_QUANTITY} tickets`);
}

function paidType(e: EventRec, ticketTypeId: string): TicketTypeRec {
  const type = typesOf(e).find((t) => t.id === ticketTypeId);
  if (!type) throw new Error("Pick a ticket");
  if (type.price_naira <= 0) throw new Error("This ticket is free. Use Register.");
  return type;
}

/** Money the host holds at Bachs: what they started with, plus paid net, less the gross of card refunds. */
export function hostBalance(hostId: string): number {
  let n = S().payouts[hostId]?.balance_naira ?? 0;
  for (const o of Object.values(S().orders)) {
    if (o.host_id !== hostId || !o.paid_at) continue;
    n += o.host_net_naira ?? 0;
    if (o.payment_method === "card" && (o.status === "refund_pending" || o.status === "refunded")) n -= o.gross_naira;
  }
  return n;
}

/* ------------------------------------------------- the fake webhook path -- */

/** Tickets and the registration for a paid order: ONE registration per person per event, quantity adds up; one ticket per seat. */
function issueTickets(o: OrderRec): void {
  const e = S().events[o.event_id];
  if (!e) return;
  let reg = regOf(o.event_id, o.buyer_id);
  const type = typesOf(e).find((t) => t.id === o.ticket_type_id);
  if (reg && isGoing(reg.status)) {
    reg.quantity = seatsOf(reg) + o.quantity;
    if (reg.status === "checked_in") reg.status = "going"; // new tickets are not checked in yet
  } else {
    const buyer = userById(o.buyer_id);
    const fresh: Registration = reg ?? {
      id: newId(), event_id: o.event_id, user_id: o.buyer_id, name: o.buyer_name, email: buyer?.email ?? "", phone: null,
      status: "going", ticket_type_id: o.ticket_type_id, ticket_name: type?.name ?? o.ticket_name, quantity: o.quantity,
      answers: {}, referrer_id: null, referrer_name: null, created_at: "", checked_in_at: null, waitlist_pos: null,
    };
    const ref = o.referrer_id && o.referrer_id !== o.buyer_id ? userById(o.referrer_id) : null;
    Object.assign(fresh, {
      name: o.buyer_name,
      email: buyer?.email ?? fresh.email,
      status: "going",
      ticket_type_id: o.ticket_type_id,
      ticket_name: type?.name ?? o.ticket_name,
      quantity: o.quantity,
      answers: o.answers,
      referrer_id: ref ? ref.id : fresh.referrer_id,
      referrer_name: ref ? ref.name : fresh.referrer_name,
      created_at: fresh.created_at || iso(now()),
      checked_in_at: null,
      checked_in_count: 0,
      waitlist_pos: null,
    });
    S().regs[fresh.id] = fresh;
    reg = fresh;
  }
  let seq = ticketsOfReg(reg.id).reduce((m, t) => Math.max(m, t.seq ?? 1), 0);
  for (let i = 0; i < o.quantity; i++) {
    const first = ticketIdFor(reg.id);
    const id = S().tickets[first] ? newId() : first;
    const t: TicketRec = { id, event_id: o.event_id, reg_id: reg.id, version: 1, status: "valid", order_id: o.id, type_id: o.ticket_type_id, seq: ++seq };
    S().tickets[id] = t;
  }
}

/** Money arrived for an order. Open and in time: tickets. Late: tickets if the seats are still free, else a refund is owed. */
export function completeCheckout(orderId: string, method: PayMethod): Order {
  const o = orderRec(orderId);
  if (o.status === "failed") throw new Error("This payment already failed");
  if (o.status !== "open" && o.status !== "expired") return view(o, false); // paid, refunding or refunded: nothing new
  const e = S().events[o.event_id];
  const late = o.status === "expired";
  const processing = processingFeeNaira(o.gross_naira, method);
  let seatsFree = true;
  if (late) {
    const type = e ? typesOf(e).find((t) => t.id === o.ticket_type_id) : undefined;
    const left = e && type ? typeSpotsLeft(e, type) : 0;
    seatsFree = !!e && e.status !== "cancelled" && (left === null || left >= o.quantity);
  }
  o.status = "paid";
  o.payment_method = method;
  o.paid_at = iso(now());
  o.processing_fee_naira = processing;
  o.host_net_naira = o.gross_naira - o.platform_fee_naira - processing;
  if (seatsFree) issueTickets(o);
  else {
    o.needs_refund = method === "card";
    o.needs_manual_refund = method === "bank_transfer";
    o.refund_reason = "late"; // the only way here is a payment that landed after the hold, with no seat left
  }
  emit();
  return view(o, false);
}

/** The payment failed: seats go back and the buyer starts again. */
export function failCheckout(orderId: string): Order {
  const o = orderRec(orderId);
  if (o.status === "open") {
    o.status = "failed";
    emit();
  }
  return view(o, false);
}

/** Nobody paid in time: the hold ends now. */
export function expireCheckout(orderId: string): Order {
  const o = orderRec(orderId);
  if (o.status === "open") {
    o.status = "expired";
    emit();
  }
  return view(o, false);
}

/** A card refund finishes (Bachs would send refund.paid). */
export function settleRefund(orderId: string): Order {
  const o = orderRec(orderId);
  if (o.status === "refund_pending") {
    o.status = "refunded";
    emit();
  }
  return view(o, false);
}

/** An order as the dev checkout page shows it: no sign-in needed, like the hosted Bachs page. */
export function peekOrder(orderId: string): (Order & { host_name: string }) | null {
  sweep();
  const o = S().orders[orderId];
  return o ? { ...view(o, true), host_name: userById(o.host_id)?.name ?? "Host" } : null;
}

/* ------------------------------------------------------------------ refund -- */

/** Void an order's tickets and take its seats off the registration. */
function takeBack(o: OrderRec): void {
  const mine = Object.values(S().tickets).filter((t) => t.order_id === o.id && t.status !== "void");
  for (const t of mine) t.status = "void";
  const reg = regOf(o.event_id, o.buyer_id);
  if (!reg || !mine.length) return;
  reg.quantity = Math.max(0, seatsOf(reg) - mine.length);
  const live = ticketsOfReg(reg.id).filter((t) => t.status !== "void");
  reg.checked_in_count = live.filter((t) => t.status === "used").length;
  if (live.length === 0) {
    reg.status = "cancelled";
    reg.quantity = 1;
    voidTicket(reg);
  } else if (live.every((t) => t.status === "used")) reg.status = "checked_in";
  fillFromWaitlist(o.event_id);
}

/* --------------------------------------------------------------------- api -- */

export const pay: PayApi = {
  async hostPayout() {
    return payoutFor(requireViewer().id);
  },

  async startOnboarding(returnPath) {
    requireViewer();
    return { url: `/dev/fake-bachs/onboarding?return=${encodeURIComponent(returnPath)}` };
  },

  async quote(eventId, ticketTypeId, quantity) {
    const e = findEvent(eventId);
    if (!e || !canOpen(e)) throw new Error("Event not found");
    if (!paidTicketsOn()) throw new Error(PAID_UNAVAILABLE);
    const type = paidType(e, ticketTypeId);
    checkQuantity(quantity);
    const gross = type.price_naira * quantity;
    return { gross_naira: gross, platform_fee_naira: platformFeeNaira(gross), quantity, unit_price_naira: type.price_naira } satisfies Quote;
  },

  async checkout(eventId, ticketTypeId, quantity, opts) {
    sweep();
    const v = requireViewer();
    const e = findEvent(eventId);
    if (!e || !canOpen(e)) throw new Error("Event not found");
    if (!paidTicketsOn()) throw new Error(PAID_UNAVAILABLE);
    const type = paidType(e, ticketTypeId);
    if (!canSell(e.host_id)) throw new Error("payouts_not_ready");
    checkQuantity(quantity);
    if (e.status === "cancelled") throw new Error("This event was cancelled");
    if (now() > eventEnd(e)) throw new Error("This event is over");
    const left = typeSpotsLeft(e, type);
    if (left !== null && left < quantity) throw new Error(left === 0 ? "Sold out" : `Only ${left} left`);
    const answers = cleanAnswers(e.id, opts?.answers);

    const gross = type.price_naira * quantity;
    const id = newId();
    const rec: OrderRec = {
      id, event_id: e.id, event_title: e.title, buyer_id: v.id, buyer_name: v.name, ticket_type_id: type.id, ticket_name: type.name,
      quantity, unit_price_naira: type.price_naira, gross_naira: gross, platform_fee_naira: platformFeeNaira(gross),
      processing_fee_naira: null, host_net_naira: null, status: "open", payment_method: null, created_at: iso(now()),
      expires_at: iso(now() + HOLD_MS), paid_at: null, checkout_url: `/dev/fake-bachs/checkout/${id}`, needs_refund: false,
      needs_manual_refund: false, host_id: e.host_id, answers, referrer_id: opts?.referrerId ?? null, refund_started_ms: null,
    };
    S().orders[id] = rec;
    emit();
    return { order_id: id, checkout_url: rec.checkout_url as string, expires_at: rec.expires_at };
  },

  async order(orderId) {
    const o = orderRec(orderId);
    readable(o);
    return view(o, o.buyer_id === viewer()?.id);
  },

  async myOrders() {
    sweep();
    const v = requireViewer();
    return Object.values(S().orders)
      .filter((o) => o.buyer_id === v.id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((o) => view(o, true));
  },

  async eventOrders(eventId) {
    sweep();
    const e = assertManage(findEvent(eventId));
    return Object.values(S().orders)
      .filter((o) => o.event_id === e.id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((o) => view(o, false));
  },

  async sales(eventId) {
    sweep();
    const e = assertManage(findEvent(eventId));
    const orders = Object.values(S().orders).filter((o) => o.event_id === e.id);
    // Sold means paid and holding tickets. A paid order that is owed back (no seat, or refund started by hand) is not a sale.
    const sold = orders.filter((o) => o.status === "paid" && !o.needs_refund && !o.needs_manual_refund);
    const rows: SalesRow[] = typesOf(e).map((t) => {
      const mine = sold.filter((o) => o.ticket_type_id === t.id);
      const sum = (f: (o: OrderRec) => number) => mine.reduce((n, o) => n + f(o), 0);
      return {
        ticket_type_id: t.id, name: t.name, price_naira: t.price_naira, sold: sum((o) => o.quantity), gross_naira: sum((o) => o.gross_naira),
        platform_fee_naira: sum((o) => o.platform_fee_naira), processing_fee_naira: sum((o) => o.processing_fee_naira ?? 0),
        net_naira: sum((o) => o.host_net_naira ?? 0),
      };
    });
    const total = (k: keyof Omit<SalesRow, "ticket_type_id" | "name" | "price_naira">) => rows.reduce((n, r) => n + r[k], 0);
    const t = now();
    return {
      rows,
      totals: {
        sold: total("sold"), gross_naira: total("gross_naira"), platform_fee_naira: total("platform_fee_naira"),
        processing_fee_naira: total("processing_fee_naira"), net_naira: total("net_naira"),
        refunded_naira: orders.filter((o) => o.status === "refunded" || o.status === "refund_pending").reduce((n, o) => n + o.gross_naira, 0),
      },
      open_orders: orders.filter((o) => o.status === "open" && Date.parse(o.expires_at) > t).length,
      refunds_owed: orders.filter((o) => o.needs_refund || o.needs_manual_refund).length,
    } satisfies Sales;
  },

  async refund(orderId): Promise<RefundResult> {
    const o = orderRec(orderId);
    assertManage(S().events[o.event_id]);
    if (o.status === "refund_pending" || (o.status === "paid" && o.refund_started_ms !== null)) throw new Error("A refund is already on its way.");
    if (o.status === "refunded") throw new Error("This order was already refunded.");
    if (o.status !== "paid") throw new Error("Only a paid order can be refunded.");
    if (Object.values(S().tickets).some((t) => t.order_id === o.id && t.status === "used")) throw new Error("tickets_used");
    const card = o.payment_method === "card";
    // A card refund comes out of the host's Bachs balance, in full. Hoppaz's fee and Bachs's fee are not returned.
    if (card && hostBalance(o.host_id) < o.gross_naira) throw new Error("Not enough balance to refund yet");
    takeBack(o);
    o.refund_started_ms = now();
    if (card) {
      o.status = "refund_pending";
      o.needs_refund = false;
      emit();
      return { method: "card", status: "refund_pending" };
    }
    o.needs_manual_refund = true; // bank transfer: Bachs cannot send it back, the host pays the buyer by hand
    emit();
    return { method: "manual", status: "manual_needed" };
  },

  async markManualRefundDone(orderId) {
    const o = orderRec(orderId);
    assertManage(S().events[o.event_id]);
    if (!o.needs_manual_refund) throw new Error("There is nothing to mark.");
    o.needs_manual_refund = false;
    o.status = "refunded";
    emit();
  },
};
