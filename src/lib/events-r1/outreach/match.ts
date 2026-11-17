/**
 * Pure matching and stage rules for the outreach flow, shared by the fake layer and the scout loader. The SQL (_ev_name_key and the
 * import matching in events_r1_outreach.sql) follows the same rules, so a name or handle means the same thing on both sides.
 */
import type { OrganiserStage } from "../types";

/** "Lekki Social Club!" -> "lekkisocialclub". Letters and digits only, accents folded, lower case. Same as _ev_name_key. */
export function nameKey(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * An Instagram handle as kept: no @, no link, lower case. "@Lekki.Social", "instagram.com/lekki.social/" and "lekki.social" all give
 * "lekki.social". Anything that is not 1 to 30 letters, digits, dots and underscores gives null.
 */
export function normHandle(raw: string | null | undefined): string | null {
  let h = (raw ?? "").trim();
  if (!h) return null;
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^(www\.)?instagram\.com\//i, "");
  h = h.split(/[/?#]/)[0].replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

/**
 * An X (Twitter) handle as kept: no @, no link, lower case, 1 to 15 letters, digits and underscores. "@Lekki_Club", "x.com/lekki_club" and
 * "twitter.com/lekki_club" all give "lekki_club". Anything else gives null. Same rule as _ev_o_xhandle in events_r1_outreach_ready.sql.
 */
export function normX(raw: string | null | undefined): string | null {
  let h = (raw ?? "").trim();
  if (!h) return null;
  h = h.replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, "").replace(/^(www\.)?(x|twitter)\.com\//i, "");
  h = h.split(/[/?#]/)[0].replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(h) ? h : null;
}

/** Does this text look like an email address, or a phone number (9 or more digits, spaces, dots, dashes and brackets allowed between them)? Same test as _ev_o_contactish. */
export const looksLikeContact = (raw: string | null | undefined): boolean => /[^@\s]+@[^@\s]+\.[A-Za-z]{2,}/.test(raw ?? "") || /(\d[ ().-]*){9,}/.test(raw ?? "");

/**
 * Short plain text for a flyer credit or a ticket platform: control characters out, runs of spaces folded, cut at `max`, or null when empty or when
 * it looks like an email or a phone number (Hoppaz keeps neither). Same as _ev_o_plain in events_r1_outreach_ready.sql.
 */
export function plainText(raw: string | null | undefined, max: number): string | null {
  if (looksLikeContact(raw)) return null;
  const t = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t || null;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A trimmed, lower case email, or null if it is not one. */
export function normEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** "jae@gmail.com" -> "j***@gmail.com". The claim page shows this, never the full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

/** An organiser who said no, or asked not to be contacted: nothing of theirs is listed, offered or sent a link. */
export const isBlocked = (o: { stage: OrganiserStage; do_not_contact: boolean }): boolean => o.stage === "declined" || o.do_not_contact;

/** Stages staff may set by hand. claimed is only set by accepting a transfer; pulled is only where an organiser starts. */
export const MANUAL_STAGES: OrganiserStage[] = ["listed", "offered", "declined"];

/**
 * Why a hand-made stage move is refused, as a reason code (see OUTREACH_REASONS), or null when it is fine.
 * A claimed organiser cannot be moved (they own the room now). A declined organiser must be reopened (listed) before an offer.
 */
export function stageRefusal(from: { stage: OrganiserStage; do_not_contact: boolean }, to: OrganiserStage): string | null {
  if (!MANUAL_STAGES.includes(to)) return "not_found";
  if (from.stage === "claimed") return "is_claimed";
  if (to === "offered" && isBlocked(from)) return "organiser_declined";
  return null;
}

/** The Lagos calendar day (UTC+1, no daylight saving) of a time, "2026-11-14". */
export const lagosDay = (ms: number): string => new Date(ms + 3.6e6).toISOString().slice(0, 10);
