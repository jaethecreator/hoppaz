"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { isMissing } from "@/lib/social";
import { useSessionStore } from "@/lib/useSession";

/**
 * Who runs a room (crew_friend_staff in supabase/crew_friends.sql): the owner, and the admins when there are any (roles today
 * are owner and member). `crew` says they are my crew, so the panel offers MESSAGE; otherwise SAY HI. Read once when the
 * owner's logo is opened.
 *
 * Without the new call on the server (the app deployed first) the owner alone is read from the crew and the profile, and
 * nobody counts as crew: SAY HI is the only action, which still works.
 */
export type Staff = { id: string; name: string; look: unknown; role: string; since: string | null; me: boolean; crew: boolean };

export function useCrewStaff(crewId: string) {
  const [people, setPeople] = useState<Staff[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.rpc("crew_friend_staff", { p_crew: crewId });
    if (!error && Array.isArray(data)) {
      setPeople(data as Staff[]);
      setFailed(false);
      return;
    }
    if (!isMissing(error)) return setFailed(true);
    const me = useSessionStore.getState().userId;
    const { data: c } = await sb.from("crews").select("created_by").eq("id", crewId).maybeSingle();
    const owner = (c as { created_by?: string } | null)?.created_by;
    if (!owner) return setFailed(true);
    const { data: p } = await sb.from("profiles").select("id, display_name, handle, avatar").eq("id", owner).maybeSingle();
    const row = p as { id: string; display_name: string | null; handle: string | null; avatar: unknown } | null;
    if (!row) return setFailed(true);
    setPeople([
      { id: row.id, name: row.display_name?.trim() || row.handle || "A crew member", look: row.avatar, role: "owner", since: null, me: row.id === me, crew: false },
    ]);
    setFailed(false);
  }, [crewId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { people, failed, reload: load };
}
