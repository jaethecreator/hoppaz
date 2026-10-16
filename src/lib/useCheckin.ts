"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { BADGES } from "./brand";
import { areaByName } from "./geo";
import { useToast } from "./store";
import { requireAccount } from "./accountGate";
import { useSessionStore } from "./useSession";
import { read, remove, revalidate, write } from "./phoneCache";
import { sfx } from "./sound/sfx";
import { haptics } from "./haptics";
import type { CheckinClaim, EventRow } from "./types";

export const CHECKIN_RADIUS_M = 1500;

/** Fired once, the first time a Hopper checks in. The install sheet listens: it is its second and last chance. */
export const FIRST_CHECKIN_EVENT = "hoppaz:first-checkin";
const FIRST_CHECKIN_KEY = "hoppaz.firstCheckin";

function markFirstCheckin() {
  try {
    if (localStorage.getItem(FIRST_CHECKIN_KEY)) return;
    localStorage.setItem(FIRST_CHECKIN_KEY, "1");
    window.dispatchEvent(new Event(FIRST_CHECKIN_EVENT));
  } catch {
    /* private mode: skip the install nudge */
  }
}

/**
 * What a check-in attempt came to. The event page reads this to punch the
 * stub (one stamp for the check-in, one per new badge); failures have already
 * been said out loud in a toast, so the page only needs to know they failed.
 */
export type CheckinOutcome =
  | { ok: true; /** ISO time the check-in landed. */ at: string; xp: number; badges: string[] }
  | { ok: false; reason: "no_fix" | "too_far" | "already" | "closed" | "error" | "account" };

/** "latenight" -> "Latenight". Used only when a badge key is not in the BADGES list. */
function prettyKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The name a badge goes by on screen. */
export function badgeName(key: string) {
  return BADGES.find((b) => b.key === key)?.name ?? prettyKey(key);
}

/**
 * The stamp landed (GAMIFY-NEXT 5.2): its thump and one buzz, then the two-note motif as the 180ms stamp
 * settles. Called on success only, so a refusal, an error and the sign-up gate stay silent. It also runs when
 * the sheet finishes a gated check-in, because the stamp lands then too. The badges and the XP count-up
 * sound from CheckInBlock, on the same beat as what they show.
 */
function landed() {
  sfx.checkin();
  haptics.buzz("checkin");
  setTimeout(() => sfx.motif("short"), 180);
}

/** The badges the real check-in would hand out, worked out in the browser for the sample night (dev only). */
function demoBadges(event: EventRow) {
  const out: string[] = [];
  if (event.area) out.push(areaByName(event.area)?.side === "island" ? "island" : "mainland");
  if (Number(new Date(Date.parse(event.starts_at) + 3.6e6).getUTCHours()) >= 23) out.push("latenight");
  if (event.price_naira === 0) out.push("free");
  if (event.vibe === "comedy" || event.vibe === "beach") out.push(event.vibe);
  return out;
}

/** The Hopper's own check-ins, kept on the phone. Private to them: it is wiped on sign-out (see phoneCache.clearUser). */
type MineRow = { event_id: string; created_at: string | null };
const mineKey = (id: string) => `u.${id}.checkins`;
const MINE_FRESH_MS = 10 * 60 * 1000;
const MINE_KEEP_MS = 30 * 24 * 3.6e6;

async function fetchMine(userId: string): Promise<MineRow[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("checkins").select("event_id, created_at").eq("user_id", userId);
  if (error || !data) return null;
  return data.map((r) => ({ event_id: String(r.event_id), created_at: r.created_at ? String(r.created_at) : null }));
}

/** After a claim (or an "already"): keep the phone's list true without a read. A list too old to trust is read again instead. */
function rememberCheckin(userId: string, eventId: string, at: string | null) {
  const held = read<MineRow[]>(mineKey(userId));
  const fresh = !!held && Date.now() - held.at < MINE_FRESH_MS;
  const fresher = useSessionStore.getState();
  if (fresh || (fresher.freshGuest && fresher.userId === userId)) {
    const rows = held?.data ?? [];
    const had = rows.find((r) => r.event_id === eventId);
    write(mineKey(userId), [
      ...rows.filter((r) => r.event_id !== eventId),
      { event_id: eventId, created_at: at ?? had?.created_at ?? null },
    ]);
  } else {
    void revalidate(mineKey(userId), () => fetchMine(userId), { freshMs: 0, force: true });
  }
  // A check-in moves the streak: the next read of the stats goes to the network.
  remove(`u.${userId}.stats.`);
  // This user now has history: the "new guest has nothing" shortcuts no longer hold.
  if (fresher.freshGuest) fresher.set({ freshGuest: false });
}

export function useCheckin(userId: string | null, onDone?: () => void) {
  const [done, setDone] = useState<Set<string>>(new Set());
  /** When each check-in landed (ISO), for the events we know it for. */
  const [checkedAt, setCheckedAt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const say = useToast((s) => s.say);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    // Merged into what is on screen, so a check-in made while the read was out is never lost.
    const apply = (rows: MineRow[]) => {
      setDone((d) => new Set([...d, ...rows.map((r) => r.event_id)]));
      setCheckedAt((m) => ({
        ...Object.fromEntries(rows.filter((r) => r.created_at).map((r) => [r.event_id, r.created_at as string])),
        ...m,
      }));
    };
    // The phone's list shows at once. A Hopper created in this page load has no check-ins, so there is nothing to ask.
    const held = read<MineRow[]>(mineKey(userId));
    if (held && Date.now() - held.at <= MINE_KEEP_MS) apply(held.data);
    if (useSessionStore.getState().freshGuest && useSessionStore.getState().userId === userId) {
      // True today and kept, so a reload of this guest does not ask either. A check-in rewrites it (rememberCheckin).
      if (!held) write(mineKey(userId), []);
      return;
    }
    let cancelled = false;
    void revalidate(mineKey(userId), () => fetchMine(userId), { freshMs: MINE_FRESH_MS }).then((rows) => {
      // Only when it is news: the claim in this tab has already updated the screen.
      if (!cancelled && rows) apply(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const checkIn = useCallback(
    async (event: EventRow, fix: { lat: number; lng: number } | null): Promise<CheckinOutcome> => {
      if (!fix) {
        say("Set your location first.");
        return { ok: false, reason: "no_fix" };
      }
      const sb = getSupabase();
      if (!sb) {
        // Local demo (no database): let the loop be felt without saving anything anywhere.
        const at = new Date().toISOString();
        setDone((s) => new Set(s).add(event.id));
        setCheckedAt((m) => ({ ...m, [event.id]: at }));
        markFirstCheckin();
        landed();
        return { ok: true, at, xp: 50, badges: demoBadges(event) };
      }
      // Checking in (and the XP and badges with it) needs an account. Return here and tap again after sign-in.
      if (!requireAccount("check in and earn XP")) return { ok: false, reason: "account" };
      const uid = useSessionStore.getState().userId ?? userId;
      if (!uid) {
        // Signed-in session not ready yet: never pretend it was saved.
        say("Still connecting. Try again in a moment.", "error");
        return { ok: false, reason: "error" };
      }
      setBusy(event.id);
      const { data, error } = await sb.rpc("claim_checkin", {
        p_event_id: event.id,
        p_lat: fix.lat,
        p_lng: fix.lng,
      });
      setBusy(null);
      if (error) {
        say("Couldn't check you in. Try again.", "error");
        return { ok: false, reason: "error" };
      }
      const res = data as CheckinClaim;
      if (!res.ok) {
        if (res.reason === "too_far") {
          say(`Too far. You're ${Math.round((res.distance_m ?? 0) / 100) / 10} km out.`, "error");
          return { ok: false, reason: "too_far" };
        }
        if (res.reason === "already") {
          setDone((s) => new Set(s).add(event.id));
          rememberCheckin(uid, event.id, null);
          say("You're already checked in here.");
          return { ok: false, reason: "already" };
        }
        say("Check-in isn't open for this one.", "error");
        return { ok: false, reason: "closed" };
      }
      const at = new Date().toISOString();
      setDone((s) => new Set(s).add(event.id));
      setCheckedAt((m) => ({ ...m, [event.id]: at }));
      rememberCheckin(uid, event.id, at);
      onDone?.();
      markFirstCheckin();
      landed();
      return { ok: true, at, xp: res.xp, badges: res.badges ?? [] };
    },
    [userId, say, onDone]
  );

  // The sign-up sheet finishes a gated check-in later; this always reaches the newest checkIn.

  return { done, checkedAt, busy, checkIn };
}
