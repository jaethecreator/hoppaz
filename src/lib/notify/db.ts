import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapKind, CapStatus, ClaimedRow, EnqueueArgs, RowOutcome } from "./types";

/**
 * The SQL side (supabase/events_r1_notify.sql) behind one interface, so the run loop and the router can be checked with a stub and the
 * route uses the real thing. Every method throws on a database error; a "no" from a function comes back as data.
 */
export interface NotifyDb {
  /** The new row's id, or null for a duplicate or a channel that is switched off. */
  enqueue(args: EnqueueArgs): Promise<string | null>;
  /** Due rows, each handed out once. `providers` are the ones this run can really use, so the allowance counts only those. */
  claim(limit: number, providers: string[]): Promise<ClaimedRow[]>;
  takeCap(provider: string, kind: CapKind): Promise<boolean>;
  giveCap(provider: string, kind: CapKind): Promise<void>;
  /** Writes the attempts to notify_sends and settles (or puts back) the claimed row. false: it was not claimed any more. */
  complete(id: string, outcome: RowOutcome): Promise<boolean>;
  capStatus(): Promise<CapStatus[]>;
}

async function call<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export function supabaseNotifyDb(sb: SupabaseClient): NotifyDb {
  return {
    async enqueue(args) {
      return (await call<string | null>(sb, "notify_enqueue", args)) ?? null;
    },
    async claim(limit, providers) {
      return (await call<ClaimedRow[] | null>(sb, "notify_claim_due", { p_limit: limit, p_providers: providers })) ?? [];
    },
    async takeCap(provider, kind) {
      return (await call<boolean>(sb, "notify_take_cap", { p_provider: provider, p_kind: kind })) === true;
    },
    async giveCap(provider, kind) {
      await call<null>(sb, "notify_give_cap", { p_provider: provider, p_kind: kind });
    },
    async complete(id, outcome) {
      const queued = outcome.final === "queued";
      return (
        (await call<boolean>(sb, "notify_complete", {
          p_queue: id,
          p_final: outcome.final,
          p_attempts: outcome.attempts,
          p_retry_at: queued ? outcome.retryAt : null,
          p_free_retry: queued ? outcome.freeRetry : false,
        })) === true
      );
    },
    async capStatus() {
      return (await call<CapStatus[] | null>(sb, "notify_cap_status", {})) ?? [];
    },
  };
}
