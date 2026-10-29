"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";

/**
 * Accounts, the client half. Browsing is open to everyone; an account (name,
 * email, password: three fields, nothing else) is what lets you say WE OUTSIDE,
 * check in, earn rewards, crew up and chat privately. See accountGate.ts.
 * Everything else (gender, then birthday) is asked later, one question a day.
 */

export type Gender = "female" | "male" | "other";
export const GENDERS: ReadonlyArray<[Gender, string]> = [
  ["female", "Female"],
  ["male", "Male"],
  ["other", "Other / rather not say"],
];

const ALREADY = /already|exists|registered/i;

/**
 * Sign-up with an email that already has an account: they have been here before, so log them in with the password they just
 * typed. Only when that fails do they hear about it, pointed at the way back in.
 */
async function alreadyHere(email: string, password: string): Promise<string | null> {
  const err = await logIn(email, password);
  return err ? "You already have an account with this email. Log in with your password, or with Google if you used it before." : null;
}

/** Returns an error line, or null once the Hopper is signed in to the new account (or back into the one they already had). */
export async function createAccount(input: { name: string; email: string; password: string; gender?: Gender }): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    // No anonymous session to upgrade (anonymous sign-ins switched off): a plain sign-up.
    const { data: made, error } = await sb.auth.signUp({ email: input.email, password: input.password, options: { data: { name: input.name } } });
    if (error) return ALREADY.test(error.message) ? alreadyHere(input.email, input.password) : error.message;
    // An email that is taken comes back as a user with no identities (Supabase hides it when confirmations are on).
    if (made.user && made.user.identities?.length === 0) return alreadyHere(input.email, input.password);
    // Confirm sign up is on: no session until they tap the link in the email.
    if (!made.session) return `Almost there. We sent a link to ${input.email}. Tap it to confirm, then log in.`;
    if (input.gender) await sb.rpc("set_private_details", { p_gender: input.gender });
    return null;
  }
  const res = await fetch("/api/account/create", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  // 409: the email has an account already (or this session is one). Their guest progress stays with the guest, as with Google.
  if (res.status === 409) return alreadyHere(input.email, input.password);
  if (!res.ok) return out.error ?? "Could not create the account";
  // Same user, now with an email: sign in so the session knows it too.
  const { error } = await sb.auth.signInWithPassword({ email: input.email, password: input.password });
  return error ? "Account made. Log in with your email and password." : null;
}

export async function logIn(email: string, password: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) return null;
  return /invalid/i.test(error.message) ? "Wrong email or password" : error.message;
}

/** Where Google sends the Hopper back to: the canonical site's /auth/callback, carrying the page to land on. */
export function googleCallback(next: string): string {
  const returnTo = next.startsWith("/") && !next.startsWith("//") ? next : "/me";
  // Pin production OAuth callbacks to the canonical site even when sign-in is
  // started from a preview URL or an installed app with an unexpected origin.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || window.location.origin;
  const callback = new URL("/auth/callback", siteUrl);
  callback.searchParams.set("next", returnTo);
  return callback.toString();
}

/** Linking was refused because this Google account is already someone's Hoppaz account. */
export const IDENTITY_TAKEN = /identity_already_exists|identity already exists|already linked to another user/i;

/**
 * Start Google OAuth, linking a guest during account creation so their Hoppaz progress stays attached. A Google account that
 * already has a Hoppaz account just signs in to it (the callback does the same when the refusal comes back from Google).
 */
export async function continueWithGoogle(next: string, linkGuest: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const options = { redirectTo: googleCallback(next) };
  // The stored session is enough to tell a guest from an account: no round trip before Google opens.
  const { data } = await sb.auth.getSession();
  let result = linkGuest && data.session?.user.is_anonymous
    ? await sb.auth.linkIdentity({ provider: "google", options })
    : await sb.auth.signInWithOAuth({ provider: "google", options });
  if (result.error && IDENTITY_TAKEN.test(result.error.message)) result = await sb.auth.signInWithOAuth({ provider: "google", options });
  if (result.error && /unsupported provider|provider.*not enabled/i.test(result.error.message)) {
    return "Google sign-in is not configured for this Hoppaz project yet. An admin needs to enable Google and add its OAuth Client ID and Secret in Supabase Authentication settings.";
  }
  if (result.error && /manual.*link.*disabled/i.test(result.error.message)) {
    return "Google sign-up is not enabled yet. The Hoppaz admin needs to enable manual identity linking in Supabase. You can use email sign-up for now.";
  }
  return result.error?.message ?? null;
}

export async function logOut() {
  const sb = getSupabase();
  await sb?.auth.signOut();
}

/* ------------------------------------------------- tell us more, slowly -- */

type Details = { gender: Gender | null; birthday: string | null; account_at: string | null };

/**
 * What to ask an account holder, one question at a time, each only once the
 * account is old enough. Add the next question here; nothing else changes.
 */
export const ASKS: ReadonlyArray<{ key: "gender" | "birthday"; afterDays: number; missing: (d: Details) => boolean }> = [
  { key: "gender", afterDays: 1, missing: (d) => !d.gender },
  { key: "birthday", afterDays: 2, missing: (d) => !d.birthday },
];

const SNOOZE = "hoppaz.ask-snooze";
const DAY = 24 * 3.6e6;

/** The next question due for this Hopper, if any, plus how to answer or put it off. */
export function useNextAsk(userId: string | null, hasAccount: boolean) {
  const [details, setDetails] = useState<Details | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || !hasAccount) return;
    let cancelled = false;
    void sb
      .from("profile_private")
      .select("gender, birthday, account_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDetails((data as Details | null) ?? { gender: null, birthday: null, account_at: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, hasAccount]);

  const [snoozed, setSnoozed] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(SNOOZE) ?? 0);
    } catch {
      return 0;
    }
  });

  const since = details?.account_at ? Date.now() - Date.parse(details.account_at) : 0;
  const next =
    details && Date.now() > snoozed
      ? ASKS.find((a) => since >= a.afterDays * DAY && a.missing(details)) ?? null
      : null;

  const later = useCallback(() => {
    const until = Date.now() + DAY;
    setSnoozed(until);
    try {
      localStorage.setItem(SNOOZE, String(until));
    } catch {
      /* private mode: it just asks again next visit */
    }
  }, []);

  const answer = useCallback(async (patch: { birthday?: string; gender?: Gender }) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { data } = await sb.rpc("set_private_details", { p_gender: patch.gender ?? null, p_birthday: patch.birthday ?? null });
    if (data) setDetails((d) => (d ? { ...d, ...patch } : d));
    return !!data;
  }, []);

  return { next, later, answer };
}
