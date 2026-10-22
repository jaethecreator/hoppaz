/**
 * Kobo (whole numbers, what the database holds) to and from Bachs's decimal strings ("5000.00", major units).
 * Conversion happens only at the Bachs edge. Never use floats for money: everything here is integer or string work.
 */

/** 500000 -> "5000.00". Whole kobo only, never negative. */
export function koboToString(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new Error(`Not a kobo amount: ${kobo}`);
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return `${naira}.${rest.toString().padStart(2, "0")}`;
}

/** "5000.00" -> 500000. Accepts "5000", "5000.5" and "5000.50"; refuses more than 2 decimals, signs, commas, exponents. */
export function stringToKobo(value: string): number {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Not a naira amount: ${value}`);
  const kobo = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(kobo)) throw new Error(`Amount too large: ${value}`);
  return kobo;
}

export const nairaToKobo = (naira: number): number => {
  const kobo = Math.round(naira * 100);
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new Error(`Not a naira amount: ${naira}`);
  return kobo;
};

export const koboToNaira = (kobo: number): number => kobo / 100;
