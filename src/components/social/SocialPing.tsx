"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FaceDisc } from "@/components/Avatar";
import { haptics } from "@/lib/haptics";
import { useGoOut } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { WAVE_HINT_MS, crewText, useVibes } from "@/lib/crew-room/vibes";
import { loadInbox, onInboxDiff, resetSocial, useSocial, type InboxDiff } from "@/lib/social";
import { sfx } from "@/lib/sound/sfx";
import { getSupabase } from "@/lib/supabase/client";
import { usePlayMode } from "@/lib/usePlayMode";
import { useSession } from "@/lib/useSession";

/**
 * Who reached me, wherever I am in the app (supabase/crew_friends.sql). Mounted once in layout.tsx, like GameTimePing.
 *
 *   keeps src/lib/social.ts fresh   one read at start, again on a new message (Realtime, scoped to my chats by row level
 *                                   security), on a ping to me, when the app comes back to the front, and every 30 s
 *                                   (waves have no live feed). That store feeds the Chat tab badge, the Chat tab and the room card.
 *   a message arrives               a small toast with the sender's face, their name and the first line. Tap opens the chat.
 *   a wave arrives                  the same toast ("ADA WAVED AT YOU"), anywhere but a crew room (the room has its own chip,
 *                                   the one with WAVE BACK) and the Chat tab itself.
 *   a poke, or a wave answered      in a crew room the room's hint chip, with their face; anywhere else this toast.
 *
 * Quiet where it would be in the way: the full-screen tasks, the staff desk and Play. The badge still counts.
 */

const QUIET = [/^\/circle(?:\/|$)/, /^\/drop$/, /^\/me\/avatar/, /^\/admin/, /^\/report\//, /^\/phone/, /^\/auth/, /^\/reset/];
const ROOM = /^\/crew\/[^/]+\/room(?:\/|$)/;
const TOAST_MS = 6000;
const POLL_MS = 30_000;

export type Toast = { id: number; name: string; look: unknown; line: string; sub?: string; href: string };

const upper = (s: string) => s.toUpperCase();
const first = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

export default function SocialPing() {
  const path = usePathname() ?? "";
  const goOut = useGoOut();
  const { userId, hasAccount } = useSession();
  const playing = usePlayMode((s) => s.active);
  const [toast, setToast] = useState<Toast | null>(null);
  const quietNow = useRef(false);
  const pathNow = useRef(path);
  pathNow.current = path;
  quietNow.current = playing || QUIET.some((re) => re.test(path));

  // A different Hopper (log in, log out) starts from nothing.
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (lastUser.current && lastUser.current !== userId) resetSocial();
    lastUser.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!userId || !hasAccount) return;
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    let hide: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;

    const show = (t: Omit<Toast, "id">, sound: "wave" | "vibe") => {
      if (!live || quietNow.current || document.visibilityState === "hidden") return;
      const id = ++seq;
      setToast({ id, ...t });
      if (hide) clearTimeout(hide);
      hide = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), TOAST_MS);
      if (sound === "wave") sfx.wave();
      else sfx.vibe();
      haptics.buzz("wave");
    };

    const notify = (diff: InboxDiff) => {
      const here = pathNow.current;
      const inbox = here === "/chat" || here.startsWith("/chat?");
      if (inbox) {
        // The list is in front of me and changes by itself: a soft chime, no toast on top of it.
        if (!quietNow.current && document.visibilityState !== "hidden") {
          sfx.wave();
          haptics.buzz("wave");
        }
        return;
      }
      for (const m of diff.newMessages) {
        if (here === `/chat/dm/${m.id}`) continue; // I am reading it
        show({ name: m.other_name, look: m.other_look, line: m.other_name, sub: first(m.last_body) || "New message", href: `/chat/dm/${m.id}` }, "wave");
      }
      if (ROOM.test(here)) return; // the room has its own chip, the one with WAVE BACK
      for (const w of diff.newWaves) {
        show({ name: w.name, look: w.look, line: `${upper(w.name)} WAVED AT YOU`, href: "/chat" }, "wave");
      }
    };
    const unsubscribe = onInboxDiff((d) => live && notify(d));

    const run = () => loadInbox();

    // A ping to me: a poke, or the answer to my wave (we are crew now). Fresh inbox first, so the crew face and chat id are there.
    const seen = new Set<string>();
    const onPing = async (row: { id: string; from_user: string; kind: string; created_at: string }) => {
      if (!row || seen.has(row.id) || (row.kind !== "poke" && row.kind !== "crew")) return;
      const at = Date.parse(row.created_at.replace(/(\.\d{3})\d+/, "$1"));
      if (Number.isFinite(at) && Date.now() - at > 15_000) return;
      seen.add(row.id);
      await loadInbox();
      if (!live) return;
      const face = useSocial.getState().crewIds[row.from_user];
      const peer = useRoomStore.getState().peers.find((p) => p.id === row.from_user);
      const name = face?.name ?? peer?.name ?? "A crew friend";
      const look = face?.look ?? peer?.look ?? null;
      const dm = face?.dm ?? null;
      const href = dm ? `/chat/dm/${dm}` : "/chat";
      const crew = row.kind === "crew";
      const text = crew ? crewText(name) : `${upper(name)} POKED YOU`;
      if (ROOM.test(pathNow.current)) {
        sfx.vibe();
        haptics.buzz("wave");
        useVibes.getState().say(
          text,
          crew ? WAVE_HINT_MS : 5000,
          crew && dm ? { label: "MESSAGE", onPress: () => goOut(`/chat/dm/${dm}`) } : undefined,
          { who: { name, look }, key: `u:${row.from_user}`, hold: true }
        );
        return;
      }
      show({ name, look, line: text, href }, crew ? "wave" : "vibe");
    };

    void run();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", visible);

    let later: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (later) clearTimeout(later);
      later = setTimeout(() => void run(), 250);
    };
    const channel = sb
      .channel(`social:${userId}`)
      // Row level security hands me only the messages of my own chats.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_pings", filter: `to_user=eq.${userId}` }, (p) =>
        void onPing(p.new as { id: string; from_user: string; kind: string; created_at: string })
      )
      .subscribe();

    return () => {
      live = false;
      clearInterval(poll);
      if (later) clearTimeout(later);
      if (hide) clearTimeout(hide);
      document.removeEventListener("visibilitychange", visible);
      unsubscribe();
      void sb.removeChannel(channel);
    };
    // goOut is stable for the life of the router; the effect is about the person, not the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hasAccount]);

  if (!toast || quietNow.current) return null;
  return (
    <PingCard
      key={toast.id}
      toast={toast}
      onOpen={() => {
        setToast(null);
        goOut(toast.href);
      }}
    />
  );
}

/** The toast card: their face, a line (the name, or "ADA WAVED AT YOU") and, for a message, its first line. Tap opens. */
export function PingCard({ toast, onOpen }: { toast: Omit<Toast, "id">; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-social-ping
      onClick={onOpen}
      className="fixed left-2 right-2 z-[46] mx-auto flex max-w-[460px] animate-rise items-center gap-3 rounded-hz border border-line bg-ink-2 p-2.5 text-left shadow-sheet"
      style={{ top: "max(8px, env(safe-area-inset-top))" }}
      aria-label={`${toast.line}${toast.sub ? `: ${toast.sub}` : ""}`}
    >
      <FaceDisc look={toast.look} initial={toast.name} size={36} />
      <span className="min-w-0 flex-1">
        <b className="block truncate font-display text-[15px] font-black leading-tight text-cream">{toast.line}</b>
        {toast.sub && <span className="block truncate font-body text-[13px] leading-snug text-dim">{toast.sub}</span>}
      </span>
    </button>
  );
}
