/**
 * Bachs (bachs.io) wire types, trimmed to the fields Hoppaz reads. Server only. The spec is
 * notes/luma/11-bachs-integration-spec.md and the sandbox findings are notes/luma/11b-bachs-sandbox-findings.md.
 * Bachs sends more fields than these; unknown ones are ignored.
 */

export type CapabilityStatus = "active" | "restricted" | "pending" | "unrequested" | "unsupported";

export type BachsAccount = {
  id: string;
  name?: string | null;
  country?: string;
  entity_type?: string;
  is_active?: boolean;
  capabilities?: Record<string, { status: CapabilityStatus | string; requested?: boolean; status_details?: unknown }>;
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    pending_verification?: string[];
    errors?: unknown[];
  };
};

export type BachsAccountLink = { id: string; url: string; expires_at?: string; previous_link_superseded?: boolean };

export type CheckoutStatus = "open" | "completed" | "expired" | (string & {});

export type BachsCheckout = {
  checkout_id: string;
  checkout_url?: string;
  status: CheckoutStatus;
  /** requires_payment_method while open, paid once settled (GET only). */
  payment_status?: string | null;
  amount?: string;
  currency?: string;
  reference?: string | null;
  platform_fee?: string | null;
  expires_at?: string;
  completed_at?: string | null;
  metadata?: Record<string, unknown> | null;
  /** On GET the charge sits here; the id is `payment_id` (webhooks call it `id`). */
  charge?: {
    payment_id?: string;
    id?: string;
    status?: string;
    /** NGN_CARD or NGN_BANK_TRANSFER on a GET (webhooks use payment_method_details.type: card or bank_transfer). */
    payment_method?: string | null;
    payment_method_details?: { type?: string } | null;
    amount_paid?: string;
    fees?: { amount?: string } | null;
  } | null;
};

export type BachsRefund = {
  refund_id?: string;
  id?: string;
  status?: string;
  requested_amount?: string;
  refunded_amount?: string;
  refund_fee_amount?: string;
  reference?: string;
};

export type BachsPlatformFee = { id: string; charge: string; collected_from?: string; earned_by?: string; amount: string; currency: string; amount_refunded?: string; refunded?: boolean };

/** The envelope every webhook has. `account` only on a connected account's events. */
export type BachsEvent = {
  id: string;
  type: string;
  created_at?: string;
  organization_id?: string;
  account?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
};

export type BachsErrorKind =
  | "auth" // 401, 403: our key or scope is wrong, or the host account does not belong to us
  | "host_not_ready" // the host cannot take this payment method yet
  | "invalid" // 400 or 422: our request was wrong (a bug or bad config)
  | "insufficient_balance" // a refund bigger than what the host account holds (Hoppaz's fee is not returned, so a host's first sale cannot be refunded in full)
  | "not_found"
  | "conflict" // idempotency
  | "rate_limited"
  | "unavailable" // 5xx, timeout, network
  | "guard"; // refused here before any call (missing or bad X-Account-Id)

export type BachsBalance = { currency: string; available_balance: string; pending_balance?: string };

/** Hoppaz -> a host's account (POST /v1/transfers). status "paid" once it has moved. */
export type BachsTransfer = { id: string; source?: string; destination: string; amount: string; currency: string; status?: string; transfer_group?: string | null; created_at?: string };

/** A host's saved bank (GET /v1/payouts/destinations as the host). Pay out only to one that is_usable. */
export type BachsPayoutDestination = {
  id: string;
  type: string;
  currency: string;
  status?: string;
  is_usable?: boolean;
  is_default?: boolean;
  account_number?: string | null;
  account_name?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
};

/** Money out of an account to its bank (POST /v1/payouts). fee is added on top: total_debited = amount + fee. */
export type BachsPayout = {
  id: string;
  status: string;
  amount: string;
  currency?: string;
  fee?: string | null;
  total_debited?: string | null;
  destination?: string;
  reference?: string | null;
  failure_reason?: string | null;
  created_at?: string;
};
