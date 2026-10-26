import { koboToString, stringToKobo } from "./amounts";
import { createPayout, createTransfer, getAvailableNairaKobo, listPayoutDestinations } from "./api";
import { BachsError, type ClientDeps } from "./client";
import type { DueWithdrawal, PayDb } from "./db";

/**
 * Host withdrawals (supabase/events_r1_payouts.sql). The sweeper calls runDuePayouts every run. For each due withdrawal:
 *   requested    POST /v1/transfers: its amount from Hoppaz's available balance to the host's Bachs account (idempotent on the reference).
 *                INSUFFICIENT_BALANCE means Hoppaz's payments have not settled yet (a day or two in live): it stays requested, tried again.
 *   transferred  POST /v1/payouts as the host: everything the host's Bachs account holds, less Bachs's withdrawal fee (added on top by
 *                Bachs, N50 in the sandbox), to their default usable bank. A different fee shows in the refusal ("... 50.00 short"): the
 *                amount is lowered by that once. payout.paid / payout.failed (webhook) settle it; a failed one comes back as transferred.
 * Nothing here decides who gets what: the database worked out the amount when the host asked.
 */

const FEE_GUESS_KOBO = () => {
  const n = Number(process.env.BACHS_PAYOUT_FEE_NAIRA ?? "50");
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 5000;
};

/** "Insufficient NGN balance: 9550.00 available, 9600.00 needed (amount 9550.00 + fee 50.00), 50.00 short" -> 5000 kobo. */
export function shortBy(message: string): number | null {
  const m = /([\d,]+(?:\.\d{1,2})?)\s+short/i.exec(message);
  if (!m) return null;
  try {
    return stringToKobo(m[1].replace(/,/g, ""));
  } catch {
    return null;
  }
}

async function transfer(db: PayDb, w: DueWithdrawal, bachs: ClientDeps, log: (line: string) => void): Promise<boolean> {
  try {
    const t = await createTransfer(
      { account: w.account, amountKobo: w.amount_kobo, group: w.reference, idempotencyKey: `${w.reference}:transfer`, description: "Hoppaz payout", metadata: { withdrawal: w.reference } },
      bachs
    );
    await db.payoutTransferred(w.id, t.id);
    return true;
  } catch (e) {
    const why = e instanceof BachsError && e.kind === "insufficient_balance" ? "waiting for Hoppaz's payments to settle" : (e as Error).message;
    log(`[payouts] transfer ${w.reference} not sent: ${why}`);
    await db.payoutNote(w.id, `transfer: ${why}`);
    return false;
  }
}

async function payout(db: PayDb, w: DueWithdrawal, bachs: ClientDeps, log: (line: string) => void): Promise<void> {
  const note = async (why: string) => {
    log(`[payouts] payout ${w.reference} not sent: ${why}`);
    await db.payoutNote(w.id, `payout: ${why}`);
  };
  try {
    const banks = (await listPayoutDestinations(w.account, bachs)).filter((d) => d.currency === "NGN" && d.is_usable);
    const bank = banks.find((d) => d.is_default) ?? banks[0];
    if (!bank) return note("no usable bank on the host's account");
    const held = await getAvailableNairaKobo(w.account, bachs);
    let amount = held - FEE_GUESS_KOBO();
    if (amount <= 0) return note(`nothing to pay out (holds ${koboToString(held)})`);
    const reference = `${w.reference}_${w.payout_tries + 1}`;
    for (let attempt = 0; ; attempt++) {
      try {
        const p = await createPayout({ accountId: w.account, destination: bank.id, amountKobo: amount, reference: attempt ? `${reference}b` : reference, narration: "Hoppaz payout" }, bachs);
        const fee = p.fee ? stringToKobo(p.fee) : null;
        await db.payoutPaying(w.id, p.id, amount, fee);
        if (["completed", "paid", "succeeded"].includes(String(p.status).toLowerCase())) await db.payoutResult(p.id, "paid", null);
        return;
      } catch (e) {
        const short = e instanceof BachsError && e.kind === "insufficient_balance" ? shortBy(e.message) : null;
        if (attempt === 0 && short && short > 0 && amount - short > 0) {
          amount -= short;
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    await note((e as Error).message);
  }
}

/** Move every due withdrawal one or two steps on. Returns what happened, for the sweep's log. */
export async function runDuePayouts(db: PayDb, bachs: ClientDeps = {}, log: (line: string) => void = console.warn): Promise<{ transferred: number; payouts: number; seen: number }> {
  const due = await db.payoutsDue(20);
  let transferred = 0;
  let payouts = 0;
  for (const w of due) {
    let state = w.status;
    if (state === "requested") {
      if (!(await transfer(db, w, bachs, log))) continue;
      transferred++;
      state = "transferred";
    }
    if (state === "transferred") {
      await payout(db, w, bachs, log);
      payouts++;
    }
  }
  return { transferred, payouts, seen: due.length };
}
