"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DoorOpen, Ticket, X } from "lucide-react";
import { requireAccount } from "@/lib/accountGate";
import { clockText, useServerNow } from "@/lib/game-time/clock";
import { isMystery } from "@/lib/game-time/drops";
import { dismissPing, pingDismissed, usePingGames } from "@/lib/game-time/hooks";
import type { GtListGame } from "@/lib/game-time/types";
import { useToast } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

/**
 * The global ping (docs/GAME-TIME.md section 4, game_time_list): a Game Time is about to open or is live, wherever the
 * Hopper is in the app. One card at the top, dismissible, once per Game Time per device. ENTER ROOM for a member, JOIN AND
 * HUNT for anyone else (one tap: it joins the open crew and walks into the room; a guest is asked to sign up first). Mounted
 * once in layout.tsx. A member who cannot hunt (email not confirmed, joined too late) and a newcomer who would join too late
 * are not pinged: there is nothing for them to win.
 *
 * It stays quiet where it would be in the way: inside the crew's own room and hub (they have their own banner), the
 * full-screen tasks, and the staff desk. A Hopper who has won has nothing left to hunt, so it never shows for them. Drop 2
 * onward of a mystery series (drops.ts) shows nothing until it is live.
 */

const QUIET = [/^\/chat\/dm\//, /^\/circle(?:\/|$)/, /^\/drop$/, /^\/me\/avatar/, /^\/admin/, /^\/report\//, /^\/phone/, /^\/auth/, /^\/reset/];

function pick(games: GtListGame[], path: string, gone: ReadonlySet<string>, now: number): GtListGame | null {
  const open = games.filter(
    (g) =>
      !g.won &&
      g.boxes_left > 0 &&
      !g.blocked &&
      // Drop 2 onward stays quiet until it is live: a card with a countdown would give the time away.
      !(isMystery(g) && Date.parse(g.opens_at) - now > 0) &&
      (g.is_member || g.join_in_time) &&
      !pingDismissed(g.id) &&
      !gone.has(g.id) &&
      !path.startsWith(`/crew/${g.crew_id}`),
  );
  // A live game first, then the one opening soonest.
  open.sort((a, b) => (a.status === b.status ? Date.parse(a.opens_at) - Date.parse(b.opens_at) : a.status === "live" ? -1 : 1));
  return open[0] ?? null;
}

export default function GameTimePing() {
  const path = usePathname() ?? "";
  const router = useRouter();
  const say = useToast((s) => s.say);
  const [joining, setJoining] = useState(false);
  const { userId, state } = useSession();
  const quiet = QUIET.some((re) => re.test(path));
  const games = usePingGames(!!userId && state === "ready" && !quiet);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const now = useServerNow(1000);
  const game = quiet ? null : pick(games, path, gone, now);
  if (!game) return null;

  const close = () => {
    dismissPing(game.id);
    setGone(new Set([...gone, game.id]));
  };
  const live = game.status === "live" || Date.parse(game.opens_at) - now <= 0;
  const left = `${game.boxes_left} ${game.boxes_left === 1 ? "box" : "boxes"}`;
  const room = `/crew/${game.crew_id}/room`;

  /** A newcomer joins the open crew right here (the same call as the hub's button) and walks in. */
  const join = async () => {
    const sb = getSupabase();
    if (!sb || joining) return;
    setJoining(true);
    const { data } = await sb.rpc("join_crew", { p_invite: game.crew_id });
    setJoining(false);
    if (!data) {
      say("Couldn't join. Try again.", "error");
      return;
    }
    close();
    say("You're in the crew.", "ok");
    router.push(room);
  };

  return (
    <aside
      role="region"
      aria-label="Game Time"
      data-gt-ping
      className="fixed left-2 right-2 z-[45] mx-auto max-w-[460px] animate-rise rounded-hz border border-line bg-ink-2 p-3 shadow-sheet"
      style={{ top: "max(8px, env(safe-area-inset-top))" }}
    >
      <div className="flex items-start gap-2">
        <Ticket size={18} aria-hidden className="mt-0.5 flex-none text-violet" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-dim">
            GAME TIME · {game.brand}
          </p>
          <p className="mt-0.5 font-display text-[15px] font-black leading-tight">
            {live ? `Live now. ${left} hiding.` : `Opens in ${clockText(Date.parse(game.opens_at) - now)}.`}
          </p>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-cream/80">
            {live ? "First to find one wins a ticket. Run." : `${left} hiding in the room. First to find one wins a ticket.`}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Dismiss" className="-mr-1.5 -mt-1.5 grid h-11 w-11 flex-none place-items-center text-dim hover:text-cream">
          <X size={18} aria-hidden />
        </button>
      </div>
      {game.is_member ? (
        <Link href={room} onClick={close} className="btn mt-2.5 w-full text-[14px]" data-gt-ping-cta>
          <DoorOpen size={18} aria-hidden /> ENTER ROOM
        </Link>
      ) : (
        <button
          type="button"
          className="btn mt-2.5 w-full text-[14px]"
          disabled={joining}
          data-gt-ping-cta
          onClick={() => {
            if (requireAccount("join this crew")) void join();
          }}
        >
          <DoorOpen size={18} aria-hidden /> {joining ? "JOINING…" : "JOIN AND HUNT"}
        </button>
      )}
    </aside>
  );
}
