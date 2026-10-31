import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed unsubscribe link: a token that says WHO and WHICH SETTING, signed with NOTIFY_UNSUB_SECRET (HMAC-SHA256).
 *   token = <r|p> . <person id> . <signature>      r: email_reminders (G10, G11, G15)   p: email_pops (G12)
 * No email address is in it. The link is the person's own key to two switches and nothing else: it can turn reminder mail or Pop mail off
 * or back on for that one person, and it cannot read anything or sign anyone in.
 *
 * NO EXPIRY, on purpose. An unsubscribe link in an old email has to keep working (the law and Gmail's one-click both expect it), and the
 * most a stolen one can do is switch off, or back on, one person's reminder emails, which they can undo themselves. The way to kill every
 * link at once is to change NOTIFY_UNSUB_SECRET; that also kills the links already sent, so it is for a leaked secret only.
 * The signature covers a version tag ("hoppaz-unsub-v1"), so a later change of format cannot be confused with this one.
 * Server only.
 */

export type UnsubSetting = "reminders" | "pops";

type Env = Record<string, string | undefined>;

const LETTER: Record<UnsubSetting, string> = { reminders: "r", pops: "p" };
const SETTING: Record<string, UnsubSetting> = { r: "reminders", p: "pops" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A secret shorter than this is treated as not set: a short one is guessable, and a typo should not look like a working setup. */
export const MIN_SECRET = 16;

/** Which setting an email kind's unsubscribe link switches off. Kinds not listed here (tickets, receipts, changes) have no link. */
export const SETTING_FOR_KIND: Readonly<Record<string, UnsubSetting>> = {
  reminder_day: "reminders",
  reminder_hour: "reminders",
  thanks: "reminders",
  host_pop: "pops",
};

export function unsubSecret(env: Env = process.env): string | null {
  const s = env.NOTIFY_UNSUB_SECRET?.trim();
  return s && s.length >= MIN_SECRET ? s : null;
}

const sign = (secret: string, letter: string, userId: string) => createHmac("sha256", secret).update(`hoppaz-unsub-v1:${letter}:${userId}`).digest("base64url");

/** null when the secret is not set or the person id is not a uuid. */
export function signUnsubToken(userId: string, setting: UnsubSetting, env: Env = process.env): string | null {
  const secret = unsubSecret(env);
  const id = userId.trim().toLowerCase();
  if (!secret || !UUID.test(id)) return null;
  const letter = LETTER[setting];
  return `${letter}.${id}.${sign(secret, letter, id)}`;
}

/** The person and the setting, or null for anything that is not a token we signed (wrong shape, wrong signature, no secret). Constant time. */
export function verifyUnsubToken(token: string | null | undefined, env: Env = process.env): { userId: string; setting: UnsubSetting } | null {
  const secret = unsubSecret(env);
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [letter, userId, mac] = parts;
  const setting = SETTING[letter];
  if (!setting || !UUID.test(userId)) return null;
  const want = Buffer.from(sign(secret, letter, userId));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { userId, setting };
}
