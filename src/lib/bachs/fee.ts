import { nairaToKobo } from "./amounts";

/**
 * Hoppaz's platform fee on one checkout, in kobo. Bachs wants an AMOUNT (never a percentage) that is above 0 and below the
 * gross, rounded half up. The buyer sees one price: the fee is part of the gross, not added on top.
 *
 *   fee = round_half_up(gross * percent / 100) + fixed naira
 *
 * percent comes from HOPPAZ_TICKET_FEE_PERCENT (for example 4.5) and fixed from HOPPAZ_TICKET_FEE_FIXED_NAIRA (for example 100).
 * Both are "SET BY JAE" in .env.example: there is no default, so a missing or bad value throws instead of selling at a made up rate.
 * Free orders never reach here (no checkout is created for a free ticket).
 */

export type FeeConfig = { percent: string; fixedNaira: string };

export function feeConfigFromEnv(env: Record<string, string | undefined> = process.env): FeeConfig {
  const percent = (env.HOPPAZ_TICKET_FEE_PERCENT ?? "").trim();
  const fixedNaira = (env.HOPPAZ_TICKET_FEE_FIXED_NAIRA ?? "").trim();
  if (!percent && !fixedNaira) throw new Error("Ticket fee is not set (HOPPAZ_TICKET_FEE_PERCENT / HOPPAZ_TICKET_FEE_FIXED_NAIRA)");
  return { percent: percent || "0", fixedNaira: fixedNaira || "0" };
}

/** "4.5" -> 45000n (percent scaled by 10^4). Up to 4 decimals, 0 to 100. */
function parsePercent(value: string): bigint {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(value);
  if (!m) throw new Error(`HOPPAZ_TICKET_FEE_PERCENT is not a percentage: ${value}`);
  const scaled = BigInt(m[1]) * 10000n + BigInt((m[2] ?? "").padEnd(4, "0") || "0");
  if (scaled > 1_000_000n) throw new Error(`HOPPAZ_TICKET_FEE_PERCENT is over 100: ${value}`);
  return scaled;
}

function parseFixedKobo(value: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new Error(`HOPPAZ_TICKET_FEE_FIXED_NAIRA is not an amount: ${value}`);
  return nairaToKobo(Number(`${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`));
}

/** The fee for one checkout of `grossKobo`, clamped so that 0 < fee < gross. Throws when no fee could apply or none is set. */
export function computeFee(grossKobo: number, config: FeeConfig = feeConfigFromEnv()): number {
  if (!Number.isSafeInteger(grossKobo) || grossKobo < 2) throw new Error(`Gross too small for a platform fee: ${grossKobo}`);
  const pct = parsePercent(config.percent);
  const fixed = parseFixedKobo(config.fixedNaira);
  // gross * percent / 100, half up: (gross * pct4 / 10^6) rounded, where pct4 is percent * 10^4.
  const percentPart = (BigInt(grossKobo) * pct + 500_000n) / 1_000_000n;
  let fee = Number(percentPart) + fixed;
  if (fee <= 0) throw new Error("Ticket fee comes to nothing: set HOPPAZ_TICKET_FEE_PERCENT or HOPPAZ_TICKET_FEE_FIXED_NAIRA");
  if (fee >= grossKobo) fee = grossKobo - 1;
  return fee;
}
