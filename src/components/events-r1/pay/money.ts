/**
 * Sales and Payouts, worked out from what the pay layer already gives (pay.sales, pay.eventOrders, pay.payoutSummary, pay.hostPayout).
 * Pure: no money moves here. Lagos time for every date.
 */
import type { R1Event } from "@/lib/events-r1/types";
import type { HostPayout, Order, PayoutSummary, Sales } from "@/lib/events-r1/pay";
import { PLACEHOLDER_FEE_PERCENT } from "@/lib/events-r1/payFee";

/** "₦3,000", and "−₦3,000" for money that comes off. */
export const nairaSigned = (n: number): string => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString("en-NG")}`;

/** The bank as the screens tell it: not added, being checked, refused, or ready. */
export type BankState = "none" | "checking" | "problem" | "ready";

export function bankState(sum: PayoutSummary | null, host: HostPayout | null): BankState {
  if (sum?.account.ready || host?.status === "ready") return "ready";
  if (host?.status === "restricted") return "problem";
  if (host?.status === "in_progress" || (sum?.account.has_account && !host)) return "checking";
  return "none";
}

/** The rules when the summary is not readable (a room admin): 5 percent, 30 days, like the server. */
export const DEFAULT_RULES: PayoutSummary["rules"] = { reserve_percent: 5, reserve_days: 30, delay_hours: 24, min_naira: 1000 };

/** Does this event sell anything (a paid ticket type)? */
export const hasPaidTypes = (e: Pick<R1Event, "ticket_types" | "price_naira">): boolean => e.ticket_types?.some((t) => t.price_naira > 0) ?? e.price_naira > 0;

/** When the night is over (the end time, or three hours after the start). */
export const eventEndMs = (e: Pick<R1Event, "starts_at" | "ends_at">): number => (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 3 * 3.6e6);

export const isOver = (e: Pick<R1Event, "starts_at" | "ends_at" | "status">, now: number): boolean => e.status === "ended" || eventEndMs(e) < now;

/** When the 5 percent held for refunds is released. */
export const releaseMs = (e: Pick<R1Event, "starts_at" | "ends_at">, rules: PayoutSummary["rules"]): number => eventEndMs(e) + rules.reserve_days * 864e5;

const DAY_F = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "numeric" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CLOCK_F = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit", hour12: true });
const YMD_F = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });

/** "Thu 5 Nov". */
export function dayWord(ms: number | string | null): string {
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  if (t === null || !Number.isFinite(t)) return "";
  const p = Object.fromEntries(DAY_F.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${MON[Number(p.month) - 1]}`;
}

export const sameLagosDay = (a: number, b: number): boolean => YMD_F.format(new Date(a)) === YMD_F.format(new Date(b));

/** "Today, 2:14 PM", "Yesterday" or "Mon 26 Oct". */
export function whenWord(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  if (sameLagosDay(t, now)) return `Today, ${CLOCK_F.format(new Date(t)).toUpperCase()}`;
  if (sameLagosDay(t, now - 864e5)) return "Yesterday";
  return dayWord(t);
}

/** One event's money, in the design's terms: money in, refunds, Hoppaz fee, (older orders) card fees, what the host gets. */
export type EventMoney = {
  sold: number;
  moneyIn: number;
  refunds: number;
  refundedTickets: number;
  fee: number;
  feePercent: number;
  cardFees: number;
  youGet: number;
  /** Tickets paid today (Lagos). */
  today: number;
  /** The 5 percent held until it is released. */
  held: number;
};

export function eventMoney(s: Sales, orders: Order[], rules: PayoutSummary["rules"], now: number): EventMoney {
  const t = s.totals;
  const refundedOrders = orders.filter((o) => o.status === "refunded" || o.status === "refund_pending");
  const refunds = t.refunded_naira;
  const feePercent = t.gross_naira > 0 ? Math.round((t.platform_fee_naira / t.gross_naira) * 1000) / 10 : PLACEHOLDER_FEE_PERCENT;
  const today = orders
    .filter((o) => o.status === "paid" && !o.needs_refund && !o.needs_manual_refund && o.paid_at && sameLagosDay(Date.parse(o.paid_at), now))
    .reduce((n, o) => n + o.quantity, 0);
  return {
    sold: t.sold,
    moneyIn: t.gross_naira + refunds,
    refunds,
    refundedTickets: refundedOrders.reduce((n, o) => n + o.quantity, 0),
    fee: t.platform_fee_naira,
    feePercent,
    cardFees: t.processing_fee_naira,
    youGet: t.net_naira,
    today,
    held: Math.ceil((t.net_naira * rules.reserve_percent) / 100),
  };
}

/** "4.5%" (one decimal only when there is one). */
export const percentWord = (p: number): string => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
