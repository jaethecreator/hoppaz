import { esc, escLines } from "./format";

/**
 * The Hoppaz email shell, drawn from supabase/email-templates/confirm-signup.html: dark page, card with the orange top edge, Poppins
 * headings and Archivo text (Google Fonts where the mail app loads them, Arial where it does not), the ember-lipped orange button,
 * table layout and inline CSS only. One Doc in, the HTML and the plain text out, so the two always say the same thing.
 */

export type DocTicket = { code?: string; token?: string; label?: string };

export type Doc = {
  /** The grey line some inboxes show beside the subject. */
  preheader: string;
  /** Small mono label above the headline. */
  eyebrow: string;
  headline: string;
  /** Plain text. Escaped here. */
  paragraphs: string[];
  /** The one plain line of event facts, with the event name above it. */
  event?: { title: string; facts: string };
  /** Label and value lines (a receipt, what changed). */
  rows?: Array<[string, string]>;
  tickets?: DocTicket[];
  button?: { label: string; url: string };
  /** After the button. */
  after?: string[];
  /** Why this email reached them. */
  reason: string;
  unsubscribeUrl: string | null;
};

export type ShellContext = { site: string; to?: string | null };

const C = { page: "#0E0B0A", card: "#171210", line: "#2E2320", orange: "#FF4D00", ember: "#B83600", cream: "#F5EBDD", muted: "#9C9087" };
const DISPLAY = "Poppins,Arial,sans-serif";
const BODY = "Archivo,Arial,sans-serif";
const MONO = "'DM Mono',ui-monospace,Menlo,monospace";

/** At most this many QR images in one email; the rest are in the app. */
export const MAX_QR = 6;

const qrUrl = (site: string, token: string) => `${site}/api/notify/qr?t=${encodeURIComponent(token)}`;

function p(text: string, extra = ""): string {
  return `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.55;color:${C.cream};${extra}">${escLines(text)}</p>`;
}

function ticketBlock(site: string, t: DocTicket, i: number, n: number): string {
  const label = t.label || (n > 1 ? `Ticket ${i + 1} of ${n}` : "");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
<tr><td align="center" style="background:#FFFFFF;border-radius:12px;padding:16px;">
${label ? `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#4A413B;">${esc(label)}</p>` : ""}
${t.token ? `<img src="${esc(qrUrl(site, t.token))}" width="200" height="200" alt="Ticket QR code" style="display:block;margin:0 auto;width:200px;height:200px;border:0;">` : ""}
${t.code ? `<p style="margin:${t.token ? "10px" : "0"} 0 0;font-family:${MONO};font-size:18px;font-weight:500;letter-spacing:0.18em;color:#0E0B0A;">${esc(t.code)}</p><p style="margin:2px 0 0;font-family:${BODY};font-size:12px;color:#4A413B;">Door code, if the scan fails</p>` : ""}
</td></tr></table>`;
}

export function renderHtml(doc: Doc, ctx: ShellContext): string {
  const { site } = ctx;
  const tickets = (doc.tickets ?? []).slice(0, MAX_QR);
  const more = (doc.tickets?.length ?? 0) - tickets.length;
  const rows = doc.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${C.line};">${doc.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${BODY};font-size:14px;color:${C.muted};">${esc(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${BODY};font-size:14px;color:${C.cream};">${esc(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const event = doc.event
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border-left:3px solid ${C.orange};padding:2px 0 2px 14px;">
<p style="margin:0 0 4px;font-family:${DISPLAY};font-weight:900;font-size:18px;line-height:1.25;color:${C.cream};">${esc(doc.event.title)}</p>
${doc.event.facts ? `<p style="margin:0;font-family:${BODY};font-size:15px;line-height:1.5;color:${C.muted};">${esc(doc.event.facts)}</p>` : ""}</td></tr></table>`
    : "";
  const button = doc.button
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr>
<td align="center" style="border-radius:12px;background:${C.orange};box-shadow:0 3px 0 ${C.ember};">
<a href="${esc(doc.button.url)}" style="display:block;padding:16px 20px;font-family:${DISPLAY};font-weight:900;font-size:15px;letter-spacing:0.04em;text-transform:uppercase;color:${C.page};text-decoration:none;border-radius:12px;">${esc(doc.button.label)}</a>
</td></tr></table>
<p style="margin:14px 0 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${C.muted};">Button not working? <a href="${esc(doc.button.url)}" style="color:${C.orange};word-break:break-all;">${esc(doc.button.url)}</a></p>`
    : "";
  const unsub = doc.unsubscribeUrl
    ? `<br><a href="${esc(doc.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe from emails like this</a>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(doc.headline)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500&family=DM+Mono:wght@500&family=Poppins:wght@900&display=swap" rel="stylesheet">
<style>
body { margin: 0; padding: 0; background: ${C.page}; }
a { color: ${C.orange}; }
@media (max-width: 520px) {
  .card { padding: 28px 20px !important; }
  .title { font-size: 28px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(doc.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td align="center" style="padding:0 0 24px;">
<a href="${esc(site)}" style="text-decoration:none;"><img src="${esc(site)}/brand/wordmark-orange.png" width="150" alt="HOPPAZ" style="display:block;width:150px;height:auto;border:0;color:${C.orange};font-family:${DISPLAY};font-weight:900;font-size:28px;"></a>
</td></tr>
<tr><td class="card" style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${C.orange};border-radius:14px;padding:36px 32px;">
<p style="margin:0 0 14px;font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${C.muted};">${esc(doc.eyebrow)}</p>
<h1 class="title" style="margin:0 0 14px;font-family:${DISPLAY};font-weight:900;font-size:32px;line-height:1.1;letter-spacing:-0.01em;color:${C.cream};">${esc(doc.headline)}</h1>
${doc.paragraphs.map((t) => p(t)).join("\n")}
${event}${rows}${tickets.map((t, i) => ticketBlock(site, t, i, doc.tickets?.length ?? 1)).join("\n")}${more > 0 ? p(`And ${more} more in the app.`, `font-size:14px;color:${C.muted};`) : ""}
${button}
${(doc.after ?? []).map((t) => `<div style="height:16px;line-height:16px;">&nbsp;</div>${p(t, "margin-bottom:0;")}`).join("\n")}
</td></tr>
<tr><td align="center" style="padding:22px 12px 0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.muted};">
${esc(doc.reason)}${ctx.to ? `<br>Sent to ${esc(ctx.to)}.` : ""}<br>Questions? Just reply to this email.${unsub}
<p style="margin:14px 0 0;font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${C.muted};">Hoppaz · Lagos, we outside</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(doc: Doc, ctx: ShellContext): string {
  const out: string[] = [doc.headline, "", ...doc.paragraphs.flatMap((t) => [t, ""])];
  if (doc.event) out.push(doc.event.title, ...(doc.event.facts ? [doc.event.facts] : []), "");
  if (doc.rows?.length) out.push(...doc.rows.map(([k, v]) => `${k}: ${v}`), "");
  const tickets = doc.tickets ?? [];
  tickets.forEach((t, i) => {
    if (t.code) out.push(`${t.label || (tickets.length > 1 ? `Ticket ${i + 1} of ${tickets.length}` : "Door code")}: ${t.code}`);
  });
  if (tickets.some((t) => t.code)) out.push("");
  if (doc.button) out.push(`${doc.button.label}: ${doc.button.url}`, "");
  for (const t of doc.after ?? []) out.push(t, "");
  out.push("--", doc.reason);
  if (ctx.to) out.push(`Sent to ${ctx.to}.`);
  out.push("Questions? Just reply to this email.");
  if (doc.unsubscribeUrl) out.push(`Unsubscribe from emails like this: ${doc.unsubscribeUrl}`);
  out.push("Hoppaz, Lagos, we outside");
  return out.join("\n");
}
