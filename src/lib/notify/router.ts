import type { EmailProvider } from "./provider";
import { renderEmail, type RenderedEmail } from "./templates";
import { MAX_TRIES, type Attempt, type CapKind, type ClaimedRow, type RowOutcome } from "./types";

/**
 * Picks the provider for a claimed row. Pure apart from the calls it is given, so scripts/notify-check.mts runs it with fakes.
 *
 * Email: the providers are tried in the order given, skipping any that does not serve the row's cap_kind. For each one the day's
 * allowance is taken first (atomic in the database); a full cap moves on to the next provider. A provider error moves on too and
 * hands the unit back. A provider that says its own limit is reached is left alone for the rest of the run. If every provider was
 * full, the row waits (and the wait is not counted as a try); if they failed, it is retried later, and after MAX_TRIES it is failed.
 * WhatsApp has no sender yet: those rows are skipped with a clear reason.
 *
 * Before any provider is asked (and before an allowance unit is taken) the row is rendered from its kind and payload (templates/). A kind with
 * no template, or a render that throws, fails the row with the reason and sends nothing: an email is never sent blank.
 */

export interface CapStore {
  /** true when one unit of the provider's allowance for today was taken. */
  take(provider: string, kind: CapKind): Promise<boolean>;
  give(provider: string, kind: CapKind): Promise<void>;
}

/** Shared by all the rows of one run. */
export type RouterState = { exhausted: Set<string> };
export const newRouterState = (): RouterState => ({ exhausted: new Set() });

/** Minutes to wait before try number `tries + 1`: 5, 10, 20, 40, then an hour. */
export function retryDelayMinutes(tries: number): number {
  const t = Math.max(1, Math.floor(tries));
  return Math.min(5 * 2 ** (t - 1), 60);
}

/** How long a row waits when every provider's cap is full. */
export const FULL_CAP_WAIT_MINUTES = 15;

export const WHATSAPP_NOT_BUILT = "WhatsApp sender is not built yet";

const plusMinutes = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000).toISOString();

const note = (row: ClaimedRow, provider: string, status: Attempt["status"], error: string): Attempt => ({
  channel: row.channel,
  provider,
  status,
  message_id: null,
  cost_usd: 0,
  error,
});

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function skipWhatsApp(row: ClaimedRow): RowOutcome {
  return { final: "skipped", attempts: [note(row, "none", "skipped", WHATSAPP_NOT_BUILT)] };
}

/** Turns a claimed row into the email to send. Throws when it cannot (no template for the kind). */
export type Renderer = (row: ClaimedRow) => RenderedEmail;

export const renderRow: Renderer = (row) => renderEmail(row.kind, row.payload, { userId: row.user_id, queueId: row.id, to: row.email });

export async function routeEmail(
  row: ClaimedRow,
  providers: readonly EmailProvider[],
  caps: CapStore,
  state: RouterState = newRouterState(),
  now: () => Date = () => new Date(),
  render: Renderer = renderRow,
): Promise<RowOutcome> {
  if (!row.email) return { final: "skipped", attempts: [note(row, "router", "skipped", "no email address")] };
  let mail: RenderedEmail;
  try {
    mail = render(row);
    if (!mail.subject?.trim() || !mail.html?.trim() || !mail.text?.trim()) throw new Error("the template gave an empty email");
  } catch (e) {
    return { final: "failed", attempts: [note(row, "router", "failed", `not sent: ${messageOf(e)}`)] };
  }
  const candidates = providers.filter((p) => p.kinds.includes(row.cap_kind));
  if (!candidates.length) return { final: "failed", attempts: [note(row, "router", "failed", `no provider for ${row.cap_kind} mail`)] };

  const attempts: Attempt[] = [];
  let errored = 0;
  for (const p of candidates) {
    if (state.exhausted.has(p.name)) continue;
    if (!(await caps.take(p.name, row.cap_kind))) continue;
    let res;
    try {
      res = await p.send({
        to: row.email,
        kind: row.kind,
        payload: row.payload,
        queueId: row.id,
        dedupeKey: row.dedupe_key,
        priority: row.priority,
        capKind: row.cap_kind,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: mail.headers,
      });
    } catch (e) {
      res = { ok: false as const, error: messageOf(e) };
    }
    if (res.ok) {
      attempts.push({ channel: row.channel, provider: p.name, status: "sent", message_id: res.messageId, cost_usd: res.costUsd, error: null });
      return { final: "sent", attempts };
    }
    attempts.push(note(row, p.name, "failed", res.error.slice(0, 300)));
    errored++;
    if (res.limit) state.exhausted.add(p.name);
    else await caps.give(p.name, row.cap_kind);
    // A message that can never go (a bad address) is not tried on the next provider.
    if (res.retryable === false) return { final: "failed", attempts };
  }

  if (errored === 0) {
    attempts.push(note(row, "router", "skipped", "every provider is at its daily cap, waiting"));
    return { final: "queued", attempts, retryAt: plusMinutes(now(), FULL_CAP_WAIT_MINUTES), freeRetry: true };
  }
  if (row.tries >= MAX_TRIES) return { final: "failed", attempts };
  return { final: "queued", attempts, retryAt: plusMinutes(now(), retryDelayMinutes(row.tries)), freeRetry: false };
}

export function routeRow(row: ClaimedRow, providers: readonly EmailProvider[], caps: CapStore, state?: RouterState, now?: () => Date, render?: Renderer): Promise<RowOutcome> {
  return row.channel === "whatsapp" ? Promise.resolve(skipWhatsApp(row)) : routeEmail(row, providers, caps, state, now, render);
}
