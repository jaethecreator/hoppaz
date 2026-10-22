import { koboToString, stringToKobo } from "./amounts";
import { bachsRequest, type ClientDeps } from "./client";
import type { BachsAccount, BachsAccountLink, BachsBalance, BachsCheckout, BachsPlatformFee, BachsRefund } from "./types";

/**
 * Typed calls for the parts of Bachs Hoppaz uses (spec sections 2 to 5). Every function takes the same optional `deps`
 * (fetch, clock, logger) as bachsRequest so the checks can run them against the mock without touching the network.
 * Amounts come in as kobo and leave as decimal strings here, nowhere else.
 */

/** Capabilities a host account asks for. fees.collector "bachs" means Bachs takes its processing fee out of the charge (host pays). */
export function createConnectedAccount(
  input: { email: string; displayName: string; idempotencyKey: string; feesCollector?: "bachs" | "platform" },
  deps?: ClientDeps
) {
  return bachsRequest<BachsAccount>(
    "POST",
    "/v1/accounts",
    {
      idempotencyKey: input.idempotencyKey,
      body: {
        contact_email: input.email,
        display_name: input.displayName,
        country: "NG",
        entity_type: "individual",
        configuration: {
          merchant: { capabilities: { bank_transfer: { requested: true }, ngn_card_collection: { requested: true } } },
          recipient: { capabilities: { payouts: { requested: true }, transfers: { requested: true } } },
        },
        responsibilities: { fees: { collector: input.feesCollector ?? "bachs" } },
      },
    },
    deps
  );
}

/** A single-use hosted onboarding link. A new link kills the previous one, so call this on click only. */
export function createAccountLink(accountId: string, input: { refreshUrl: string; returnUrl: string; type?: "onboarding" | "update"; idempotencyKey?: string }, deps?: ClientDeps) {
  return bachsRequest<BachsAccountLink>(
    "POST",
    `/v1/accounts/${accountId}/account-links`,
    { idempotencyKey: input.idempotencyKey, body: { type: input.type ?? "onboarding", refresh_url: input.refreshUrl, return_url: input.returnUrl } },
    deps
  );
}

export const getAccount = (accountId: string, deps?: ClientDeps) => bachsRequest<BachsAccount>("GET", `/v1/accounts/${accountId}`, {}, deps);

/** capability name -> status, read live (used on a doubt, the webhook is the normal path). */
export async function getCapabilities(accountId: string, deps?: ClientDeps): Promise<Record<string, string>> {
  const res = await bachsRequest<{ items?: { name: string; status: string }[] }>("GET", `/v1/accounts/${accountId}/capabilities`, {}, deps);
  const out: Record<string, string> = {};
  for (const c of res.items ?? []) out[c.name] = c.status;
  return out;
}

export type CreateCheckoutInput = {
  accountId: string;
  /** Unique per attempt: an expired checkout keeps its reference, so a retry for the same order needs a new one. */
  reference: string;
  idempotencyKey: string;
  grossKobo: number;
  platformFeeKobo: number;
  customer?: { email?: string; name?: string };
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  expiresInMinutes?: number;
  /** true makes the buyer pay Bachs's fee on top. Default false: the host pays it. */
  customerBearsFee?: boolean;
};

/**
 * Direct charge: X-Account-Id makes the host the merchant. A raw `pricing` amount is used (the sandbox accepts it with
 * platform_fee, so no product has to exist on the host account).
 */
export function createCheckout(input: CreateCheckoutInput, deps?: ClientDeps) {
  if (input.platformFeeKobo <= 0 || input.platformFeeKobo >= input.grossKobo) throw new Error("platform_fee must be above 0 and below the gross");
  return bachsRequest<BachsCheckout>(
    "POST",
    "/v1/checkout-sessions",
    {
      accountId: input.accountId,
      idempotencyKey: input.idempotencyKey,
      body: {
        pricing: { currency: "NGN", amount: koboToString(input.grossKobo) },
        platform_fee: koboToString(input.platformFeeKobo),
        ...(input.customer && (input.customer.email || input.customer.name) ? { customer: input.customer } : {}),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        reference: input.reference,
        metadata: input.metadata,
        expires_in_minutes: input.expiresInMinutes ?? 15,
        payment_method_types: ["NGN_BANK_TRANSFER", "NGN_CARD"],
        ...(input.customerBearsFee ? { customer_bears_fee: true } : {}),
      },
    },
    deps
  );
}

/** Needs X-Account-Id: without it Bachs answers 404 for a host's checkout. */
export const getCheckout = (checkoutId: string, accountId: string, deps?: ClientDeps) =>
  bachsRequest<BachsCheckout>("GET", `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, { accountId }, deps);

/** accountId is required: a refund of a direct charge is the host's (Bachs answers 404 without it), and the client refuses the call without one. */
export function createRefund(
  input: { chargeId: string; reference: string; idempotencyKey: string; accountId: string; amountKobo?: number; reason?: string; simulatedOutcome?: "success" | "failed" },
  deps?: ClientDeps
) {
  return bachsRequest<BachsRefund>(
    "POST",
    "/v1/refunds",
    {
      accountId: input.accountId,
      idempotencyKey: input.idempotencyKey,
      body: {
        charge_id: input.chargeId,
        reference: input.reference,
        ...(input.amountKobo !== undefined ? { amount: koboToString(input.amountKobo) } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.simulatedOutcome ? { simulated_outcome: input.simulatedOutcome } : {}),
      },
    },
    deps
  );
}

/**
 * One refund by its id, as the host. Bachs documents no list-by-reference for refunds, so a refund whose creation timed out is
 * asked about by id once the id is known (refund.created carries it), and otherwise the SAME reference is sent again with the
 * SAME idempotency key (createRefund): Bachs returns the original answer, never a second refund.
 */
export const getRefund = (refundId: string, accountId: string, deps?: ClientDeps) =>
  bachsRequest<BachsRefund>("GET", `/v1/refunds/${encodeURIComponent(refundId)}`, { accountId }, deps);

/** Hoppaz's own record of what it earned on a charge (reconciliation only). */
export async function getPlatformFee(chargeId: string, deps?: ClientDeps): Promise<BachsPlatformFee | null> {
  const res = await bachsRequest<{ items?: BachsPlatformFee[] }>("GET", "/v1/platform_fees", { query: { charge: chargeId } }, deps);
  return res.items?.find((p) => p.charge === chargeId) ?? null;
}

/** What a host account holds, in kobo of NGN available (0 when Bachs lists none). Used before a card refund: the host is debited the full amount. */
export async function getAvailableNairaKobo(accountId: string, deps?: ClientDeps): Promise<number> {
  const res = await bachsRequest<{ balances?: BachsBalance[] }>("GET", "/v1/balances", { accountId }, deps);
  const ngn = res.balances?.find((b) => b.currency === "NGN");
  return ngn ? stringToKobo(ngn.available_balance) : 0;
}
