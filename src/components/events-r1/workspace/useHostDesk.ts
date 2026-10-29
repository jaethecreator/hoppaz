"use client";

import { useMemo } from "react";
import { useR1Auth, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { buildDesk } from "./desk";
import type { Desk } from "./desk";

/**
 * The Hosting line on Me and the green dot on the ME tab: the viewer's own events, the rooms they run (owner or admin) and those rooms'
 * events, from the Release 1 data layer. It reads the Release 1 sign in itself. `desk` is null while loading and when signed out.
 */
export function useHostDesk(): { signedIn: boolean; ready: boolean; desk: Desk | null } {
  const { user, ready } = useR1Auth();
  const now = useR1Now();
  const q = useR1Query(async (a) => {
    if (!a.auth.current()) return null;
    const [mine, rooms] = await Promise.all([a.events.listMine(), a.rooms.managed()]);
    const lists = await Promise.all(rooms.map((r) => a.events.listForRoom(r.id).catch((): R1Event[] => [])));
    return { mine, rooms, roomEvents: Object.fromEntries(rooms.map((r, i) => [r.id, lists[i]])) as Record<string, R1Event[]> };
  }, [user?.id]);
  const data = q.data;
  const desk = useMemo(() => (user && data ? buildDesk({ ...data, now }) : null), [user, data, now]);
  return { signedIn: !!user, ready: ready && !q.loading, desk };
}
