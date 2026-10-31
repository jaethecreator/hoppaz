import type { NotifyDb } from "./db";
import type { EmailProvider } from "./provider";
import { newRouterState, routeRow, type CapStore } from "./router";
import type { CapStatus, ClaimedRow, RowOutcome } from "./types";

/**
 * One run of the sender (what /api/notify/run does): claim due rows, route each one, write what happened. Kept out of the route file so
 * scripts/notify-check.mts can run it with a stub database and fake providers.
 */

export type RunDeps = {
  db: NotifyDb;
  providers: readonly EmailProvider[];
  /** At most 500, the most the database hands out in one claim. */
  limit?: number;
  /** Rows worked on at once. */
  concurrency?: number;
  /** Stop starting new rows after this many milliseconds, and put the rest back. The route has 60 seconds. */
  budgetMs?: number;
  now?: () => Date;
  clock?: () => number;
  log?: (line: string) => void;
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

export async function runNotify(deps: RunDeps): Promise<RunSummary> {
  const { db, providers } = deps;
  const limit = Math.min(Math.max(deps.limit ?? 500, 1), 500);
  const concurrency = Math.max(deps.concurrency ?? 20, 1);
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const stopAt = clock() + (deps.budgetMs ?? 40_000);

  const out: RunSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0, requeued: 0, stuck: 0, warnings: [] };
  const rows = await db.claim(limit, providers.map((p) => p.name));
  out.claimed = rows.length;
  if (rows.length) {
    const caps: CapStore = { take: (p, k) => db.takeCap(p, k), give: (p, k) => db.giveCap(p, k) };
    const state = newRouterState();

    const settle = async (row: ClaimedRow, outcome: RowOutcome) => {
      if (!(await db.complete(row.id, outcome))) log(`[hoppaz] notify: row ${row.id} was not claimed any more when it was settled`);
      if (outcome.final === "queued") out.requeued++;
      else out[outcome.final]++;
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
          try {
            await settle(row, await routeRow(row, providers, caps, state, now));
          } catch (e) {
            log(`[hoppaz] notify: row ${row.id} failed: ${(e as Error).message}`);
            await putBack(row, 5, false);
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
  return out;
}
