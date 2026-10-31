import type { CapKind, Priority } from "./types";

/** What a provider is asked to send. Rendering (templates) is a later step: the provider gets the facts and builds its own message. */
export type OutgoingEmail = {
  to: string;
  kind: string;
  payload: Record<string, unknown>;
  queueId: string;
  dedupeKey: string;
  priority: Priority;
};

/**
 * ok: the provider took the message and gave it an id.
 * Not ok: `limit` means the provider says its own allowance is used up (the router stops using it for this run and does not hand the unit back);
 * `retryable: false` means this message can never go (a bad address), so the router stops and gives up on the row.
 */
export type SendResult =
  | { ok: true; messageId: string; costUsd: number }
  | { ok: false; error: string; limit?: boolean; retryable?: boolean };

/** One way of sending email: Brevo, Mailjet, Mailtrap, SES and the log provider are all this. */
export interface EmailProvider {
  /** The name used in notify_caps and notify_sends. */
  readonly name: string;
  /** The allowances it may serve: Brevo guest, Mailtrap code, Mailjet both. */
  readonly kinds: readonly CapKind[];
  send(msg: OutgoingEmail): Promise<SendResult>;
}
