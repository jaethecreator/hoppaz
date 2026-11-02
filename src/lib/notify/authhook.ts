import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotifyDb } from "./db";
import { maskAddress } from "./log";
import { obj } from "./mailcommon";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider";
import { newRouterState, routeEmail, type CapStore } from "./router";
import { renderAuthEmail, type AuthMail, type AuthVariant } from "./templates/authcode";
import type { Attempt, CapKind, ClaimedRow } from "./types";
import { secretKey, verifyWebhook } from "./webhooksig";

/**
 * The Send Email Hook: Supabase Auth hands every auth email to /api/auth/send-email instead of its own mailer, so codes can go through
 * Mailtrap (150 a day) and fall back to Mailjet (100 a day for codes). Docs: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 * and https://supabase.com/docs/guides/auth/auth-hooks. Server only. This is the most sensitive route in the notification system: when it
 * fails, people cannot sign in. So:
 *
 * - It sends directly and at once, never through notify_queue. A code that waits in a queue is a code that expires unread.
 * - Supabase waits 5 seconds for the whole call (cold start and network included), so the work has a deadline of 3.8 seconds, each
 *   provider gets a short share of it, and a provider that hangs still leaves time for the backup.
 * - The bookkeeping (the daily cap, the send log) never stops a code. If the database is slow or down, the code is sent anyway.
 * - The flag notify_email is for guest mail and is not read here. notify_suppressed is not read either: an address that bounced once,
 *   long ago, must still be able to get a code, or that person is locked out for good. A bounce webhook may still add the address to the
 *   list (that only affects guest mail); this route never looks.
 * - The code, the token hash and a full address never reach a log, the send log or a provider's payload field. Addresses are masked.
 *
 * What Supabase sends: { user, email_data: { token, token_hash, token_new, token_hash_new, redirect_to, site_url, email_action_type, old_email,
 * provider, factor_type, ... } } signed with Standard Webhooks (src/lib/notify/webhooksig.ts). Success is a 200. An error is a non-2xx with
 * { error: { http_code, message } }, always application/json. 429 and 503 make Supabase retry (up to 3 times inside the same 5 seconds), which
 * would spend the allowance twice, so this route never answers those.
 *
 * Not proved against a real Supabase project: the field names are the documented ones, and email_changed_notification going to old_email.
 */

type Env = Record<string, string | undefined>;

export type Logger = { warn(line: string): void; error(line: string): void };

export type HookLimits = {
  /** The whole job, from the request arriving. Supabase gives up at 5000. */
  deadlineMs: number;
  /** The database calls (taking and handing back an allowance). */
  capMs: number;
  /** The most one provider may take. */
  providerMaxMs: number;
  /** Kept back for writing the answer. */
  reserveMs: number;
  /** A provider is not tried with less than this left. */
  minProviderMs: number;
};

export const DEFAULT_LIMITS: HookLimits = { deadlineMs: 3800, capMs: 400, providerMaxMs: 2200, reserveMs: 150, minProviderMs: 400 };

/** The body of an email-change hook is a few KB. Anything near this is not Supabase. */
export const MAX_BODY_BYTES = 256_000;

/** One line of notify_sends (queue_id stays null: there is no queue row). */
export type SendRow = { channel: "email"; provider: string; status: Attempt["status"]; provider_message_id: string | null; cost_usd: number; error: string | null };
export type SendLog = { record(rows: SendRow[]): Promise<void> };

export type HookDeps = {
  env: Env;
  /** Called after the signature is accepted, so a refused call costs nothing. */
  providers: () => EmailProvider[];
  /** null: no database configured. The caps are then not counted and the code goes anyway. */
  db: Pick<NotifyDb, "takeCap" | "giveCap"> | null;
  sends: SendLog | null;
  log: Logger;
  clock?: () => number;
  /** Keeps work that must not hold up the answer alive (handing back an allowance, the send log). In a route that is `after`. Without it the work still runs, just unwatched. */
  defer?: (work: Promise<unknown>) => void;
  limits?: Partial<HookLimits>;
};

// ---------------------------------------------------------------------------------------------------- what to send

const CODE = /^\d{6}$/;
const ADDRESS = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const address = (v: unknown): string => {
  const s = text(v);
  return s.length <= 320 && ADDRESS.test(s) ? s : "";
};
const web = (v: unknown): string => {
  const s = text(v);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
};

export type Plan = { ok: true; mails: AuthMail[]; skipped?: string } | { ok: false; error: string };

const NOTICES: Record<string, AuthVariant> = {
  password_changed_notification: "password_changed",
  email_changed_notification: "email_changed",
  phone_changed_notification: "phone_changed",
  identity_linked_notification: "identity_linked",
  identity_unlinked_notification: "identity_unlinked",
  mfa_factor_enrolled_notification: "mfa_enrolled",
  mfa_factor_unenrolled_notification: "mfa_unenrolled",
};

/** The action types Supabase documents. Anything else is handled as "unknown" below. */
export const DOCUMENTED_ACTIONS: readonly string[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
  "reauthentication",
  ...Object.keys(NOTICES),
];

/**
 * What a verified hook body asks for: which emails, to whom, with which code. Pure. Errors are plain words and never contain the body.
 * A code must be exactly six digits, because that is all the sign-in sheet takes (Authentication > Providers > Email > Email OTP Length).
 */
export function planAuthMails(body: unknown, env: Env = {}): Plan {
  const root = obj(body);
  const user = obj(root.user);
  const data = obj(root.email_data);
  const action = text(data.email_action_type);
  if (!action) return { ok: false, error: "no email_action_type" };
  const email = address(user.email);
  const newEmail = address(user.new_email);
  const token = text(data.token);
  const tokenNew = text(data.token_new);
  const meta = obj(user.user_metadata);
  const name = (text(meta.name) || text(meta.full_name)).split(/\s+/)[0] ?? "";
  const one = (variant: AuthVariant, to: string, extra: Partial<AuthMail> = {}): Plan => ({ ok: true, mails: [{ variant, action, to, ...extra }] });
  const needs = (what: string): Plan => ({ ok: false, error: `${action}: ${what}` });

  switch (action) {
    case "magiclink":
    case "email":
      if (!email) return needs("no valid address");
      return CODE.test(token) ? one("sign_in", email, { code: token }) : needs("no six digit code");
    case "signup":
      if (!email) return needs("no valid address");
      return CODE.test(token) ? one("sign_up", email, { code: token, name }) : needs("no six digit code");
    case "reauthentication":
      if (!email) return needs("no valid address");
      return CODE.test(token) ? one("reauth", email, { code: token }) : needs("no six digit code");
    case "email_change": {
      // Secure email change on: two codes for two people. `token` is for the CURRENT address and `token_new` for the NEW one (the hashes
      // are the other way round, which does not matter here because codes are all we send). Off, or a guest with no address yet: one
      // code, to the new address.
      if (!newEmail) return needs("no new address");
      if (email && CODE.test(token) && CODE.test(tokenNew)) {
        return {
          ok: true,
          mails: [
            { variant: "email_change_current", action, to: email, code: token, newEmail },
            { variant: "email_change_new", action, to: newEmail, code: tokenNew },
          ],
        };
      }
      const single = CODE.test(token) ? token : CODE.test(tokenNew) ? tokenNew : "";
      return single ? one("email_change_new", newEmail, { code: single }) : needs("no six digit code");
    }
    case "recovery":
      return email ? one("recovery", email) : needs("no valid address");
    case "invite": {
      // The one link: an invited person has no screen waiting for a code. Same as Ola's invite-user.html.
      const base = web(env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
      const hash = text(data.token_hash);
      if (!email) return needs("no valid address");
      if (!base || !hash) return needs("cannot build the invite link (NEXT_PUBLIC_SUPABASE_URL or token_hash missing)");
      const back = web(data.redirect_to);
      const link = `${base}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=invite${back ? `&redirect_to=${encodeURIComponent(back)}` : ""}`;
      return one("invite", email, { link });
    }
    default: {
      const variant = NOTICES[action];
      if (variant) {
        // The notice about a changed email is for the old address (old_email), which no longer belongs to the account.
        const to = action === "email_changed_notification" ? address(data.old_email) || email : email;
        if (!to) return needs("no valid address");
        return one(variant, to, { provider: text(data.provider) || text(data.factor_type) });
      }
      // A notice that Supabase adds later: nothing to send that we know how to word, and nothing a person is waiting for.
      if (/_notification$/.test(action)) return { ok: true, mails: [], skipped: `${action} is not one we send yet` };
      // Any other new type that comes with a code still gets the code to the person.
      if (email && CODE.test(token)) return one("code_other", email, { code: token });
      return needs("not a type this route knows");
    }
  }
}

// ---------------------------------------------------------------------------------------------------- the providers

/** Mailtrap before Mailjet: a provider that serves codes only goes first, so Mailjet's 100 a day are the spare, whatever order NOTIFY_PROVIDERS lists them in. */
export function codeProviders(all: readonly EmailProvider[], env: Env): EmailProvider[] {
  // The log provider sends nothing. It is never allowed to take real codes in production, fake mode or not (fake mode does not call Supabase at all).
  const live = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  const usable = all.filter((p) => p.kinds.includes("code") && !(live && p.name === "log"));
  return [...usable.filter((p) => p.kinds.length === 1), ...usable.filter((p) => p.kinds.length !== 1)];
}

// ---------------------------------------------------------------------------------------------------- small helpers

const within = <T>(work: Promise<T>, ms: number): Promise<T> => {
  work.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
};

/** Takes out anything that could be a secret or a person from a line before it is logged or stored: the code and hashes of this call, and any address. */
export function scrub(line: string, secrets: readonly string[] = []): string {
  let out = String(line);
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  return out.replace(/[^\s<>"',;:()[\]]+@[^\s<>"',;()[\]]+/g, "***");
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/** Supabase's documented error shape. Never 429 or 503, which it would retry. */
function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: JSON_HEADERS });
}

const success = () => new Response("{}", { status: 200, headers: JSON_HEADERS });

export const NOT_SET_UP = "Sign-in email is not set up";
export const COULD_NOT_SEND = "We could not send your sign-in email. Try again in a moment.";

// ---------------------------------------------------------------------------------------------------- the handler

export async function handleSendEmailHook(req: Request, deps: HookDeps): Promise<Response> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const L: HookLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const deadline = started + L.deadlineMs;
  const { log } = deps;
  const defer = (work: Promise<unknown>) => {
    work.catch(() => {});
    deps.defer?.(work);
  };

  // No secret, no service. There is no bypass: not for local use, not for fake mode.
  if (!secretKey(deps.env.SEND_EMAIL_HOOK_SECRET)) {
    log.error("[hoppaz] SIGN-IN EMAIL HOOK REFUSED EVERYTHING: SEND_EMAIL_HOOK_SECRET is not set (or is not a base64 secret). Set it in Vercel, or disable the hook in Supabase.");
    return failure(500, NOT_SET_UP);
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return failure(413, "Too large");
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return failure(413, "Too large");

  const check = verifyWebhook(deps.env.SEND_EMAIL_HOOK_SECRET, req.headers, raw, clock() / 1000);
  if (!check.ok) {
    log.warn(`[hoppaz] sign-in email hook: call refused (${check.reason})`);
    return failure(401, "Invalid signature");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure(400, "Not JSON");
  }
  const plan = planAuthMails(body, deps.env);
  const data = obj(obj(body).email_data);
  const action = text(data.email_action_type).slice(0, 60);
  // Everything in this call that must never be written down: scrubbed out of every line below, whatever put it there.
  const secrets = ["token", "token_new", "token_hash", "token_hash_new"].map((k) => text(data[k]));
  if (!plan.ok) {
    log.error(`[hoppaz] SIGN-IN EMAIL NOT SENT: the hook call could not be used (${scrub(plan.error, secrets)}). Check the Email OTP length (6) and the Secure email change setting in Supabase.`);
    return failure(400, "This email could not be built");
  }
  if (!plan.mails.length) {
    log.warn(`[hoppaz] sign-in email hook: nothing sent, ${scrub(plan.skipped ?? action, secrets)}`);
    return success();
  }

  const providers = codeProviders(deps.providers(), deps.env);
  if (!providers.length) {
    log.error("[hoppaz] SIGN-IN EMAIL NOT SENT: no provider for codes is set up (NOTIFY_PROVIDERS, MAILTRAP_API_KEY, MAILJET_API_KEY and MAILJET_SECRET_KEY). The log provider is not allowed in production.");
    return failure(500, NOT_SET_UP);
  }

  // Bookkeeping that fails open: a database that is slow or down must never stop a code.
  const tookNothing = new Map<string, number>();
  let dbTrouble = false;
  const trouble = (what: string, e: unknown) => {
    if (dbTrouble) return;
    dbTrouble = true;
    log.error(`[hoppaz] sign-in email: ${what} failed (${scrub(messageOf(e), secrets)}), sending the code anyway. Daily counts will be low until the database is back.`);
  };
  const caps: CapStore = {
    async take(provider: string, kind: CapKind) {
      try {
        if (!deps.db) throw new Error("no database configured");
        return await within(deps.db.takeCap(provider, kind), L.capMs);
      } catch (e) {
        trouble("taking the daily allowance", e);
        tookNothing.set(provider, (tookNothing.get(provider) ?? 0) + 1);
        return true;
      }
    },
    async give(provider: string, kind: CapKind) {
      // A unit that was never taken (the database was down) is not handed back.
      const n = tookNothing.get(provider) ?? 0;
      if (n > 0) {
        tookNothing.set(provider, n - 1);
        return;
      }
      if (!deps.db) return;
      defer(deps.db.giveCap(provider, kind).catch((e) => trouble("handing back an allowance", e)));
    },
  };

  const budgeted = (p: EmailProvider, index: number): EmailProvider => ({
    name: p.name,
    kinds: p.kinds,
    async send(msg: OutgoingEmail): Promise<SendResult> {
      const left = deadline - clock() - L.reserveMs;
      const ms = Math.floor(Math.min(L.providerMaxMs, left / (providers.length - index)));
      if (ms < L.minProviderMs) return { ok: false, error: `${p.name}: no time left` };
      // The provider is asked to give up at `ms` (its fetch is aborted), and is not waited for beyond that even if it ignores the request.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<SendResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: `${p.name}: timed out` }), ms + 100);
      });
      try {
        const work = p.send({ ...msg, timeoutMs: ms });
        work.catch(() => {});
        return await Promise.race([work, late]);
      } finally {
        clearTimeout(timer);
      }
    },
  });
  const tryOrder = providers.map(budgeted);
  const state = newRouterState();

  const results = await Promise.all(
    plan.mails.map(async (mail) => {
      const hidden = [...secrets, mail.code ?? "", mail.link ?? ""];
      // The "row" exists only to drive the router. It carries no payload and no queue id.
      const row: ClaimedRow = {
        id: "",
        user_id: "",
        kind: `auth:${mail.action}`,
        event_id: null,
        channel: "email",
        cap_kind: "code",
        payload: {},
        priority: 1,
        tries: 0,
        dedupe_key: "",
        email: mail.to,
        whatsapp_number: null,
      };
      const outcome = await routeEmail(row, tryOrder, caps, state, () => new Date(clock()), () => renderAuthEmail(mail));
      const sent = outcome.final === "sent";
      const rows: SendRow[] = outcome.attempts.map((a) => ({
        channel: "email",
        provider: a.provider,
        status: a.status,
        provider_message_id: a.message_id,
        cost_usd: a.cost_usd,
        error: (a.error ? `auth:${mail.action}: ${scrub(a.error, hidden)}` : `auth:${mail.action}`).slice(0, 500),
      }));
      return { mail, sent, outcome, rows, hidden };
    }),
  );

  const rows = results.flatMap((r) => r.rows);
  if (deps.sends && rows.length) {
    const sends = deps.sends;
    defer(sends.record(rows).catch((e) => trouble("writing the send log", e)));
  } else if (!deps.sends) {
    trouble("writing the send log", new Error("no database configured"));
  }

  const failed = results.filter((r) => !r.sent);
  if (!failed.length) {
    const backup = results.some((r) => r.outcome.attempts.some((a) => a.status === "failed"));
    if (backup) log.warn(`[hoppaz] sign-in email: sent, but only after a provider failed (${results.map((r) => r.outcome.attempts.map((a) => `${a.provider} ${a.status}`).join(", ")).join("; ")})`);
    return success();
  }

  for (const r of failed) {
    const why = r.outcome.attempts.map((a) => `${a.provider}: ${scrub(a.error ?? a.status, r.hidden)}`).join("; ");
    const where = `${r.mail.action} to ${maskAddress(r.mail.to)}`;
    const partial = results.length > 1 && failed.length < results.length ? " One of the two emails of this change did go." : "";
    log.error(`[hoppaz] SIGN-IN EMAIL NOT SENT (${where}): every provider failed or is full. ${why}.${partial} The person sees an error and can ask again.`);
  }
  return failure(500, COULD_NOT_SEND);
}

// ---------------------------------------------------------------------------------------------------- the real send log

/** notify_sends, written with the service key. The table allows no kind column, so the error column starts with auth:<email_action_type>. */
export function supabaseSendLog(sb: SupabaseClient): SendLog {
  return {
    async record(rows) {
      const { error } = await sb.from("notify_sends").insert(rows.map((r) => ({ ...r, queue_id: null })));
      if (error) throw new Error(`notify_sends: ${error.message}`);
    },
  };
}
