/**
 * Release 1 paid tickets: shared types and the one interface for money.
 * Payments run on Bachs (bachs.io), direct charge: each host is their own merchant, Hoppaz takes a platform fee.
 * Amounts here are whole naira (kobo only inside the database and at the Bachs edge). The spec is notes/luma/11-bachs-integration-spec.md.
 * Everything here is behind paidTicketsOn() (flags.ts: NEXT_PUBLIC_PAID_TICKETS, or the dev panel switch on fake data). Off: paid types show "Currently unavailable" and nothing below is called.
 */

export type OrderStatus = "open" | "paid" | "expired" | "failed" | "refund_pending" | "refunded";
export type PayMethod = "card" | "bank_transfer";

export type Order = {
  id: string;
  event_id: string;
  event_title: string;
  buyer_id: string;
  buyer_name: string;
  ticket_type_id: string;
  ticket_name: string;
  quantity: number;
  unit_price_naira: number;
  gross_naira: number;
  /** What Hoppaz keeps, stored at checkout time (Bachs does not echo it back). */
  platform_fee_naira: number;
  /** Bachs's processing fee, known after collection.succeeded. */
  processing_fee_naira: number | null;
  /** What the host receives after both fees. Null until paid. */
  host_net_naira: number | null;
  status: OrderStatus;
  payment_method: PayMethod | null;
  created_at: string;
  /** Seats are held until this time while the order is open. */
  expires_at: string;
  paid_at: string | null;
  /** The hosted Bachs page. Returned only to the buyer, only while open. */
  checkout_url: string | null;
  /** Payment landed after the hold ended and no seat was left: a refund is owed. */
  needs_refund: boolean;
  /** Bank transfers cannot be refunded through Bachs: the host pays the buyer by hand. */
  needs_manual_refund: boolean;
  /** Why a refund is owed, for the buyer's screen: "late" (the payment landed after the hold and the seats were gone) or "failed" (the host's refund was refused and the order is paid again). Null or missing: no reason known. */
  refund_reason?: "late" | "failed" | null;
};

export type HostPayoutStatus = "not_started" | "in_progress" | "ready" | "restricted";

export type HostPayout = {
  status: HostPayoutStatus;
  /** capability name to status (bank_transfer, ngn_card_collection, payouts ...). */
  capabilities: Record<string, string>;
  /** Plain words for what Bachs still needs from the host. */
  requirements_due: string[];
  /** Since 26 Oct (Hoppaz collects): transfers and payouts active, the host can withdraw. Selling never needs it. */
  can_sell: boolean;
  /** Where the host sees payouts (Bachs dashboard). */
  dashboard_url: string;
};

export type SalesRow = {
  ticket_type_id: string;
  name: string;
  price_naira: number;
  sold: number;
  gross_naira: number;
  platform_fee_naira: number;
  processing_fee_naira: number;
  net_naira: number;
};

export type Sales = {
  rows: SalesRow[];
  totals: { sold: number; gross_naira: number; platform_fee_naira: number; processing_fee_naira: number; net_naira: number; refunded_naira: number };
  open_orders: number;
  /** Paid orders that need the host to pay the buyer back by hand (bank transfers) or are owed a refund. */
  refunds_owed: number;
};

/** One withdrawal of a host's balance. requested: sent a day after the ask; transferred / paying: on its way to the bank. */
export type Withdrawal = {
  id: string;
  amount_naira: number;
  status: "requested" | "transferred" | "paying" | "paid" | "cancelled";
  execute_after: string;
  /** What reached the bank (the amount less Bachs's withdrawal fee), once sent. */
  received_naira: number | null;
  fee_naira: number | null;
  created_at: string;
  paid_at: string | null;
};

/** The host's money (events_r1_payouts.sql). Hoppaz collects every payment and pays the host their share. */
export type PayoutSummary = {
  account: { has_account: boolean; ready: boolean; bank_label: string | null; requirements_due: string[] };
  /** Shares of paid tickets (the price less Hoppaz's 4.5 percent), all time. */
  earned_naira: number;
  /** 5 percent held back until 30 days after each event (chargebacks). */
  reserved_naira: number;
  /** When the earliest held amount is released. */
  reserve_until: string | null;
  withdrawn_naira: number;
  /** What can be withdrawn now. */
  available_naira: number;
  /** earned less withdrawn; below zero when refunds came after a withdrawal. */
  balance_naira: number;
  open_withdrawal: Withdrawal | null;
  recent: Withdrawal[];
  rules: { reserve_percent: number; reserve_days: number; delay_hours: number; min_naira: number };
};

/** What the host gives to get paid. Nothing else: no ID, no BVN. */
export type PayoutDetails = {
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dob: string;
  line1: string;
  city: string;
  state: string;
  bankCode: string;
  accountNumber: string;
};

export type Quote = { gross_naira: number; platform_fee_naira: number; quantity: number; unit_price_naira: number };
export type Checkout = { order_id: string; checkout_url: string; expires_at: string };
export type RefundResult = {
  method: "card" | "manual";
  status: "refund_pending" | "refunded" | "manual_needed";
  /** Bachs did not answer yet: the refund is pending (the tickets stay void) and will be settled automatically. */
  unconfirmed?: boolean;
};

export interface PayApi {
  /** The signed-in host's payout setup. */
  hostPayout(): Promise<HostPayout>;
  /** The signed-in host's balance, held amount, bank and withdrawals. */
  payoutSummary(): Promise<PayoutSummary>;
  /** Nigerian banks for the payout form. */
  banks(): Promise<{ name: string; code: string }[]>;
  /** The name the bank has on an account (so the host sees it is theirs). Throws when the bank does not find it. */
  checkAccount(bankCode: string, accountNumber: string): Promise<{ account_name: string }>;
  /** Save the host's payout details (makes their payout account; ready at once when the bank resolves). */
  setupPayout(d: PayoutDetails): Promise<{ ready: boolean; bank_label: string; account_name: string }>;
  /** Withdraw the whole available balance; it is sent a day later. Throws needs_bank, already_requested or too_small. */
  requestWithdrawal(): Promise<Withdrawal>;
  /** What the buyer will pay for the tickets: price times quantity. Bachs adds its processing fee on top at checkout. */
  quote(eventId: string, ticketTypeId: string, quantity: number): Promise<Quote>;
  /** Reserve seats, create the Bachs checkout, return its hosted page. Tickets are NEVER issued here, only by the verified webhook. */
  checkout(eventId: string, ticketTypeId: string, quantity: number, opts?: { answers?: Record<string, string>; referrerId?: string | null }): Promise<Checkout>;
  /** Poll this on the return page: "confirming" until status is paid, expired or failed. */
  order(orderId: string): Promise<Order>;
  myOrders(): Promise<Order[]>;
  /** Host: orders for one event. */
  eventOrders(eventId: string): Promise<Order[]>;
  /** Host: sales per ticket type with both fees and net. */
  sales(eventId: string): Promise<Sales>;
  /** Host or staff: refund a paid order (card via Bachs; bank transfer becomes a manual task). */
  refund(orderId: string): Promise<RefundResult>;
  /** Host: after paying a bank transfer buyer back by hand. */
  markManualRefundDone(orderId: string): Promise<void>;
}
