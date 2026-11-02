import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./http";
import { verifyUnsubToken, type UnsubSetting } from "./unsubToken";

/**
 * What the unsubscribe page and route do with a signed link: read one person's two email settings, switch one. The database half is
 * notify_get_prefs and notify_set_pref in supabase/events_r1_notify_prefs.sql (service role only); the link carries no sign-in.
 * Server only. Local development with the fake switch gets an in-memory store instead, so the whole flow can be seen without a database.
 */

type Env = Record<string, string | undefined>;

export type EmailSettings = { reminders: boolean; pops: boolean };

export interface PrefStore {
  /** null: there is no such person. */
  get(userId: string): Promise<EmailSettings | null>;
  /** false: there is no such person. */
  set(userId: string, setting: UnsubSetting, on: boolean): Promise<boolean>;
}

export function supabasePrefStore(sb: SupabaseClient): PrefStore {
  return {
    async get(userId) {
      const { data, error } = await sb.rpc("notify_get_prefs", { p_user: userId });
      if (error) throw new Error(`notify_get_prefs: ${error.message}`);
      if (!data || typeof data !== "object") return null;
      const d = data as { email_reminders?: unknown; email_pops?: unknown };
      return { reminders: d.email_reminders !== false, pops: d.email_pops !== false };
    },
    async set(userId, setting, on) {
      const { data, error } = await sb.rpc("notify_set_pref", { p_user: userId, p_setting: setting, p_on: on });
      if (error) throw new Error(`notify_set_pref: ${error.message}`);
      return data === true;
    },
  };
}

/** The fake switch on a development server. Never on in a production build, whatever the variable says. */
export const fakeDev = (env: Env = process.env): boolean => env.NEXT_PUBLIC_EVENTS_R1_FAKE === "1" && env.NODE_ENV !== "production";

type Shared = typeof globalThis & { __hoppazFakeNotifyPrefs?: Map<string, EmailSettings> };

/** One map per server process (the page and the route are separate bundles in development, so it hangs on globalThis). Any person id exists. */
export function fakePrefStore(): PrefStore {
  const g = globalThis as Shared;
  const map = (g.__hoppazFakeNotifyPrefs ??= new Map());
  return {
    async get(userId) {
      return { ...(map.get(userId) ?? { reminders: true, pops: true }) };
    },
    async set(userId, setting, on) {
      map.set(userId, { ...(map.get(userId) ?? { reminders: true, pops: true }), [setting]: on });
      return true;
    },
  };
}

/** The store to use, or null when none is configured (no database address or service key). */
export function prefStoreFor(env: Env = process.env): PrefStore | null {
  if (fakeDev(env)) return fakePrefStore();
  const sb = serviceClient(env);
  return sb ? supabasePrefStore(sb) : null;
}

export type UnsubView =
  | { ok: true; setting: UnsubSetting; on: boolean }
  | { ok: false; reason: "bad_link" | "no_person" | "unavailable" };

/** The state a link points at. A link that does not verify never reaches the store. Changes nothing. */
export async function readUnsub(token: string | null | undefined, store: PrefStore | null, env: Env = process.env): Promise<UnsubView> {
  const who = verifyUnsubToken(token, env);
  if (!who) return { ok: false, reason: "bad_link" };
  if (!store) return { ok: false, reason: "unavailable" };
  try {
    const now = await store.get(who.userId);
    return now ? { ok: true, setting: who.setting, on: now[who.setting] } : { ok: false, reason: "no_person" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Switches the link's setting on or off. The only function in this file that writes. */
export async function applyUnsub(token: string | null | undefined, on: boolean, store: PrefStore | null, env: Env = process.env): Promise<UnsubView> {
  const who = verifyUnsubToken(token, env);
  if (!who) return { ok: false, reason: "bad_link" };
  if (!store) return { ok: false, reason: "unavailable" };
  try {
    return (await store.set(who.userId, who.setting, on)) ? { ok: true, setting: who.setting, on } : { ok: false, reason: "no_person" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
