import { siteBase } from "./format";
import { SETTING_FOR_KIND, signUnsubToken } from "../unsubToken";

/**
 * Where the unsubscribe link of G10, G11, G12 and G15 points: a signed link (src/lib/notify/unsubToken.ts) made from the person and the
 * kind. Tickets, receipts, changes and cancellations have no setting to switch off, so they get no link and no List-Unsubscribe header.
 * Answers null when there is no secret (NOTIFY_UNSUB_SECRET), no person, or a kind that has no link: the templates then draw no link and
 * send no header (a header that points nowhere is worse than none).
 *
 * Two addresses, because they do two jobs:
 *   page      /unsubscribe?t=...   what a person opens from the footer. A GET shows what will change and changes nothing.
 *   oneClick  /api/notify/unsubscribe?t=...   the List-Unsubscribe header (RFC 8058). Gmail and Apple Mail POST here. A page cannot take a
 *             bare POST, so this is a route; a GET to it only sends the browser on to the page.
 */
export type UnsubscribeInput = { kind: string; userId?: string; queueId?: string; site?: string };

export type UnsubscribeLinks = { page: string; oneClick: string };

export function unsubscribeLinksFor(input: UnsubscribeInput, env: Record<string, string | undefined> = process.env): UnsubscribeLinks | null {
  const setting = Object.prototype.hasOwnProperty.call(SETTING_FOR_KIND, input.kind) ? SETTING_FOR_KIND[input.kind] : null;
  if (!setting || !input.userId) return null;
  const token = signUnsubToken(input.userId, setting, env);
  if (!token) return null;
  const site = siteBase(input.site);
  const q = `?t=${encodeURIComponent(token)}`;
  return { page: `${site}/unsubscribe${q}`, oneClick: `${site}/api/notify/unsubscribe${q}` };
}

export function unsubscribeUrlFor(input: UnsubscribeInput): string | null {
  return unsubscribeLinksFor(input)?.page ?? null;
}
