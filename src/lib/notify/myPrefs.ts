import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import { getSupabase } from "@/lib/supabase/client";

/**
 * A signed-in person's own email settings, for the page at /account/notifications. Browser side.
 * Real: the functions notify_get_my_prefs and notify_set_my_prefs (supabase/events_r1_notify_prefs.sql); they act only on the caller.
 * Fake (NEXT_PUBLIC_EVENTS_R1_FAKE=1): kept in this browser's localStorage per fake person, like the rest of the Release 1 fake data.
 */

export type MyPrefs = { email_reminders: boolean; email_pops: boolean };
export type MyPrefsPatch = Partial<MyPrefs>;

export const DEFAULT_PREFS: MyPrefs = { email_reminders: true, email_pops: true };

export const FAKE_PREFS_KEY = "hz.notify.prefs.v1";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function readAll(store: Storage | null): Record<string, Partial<MyPrefs>> {
  try {
    const raw = store?.getItem(FAKE_PREFS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Partial<MyPrefs>>) : {};
  } catch {
    return {};
  }
}

/** The fake store: one record per person id. Takes the storage so a check can hand it a plain object. */
export function fakePrefs(store: Storage | null) {
  return {
    load(userId: string): MyPrefs {
      const mine = readAll(store)[userId] ?? {};
      return { email_reminders: mine.email_reminders !== false, email_pops: mine.email_pops !== false };
    },
    save(userId: string, patch: MyPrefsPatch): MyPrefs {
      const all = readAll(store);
      const next = { ...fakePrefs(store).load(userId), ...patch };
      all[userId] = next;
      try {
        store?.setItem(FAKE_PREFS_KEY, JSON.stringify(all));
      } catch {
        // storage full or blocked: the change lasts until the page is closed
      }
      return next;
    },
  };
}

const browserStore = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const parse = (d: unknown): MyPrefs => {
  const o = (d && typeof d === "object" ? d : {}) as Partial<MyPrefs>;
  return { email_reminders: o.email_reminders !== false, email_pops: o.email_pops !== false };
};

export async function loadMyPrefs(userId: string): Promise<MyPrefs> {
  if (EVENTS_R1_FAKE) return fakePrefs(browserStore()).load(userId);
  const sb = getSupabase();
  if (!sb) throw new Error("Not connected");
  const { data, error } = await sb.rpc("notify_get_my_prefs");
  if (error) throw new Error(error.message);
  return parse(data);
}

export async function saveMyPrefs(userId: string, patch: MyPrefsPatch): Promise<MyPrefs> {
  if (EVENTS_R1_FAKE) return fakePrefs(browserStore()).save(userId, patch);
  const sb = getSupabase();
  if (!sb) throw new Error("Not connected");
  const { data, error } = await sb.rpc("notify_set_my_prefs", { p_reminders: patch.email_reminders ?? null, p_pops: patch.email_pops ?? null });
  if (error) throw new Error(error.message);
  return parse(data);
}
