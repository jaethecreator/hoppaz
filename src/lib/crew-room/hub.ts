"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/**
 * A crew as its hub (/crew/<id>) and its invite page (/crew/join/<code>) show it: crew_card() in
 * supabase/crew_rooms.sql. Members get the invite code and the recent General chat; anyone holding the code, or
 * anyone at all for an open crew, gets the rest. Null when the crew is private and there is no code.
 */
export type CrewCard = {
  id: string;
  name: string;
  /** The room's banner (the crew name until the owner sets one). */
  brand: string;
  verified: boolean;
  visibility: "open" | "private";
  members: number;
  is_member: boolean;
  is_owner: boolean;
  invite_code: string | null;
  /** Comma separated words that find the crew's events. */
  keywords: string;
  in_room: number;
  heads: { id: string; name: string; look: unknown }[];
  recent: { id: string; author_id: string; author_name: string; author_look: unknown; body: string; created_at: string }[];
};

/** A crew's event, as the hub tiles and the Stage show it. */
export type CrewEvent = { id: string; title: string; venue_name: string; area: string | null; starts_at: string; flyer_url: string | null };

/** Live updates of the card ("N in the room now") while the hub is open. */
const REFRESH = 15_000;

/** The invite link for a code, on this site. */
export const inviteLink = (code: string) => `${typeof window === "undefined" ? "" : window.location.origin}/crew/join/${code}`;

/** One crew's card, by id or by invite code, kept fresh every 15 s while the page is visible. */
export function useCrewCard({ crewId, code }: { crewId?: string; code?: string }) {
  const [card, setCard] = useState<CrewCard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "offline">("loading");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return setState("offline");
    const { data, error } = await sb.rpc("crew_card", { p_crew: crewId ?? null, p_code: code ?? null });
    if (error) return setState((s) => (s === "ready" ? s : "offline"));
    setCard((data as CrewCard | null) ?? null);
    setState(data ? "ready" : "missing");
  }, [crewId, code]);

  useEffect(() => {
    setState("loading");
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), REFRESH);
    return () => clearInterval(t);
  }, [load]);

  return { card, state, reload: load };
}

const COLUMNS = "id,title,venue_name,area,starts_at,flyer_url";

/**
 * The crew's upcoming events: live events whose title or venue has one of its words. `matched` is false when none
 * do and the list is the next big events in Lagos instead (by base heat), so the hub never shows an empty shelf.
 */
export function useCrewEvents(keywords: string | null | undefined, limit = 3) {
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [matched, setMatched] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || keywords == null) return;
    let live = true;
    // Words are matched as plain text: anything PostgREST reads as syntax is dropped from them.
    const words = keywords
      .split(",")
      .map((w) => w.replace(/[^\p{L}\p{N} '&-]/gu, "").trim())
      .filter((w) => w.length >= 2)
      .slice(0, 6);
    // From six hours ago: tonight's event is still "next" while it is on.
    const from = new Date(Date.now() - 6 * 3600_000).toISOString();
    void (async () => {
      let rows: CrewEvent[] = [];
      if (words.length) {
        const any = words.flatMap((w) => [`title.ilike.*${w}*`, `venue_name.ilike.*${w}*`]).join(",");
        const { data } = await sb
          .from("events")
          .select(COLUMNS)
          .eq("status", "live")
          .gte("starts_at", from)
          .or(any)
          .order("starts_at")
          .limit(limit);
        rows = (data ?? []) as CrewEvent[];
      }
      const found = rows.length > 0;
      if (!found) {
        const week = new Date(Date.now() + 7 * 86400_000).toISOString();
        const { data } = await sb
          .from("events")
          .select(COLUMNS)
          .eq("status", "live")
          .gte("starts_at", from)
          .lte("starts_at", week)
          .order("base_heat", { ascending: false })
          .order("starts_at")
          .limit(limit);
        rows = (data ?? []) as CrewEvent[];
      }
      if (!live) return;
      setEvents(rows);
      setMatched(found);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [keywords, limit]);

  return { events, matched, ready };
}

/**
 * Share the invite link: the phone's share sheet where there is one, otherwise the clipboard. Says which happened,
 * or null when the Hopper closed the sheet.
 */
export async function shareInvite(name: string, code: string): Promise<"shared" | "copied" | "failed" | null> {
  const url = inviteLink(code);
  const text = `Join ${name} on Hoppaz. Walk into our room and say hi.`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: `${name} on Hoppaz`, text, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
