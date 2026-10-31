import type { NotifyDb } from "./db";
import type { EmailProvider } from "./provider";
import { newRouterState, routeRow, type CapStore, type Renderer, type WaRoute } from "./router";
import type { CapStatus, Channel, ClaimedRow, RowOutcome, WaBudget } from "./types";
import type { WhatsAppSender } from "./whatsapp";

const SETTLE_TRIES = 3;

/**
 * One run of the sender (what /api/notify/run does): claim due rows, route each one, write what happened. Kept out of the route file so
 * scripts/notify-check.mts can run it with a stub database and fake providers.
 */

export type RunDeps = {
  db: NotifyDb;
  providers: readonly EmailProvider[];
  /** The WhatsApp sender, or none. Without one, WhatsApp rows are not claimed at all and stay queued; without email providers, email rows are not. */
  whatsapp?: WhatsAppSender | null;
  /** At most 500, the most the database hands out in one claim. */
  limit?: number;
  /** Rows worked on at once. */
  concurrency?: number;
  /** Stop starting new rows after this many milliseconds, and put the rest back. The route has 60 seconds. */
  budgetMs?: number;
  now?: () => Date;
  clock?: () => number;
  /** Waits between tries to record a send. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Turns a row into the email. Default: the templates. Tests pass a stub. */
  render?: Renderer;
};

export type RunSummary = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Put back for later: every provider full, a provider error, or no time left. */
  requeued: number;
  /** Rows that could not even be settled; the database hands them out again after 10 minutes. */
  stuck: number;
  warnings: string[];
};

/** A line for each cap that has used 80 percent of its day, the signal to pay for a step up or switch on SES. */
export function capWarnings(status: readonly CapStatus[], threshold = 80): string[] {
  return status
    .filter((s) => s.percent !== null && s.percent >= threshold)
    .map((s) => `${s.provider} ${s.kind} mail has used ${s.used} of ${s.daily_cap} today (${s.percent}%)`);
}

/** A line when the month's WhatsApp spend (counting what is not priced yet) has reached `threshold` percent of the budget, matching capWarnings. */
export function waBudgetWarning(b: WaBudget | null, threshold = 80): string | null {
  if (!b || b.percent < threshold) return null;
  const money = (n: number) => `$${n.toFixed(2)}`;
  const base = `WhatsApp has used ${money(b.projected_usd)} of the ${money(b.budget_usd)} monthly budget (${b.percent}%)`;
  return b.room <= 0 ? `${base}; the budget is reached, WhatsApp rows are being skipped until next month or a higher whatsapp_monthly_budget_usd` : base;
}

export async function runNotify(deps: RunDeps): Promise<RunSummary> {
  const { db, providers } = deps;
  const limit = Math.min(Math.max(deps.limit ?? 500, 1), 500);
  const concurrency = Math.max(deps.concurrency ?? 20, 1);
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stopAt = clock() + (deps.budgetMs ?? 40_000);

  const out: RunSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0, requeued: 0, stuck: 0, warnings: [] };
  const channels: Channel[] = [...(providers.length ? (["email"] as const) : []), ...(deps.whatsapp ? (["whatsapp"] as const) : [])];
  const wa: WaRoute | null = deps.whatsapp ? { sender: deps.whatsapp, recheck: (row) => db.waRecheck(row.id) } : null;
  const rows = channels.length ? await db.claim(limit, providers.map((p) => p.name), channels) : [];
  out.claimed = rows.length;
  if (rows.length) {
    const caps: CapStore = { take: (p, k) => db.takeCap(p, k), give: (p, k) => db.giveCap(p, k) };
    const state = newRouterState();

    const count = (outcome: RowOutcome) => {
      if (outcome.final === "queued") out.requeued++;
      else out[outcome.final]++;
    };
    const settle = async (row: ClaimedRow, outcome: RowOutcome) => {
      if (!(await db.complete(row.id, outcome))) log(`[hoppaz] notify: row ${row.id} was not claimed any more when it was settled`);
      count(outcome);
    };
    // A provider has accepted the message, so the row must never go back to the queue: that would send it a second time. Recording the
    // outcome is retried a few times; if it still fails the row stays 'claimed' and the database hands it out again after 10 minutes.
    // KNOWN GAP: that reclaim (and a crash between the send and the settle) can send the same message twice. Real providers are given
    // the row's dedupeKey so they can use it as an idempotency key.
    const settleSent = async (row: ClaimedRow, outcome: RowOutcome) => {
      for (let attempt = 1; attempt <= SETTLE_TRIES; attempt++) {
        try {
          await settle(row, outcome);
          return;
        } catch (e) {
          log(`[hoppaz] notify: row ${row.id} was sent but recording it failed (try ${attempt} of ${SETTLE_TRIES}): ${(e as Error).message}`);
          if (attempt < SETTLE_TRIES) await sleep(attempt * 300);
        }
      }
      out.stuck++;
      log(`[hoppaz] notify: SENT BUT NOT RECORDED: row ${row.id} (${row.dedupe_key}) went out and stays claimed; it may be sent again after 10 minutes`);
    };
    // Put a row back untouched (no time left, or the work on it blew up). If even that fails the database reclaims it after 10 minutes.
    const putBack = async (row: ClaimedRow, minutes: number, freeRetry: boolean) => {
      try {
        await settle(row, { final: "queued", attempts: [], retryAt: new Date(now().getTime() + minutes * 60_000).toISOString(), freeRetry });
      } catch (e) {
        out.stuck++;
        log(`[hoppaz] notify: could not put row ${row.id} back: ${(e as Error).message}`);
      }
    };

    for (let i = 0; i < rows.length; i += concurrency) {
      if (clock() > stopAt) {
        log(`[hoppaz] notify: out of time, putting back ${rows.length - i} rows`);
        await Promise.all(rows.slice(i).map((row) => putBack(row, 0, true)));
        break;
      }
      await Promise.all(
        rows.slice(i, i + concurrency).map(async (row) => {
          let outcome: RowOutcome;
          try {
            outcome = await routeRow(row, providers, caps, state, now, deps.render, wa);
          } catch (e) {
            // Routing blew up (the database, usually). A provider that had accepted the message would have returned an outcome, so nothing went out.
            log(`[hoppaz] notify: row ${row.id} failed: ${(e as Error).message}`);
            await putBack(row, 5, false);
            return;
          }
          if (outcome.attempts.some((a) => a.status === "sent")) {
            await settleSent(row, outcome);
            return;
          }
          try {
            await settle(row, outcome);
          } catch (e) {
            // Nothing went out, so the row can wait: the database hands it out again after 10 minutes.
            out.stuck++;
            log(`[hoppaz] notify: row ${row.id} could not be settled: ${(e as Error).message}`);
          }
        }),
      );
    }
  }
  try {
    out.warnings = capWarnings(await db.capStatus());
    for (const w of out.warnings) log(`[hoppaz] notify: ${w}`);
  } catch (e) {
    log(`[hoppaz] notify: could not read the caps: ${(e as Error).message}`);
  }
  if (deps.whatsapp) {
    try {
      const w = waBudgetWarning(await db.waBudget());
      if (w) {
        out.warnings.push(w);
        log(`[hoppaz] notify: ${w}`);
      }
    } catch (e) {
      log(`[hoppaz] notify: could not read the WhatsApp budget: ${(e as Error).message}`);
    }
  }
  return out;
}
