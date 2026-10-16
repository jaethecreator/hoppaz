"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/lib/store";
import type { CrewInfo, Desk, Game, GameTimeAct, GameTimeDeskApi, Winner } from "./types";

/**
 * The staff desk's Game Time data: the drops, the crews and their rooms' hiding spots (GET /api/admin/game-time), and the
 * actions (POST). Every call carries the staff token. A 401 locks the desk (onLock). After an action that worked the list
 * reloads, so every part of the desk shows the new state.
 */
export function useGameTimeDesk(token: string, onLock: () => void): GameTimeDeskApi {
  const say = useToast((s) => s.say);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch("/api/admin/game-time", { headers, cache: "no-store" });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Partial<Desk>;
    if (r.status === 401) return onLock();
    if (!r.ok || !data.ok) {
      setError(data.message ?? "Game Time did not load.");
      return;
    }
    setError("");
    setDesk({ games: data.games ?? [], crews: data.crews ?? [], objects: data.objects ?? {} });
  }, [headers, onLock, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act: GameTimeAct = useCallback(
    async (body, onError) => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/game-time", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; game?: Game };
        if (r.status === 401) {
          onLock();
          return null;
        }
        if (!r.ok || !data.ok) {
          if (onError) onError(data.message ?? "That did not work.");
          else say((data.message ?? "That did not work.").toUpperCase());
          return null;
        }
        // The save worked; a reload that fails (a dropped connection) must not make it look as if it had not.
        await load().catch(() => undefined);
        return data;
      } finally {
        setBusy(false);
      }
    },
    [headers, load, onLock, say],
  );

  const exportCsv = useCallback(
    async (game: string | null, filename: string) => {
      const r = await fetch(`/api/admin/game-time?winners=${game ?? "all"}&format=csv`, { headers, cache: "no-store" });
      if (!r.ok) return say("EXPORT FAILED");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    [headers, say],
  );

  return { desk, error, busy, headers, load, act, exportCsv };
}

/** One drop in full: its boxes with codes and where each hides, and its hiding spots. Null when it could not be read. */
export async function fetchGame(headers: { authorization: string }, id: string): Promise<Game | null> {
  const r = await fetch(`/api/admin/game-time?id=${encodeURIComponent(id)}`, { headers, cache: "no-store" }).catch(() => null);
  const d = (await r?.json().catch(() => null)) as { ok?: boolean; game?: Game } | null;
  return d?.ok && d.game ? d.game : null;
}

/** The winners of one drop (game id), or of every drop (null). Empty when they could not be read. */
export async function fetchWinners(headers: { authorization: string }, id: string | null): Promise<Winner[]> {
  const r = await fetch(`/api/admin/game-time?winners=${id ? encodeURIComponent(id) : "all"}`, { headers, cache: "no-store" }).catch(() => null);
  const d = (await r?.json().catch(() => null)) as { ok?: boolean; winners?: Winner[] } | null;
  return d?.ok && Array.isArray(d.winners) ? d.winners : [];
}

/** The facts about one crew room (members, people in the room, announcements). Null when it could not be read. */
export async function fetchCrewInfo(headers: { authorization: string }, id: string): Promise<CrewInfo | null> {
  const r = await fetch(`/api/admin/game-time?crew=${encodeURIComponent(id)}`, { headers, cache: "no-store" }).catch(() => null);
  const d = (await r?.json().catch(() => null)) as ({ ok?: boolean } & { crew?: CrewInfo }) | null;
  return d?.ok && d.crew ? d.crew : null;
}
