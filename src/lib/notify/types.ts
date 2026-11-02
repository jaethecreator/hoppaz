/**
 * Shared types of the notification layer (supabase/events_r1_notify.sql is the database half; plans in docs/reminders-*-plan.md).
 * Server only. Nothing here sends anything: providers are in provider.ts and the router in router.ts.
 */

export type Channel = "email" | "whatsapp";
/** Which daily allowance a message spends: sign-in codes, or everything else a guest gets. */
export type CapKind = "code" | "guest";
/** 1 always goes, 5 is the first to be dropped or moved to the next day when a day's allowance runs low. */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** A due row handed out by notify_claim_due. Each row goes to one run only. */
export type ClaimedRow = {
  id: string;
  user_id: string;
  kind: string;
  event_id: string | null;
  channel: Channel;
  cap_kind: CapKind;
  payload: Record<string, unknown>;
  priority: Priority;
  /** Counts this try. */
  tries: number;
  dedupe_key: string;
  /** Set on email rows, already lower case and checked against the suppression list. */
  email: string | null;
  /** Set on WhatsApp rows, in international form. */
  whatsapp_number: string | null;
};

export type AttemptStatus = "sent" | "failed" | "skipped";

/** One line for notify_sends. A row that falls through two providers has two. */
export type Attempt = {
  channel: Channel;
  provider: string;
  status: AttemptStatus;
  message_id: string | null;
  cost_usd: number;
  error: string | null;
};

/** What happened to a claimed row. `queued` puts it back for later; freeRetry means the try is not counted (every provider was just full). */
export type RowOutcome =
  | { final: "sent" | "failed" | "skipped"; attempts: Attempt[] }
  | { final: "queued"; attempts: Attempt[]; retryAt: string; freeRetry: boolean };

/** How full a cap is today (notify_cap_status). */
export type CapStatus = { provider: string; kind: CapKind; daily_cap: number; used: number; percent: number | null };

/** The month's WhatsApp budget (notify_wa_budget in supabase/events_r1_notify_whatsapp.sql). `room` is how many more messages it pays for. */
export type WaBudget = {
  budget_usd: number;
  spent_usd: number;
  unpriced: number;
  in_flight: number;
  estimate_usd: number;
  projected_usd: number;
  percent: number;
  room: number;
};

/** The arguments of notify_enqueue, in the database's own names. */
export type EnqueueArgs = {
  p_user: string;
  p_kind: string;
  p_event: string | null;
  p_payload: Record<string, unknown>;
  p_priority: Priority;
  p_due_at: string | null;
  p_dedupe: string | null;
  p_channel: Channel;
  p_cap_kind: CapKind;
  p_expires_at: string | null;
};

/** What a caller gives notify(). Anything left out comes from KIND_RULES, then from the defaults. */
export type NotifyInput = {
  userId: string;
  kind: string;
  eventId?: string | null;
  channel?: Channel;
  capKind?: CapKind;
  payload?: Record<string, unknown>;
  priority?: Priority;
  /** Default: now. */
  dueAt?: Date | string | null;
  /** After this the message is useless (a reminder). A row without it is open ended and may be moved to the next day. */
  expiresAt?: Date | string | null;
  /** Default: kind:event:user:channel, so the same message to the same person for the same event goes once. */
  dedupeKey?: string | null;
};

/**
 * The email list of docs/reminders-email-plan.md section 2, with its priorities. The database queues reminder_day and reminder_hour
 * itself (from the automatic Pops); the others are queued by whatever happens (a registration, an approval, a cancel).
 */
export const KIND_RULES = {
  sign_in_code: { priority: 1, capKind: "code" },
  email_change_code: { priority: 1, capKind: "code" },
  new_sign_in: { priority: 3, capKind: "code" },
  registered: { priority: 1, capKind: "guest" },
  receipt: { priority: 1, capKind: "guest" },
  request_sent: { priority: 2, capKind: "guest" },
  approved: { priority: 1, capKind: "guest" },
  declined: { priority: 3, capKind: "guest" },
  waitlisted: { priority: 3, capKind: "guest" },
  spot_opened: { priority: 1, capKind: "guest" },
  event_changed: { priority: 1, capKind: "guest" },
  event_cancelled: { priority: 1, capKind: "guest" },
  reminder_day: { priority: 2, capKind: "guest" },
  reminder_hour: { priority: 4, capKind: "guest" },
  host_pop: { priority: 3, capKind: "guest" },
  you_cancelled: { priority: 3, capKind: "guest" },
  refund_sent: { priority: 2, capKind: "guest" },
  thanks: { priority: 5, capKind: "guest" },
  host_live: { priority: 3, capKind: "guest" },
  host_daily: { priority: 4, capKind: "guest" },
  payout_sent: { priority: 2, capKind: "guest" },
} as const satisfies Record<string, { priority: Priority; capKind: CapKind }>;

/** A row is tried this many times, then given up on (the database enforces the same number). */
export const MAX_TRIES = 5;
