import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapKind, CapStatus, Channel, ClaimedRow, EnqueueArgs, RowOutcome, WaBudget } from "./types";

/**
 * The SQL side (supabase/events_r1_notify.sql) behind one interface, so the run loop and the router can be checked with a stub and the
 * route uses the real thing. Every method throws on a database error; a "no" from a function comes back as data.
 */
export interface NotifyDb {
  /** The new row's id, or null for a duplicate or a channel that is switched off. */
  enqueue(args: EnqueueArgs): Promise<string | null>;
  /**
   * Due rows, each handed out once. `providers` are the email providers this run can really use, so the allowance counts only those.
   * `channels` are the channels it can send on (undefined: both); rows of the others stay queued, untouched.
   */
  claim(limit: number, providers: string[], channels?: Channel[]): Promise<ClaimedRow[]>;
  takeCap(provider: string, kind: CapKind): Promise<boolean>;
  giveCap(provider: string, kind: CapKind): Promise<void>;
  /** Writes the attempts to notify_sends and settles (or puts back) the claimed row. false: it was not claimed any more. */
  complete(id: string, outcome: RowOutcome): Promise<boolean>;
  capStatus(): Promise<CapStatus[]>;
  /** Just before a WhatsApp template goes out: the guest's number if they are still on and paid, null if a STOP or a refund came in meanwhile. */
  waRecheck(id: string): Promise<string | null>;
  /** The month's WhatsApp budget, or null if the function is not there (the WhatsApp SQL has not been run). */
  waBudget(): Promise<WaBudget | null>;
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
    async claim(limit, providers, channels) {
      return (await call<ClaimedRow[] | null>(sb, "notify_claim_due", { p_limit: limit, p_providers: providers, p_channels: channels ?? null })) ?? [];
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
    async waRecheck(id) {
      return (await call<string | null>(sb, "notify_wa_recheck", { p_queue: id })) ?? null;
    },
    async waBudget() {
      return (await call<WaBudget | null>(sb, "notify_wa_budget", {})) ?? null;
    },
  };
}
