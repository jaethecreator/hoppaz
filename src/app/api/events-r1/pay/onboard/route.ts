import { NextResponse } from "next/server";
import { createAccountLink, createConnectedAccount } from "@/lib/bachs/api";
import { BachsError, bachsConfig } from "@/lib/bachs/client";
import type { PayDb } from "@/lib/bachs/db";
import { fail, isResponse, json, limiter, refreshValid, safePath, sameOrigin, serviceDb, sessionOf, signRefresh, siteOrigin, UUID } from "@/lib/bachs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slowDown = limiter(6);
const REFRESH_DAYS = 7;

/**
 * Host payout setup (Bachs Connect, spec section 2). Each host is their own merchant: their own Bachs account, created once, and
 * a single-use hosted onboarding link made on click.
 *
 *   POST { returnPath } with a bearer session (a signed-in host) -> { url }. returnPath is a path on this site, for example
 *        /host/<event>?tab=overview (PayApi.startOnboarding). First call creates the connected account (fees collector "bachs":
 *        the host pays Bachs's fee) and saves it with ev_pay_host_save_account; later calls reuse it. The host is sent to `url`.
 *   GET  ?u=<user>&r=<returnPath>&e=<expiry>&s=<signature> is the refresh_url. Bachs sends the host's browser here when the link
 *        was used or has expired; the signed query says whose it is (there is no session header on a redirect). It makes a new link
 *        and redirects to it. A link older than 7 days, or with a bad signature, goes back to the site instead.
 * Whether the host can sell is never decided here: capability.updated and account.updated webhooks fill ev_host_payouts.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Not allowed.");
  const session = await sessionOf(req);
  if (isResponse(session)) return session;
  if (slowDown(session.userId)) return fail(429, "Give it a moment, then try again.");
  if (!bachsConfig()) return fail(503, "Payments are not set up yet.", { reason: "not_configured" });
  const body = (await req.json().catch(() => null)) as { returnPath?: unknown } | null;
  const returnPath = safePath(body?.returnPath, "/");
  try {
    const account = await ensureAccount(session.db, session.userId, session.email, session.name);
    if (!account) return fail(409, "This host already has a payout account.", { reason: "account_conflict" });
    return json({ url: await linkFor(req, session.userId, account, returnPath) });
  } catch (e) {
    return bachsFailure(e);
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const userId = u.searchParams.get("u") ?? "";
  const returnPath = safePath(u.searchParams.get("r"), "/");
  const expiresAt = Number(u.searchParams.get("e"));
  const home = NextResponse.redirect(new URL(returnPath, siteOrigin(req)));
  if (!UUID.test(userId) || !refreshValid(userId, returnPath, expiresAt, u.searchParams.get("s") ?? "") || !bachsConfig()) return home;
  const db = serviceDb();
  const account = db ? await db.hostAccountOf(userId).catch(() => null) : null;
  if (!account) return home;
  try {
    return NextResponse.redirect(await linkFor(req, userId, account, returnPath));
  } catch (e) {
    console.error(`[bachs] onboarding refresh failed: ${(e as Error).message}`);
    return home;
  }
}

/** The host's Bachs account: the one we hold, or a new one (idempotent per user, so a retry after a timeout does not make a second). */
async function ensureAccount(db: PayDb, userId: string, email: string, name: string): Promise<string | null> {
  const existing = await db.hostAccountOf(userId);
  if (existing) return existing;
  const created = await createConnectedAccount({ email, displayName: name, idempotencyKey: `host:${userId}:acct1` });
  const saved = await db.hostSaveAccount(userId, created.id);
  return saved === "ok" ? created.id : null;
}

/** A fresh single-use link. A new link kills the old one, so this runs on click only, never in advance. */
async function linkFor(req: Request, userId: string, account: string, returnPath: string): Promise<string> {
  const origin = siteOrigin(req);
  const exp = Math.floor(Date.now() / 1000) + REFRESH_DAYS * 86400;
  const refresh = `${origin}/api/events-r1/pay/onboard?${new URLSearchParams({ u: userId, r: returnPath, e: String(exp), s: signRefresh(userId, returnPath, exp) })}`;
  const link = await createAccountLink(account, { refreshUrl: refresh, returnUrl: `${origin}${returnPath}`, type: "onboarding" });
  return link.url;
}

function bachsFailure(e: unknown) {
  if (e instanceof BachsError) {
    if (e.kind === "unavailable" || e.kind === "rate_limited") return fail(503, "Bachs is slow right now. Try again in a minute.", { reason: "bachs_unavailable" });
    // 403 on create means Hoppaz's own Connect is not switched on yet (spec section 2, prerequisite).
    if (e.kind === "auth") return fail(503, "Payouts are not open yet.", { reason: "connect_not_enabled" });
  }
  console.error(`[bachs] onboarding failed: ${(e as Error).message}`);
  return fail(502, "Could not open payout setup. Try again.", { reason: "bachs_failed" });
}
