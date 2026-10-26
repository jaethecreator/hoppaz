import { resolveBankAccount } from "@/lib/bachs/api";
import { bankList } from "@/lib/bachs/banks";
import { BachsError, bachsConfig } from "@/lib/bachs/client";
import { fail, isResponse, json, limiter, sameOrigin, sessionOf } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(20);

/**
 * The host's payout form (PayoutSetupSheet).
 *   GET                                   -> { banks: [{ name, code }] }
 *   POST { bankCode, accountNumber }      -> { account_name }  the name the bank has on that account, so the host sees it is theirs
 * Both need a signed-in person with an account.
 */
export async function GET(req: Request) {
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (!bachsConfig()) return fail(503, "Payouts are not set up yet.", { reason: "not_configured" });
  try {
    return json({ banks: await bankList() });
  } catch (e) {
    console.error(`[bachs] bank list failed: ${(e as Error).message}`);
    return fail(503, "Could not load the banks. Try again.", { reason: "bachs_unavailable" });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  if (!bachsConfig()) return fail(503, "Payouts are not set up yet.", { reason: "not_configured" });
  const body = (await req.json().catch(() => null)) as { bankCode?: unknown; accountNumber?: unknown } | null;
  const bankCode = typeof body?.bankCode === "string" && /^\d{3,6}$/.test(body.bankCode) ? body.bankCode : null;
  const accountNumber = typeof body?.accountNumber === "string" && /^\d{10}$/.test(body.accountNumber) ? body.accountNumber : null;
  if (!bankCode || !accountNumber) return fail(400, "Pick your bank and enter the 10 digit account number.", { reason: "bad_input" });
  try {
    const r = await resolveBankAccount(bankCode, accountNumber);
    if (!r.resolved || !r.account_name) return fail(404, "We couldn't find that account. Check the number and the bank.", { reason: "not_found" });
    return json({ account_name: r.account_name });
  } catch (e) {
    if (e instanceof BachsError && (e.kind === "invalid" || e.kind === "not_found")) return fail(404, "We couldn't find that account. Check the number and the bank.", { reason: "not_found" });
    console.error(`[bachs] account check failed: ${(e as Error).message}`);
    return fail(503, "The bank check is slow right now. Try again.", { reason: "bachs_unavailable" });
  }
}
