/** Small words for the claim page and the transfer dialog. Pure. */
import { OUTREACH_REASONS } from "@/lib/events-r1/types";

/** Where people write when a link does not work. NEXT_PUBLIC_SUPPORT_EMAIL overrides it for a staging project. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "itshoppaz@gmail.com";

/** "joy@gmail.com" -> "j***@gmail.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Could this email be the one the link is for? The page only knows the masked hint ("j***@gmail.com"), so it can say no for sure
 * but not yes: the server has the last word and answers wrong_email.
 */
export function mayMatchHint(email: string, hint: string): boolean {
  const e = email.trim().toLowerCase();
  const h = hint.trim().toLowerCase();
  const eAt = e.lastIndexOf("@");
  const hAt = h.lastIndexOf("@");
  if (eAt < 1 || hAt < 1) return false;
  if (e.slice(eAt) !== h.slice(hAt)) return false;
  const prefix = h.slice(0, hAt).split("*")[0];
  return e.slice(0, eAt).startsWith(prefix);
}

/** A reason code or a plain message, as a plain sentence. */
export function reasonText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return "That did not work. Try again";
  return OUTREACH_REASONS[raw] ?? raw;
}

const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true };

/** "Fri 30 Oct · 8:00 PM" in Lagos time. */
export function whenLagos(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "Africa/Lagos" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`;
}

/** "Fri 13 Nov" in Lagos time. */
export function dayLagos(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}
