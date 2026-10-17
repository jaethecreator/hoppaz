"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import { clearUser, clearUsersExcept, read, revalidate, write } from "./phoneCache";
import { randomLook } from "./avatar";
import { useHoppaz } from "./store";
import type { Profile } from "./types";

/**
 * The session, held once for the whole app. Supabase anonymous sign-in gives
 * every Hopper a real user id on first open; making an account attaches an
 * email to that same id, and logging in swaps to another one. Every screen
 * reads this one store, so a sign-up or log-in shows everywhere at once,
 * without a reload, and only one anonymous user is ever made per phone.
 */

type SessionState = {
  userId: string | null;
  /** Set once the Hopper has an account (email + password); null while anonymous. */
  email: string | null;
  profile: Profile | null;
  state: "loading" | "ready" | "offline";
  /**
   * True only when this page load made a brand-new anonymous user. Such a user has no check-ins, stats or history, so the
   * hooks that read them skip the network. False for any existing session or sign-in.
   */
  freshGuest: boolean;
  set: (patch: Partial<Omit<SessionState, "set">>) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  email: null,
  profile: null,
  state: "loading",
  freshGuest: false,
  set: (patch) => set(patch),
}));

const profileKey = (id: string) => `u.${id}.profile`;
/** A copy of someone's profile is shown for up to 30 days while the real one is fetched. */
const PROFILE_KEEP_MS = 30 * 24 * 3.6e6;
const PROFILE_FRESH_MS = 5 * 60 * 1000;

/** `force` skips the 5 minute rest: after a check-in, or when an account was just made. */
async function loadProfile(id: string, force = false) {
  const sb = getSupabase();
  if (!sb) return;
  const data = await revalidate<Profile>(
    profileKey(id),
    async () => {
      const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
      return (data as Profile | null) ?? null;
    },
    { freshMs: PROFILE_FRESH_MS, force }
  );
  // Only if still the same person: a log-in may have swapped users meanwhile.
  if (data && useSessionStore.getState().userId === id) useSessionStore.getState().set({ profile: data });
  if (data && !data.avatar && useSessionStore.getState().userId === id) void dressOnce(id, data);
}

/** Hoppers already given a look this page load, so a slow save is not repeated by the next profile read. */
const dressed = new Set<string>();

/**
 * A new Hopper has no look saved, and an empty look draws as the same default outfit for everyone. Give them their own:
 * the one they made on this phone before saving it, or a random one. Written only while the profile still has none, so
 * a look picked on another phone in the meantime is never overwritten.
 */
async function dressOnce(id: string, profile: Profile) {
  const sb = getSupabase();
  if (!sb || dressed.has(id)) return;
  dressed.add(id);
  const look = useHoppaz.getState().look ?? randomLook();
  const { error } = await sb.from("profiles").update({ avatar: look }).eq("id", id).is("avatar", null);
  if (error || useSessionStore.getState().userId !== id) return;
  const next = { ...profile, avatar: look };
  useSessionStore.getState().set({ profile: next });
  write(profileKey(id), next);
  if (!useHoppaz.getState().look) useHoppaz.getState().setLook(look);
}

/** True while `anonymous()` is making a new user: whoever is adopted then is a fresh guest. */
let creatingGuest = false;

let started = false;

/** Runs once per page load: find or make the session, then follow every change to it. */
function start() {
  if (started) return;
  started = true;
  const sb = getSupabase();
  const { set } = useSessionStore.getState();
  if (!sb) return set({ state: "offline" });

  const adopt = (user: { id: string; email?: string | null } | null) => {
    const { userId: before, email: hadEmail } = useSessionStore.getState();
    set({ userId: user?.id ?? null, email: user?.email || null });
    if (user && user.id !== before) {
      // A different person from the one before: their copies must not outlive them on this phone.
      if (before) clearUser(before);
      else clearUsersExcept(user.id);
      const held = read<Profile>(profileKey(user.id));
      const usable = held && Date.now() - held.at <= PROFILE_KEEP_MS ? held.data : null;
      // With the phone's copy the app is ready at once and the profile is checked quietly behind it.
      set(usable ? { profile: usable, state: "ready", freshGuest: creatingGuest } : { profile: null, freshGuest: creatingGuest });
      void loadProfile(user.id).then(() => set({ state: "ready" }));
    } else if (user && (user.email || null) !== hadEmail) {
      // Same person, just made an account: the sign-up set their name, so read it back.
      void loadProfile(user.id, true).then(() => set({ state: "ready" }));
    } else if (user) {
      set({ state: "ready" });
    }
  };

  const anonymous = async () => {
    creatingGuest = true;
    const { data, error } = await sb.auth.signInAnonymously().finally(() => {
      // The auth event for the new user has been heard by now; anything adopted after this is not a fresh guest.
      setTimeout(() => (creatingGuest = false), 0);
    });
    if (error) {
      // Almost always: anonymous sign-ins are still switched off in the
      // Supabase dashboard. Say so rather than failing silently.
      console.warn("[hoppaz] anonymous sign-in failed:", error.message);
      set({ state: "offline" });
      return;
    }
    adopt(data.user);
  };

  void sb.auth.getSession().then(({ data, error }) => {
    if (data.session) return adopt(data.session.user);
    // A stored session whose refresh failed only because the network did is still this Hopper's:
    // signing in again would overwrite it with a new anonymous account (and orphan the XP, badges and streak).
    // Any other refresh failure means the server turned the session down and it has been cleared, so a fresh start is right.
    if (error && isAuthRetryableFetchError(error)) {
      console.warn("[hoppaz] session start-up failed:", error.message);
      return set({ state: "offline" });
    }
    void anonymous();
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      // Logging out leaves you as a fresh anonymous Hopper, like a first open. Nothing of the last person stays on the phone.
      const last = useSessionStore.getState().userId;
      if (last) clearUser(last);
      else clearUser();
      set({ userId: null, email: null, profile: null, state: "loading" });
      void anonymous();
      return;
    }
    if (session?.user) adopt(session.user);
  });
}

export function useSession() {
  const { userId, email, profile, state, set } = useSessionStore();

  useEffect(() => {
    start();
  }, []);

  const patchProfile = useCallback(
    async (patch: Partial<Pick<Profile, "display_name" | "area" | "avatar">>) => {
      const sb = getSupabase();
      if (!sb || !userId) return;
      const p = useSessionStore.getState().profile;
      if (p) {
        const next = { ...p, ...patch };
        set({ profile: next });
        write(profileKey(userId), next);
      }
      await sb.from("profiles").update(patch).eq("id", userId);
    },
    [userId, set]
  );

  const refresh = useCallback(() => {
    if (userId) void loadProfile(userId, true);
  }, [userId]);

  return { userId, email, hasAccount: !!email, profile, state, patchProfile, refresh };
}
