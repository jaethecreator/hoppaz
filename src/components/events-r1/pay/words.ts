/** Words for paid tickets: money, plain errors, order states. Pure. */
import type { Order, OrderStatus } from "@/lib/events-r1/pay";

/** Whole naira as "₦3,000". */
export const naira = (n: number): string => `₦${Math.round(n).toLocaleString("en-NG")}`;

export const ticketsWord = (n: number): string => `${n} ticket${n === 1 ? "" : "s"}`;

/** What the host is told when a refund cannot come out of their Bachs balance yet. */
export const BALANCE_WORD = "A refund comes out of your Bachs balance and your balance is lower than the sale because of the fees. It works once more sales have come in.";

/** The one line on the Get paid card: who sells and who pays for a refund. */
export const SELLER_NOTE = "You are the seller. Refunds and disputes are charged to your Bachs balance. Hoppaz's fee is not returned on a refund.";

/** The server code for "events are switched off on this server" (events_r1 setting), as a plain line. */
const NOT_OPEN = /events?_r1_off|r1_off|not_open_yet/i;

/** An error from the pay layer as one plain line for a buyer. Messages that are already plain pass through. */
export function buyError(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (NOT_OPEN.test(m)) return "Not open yet";
  if (/payouts?_not_ready|not_ready|not finished setting up/i.test(m)) return "The host has not finished setting up payments yet.";
  if (/payment open|order_open/i.test(m)) return "You already have a payment open for this event.";
  if (/^sold.?out$/i.test(m.trim())) return "Sold out. Try fewer tickets, or check back later.";
  if (/paid_off|unavailable/i.test(m)) return "Paid tickets are not open yet.";
  return m || "That did not work. Try again.";
}

/** An error from the pay layer as one plain line for a host (refunds, payouts). */
export function hostPayError(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (NOT_OPEN.test(m)) return "Not open yet";
  if (/payouts?_not_ready/i.test(m)) return "Set up payouts first";
  if (/balance/i.test(m)) return BALANCE_WORD;
  if (/tickets_used|checked.?in|used/i.test(m)) return "Tickets already checked in";
  return m || "That did not work. Try again.";
}

export const ORDER_WORD: Record<OrderStatus, string> = {
  open: "Waiting for payment",
  paid: "Paid",
  expired: "Expired",
  failed: "Failed",
  refund_pending: "Refund pending",
  refunded: "Refunded",
};

export const ORDER_TONE: Record<OrderStatus, string> = {
  open: "pill-danfo",
  paid: "pill-keke",
  expired: "",
  failed: "pill-fireant",
  refund_pending: "pill-lagoon",
  refunded: "pill-violet",
};

/** The word on an order's chip: a refund owed shows before the status. */
export function orderChip(o: Order): { word: string; tone: string } {
  if (o.needs_manual_refund) return { word: "Refund owed", tone: "pill-fireant" };
  if (o.needs_refund) return { word: "Refund owed", tone: "pill-fireant" };
  return { word: ORDER_WORD[o.status], tone: ORDER_TONE[o.status] };
}

export const METHOD_WORD = { card: "Card", bank_transfer: "Bank transfer" } as const;

/** "Paid ₦6,000 · 2 tickets" */
export const paidLine = (o: Pick<Order, "gross_naira" | "quantity">): string => `Paid ${naira(o.gross_naira)} · ${ticketsWord(o.quantity)}`;
