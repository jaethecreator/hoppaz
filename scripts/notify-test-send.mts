/**
 * Sends a few REAL test emails to your own inbox, through the real Hoppaz email code, before anything is deployed. Jae runs this himself, on
 * his own machine, from the repo root:
 *
 *   node --no-warnings scripts/notify-test-send.mts --to you@example.com --provider brevo             dry run (the default): prints what it would send, sends nothing
 *   node --no-warnings scripts/notify-test-send.mts --to you@example.com --provider brevo --send      really sends
 *
 * --provider is brevo, mailjet or mailtrap. What each one sends (never more than 3 emails, to the one address after --to):
 *   brevo     the ticket confirmation (G1 "You're going") and the 24 hour reminder (G10 "Tomorrow")
 *   mailjet   the same two, and the sign-in code email, because Mailjet is the backup for sign-in codes
 *   mailtrap  the sign-in code email
 * They use the real templates and the sample data of src/lib/notify/templates/samples.ts, so they look like production. The subject starts
 * with "[TEST] ". The sign-in code in the email is a made-up one and does not work.
 *
 * Keys: read from a file named .env.notify-test in the repo root (copy .env.notify-test.example to it; the file is ignored by git), and
 * for any key not in that file, from the environment of the terminal. No other env file is ever read, .env.local least of all, because
 * that one points at production. A key is never printed, not even partly.
 *
 * Touches no database, no queue, no send log and no daily allowance. The unsubscribe link in the reminder is a made-up preview link.
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createBrevoProvider } = await import("../src/lib/notify/brevo.ts");
const { createMailjetProvider } = await import("../src/lib/notify/mailjet.ts");
const { createMailtrapProvider } = await import("../src/lib/notify/mailtrap.ts");
const { senderFor } = await import("../src/lib/notify/mailcommon.ts");
const { renderEmail } = await import("../src/lib/notify/templates/index.ts");
const { SAMPLES } = await import("../src/lib/notify/templates/samples.ts");
const { AUTH_SAMPLES, renderAuthEmail } = await import("../src/lib/notify/templates/authcode.ts");
type EmailProvider = import("../src/lib/notify/provider.ts").EmailProvider;
type CapKind = import("../src/lib/notify/types.ts").CapKind;

const USAGE = "Use: node --no-warnings scripts/notify-test-send.mts --to you@example.com --provider brevo|mailjet|mailtrap [--send]";
const PROVIDERS = ["brevo", "mailjet", "mailtrap"] as const;
type ProviderName = (typeof PROVIDERS)[number];

// ------------------------------------------------------------------ the command line ---
function refuse(why: string): never {
  console.error(`${why}\n${USAGE}\nNothing was sent.`);
  process.exit(2);
}

let to = "";
let providerArg = "";
let send = false;
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--send") send = true;
    else if (a === "--to" || a === "--provider") {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) refuse(`${a} needs a value.`);
      if (a === "--to") to = v;
      else providerArg = v;
    } else if (a.startsWith("--to=")) to = a.slice(5);
    else if (a.startsWith("--provider=")) providerArg = a.slice(11);
    else refuse(`I do not know "${a.slice(0, 40)}".`);
  }
}
if (!to) refuse("Say who to send to with --to.");
// One plain address: no spaces, commas, semicolons or angle brackets, so a list or "Name <a@b.c>" is refused.
if (to.length > 254 || !/^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(to)) refuse("--to must be exactly one email address, for example you@example.com.");
if (!providerArg) refuse("Say which provider with --provider (brevo, mailjet or mailtrap).");
if (!(PROVIDERS as readonly string[]).includes(providerArg)) refuse(`--provider must be brevo, mailjet or mailtrap, not "${providerArg.slice(0, 20)}".`);
const providerName = providerArg as ProviderName;

// ------------------------------------------------------------------ the keys ---
/** Only these are ever read, from the file or from the terminal. Nothing else in the environment reaches the providers. */
const KEYS = ["BREVO_API_KEY", "MAILJET_API_KEY", "MAILJET_SECRET_KEY", "MAILTRAP_API_KEY", "NOTIFY_FROM_GUEST", "NOTIFY_FROM_CODE", "NOTIFY_REPLY_TO"] as const;
const SECRET_KEYS = ["BREVO_API_KEY", "MAILJET_API_KEY", "MAILJET_SECRET_KEY", "MAILTRAP_API_KEY"] as const;
const ENV_FILE = new URL("../.env.notify-test", import.meta.url);

/** KEY=VALUE per line. Blank lines and lines starting with # are ignored; "export " is allowed; a value may be in single or double quotes. */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const quote = v[0] === '"' || v[0] === "'" ? v[0] : "";
    if (quote) {
      const end = v.indexOf(quote, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      v = v.replace(/\s+#.*$/, "");
    }
    out[m[1]] = v.trim();
  }
  return out;
}

const fileFound = existsSync(fileURLToPath(ENV_FILE));
const fromFile = fileFound ? parseEnvFile(readFileSync(ENV_FILE, "utf8")) : {};
const env: Record<string, string | undefined> = {};
for (const k of KEYS) env[k] = fromFile[k]?.trim() || process.env[k]?.trim() || undefined;

const NEEDS: Record<ProviderName, readonly string[]> = {
  brevo: ["BREVO_API_KEY"],
  mailjet: ["MAILJET_API_KEY", "MAILJET_SECRET_KEY"],
  mailtrap: ["MAILTRAP_API_KEY"],
};
const missing = NEEDS[providerName].filter((k) => !env[k]);

/** Anything printed goes through here, so a key can never reach the screen even if a provider error quotes it. */
const secrets = SECRET_KEYS.map((k) => env[k]).filter((v): v is string => !!v && v.length >= 4);
if (env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY) secrets.push(Buffer.from(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`).toString("base64"));
const scrub = (s: string): string => secrets.reduce((acc, v) => acc.split(v).join("[hidden]"), s);

// ------------------------------------------------------------------ what to send ---
type Planned = { label: string; kind: string; capKind: CapKind; subject: string; html: string; text: string; headers: Record<string, string> };

function plan(): Planned[] {
  const out: Planned[] = [];
  const guest = (kind: string) => {
    const sample = SAMPLES.find((s) => s.kind === kind && !s.label.startsWith("Awkward"));
    if (!sample) throw new Error(`no sample for ${kind}`);
    // The reminders carry an unsubscribe link; without NOTIFY_UNSUB_SECRET a real one cannot be made, so this is the same made-up link the /dev/emails preview uses.
    const mail = renderEmail(kind, sample.payload, { to, unsubscribeUrl: "https://hoppaz.fun/unsubscribe/preview-only" });
    out.push({ label: sample.label, kind, capKind: "guest", ...mail });
  };
  const code = () => {
    const sample = AUTH_SAMPLES.find((s) => s.mail.variant === "sign_in");
    if (!sample) throw new Error("no sign-in code sample");
    const mail = renderAuthEmail({ ...sample.mail, to });
    out.push({ label: sample.label, kind: sample.kind, capKind: "code", ...mail });
  };
  if (providerName !== "mailtrap") {
    guest("registered");
    guest("reminder_day");
  }
  if (providerName !== "brevo") code();
  return out.map((p) => ({ ...p, subject: `[TEST] ${p.subject}` })).slice(0, 3);
}

const emails = plan();
const fromOf = (capKind: CapKind) => {
  const { from } = senderFor({ to, kind: "", payload: {}, queueId: "", dedupeKey: "", priority: 1, capKind }, env);
  return from.name ? `${from.name} <${from.email}>` : from.email;
};

console.log(send ? "SEND MODE: real emails will be sent." : "DRY RUN: nothing is sent, no network is used.");
console.log(`Provider: ${providerName}`);
console.log(`To: ${to}`);
console.log(`Keys file .env.notify-test: ${fileFound ? "found" : "not found (using the terminal's environment only)"}`);
console.log(`Key present: ${missing.length ? `no (missing ${missing.join(", ")})` : "yes"}`);
console.log(`Emails (${emails.length}):`);
emails.forEach((e, i) => console.log(`  ${i + 1}. ${e.subject}\n     from ${fromOf(e.capKind)}`));

if (!send) {
  console.log("\nDry run done. Add --send to send these for real.");
  process.exit(0);
}

// ------------------------------------------------------------------ sending ---
const PRETTY: Record<ProviderName, string> = { brevo: "Brevo", mailjet: "Mailjet", mailtrap: "Mailtrap" };
const NAME = PRETTY[providerName];

if (missing.length) {
  console.error(`\nFailed: ${NAME} key missing (${missing.join(", ")}). Nothing was sent.`);
  console.error("Hint: copy .env.notify-test.example to .env.notify-test in the repo root, paste the key after the equals sign, save, and run again.");
  process.exit(1);
}

const provider: EmailProvider =
  providerName === "brevo" ? createBrevoProvider(env) : providerName === "mailjet" ? createMailjetProvider(env) : createMailtrapProvider(env);

/** Plain sentences for the common failures. The Brevo unknown address case is alone; otherwise every one that fits is returned. */
function hintsFor(reason: string): string[] {
  if (/unrecogni[sz]ed ip|authori[sz]ed.?ips?|unknown ip|ip address/i.test(reason)) {
    return ["Brevo blocks requests from computers it does not know. In Brevo open Security, then Authorised IPs, and either add this laptop's address or turn the IP blocking off for now. Then run again."];
  }
  const out: string[] = [];
  if (/review|suspend|not (yet )?activated|activation|account.*(inactive|disabled|pending|blocked)|pending approval/i.test(reason)) {
    out.push(`The ${NAME} account may still be under review. Wait for ${NAME} to approve it (they often email you), or ask their support. Then run again.`);
  }
  if (/domain|from address|not verified|unverified|verify|sender.*(invalid|not valid|not allowed|not verified)|dkim|spf/i.test(reason)) {
    out.push(`The sending domain or address is probably not verified at ${NAME} yet. Finish the domain setup there (the DNS records), wait until it shows as verified, then run again. The From address is shown above.`);
  }
  if (/key refused|\b40[13]\b|unauthori[sz]ed|permission|invalid.*(key|token)|authentication/i.test(reason)) {
    out.push(`${NAME} did not accept the key. Check that it was copied whole, with no spaces, and that it is the key for ${NAME}.`);
  }
  if (/network error|timed out/i.test(reason)) out.push("No answer from the provider. Check your internet connection and run again.");
  if (/limit|quota|credit|too many/i.test(reason)) out.push(`${NAME} says a limit is reached. Wait a while or check the plan in ${NAME}, then run again.`);
  return out;
}

console.log("");
let failed = 0;
const hints = new Set<string>();
for (const [i, e] of emails.entries()) {
  let reason = "";
  try {
    const res = await provider.send({
      to,
      kind: e.kind,
      payload: {},
      queueId: "notify-test-send",
      dedupeKey: `notify-test-send:${e.kind}:${i}`,
      priority: 1,
      capKind: e.capKind,
      subject: e.subject,
      html: e.html,
      text: e.text,
      headers: e.headers,
    });
    if (res.ok) {
      console.log(`Sent: ${e.subject} via ${providerName}, check your inbox and spam folder`);
      continue;
    }
    reason = res.error;
  } catch (err) {
    reason = (err as Error).message || "unknown error";
  }
  failed++;
  reason = scrub(reason);
  console.log(`Failed: ${e.subject} via ${providerName}: ${reason}`);
  for (const h of hintsFor(reason)) hints.add(h);
}

if (emails.some((e) => e.kind === "registered")) {
  console.log("\nNote: the ticket QR picture in the confirmation email loads from hoppaz.fun/api/notify/qr, which only works once this branch is deployed, so until then the picture may show as broken.");
}
if (emails.some((e) => e.capKind === "code")) console.log("Note: the code in the sign-in email is a made-up one and will not sign anyone in.");
for (const h of hints) console.log(`\nHint: ${h}`);
console.log(failed ? `\n${failed} of ${emails.length} failed.` : `\nAll ${emails.length} sent. They can take a minute to arrive.`);
process.exit(failed ? 1 : 0);
