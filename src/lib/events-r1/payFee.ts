/**
 * Fake fees for paid tickets, whole naira, half up. The real server works in kobo (src/lib/bachs/fee.ts and the Bachs fee table);
 * this keeps the same shape so the fake and the real numbers look alike.
 *
 * The Hoppaz percent and fixed amount are PLACEHOLDERS until Jae sets the real fee (HOPPAZ_TICKET_FEE_PERCENT and
 * HOPPAZ_TICKET_FEE_FIXED_NAIRA on the server). Bachs's own fees are from the live fee table: bank transfer 1.5 percent capped
 * at 2,000, Nigerian cards 2 percent.
 */
import type { PayMethod } from "./pay";

export const PLACEHOLDER_FEE_PERCENT = 4.5;
export const PLACEHOLDER_FEE_FIXED_NAIRA = 0;

/** gross x percent / 100, half up, in whole naira. percent has up to 4 decimals. */
function percentOf(gross: number, percent: number): number {
  const scaled = Math.round(percent * 10_000);
  return Math.floor((gross * scaled + 500_000) / 1_000_000);
}

/** What Hoppaz keeps from one checkout. Above 0 and below the gross, like Bachs wants. The buyer never sees it: it is inside the price. */
export function platformFeeNaira(
  grossNaira: number,
  percent: number = PLACEHOLDER_FEE_PERCENT,
  fixedNaira: number = PLACEHOLDER_FEE_FIXED_NAIRA
): number {
  if (!Number.isInteger(grossNaira) || grossNaira < 2) throw new Error("Price too small for a fee");
  const fee = percentOf(grossNaira, percent) + fixedNaira;
  return Math.min(Math.max(fee, 1), grossNaira - 1);
}

/** What Bachs takes for processing: bank transfer 1.5 percent capped at 2,000, card 2 percent. */
export function processingFeeNaira(grossNaira: number, method: PayMethod): number {
  return method === "bank_transfer" ? Math.min(percentOf(grossNaira, 1.5), 2000) : percentOf(grossNaira, 2);
}
