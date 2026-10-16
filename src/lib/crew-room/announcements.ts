"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { backoff, hidden, jitter } from "@/lib/idle";
import { getSupabase } from "@/lib/supabase/client";
import { isMissing } from "@/lib/social";

/**
 * Owner announcements, the quiet way (supabase/crew_announcements.sql). The room's owner posts a short note for its members.
 * Nobody is interrupted: the owner's logo in the room pulses with a small orange "!" while there is one this member has not
 * seen, and the owner and admins panel (OwnerPanel.tsx) lists them, latest first. Opening the panel marks them seen.
 *
 * Read once when the room opens and again every 2 minutes (5 at the slowest, for a phone nobody is touching) while the page is
 * visible, and when the page comes back to the front after a minute or more. Without the file on the server there is
 * no pulse and no section (`supported` false): nothing is drawn for what does not exist.
 */
export type Announcement = { id: string; body: string; at: string; edited: boolean; by: string; mine: boolean; fresh: boolean };

type Entry = { items: Announcement[]; unseen: number; isStaff: boolean; canSend: boolean; loaded: boolean; supported: boolean };
const EMPTY: Entry = { items: [], unseen: 0, isStaff: false, canSend: false, loaded: false, supported: true };

const useStore = create<{ rooms: Record<string, Entry> }>(() => ({ rooms: {} }));

const put = (crewId: string, patch: Partial<Entry>) =>
  useStore.setState((s) => ({ rooms: { ...s.rooms, [crewId]: { ...(s.rooms[crewId] ?? EMPTY), ...patch } } }));

export async function loadAnnouncements(crewId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data, error } = await sb.rpc("crew_announcements", { p_crew: crewId });
  if (error) {
    if (isMissing(error)) put(crewId, { supported: false, loaded: true });
    return;
  }
  const j = data as { items?: Announcement[]; unseen?: number; is_staff?: boolean; can_send?: boolean } | null;
  put(crewId, {
    items: j?.items ?? [],
    unseen: j?.unseen ?? 0,
    isStaff: !!j?.is_staff,
    canSend: !!j?.can_send,
    loaded: true,
    supported: true,
  });
}

/** What this room's announcements are now, for the logo and the panel. */
export function useAnnouncements(crewId: string): Entry {
  return useStore((s) => s.rooms[crewId]) ?? EMPTY;
}

/** Keep the room's announcements fresh while the room is open: now, then every 2 minutes or so while the page is in front. */
export function useAnnouncementFeed(crewId: string) {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastAt = 0;
    const read = async () => {
      lastAt = Date.now();
      await loadAnnouncements(crewId);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (stopped) return;
        if (!hidden()) await read();
        if (!stopped) arm();
      }, jitter(backoff(120_000, { max: 300_000 })));
    };
    const onVisible = () => {
      if (!hidden() && Date.now() - lastAt > 60_000) void read();
    };
    void read();
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [crewId]);
}

/** The panel was opened: the pulse stops now, and the server remembers. */
export async function markAnnouncementsSeen(crewId: string): Promise<void> {
  const cur = useStore.getState().rooms[crewId];
  if (!cur || !cur.supported) return;
  put(crewId, { unseen: 0 });
  const sb = getSupabase();
  if (sb) await sb.rpc("crew_announcement_seen", { p_crew: crewId });
}

const TEXT: Record<string, string> = {
  not_staff: "ONLY THE OWNER CAN POST",
  empty: "WRITE SOMETHING FIRST",
  too_long: "280 CHARACTERS AT MOST",
  slow_down: "2 A DAY. TRY TOMORROW",
  need_account: "MAKE AN ACCOUNT TO POST",
  no_session: "NOT SIGNED IN YET",
  gone: "THAT ONE IS GONE",
};

export type Result = { ok: boolean; text: string };

async function call(crewId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const sb = getSupabase();
  if (!sb) return { ok: false, text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, text: isMissing(error) ? "NOT AVAILABLE YET" : "COULD NOT SAVE" };
  const r = String(data);
  if (r === "ok" || r.startsWith("sent:")) {
    await loadAnnouncements(crewId);
    return { ok: true, text: "" };
  }
  return { ok: false, text: TEXT[r] ?? "COULD NOT SAVE" };
}

export const announce = (crewId: string, body: string) => call(crewId, "crew_announce", { p_crew: crewId, p_body: body });
export const editAnnouncement = (crewId: string, id: string, body: string) => call(crewId, "crew_announcement_edit", { p_id: id, p_body: body });
export const deleteAnnouncement = (crewId: string, id: string) => call(crewId, "crew_announcement_delete", { p_id: id });
