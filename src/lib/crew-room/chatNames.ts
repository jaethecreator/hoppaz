"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { RoomMessage } from "./types";

/**
 * Names in the room chat. The server writes `author_name` into each message when it is sent, and falls back to
 * "A crew member" when the Hopper has not typed a display name yet (supabase/crew_rooms.sql), so a lot of rows say
 * that. A Hopper without a display name still has a handle (profiles.handle, "LekkiLegend8686"), and profiles are
 * readable by every signed-in Hopper, so the chat looks the missing names up once and keeps them.
 *
 * Order: me ("You"), the name stored with the message, the name the room shows for that person right now, their
 * handle, then "Hopper".
 *
 * The room's people list has the same hole (the walkers' name tags, the Hopper menu), so useNamedPeers fills it with
 * the same lookup; useCrewRoom hands every room screen the filled-in list.
 */
const GENERIC = /^\s*(a crew member|a hopper|someone|unknown)?\s*$/i;

/** True for the placeholder names that mean "no name was set". */
export const isGenericName = (name?: string | null) => !name || GENERIC.test(name);

/** id -> the best name found in profiles; "" when the profile has neither a name nor a handle. */
const found = new Map<string, string>();
const asked = new Set<string>();

type Row = { id: string; display_name: string | null; handle: string | null };

/** Ask profiles for the people whose names are not known yet; returns a number that changes when answers arrive. */
function useProfileNames(missing: string[]) {
  const [version, bump] = useState(0);
  const key = missing.join(",");

  useEffect(() => {
    if (!key) return;
    const sb = getSupabase();
    if (!sb) return;
    const ids = key.split(",");
    ids.forEach((id) => asked.add(id));
    let live = true;
    void sb
      .from("profiles")
      .select("id,display_name,handle")
      .in("id", ids)
      .then(({ data, error }) => {
        if (error) {
          // Try again on the next message instead of showing a placeholder for the rest of the visit.
          ids.forEach((id) => asked.delete(id));
          return;
        }
        ((data ?? []) as Row[]).forEach((row) => {
          const name = (row.display_name ?? "").trim() || (row.handle ?? "").trim();
          found.set(row.id, name);
        });
        ids.forEach((id) => !found.has(id) && found.set(id, ""));
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [key]);

  return version;
}

const unknown = (id: string) => !found.has(id) && !asked.has(id);

export function useChatNames(messages: RoomMessage[], peers: { id: string; name: string }[], userId: string) {
  const missing = [...new Set(messages.filter((m) => m.author_id !== userId && isGenericName(m.author_name)).map((m) => m.author_id))].filter(
    (id) => unknown(id) && !peers.some((p) => p.id === id && !isGenericName(p.name))
  );
  const version = useProfileNames(missing);

  /** The name to print above a message. */
  return useCallback(
    (message: Pick<RoomMessage, "author_id" | "author_name">) => {
      if (message.author_id === userId) return "You";
      if (!isGenericName(message.author_name)) return message.author_name;
      const peer = peers.find((p) => p.id === message.author_id);
      if (peer && !isGenericName(peer.name)) return peer.name;
      return found.get(message.author_id) || "Hopper";
    },
    // `found` is a module map; `version` is what tells a name list that it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, peers, version]
  );
}

/**
 * The room's people with the placeholder names filled in (display name, else handle). Returns the same array when
 * nothing needed filling, so a screen that compares lists is not woken for nothing.
 */
export function useNamedPeers<T extends { id: string; name: string }>(peers: T[] | undefined): T[] | undefined {
  const missing = (peers ?? []).filter((p) => isGenericName(p.name) && unknown(p.id)).map((p) => p.id);
  const version = useProfileNames(missing);
  return useMemo(() => {
    if (!peers || !peers.some((p) => isGenericName(p.name) && found.get(p.id))) return peers;
    return peers.map((p) => (isGenericName(p.name) && found.get(p.id) ? { ...p, name: found.get(p.id) as string } : p));
    // `found` is a module map; `version` is what tells this list that it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, version]);
}
