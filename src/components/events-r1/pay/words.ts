/** Words for paid tickets: money, plain errors, order states. Pure. */
import type { Order, OrderStatus } from "@/lib/events-r1/pay";

/** Whole naira as "₦3,000". */
export const naira = (n: number): string => `₦${Math.round(n).toLocaleString("en-NG")}`;

export const ticketsWord = (n: number): string => `${n} ticket${n === 1 ? "" : "s"}`;

/** What the host is told when Bachs cannot take a refund from Hoppaz's balance right now (it pays them out of the next payments). */
export const BALANCE_WORD = "Refunds are paused for a few minutes. Try again shortly.";

/** The one line on the money card: who collects, who pays which fee, what a refund does. */
export const SELLER_NOTE = "Hoppaz collects every payment and pays you. Buyers pay the card or transfer fee. Hoppaz keeps 4.5 percent. A refund comes off your earnings.";

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
  if (/payouts?_not_ready|needs_bank/i.test(m)) return "Add your bank details first";
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
