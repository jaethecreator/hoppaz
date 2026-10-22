/**
 * The fake host payout setup: what Bachs would say about a host (Not started, In progress, Ready, Restricted) and the
 * host's balance. Kept apart from pay.ts so events.ts can ask "can this host sell?" without a loop of imports.
 */
import type { HostPayout, HostPayoutStatus } from "../pay";
import { S } from "./store";
import type { PayoutRec } from "./store";

const DASHBOARD = "https://dashboard.bachs.io";

export function statusOfHost(userId: string): HostPayoutStatus {
  return S().payouts[userId]?.status ?? "not_started";
}

/** The answer Bachs would give for a host in this state. */
export function payoutFor(userId: string): HostPayout {
  const status = statusOfHost(userId);
  const capabilities: Record<string, string> =
    status === "ready"
      ? { bank_transfer: "active", ngn_card_collection: "active", payouts: "active" }
      : status === "in_progress"
        ? { bank_transfer: "pending", ngn_card_collection: "pending", payouts: "pending" }
        : status === "restricted"
          ? { bank_transfer: "restricted", ngn_card_collection: "restricted", payouts: "restricted" }
          : {};
  const requirements_due =
    status === "ready"
      ? []
      : status === "in_progress"
        ? ["Upload your ID"]
        : status === "restricted"
          ? ["Bachs needs more details about you. Open your dashboard to see what."]
          : ["Upload your ID", "Add your bank account"];
  const collects = capabilities.bank_transfer === "active" || capabilities.ngn_card_collection === "active";
  return { status, capabilities, requirements_due, can_sell: collects && capabilities.payouts === "active", dashboard_url: DASHBOARD };
}

export const canSell = (userId: string): boolean => payoutFor(userId).can_sell;

/** Change a host's setup (the fake onboarding page and the dev panel). The caller emits. */
export function setPayoutStatus(userId: string, status: HostPayoutStatus): void {
  const rec: PayoutRec = S().payouts[userId] ?? { id: userId, status, balance_naira: 0 };
  rec.status = status;
  S().payouts[userId] = rec;
}
