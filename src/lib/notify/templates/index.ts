import { BUILDERS, UNSUBSCRIBE_KINDS, type Payload } from "./copy";
import { oneLine, siteBase } from "./format";
import { renderHtml, renderText } from "./layout";
import { unsubscribeLinksFor } from "./unsubscribe";

/**
 * Kind and payload in, a finished email out: { subject, html, text, headers }. Pure (nothing is read from the database or sent).
 * The router calls renderEmail before any provider, so a kind with no template fails there, clearly, and is never sent blank.
 */

export type RenderedEmail = { subject: string; html: string; text: string; headers: Record<string, string> };

export type RenderOptions = {
  /** Who the row is for: the signed unsubscribe link is made from them and the kind. */
  userId?: string;
  queueId?: string;
  /** The address it goes to, shown in the footer ("Sent to ..."). */
  to?: string | null;
  /** The public address of the site, no trailing slash. Default: NEXT_PUBLIC_SITE_URL, else https://hoppaz.fun. */
  site?: string;
  now?: Date;
  /** Override for the unsubscribe link of G10, G11, G12 and G15 (the preview uses it). undefined: a signed link from userId, or none without NOTIFY_UNSUB_SECRET. */
  unsubscribeUrl?: string | null;
};

export class NoTemplateError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`no email template for kind "${kind}"`);
    this.name = "NoTemplateError";
    this.kind = kind;
  }
}

export const TEMPLATE_KINDS: readonly string[] = Object.keys(BUILDERS);

export const hasTemplate = (kind: string): boolean => Object.prototype.hasOwnProperty.call(BUILDERS, kind);

export function renderEmail(kind: string, payload: Payload, opts: RenderOptions = {}): RenderedEmail {
  if (!hasTemplate(kind)) throw new NoTemplateError(kind);
  const site = siteBase(opts.site);
  const wantsUnsubscribe = (UNSUBSCRIBE_KINDS as readonly string[]).includes(kind);
  // Only G10, G11, G12 and G15 ask. An override is used for both the footer link and the header.
  const links = !wantsUnsubscribe
    ? null
    : opts.unsubscribeUrl !== undefined
      ? opts.unsubscribeUrl ? { page: opts.unsubscribeUrl, oneClick: opts.unsubscribeUrl } : null
      : unsubscribeLinksFor({ kind, userId: opts.userId, queueId: opts.queueId, site });
  const unsubscribeUrl = links?.page ?? null;
  const built = BUILDERS[kind]({ payload: payload ?? {}, site, now: opts.now ?? new Date(), unsubscribeUrl });
  const ctx = { site, to: opts.to ? oneLine(opts.to, 320) : null };
  const headers: Record<string, string> = {};
  if (links) {
    headers["List-Unsubscribe"] = `<${links.oneClick}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject: built.subject, html: renderHtml(built.doc, ctx), text: renderText(built.doc, ctx), headers };
}

export { UNSUBSCRIBE_KINDS } from "./copy";
export { unsubscribeUrlFor, unsubscribeLinksFor } from "./unsubscribe";
export { formatWhen, naira, siteBase } from "./format";
