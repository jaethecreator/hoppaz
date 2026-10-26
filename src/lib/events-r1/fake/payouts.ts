/**
 * The fake host payout setup: what Bachs would say about a host (Not started, In progress, Ready, Restricted) and the
 * host's balance. Kept apart from pay.ts so events.ts can ask "can this host sell?" without a loop of imports.
 * Hoppaz collects (26 Oct): every host can sell; the setup (name, date of birth, address, bank) is only for withdrawing.
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
      ? { transfers: "active", payouts: "active" }
      : status === "in_progress"
        ? { transfers: "restricted", payouts: "restricted" }
        : status === "restricted"
          ? { transfers: "restricted", payouts: "restricted" }
          : {};
  const requirements_due =
    status === "ready"
      ? []
      : status === "restricted"
        ? ["The bank account for your payouts"]
        : ["Your name, date of birth and address", "The bank account for your payouts"];
  return { status, capabilities, requirements_due, can_sell: capabilities.transfers === "active" && capabilities.payouts === "active", dashboard_url: DASHBOARD };
}

/** Selling never waits for payout setup (Hoppaz collects). Kept as a function so the checks still read the same. */
export const canSell = (userId: string): boolean => !!userId;

/** Change a host's setup (the fake onboarding page and the dev panel). The caller emits. */
export function setPayoutStatus(userId: string, status: HostPayoutStatus): void {
  const rec: PayoutRec = S().payouts[userId] ?? { id: userId, status, balance_naira: 0 };
  rec.status = status;
  S().payouts[userId] = rec;
}
