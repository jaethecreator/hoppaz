import { listBanks } from "./api";

let cached: { at: number; banks: { name: string; code: string }[] } | null = null;
const SIX_HOURS = 6 * 3.6e6;

/** Nigerian banks, sorted by name. Kept for six hours (the list changes rarely). */
export async function bankList(): Promise<{ name: string; code: string }[]> {
  if (cached && Date.now() - cached.at < SIX_HOURS) return cached.banks;
  const banks = (await listBanks()).sort((a, b) => a.name.localeCompare(b.name));
  cached = { at: Date.now(), banks };
  return banks;
}
