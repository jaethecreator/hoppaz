import type { LinkType } from "@/lib/events-r1/types";

/** The create page works in Lagos time (UTC+1 all year), shown under the time pickers as Africa/Lagos. */
export const TIMEZONE = "Africa/Lagos";
const HOUR = 3_600_000;

/** A datetime-local value ("2026-10-23T19:00") for an instant, read on a Lagos clock. */
export const toLagosInput = (ms: number) => new Date(ms + HOUR).toISOString().slice(0, 16);

/** The instant for a datetime-local value typed on a Lagos clock. NaN when it is empty or broken. */
export const fromLagosInput = (v: string) => Date.parse(`${v}:00+01:00`);

/** Tomorrow evening, 19:00 Lagos. */
export function defaultStart(nowMs: number): number {
  const d = new Date(nowMs + HOUR);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(19, 0, 0, 0);
  return d.getTime() - HOUR;
}

export const DEFAULT_LENGTH = 3 * HOUR;

export const LINK_LABEL: Record<LinkType, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  whatsapp: "WhatsApp call",
  other: "Other",
};

/** A pasted link with no scheme gets https://, so "zoom.us/j/1" works. Empty stays empty. */
export function cleanLink(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Which call app a pasted link is for. A WhatsApp group chat link (chat.whatsapp.com) is a chat, not a call: Other. */
export function detectLinkType(raw: string): LinkType | null {
  const v = cleanLink(raw);
  if (!v) return null;
  let host = "";
  try {
    host = new URL(v).hostname.toLowerCase();
  } catch {
    return "other";
  }
  const on = (d: string) => host === d || host.endsWith(`.${d}`);
  if (on("zoom.us") || on("zoom.com")) return "zoom";
  if (host === "meet.google.com") return "meet";
  if (host === "call.whatsapp.com" || host === "wa.me") return "whatsapp";
  return "other";
}
