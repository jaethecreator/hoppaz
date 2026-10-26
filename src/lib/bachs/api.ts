import { koboToString, stringToKobo } from "./amounts";
import { bachsRequest, type ClientDeps, type RequestOptions } from "./client";
import type { BachsAccount, BachsAccountLink, BachsBalance, BachsCheckout, BachsPayout, BachsPayoutDestination, BachsPlatformFee, BachsRefund, BachsTransfer } from "./types";

/**
 * Typed calls for the parts of Bachs Hoppaz uses. Every function takes the same optional `deps` (fetch, clock, logger) as bachsRequest
 * so the checks can run them against the mock without touching the network. Amounts come in as kobo and leave as decimal strings here,
 * nowhere else.
 *
 * Hoppaz collects (Bachs "You collect the payment", 26 Oct 2026): checkouts, refunds and Hoppaz's balance are Hoppaz's own account
 * (PLATFORM). Hosts are recipients: Hoppaz transfers them their share and they pay it out to their bank. Old orders made as direct charges
 * carry a host account id instead, and every call below still takes one.
 */

/** The host_account of an order Hoppaz collected (ev_orders.host_account). */
export const PLATFORM = "platform";

/** Whose account a call acts as: Hoppaz's own (PLATFORM) or a host's (acct_...). */
export const whose = (account: string): Pick<RequestOptions, "accountId" | "asPlatform"> => (account === PLATFORM ? { asPlatform: true } : { accountId: account });

/**
 * A host's account: a recipient only (it receives transfers and pays them out to a bank, it never takes payments itself), so it needs
 * no merchant checks. fees.collector "bachs": Bachs takes its fees from the account's own movements, never from Hoppaz's balance.
 */
export function createRecipientAccount(
  input: { email: string; displayName: string; firstName: string; lastName: string; idempotencyKey: string },
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
        first_name: input.firstName,
        last_name: input.lastName,
        country: "NG",
        entity_type: "individual",
        configuration: { recipient: { capabilities: { payouts: { requested: true }, transfers: { requested: true } } } },
        responsibilities: { fees: { collector: "bachs" } },
      },
    },
    deps
  );
}

export type HostDetails = {
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dob: string;
  address: { line1: string; city: string; state: string };
  bank: { code: string; accountNumber: string; accountName: string };
};

/**
 * Everything a recipient needs, in one call (sandbox, 26 Oct: requirements empty, transfers and payouts active, the bank destination
 * approved at once). Bachs asks only for the name, but the person it takes also needs a date of birth and an address.
 */
export function submitHostDetails(accountId: string, d: HostDetails, idempotencyKey: string, deps?: ClientDeps) {
  return bachsRequest<BachsAccount>(
    "POST",
    `/v1/accounts/${accountId}`,
    {
      idempotencyKey,
      body: {
        fields: {
          persons: [
            {
              first_name: d.firstName,
              last_name: d.lastName,
              dob: d.dob,
              relationship: { representative: true },
              address: { line1: d.address.line1, city: d.address.city, state: d.address.state, country: "NG" },
            },
          ],
          payout_destination: { currency: "NGN", type: "bank_account", account_number: d.bank.accountNumber, account_name: d.bank.accountName, bank_code: d.bank.code },
        },
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

/** Nigerian banks and their codes, for the host's bank picker. */
export async function listBanks(deps?: ClientDeps): Promise<{ name: string; code: string }[]> {
  const res = await bachsRequest<{ banks?: { name: string; code: string }[] }>("GET", "/v1/reference/banks", { query: { country: "NG" } }, deps);
  return (res.banks ?? []).filter((b) => b && typeof b.name === "string" && typeof b.code === "string");
}

/** The name on a bank account, so the host sees it is theirs before saving. resolved false: the bank did not find it. */
export function resolveBankAccount(bankCode: string, accountNumber: string, deps?: ClientDeps) {
  return bachsRequest<{ resolved?: boolean; account_name?: string; account_number?: string; message?: string }>(
    "POST",
    "/v1/misc/bank-accounts/resolve",
    { body: { bank_code: bankCode, account_number: accountNumber, country: "NG" } },
    deps
  );
}

export type CreateCheckoutInput = {
  /** PLATFORM (Hoppaz collects, the normal case) or an old host account id (direct charge). */
  account: string;
  /** Unique per attempt: an expired checkout keeps its reference, so a retry for the same order needs a new one. */
  reference: string;
  idempotencyKey: string;
  grossKobo: number;
  /** Hoppaz's cut. Sent to Bachs only on a direct charge; when Hoppaz collects, its cut is simply what it does not pay the host. */
  platformFeeKobo: number;
  customer?: { email?: string; name?: string };
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  expiresInMinutes?: number;
  /** true makes the buyer pay Bachs's fee on top (always, when Hoppaz collects). */
  customerBearsFee?: boolean;
};

/**
 * Hoppaz collects: the checkout is Hoppaz's own, the buyer pays the ticket price plus Bachs's processing fee as its own line (the sandbox
 * showed Subtotal, Processing Fee, Total). A raw `pricing` amount is used, so no product has to exist.
 */
export function createCheckout(input: CreateCheckoutInput, deps?: ClientDeps) {
  if (input.platformFeeKobo <= 0 || input.platformFeeKobo >= input.grossKobo) throw new Error("platform_fee must be above 0 and below the gross");
  const platform = input.account === PLATFORM;
  const buyerPays = platform || input.customerBearsFee;
  return bachsRequest<BachsCheckout>(
    "POST",
    "/v1/checkout-sessions",
    {
      ...whose(input.account),
      idempotencyKey: input.idempotencyKey,
      body: {
        pricing: { currency: "NGN", amount: koboToString(input.grossKobo) },
        ...(platform ? {} : { platform_fee: koboToString(input.platformFeeKobo) }),
        ...(input.customer && (input.customer.email || input.customer.name) ? { customer: input.customer } : {}),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        reference: input.reference,
        metadata: input.metadata,
        expires_in_minutes: input.expiresInMinutes ?? 15,
        payment_method_types: ["NGN_BANK_TRANSFER", "NGN_CARD"],
        ...(buyerPays ? { customer_bears_fee: true } : {}),
      },
    },
    deps
  );
}

export const getCheckout = (checkoutId: string, account: string, deps?: ClientDeps) =>
  bachsRequest<BachsCheckout>("GET", `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, whose(account), deps);

/** A refund of a charge Hoppaz collected comes out of Hoppaz's balance (account PLATFORM); an old direct charge's out of the host's. */
export function createRefund(
  input: { chargeId: string; reference: string; idempotencyKey: string; account: string; amountKobo?: number; reason?: string; simulatedOutcome?: "success" | "failed" },
  deps?: ClientDeps
) {
  return bachsRequest<BachsRefund>(
    "POST",
    "/v1/refunds",
    {
      ...whose(input.account),
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
 * One refund by its id. Bachs documents no list-by-reference for refunds, so a refund whose creation timed out is asked about by id once
 * the id is known (refund.created carries it), and otherwise the SAME reference is sent again with the SAME idempotency key
 * (createRefund): Bachs returns the original answer, never a second refund.
 */
export const getRefund = (refundId: string, account: string, deps?: ClientDeps) =>
  bachsRequest<BachsRefund>("GET", `/v1/refunds/${encodeURIComponent(refundId)}`, whose(account), deps);

/** Hoppaz's own record of what it earned on a charge (reconciliation only). */
export async function getPlatformFee(chargeId: string, deps?: ClientDeps): Promise<BachsPlatformFee | null> {
  const res = await bachsRequest<{ items?: BachsPlatformFee[] }>("GET", "/v1/platform_fees", { query: { charge: chargeId } }, deps);
  return res.items?.find((p) => p.charge === chargeId) ?? null;
}

/** NGN available on an account, in kobo (0 when Bachs lists none). PLATFORM reads Hoppaz's own. */
export async function getAvailableNairaKobo(account: string, deps?: ClientDeps): Promise<number> {
  const res = await bachsRequest<{ balances?: BachsBalance[] }>("GET", "/v1/balances", whose(account), deps);
  const ngn = res.balances?.find((b) => b.currency === "NGN");
  return ngn ? stringToKobo(ngn.available_balance) : 0;
}

let platformId: string | null = null;
/** Hoppaz's own Bachs account id (events Bachs sends about Hoppaz's charges carry it). Read once from the balances. */
export async function platformAccountId(deps?: ClientDeps): Promise<string> {
  if (platformId && !deps) return platformId;
  const res = await bachsRequest<{ account_id?: string }>("GET", "/v1/balances", { asPlatform: true }, deps);
  if (!res.account_id) throw new Error("Bachs gave no account_id for Hoppaz");
  if (!deps) platformId = res.account_id;
  return res.account_id;
}

/** Hoppaz -> a host's Bachs account. Draws on Hoppaz's AVAILABLE balance: a charge not settled yet answers INSUFFICIENT_BALANCE. */
export function createTransfer(input: { account: string; amountKobo: number; group: string; idempotencyKey: string; description?: string; metadata?: Record<string, string> }, deps?: ClientDeps) {
  return bachsRequest<BachsTransfer>(
    "POST",
    "/v1/transfers",
    {
      idempotencyKey: input.idempotencyKey,
      body: {
        destination: input.account,
        amount: koboToString(input.amountKobo),
        currency: "NGN",
        transfer_group: input.group,
        ...(input.description ? { description: input.description } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    },
    deps
  );
}

/** A host's saved bank destinations (as the host). */
export async function listPayoutDestinations(accountId: string, deps?: ClientDeps): Promise<BachsPayoutDestination[]> {
  const res = await bachsRequest<{ destinations?: BachsPayoutDestination[] }>("GET", "/v1/payouts/destinations", { accountId }, deps);
  return res.destinations ?? [];
}

/** The host's money out to their bank. Bachs adds its withdrawal fee ON TOP: the balance must cover amount + fee. */
export function createPayout(input: { accountId: string; destination: string; amountKobo: number; reference: string; narration?: string }, deps?: ClientDeps) {
  return bachsRequest<BachsPayout>(
    "POST",
    "/v1/payouts",
    {
      accountId: input.accountId,
      idempotencyKey: input.reference,
      body: { destination: input.destination, amount: koboToString(input.amountKobo), reference: input.reference, ...(input.narration ? { narration: input.narration } : {}) },
    },
    deps
  );
}
