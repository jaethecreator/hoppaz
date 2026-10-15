"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Reactions on chat messages (supabase/crew_reactions.sql). Four kinds, one row per (message, person, kind).
 * If the table is not installed on the database the hook says `available: false` and the chat hides the four
 * buttons (REPLY and WALK TO stay), so a missing table never shows dead buttons.
 */
export type ReactionKind = "heart" | "fire" | "laugh" | "party";
export const REACTION_KINDS: ReactionKind[] = ["heart", "fire", "laugh", "party"];

type Row = { message_id: string; user_id: string; kind: ReactionKind };
export type ReactionCount = { kind: ReactionKind; count: number; mine: boolean };

/** Messages asked about per request. */
const BATCH = 80;
const MISSING = /PGRST205|PGRST202|42P01|does not exist|schema cache/i;

export function useReactions(crewId: string, userId: string, messageIds: string[]) {
  const [rows, setRows] = useState<Row[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const fetched = useRef(new Set<string>());
  const idsKey = messageIds.join(",");

  const load = useCallback(async (ids: string[]) => {
    const sb = getSupabase();
    if (!sb || !ids.length) return;
    for (let i = 0; i < ids.length; i += BATCH) {
      const part = ids.slice(i, i + BATCH);
      const { data, error } = await sb.from("crew_room_reactions").select("message_id,user_id,kind").in("message_id", part);
      if (error) {
        if (MISSING.test(`${error.code ?? ""} ${error.message}`)) setAvailable(false);
        return;
      }
      setAvailable(true);
      const got = (data ?? []) as Row[];
      setRows((old) => [...old.filter((r) => !part.includes(r.message_id)), ...got]);
    }
  }, []);

  // Messages that are new to the list.
  useEffect(() => {
    if (available === false || !idsKey) return;
    const fresh = idsKey.split(",").filter((id) => !fetched.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => fetched.current.add(id));
    void load(fresh);
  }, [idsKey, available, load]);

  // Live: a reaction added or taken off in this crew.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || available !== true) return;
    const channel = sb
      .channel(`crew-reactions:${crewId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_room_reactions", filter: `crew_id=eq.${crewId}` }, (payload) => {
        const r = payload.new as Row;
        setRows((old) => (old.some((o) => o.message_id === r.message_id && o.user_id === r.user_id && o.kind === r.kind) ? old : [...old, r]));
      })
      // A removal carries only the key, and carries no crew filter, so read again the message it names if it is on screen.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "crew_room_reactions" }, (payload) => {
        const r = payload.old as Partial<Row>;
        if (r.message_id && fetched.current.has(r.message_id)) void load([r.message_id]);
      })
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [crewId, available, load]);

  // A new crew room starts clean.
  useEffect(() => {
    const seen = fetched.current;
    return () => {
      seen.clear();
      setRows([]);
    };
  }, [crewId]);

  const by = useMemo(() => {
    const map = new Map<string, ReactionCount[]>();
    for (const r of rows) {
      const list = map.get(r.message_id) ?? [];
      const hit = list.find((c) => c.kind === r.kind);
      if (hit) {
        hit.count += 1;
        hit.mine ||= r.user_id === userId;
      } else list.push({ kind: r.kind, count: 1, mine: r.user_id === userId });
      map.set(r.message_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => REACTION_KINDS.indexOf(a.kind) - REACTION_KINDS.indexOf(b.kind));
    return map;
  }, [rows, userId]);

  /** Add my reaction, or take it off if it is there. Shows at once; the server has the last word. */
  const toggle = useCallback(
    async (messageId: string, kind: ReactionKind) => {
      const sb = getSupabase();
      if (!sb) return;
      const had = rows.some((r) => r.message_id === messageId && r.user_id === userId && r.kind === kind);
      setRows((old) =>
        had
          ? old.filter((r) => !(r.message_id === messageId && r.user_id === userId && r.kind === kind))
          : [...old, { message_id: messageId, user_id: userId, kind }]
      );
      const { error } = await sb.rpc("crew_room_react", { p_message: messageId, p_kind: kind });
      if (error) {
        // Put it back the way it was.
        setRows((old) =>
          had
            ? [...old, { message_id: messageId, user_id: userId, kind }]
            : old.filter((r) => !(r.message_id === messageId && r.user_id === userId && r.kind === kind))
        );
        if (MISSING.test(`${error.code ?? ""} ${error.message}`)) setAvailable(false);
      }
    },
    [rows, userId]
  );

  return { available: available === true, by, toggle };
}
