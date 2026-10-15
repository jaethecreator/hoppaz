"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, CalendarDays, Users, MessageSquare, CircleUserRound, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useLeaveStore } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { sfx } from "@/lib/sound/sfx";
import { useSocial } from "@/lib/social";

type Tab = { href: string; label: string; Icon: LucideIcon; tour?: string };

const TABS: ReadonlyArray<Tab> = [
  { href: "/", label: "MAP", Icon: Map },
  { href: "/discover", label: "EVENTS", Icon: CalendarDays, tour: "events" },
  // ROOMZ (brand spelling): places (your roomz, event rooms, a search for a room). People are on CHAT (CHATS and CREW). The route stays /crew.
  { href: "/crew", label: "ROOMZ", Icon: Users },
  { href: "/chat", label: "CHAT", Icon: MessageSquare },
  { href: "/me", label: "ME", Icon: CircleUserRound },
];

/** Sub-pages keep their parent tab lit, so you always know where you are. */
const PARENT: Array<[string, string]> = [
  ["/drop", "/"],
  ["/event", "/"],
  ["/quests", "/me"],
  ["/drops", "/me"],
  ["/collection", "/me"],
  ["/privacy", "/me"],
  ["/community", "/me"],
  ["/account", "/me"],
  // A hotspot's room (/room/<slug>) is a place, so ROOMZ stays lit inside it.
  ["/room", "/crew"],
];

/**
 * Full-screen tasks hide the tab bar, the way a chat hides WhatsApp's tabs. A crew room (/crew/<id>/room) is NOT one:
 * the room is a place inside the app, so the tabs stay under it with CREW lit (the path starts with /crew).
 */
const ROOM = /^\/crew\/[^/]+\/room(?:\/|$)/;
const FULL_SCREEN = [/^\/welcome/, /^\/chat\/dm\//, /^\/circle(?:\/|$)/, /^\/drop$/, /^\/me\/avatar/, /^\/admin/, /^\/report\//, /^\/phone/];

export default function BottomNav() {
  const path = usePathname();
  // Unread messages and waves waiting for me: the dot on CHAT (supabase/crew_friends.sql).
  const waiting = useSocial((s) => s.unread + s.waves.length + s.mentions.length);
  if (FULL_SCREEN.some((re) => re.test(path))) return null;
  const parent = PARENT.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1];
  const active = parent ?? path;
  return (
    <nav
      className="z-30 flex flex-none border-t border-line bg-ink-2"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main"
    >
      {TABS.map(({ href, label, Icon, tour }, i) => {
        const on = href === "/" ? active === "/" : active === href || active.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            data-tour={tour}
            aria-current={on ? "page" : undefined}
            // A very quiet wood tick, one pitch up the scale per tab, only when the lit tab is about to change.
            onClick={(e) => {
              // In a crew room, every tab leaves the room. During a Game Time that asks "Leave the hunt?" first, the way the
              // door, the pill and the back arrow do (rails.ts useGoOut).
              if (ROOM.test(path) && useRoomStore.getState().huntActive) {
                e.preventDefault();
                useLeaveStore.getState().ask(href);
                return;
              }
              if (!on) sfx.tabTick(i);
            }}
            className={clsx(
              "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 transition-colors",
              on ? "text-orange" : "text-dim"
            )}
          >
            <span className="relative">
              <Icon size={19} strokeWidth={on ? 2.4 : 1.9} aria-hidden />
              {href === "/chat" && waiting > 0 && (
                <i
                  className="absolute -right-2.5 -top-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-orange px-1 font-mono text-[9px] font-medium not-italic leading-none text-ink"
                  aria-label={`${waiting} waiting`}
                >
                  {waiting > 9 ? "9+" : waiting}
                </i>
              )}
            </span>
            <span className="font-mono text-[10px] font-medium tracking-[0.1em]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
