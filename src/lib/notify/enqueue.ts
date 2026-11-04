import type { NotifyDb } from "./db";
import { KIND_RULES, type EnqueueArgs, type NotifyInput, type Priority } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z0-9_]{1,40}$/;

const iso = (v: Date | string | null | undefined, what: string): string | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`notify: ${what} is not a date`);
  return d.toISOString();
};

/**
 * Checks a notify() call and turns it into the arguments of notify_enqueue. Pure. Throws a plain Error on bad input, because a bad call
 * is a bug in our code, not something to be sent quietly into the queue.
 */
export function buildEnqueueArgs(input: NotifyInput): EnqueueArgs {
  if (!UUID.test(input.userId)) throw new Error("notify: userId must be a uuid");
  if (!KIND.test(input.kind)) throw new Error("notify: kind must be 1 to 40 characters of a-z, 0-9 and _");
  const eventId = input.eventId ?? null;
  if (eventId !== null && !UUID.test(eventId)) throw new Error("notify: eventId must be a uuid");
  const rule = (KIND_RULES as Record<string, { priority: Priority; capKind: "code" | "guest" } | undefined>)[input.kind];
  const priority = input.priority ?? rule?.priority ?? 3;
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new Error("notify: priority must be 1 to 5");
  const channel = input.channel ?? "email";
  if (channel !== "email" && channel !== "whatsapp") throw new Error("notify: channel must be email or whatsapp");
  const capKind = input.capKind ?? rule?.capKind ?? "guest";
  if (capKind !== "code" && capKind !== "guest") throw new Error("notify: capKind must be code or guest");
  const payload = input.payload ?? {};
  if (typeof payload !== "object" || Array.isArray(payload)) throw new Error("notify: payload must be an object");
  const dedupe = input.dedupeKey == null ? null : input.dedupeKey.trim();
  if (dedupe !== null && dedupe.length > 200) throw new Error("notify: dedupeKey is too long");
  return {
    p_user: input.userId,
    p_kind: input.kind,
    p_event: eventId,
    p_payload: payload,
    p_priority: priority as Priority,
    p_due_at: iso(input.dueAt, "dueAt"),
    p_dedupe: dedupe || null,
    p_channel: channel,
    p_cap_kind: capKind,
    p_expires_at: iso(input.expiresAt, "expiresAt"),
  };
}

/**
 * Queue one message. `queued: false` means it was a duplicate (the same dedupe key) or the channel's switch (notify_email,
 * notify_whatsapp in ev_settings) is off: both are normal, neither is an error.
 */
export async function notify(db: NotifyDb, input: NotifyInput): Promise<{ queued: boolean; id: string | null }> {
  const id = await db.enqueue(buildEnqueueArgs(input));
  return { queued: id !== null, id };
}
