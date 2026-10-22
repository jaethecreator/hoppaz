import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";
import { supabasePayDb, type PayDb } from "./db";

/**
 * What the payment routes under api/events-r1/pay share. Server only. Same sign-in pattern as the neighbouring routes (a Supabase
 * bearer token, permanent accounts only, queerServer.ts), same rate limiter idea as crew/rooms/voice.
 */

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One small per-person limiter per route: true when this person has asked `max` times in `windowMs`. */
export function limiter(max: number, windowMs = 60_000) {
  const asked = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (asked.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      asked.set(key, recent);
      return true;
    }
    recent.push(now);
    asked.set(key, recent);
    if (asked.size > 5000) for (const [k, times] of asked) if (!times.some((at) => now - at < windowMs)) asked.delete(k);
    return false;
  };
}

/** The public address of the site: NEXT_PUBLIC_SITE_URL, else the address this request came to. */
export function siteOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}

/**
 * Where Bachs sends the buyer back. Bachs refuses a private or loopback address for success_url, so a laptop talking to the real
 * sandbox sets BACHS_RETURN_ORIGIN to a public address. Unset: the site origin (right for production and for the local mock).
 */
export const returnOrigin = (req: Request) => (process.env.BACHS_RETURN_ORIGIN?.replace(/\/+$/, "") || siteOrigin(req));

/** A browser POST from another site is refused. No Origin header (a script, the cron) passes: those carry a bearer or a secret anyway. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    const own = new URL(siteOrigin(req)).host;
    return host === own || host === new URL(req.url).host || host === req.headers.get("host");
  } catch {
    return false;
  }
}

export type Session = { userId: string; email: string; name: string; userClient: NonNullable<ReturnType<typeof getQueerServerClients>>["auth"]; db: PayDb };

/** The signed-in (permanent) user, the service-key database, and the user's own client (for the six ev_pay_ functions a person may call). */
export async function sessionOf(req: Request): Promise<Session | NextResponse> {
  const clients = getQueerServerClients(bearerFrom(req));
  if (!clients) return fail(401, "Sign in to continue.");
  const user = await getPermanentUser(clients.auth);
  if (!user) return fail(401, "Make an account to continue.");
  const { data: profile } = await clients.admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  return {
    userId: user.id,
    email: user.email ?? "",
    name: (profile?.display_name || user.user_metadata?.name || "Hopper").toString().slice(0, 60),
    userClient: clients.auth,
    db: supabasePayDb(clients.admin),
  };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;

/** The service-key database alone (webhook, sweeper). Null when Supabase is not configured. */
export function serviceDb(): PayDb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return supabasePayDb(createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }));
}

/** HOPPAZ_CRON_SECRET, else the existing CRON_SECRET (Vercel Cron sends it as a bearer). Also accepted in x-hoppaz-cron-secret. */
export function cronAllowed(req: Request): boolean {
  const secret = process.env.HOPPAZ_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.headers.get("x-hoppaz-cron-secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A short-lived signed token for the onboarding refresh_url. Bachs redirects the host's browser there with no Hoppaz session
 * header, so the link itself carries who and where, signed with a key made from BACHS_SECRET_KEY (never sent anywhere).
 */
const signingKey = () => createHmac("sha256", "hoppaz-onboard-refresh").update(process.env.BACHS_SECRET_KEY ?? "").digest();
export function signRefresh(userId: string, returnPath: string, expiresAt: number): string {
  return createHmac("sha256", signingKey()).update(`${userId}|${returnPath}|${expiresAt}`).digest("hex");
}
export function refreshValid(userId: string, returnPath: string, expiresAt: number, sig: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
  const want = Buffer.from(signRefresh(userId, returnPath, expiresAt));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A same-site path only (no scheme, no //, no backslash). */
export const safePath = (p: unknown, fallback = "/"): string => (typeof p === "string" && /^\/(?!\/)[^\s\\]{0,300}$/.test(p) ? p : fallback);
