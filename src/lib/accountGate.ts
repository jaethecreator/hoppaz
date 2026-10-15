"use client";

import { getSupabase } from "./supabase/client";
import { useSessionStore } from "./useSession";

/**
 * The account gate. Browsing is open to everyone; doing things (saying WE
 * OUTSIDE, checking in, claiming rewards, crews, your profile) needs an
 * account. A gated action calls requireAccount(): with an account it is a
 * no-op; without one it routes to the full account page.
 */

/**
 * What a gated hook hands back instead of an error message. The toast store
 * ignores it (the sheet is already explaining), and anything that shows
 * errors inline should check isNeedAccount() first.
 */
export const NEED_ACCOUNT = "need_account";
export const isNeedAccount = (msg: string | null | undefined) => msg === NEED_ACCOUNT;

/** Send a guest to the account page and return them to this screen afterwards. */
export function goToAccount(reason: string, mode: "create" | "login" = "create", detail?: string): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const target = new URL("/account", window.location.origin);
  target.searchParams.set("mode", mode);
  target.searchParams.set("reason", reason);
  if (detail) target.searchParams.set("detail", detail);
  target.searchParams.set("next", next.startsWith("/account") ? "/me" : next);
  window.location.assign(`${target.pathname}${target.search}${target.hash}`);
}

/**
 * True when the Hopper can go ahead. False when they need an account; they are
 * routed to the account page and can repeat the action after signing in.
 * Without a database (local demo) nothing is gated.
 */
export function requireAccount(reason: string, opts?: { quiet?: boolean }): boolean {
  if (!getSupabase()) return true;
  if (useSessionStore.getState().email) return true;
  // Quiet: the caller has asked already this visit (the Today deck's right swipes) and only needs the answer.
  if (opts?.quiet) return false;
  // Return to this screen after sign-in; the Hopper can repeat the action.
  goToAccount(reason);
  return false;
}
