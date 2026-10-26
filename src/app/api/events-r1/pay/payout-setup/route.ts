import { createHash } from "node:crypto";
import { createRecipientAccount, getAccount, getCapabilities, resolveBankAccount, submitHostDetails, type HostDetails } from "@/lib/bachs/api";
import { bankList } from "@/lib/bachs/banks";
import { BachsError, bachsConfig } from "@/lib/bachs/client";
import type { PayDb } from "@/lib/bachs/db";
import { fail, isResponse, json, limiter, sameOrigin, sessionOf } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(6);

/**
 * A host's payout account, set up inside Hoppaz (never Bachs's long hosted form). Hoppaz collects every payment, so a host is only a
 * recipient: Bachs needs their name, date of birth, address and a bank account that resolves, and nothing else (no ID, no BVN). Tested in
 * the sandbox on 26 Oct: one call and the account can receive transfers and pay out, the bank approved on the spot.
 *
 *   POST { firstName, lastName, dob: "YYYY-MM-DD", line1, city, state, bankCode, accountNumber } with a bearer session
 *     -> { ready, bank_label, account_name }
 * The bank account is checked first (the name on it comes back); then the host's Bachs account is made (once, idempotent per person) and
 * filled; then its capabilities are read back so the money screen is right at once (the webhooks say the same later).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  if (!bachsConfig()) return fail(503, "Payouts are not set up yet.", { reason: "not_configured" });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (k: string, max: number) => (typeof b?.[k] === "string" ? (b[k] as string).trim().replace(/\s+/g, " ").slice(0, max) : "");
  const firstName = text("firstName", 50);
  const lastName = text("lastName", 50);
  const dob = text("dob", 10);
  const line1 = text("line1", 120);
  const city = text("city", 60);
  const state = text("state", 60);
  const bankCode = text("bankCode", 6);
  const accountNumber = text("accountNumber", 10);
  if (!firstName || !lastName) return fail(400, "Add your first and last name, as on your bank account.", { reason: "bad_name" });
  if (!adult(dob)) return fail(400, "Add your date of birth. You need to be 18 or over to get paid.", { reason: "bad_dob" });
  if (!line1 || !city || !state) return fail(400, "Add your address: street, city and state.", { reason: "bad_address" });
  if (!/^\d{3,6}$/.test(bankCode) || !/^\d{10}$/.test(accountNumber)) return fail(400, "Pick your bank and enter the 10 digit account number.", { reason: "bad_bank" });

  try {
    const resolved = await resolveBankAccount(bankCode, accountNumber).catch((e) => {
      if (e instanceof BachsError && (e.kind === "invalid" || e.kind === "not_found")) return { resolved: false, account_name: undefined };
      throw e;
    });
    if (!resolved.resolved || !resolved.account_name) return fail(400, "We couldn't find that account. Check the number and the bank.", { reason: "bank_not_found" });
    const accountName = resolved.account_name;

    const account = await ensureAccount(session.db, session.userId, session.email, `${firstName} ${lastName}`, firstName, lastName);
    if (!account) return fail(409, "This host already has a different payout account. Contact Hoppaz.", { reason: "account_conflict" });

    const details: HostDetails = { firstName, lastName, dob, address: { line1, city, state }, bank: { code: bankCode, accountNumber, accountName } };
    // Same details twice is the same call (a double tap or a retry after a timeout); changed details are a new one.
    const key = `host:${session.userId}:details:${createHash("sha256").update(JSON.stringify(details)).digest("hex").slice(0, 24)}`;
    await submitHostDetails(account, details, key);

    const now = new Date().toISOString();
    const caps = await getCapabilities(account);
    for (const [name, status] of Object.entries(caps)) await session.db.hostApplyCapability(account, name, status, now);
    const acct = await getAccount(account).catch(() => null);
    const due = acct?.requirements?.currently_due;
    if (Array.isArray(due)) await session.db.hostApplyRequirements(account, due.filter((x): x is string => typeof x === "string"));

    const bankName = (await bankList().catch(() => [])).find((x) => x.code === bankCode)?.name ?? "Bank";
    const label = `${bankName} ending ${accountNumber.slice(-4)}`;
    await session.db.hostSetBankLabel(session.userId, label);
    return json({ ready: caps.transfers === "active" && caps.payouts === "active", bank_label: label, account_name: accountName });
  } catch (e) {
    return bachsFailure(e);
  }
}

/** A real date (YYYY-MM-DD) at least 18 years ago and after 1900. */
function adult(dob: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1900) return false;
  const eighteen = new Date();
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() - 18);
  return d <= eighteen;
}

/** The host's Bachs account: the one we hold, or a new recipient account (idempotent per person, so a retry does not make a second). */
async function ensureAccount(db: PayDb, userId: string, email: string, name: string, firstName: string, lastName: string): Promise<string | null> {
  const existing = await db.hostAccountOf(userId);
  if (existing) return existing;
  const created = await createRecipientAccount({ email, displayName: name, firstName, lastName, idempotencyKey: `host:${userId}:recipient1` });
  const saved = await db.hostSaveAccount(userId, created.id);
  return saved === "ok" ? created.id : null;
}

/** Bachs field errors in words the host can act on. */
function bachsFailure(e: unknown) {
  if (e instanceof BachsError) {
    if (e.kind === "unavailable" || e.kind === "rate_limited") return fail(503, "Bachs is slow right now. Try again in a minute.", { reason: "bachs_unavailable" });
    // 403 on create: Hoppaz's own Connect is not switched on yet.
    if (e.kind === "auth") return fail(503, "Payouts are not open yet.", { reason: "connect_not_enabled" });
    if (e.kind === "invalid" && Array.isArray(e.fieldErrors)) {
      const fields = (e.fieldErrors as { field?: string }[]).map((f) => String(f.field ?? ""));
      const has = (re: RegExp) => fields.some((f) => re.test(f));
      const say = has(/dob/) ? "Check your date of birth." : has(/address/) ? "Check your address." : has(/payout_destination|bank|account_number/) ? "Check your bank details." : has(/name/) ? "Check your name." : "Check your details.";
      console.warn(`[bachs] payout setup refused: ${fields.join(", ")}`);
      return fail(400, say, { reason: "details_refused", fields });
    }
  }
  console.error(`[bachs] payout setup failed: ${(e as Error).message}`);
  return fail(502, "Could not save your payout details. Try again.", { reason: "bachs_failed" });
}
