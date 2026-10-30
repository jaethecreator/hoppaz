"use client";

/* eslint-disable @next/next/no-img-element -- logos are data URLs or bucket links of unknown size */

import clsx from "clsx";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useManagedRooms, useR1Auth } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";
import { memberWord } from "../rooms/words";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "H";

function Tile({ logo, name, size = 40 }: { logo?: string | null; name: string; size?: number }) {
  return logo ? (
    <img src={logo} alt="" width={size} height={size} className="flex-none rounded-hz border border-t-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid flex-none place-items-center rounded-hz bg-t-accent font-display font-black text-t-on" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** The room's size as its own people read it: small numbers are warm ("Just you", "You and 2 others"), big ones are counted. */
export const roomLine = (r: Pick<RoomSummary, "members">) => (r.members <= 1 ? "Just you" : r.members < 10 ? `You and ${r.members - 1} ${r.members === 2 ? "other" : "others"}` : memberWord(r.members));

/**
 * The workspace switcher, top left of the host surfaces: who you are working as. Opens "Your workspaces": Personal, every room you
 * own or admin, and + New room. `current` is "personal" or a room id. `room` is the current room (for its logo and name).
 */
export default function Switcher({ current, room }: { current: "personal" | string; room?: RoomSummary | null }) {
  const { user } = useR1Auth();
  const rooms = useManagedRooms();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const me = user?.name ?? "Your events";
  const personal = current === "personal";
  const name = personal ? me : (room?.name ?? "Room");
  const sub = personal ? "Personal" : room ? `Room · ${roomLine(room)}` : "Room";
  const list = rooms.data ?? [];
  const row = "flex min-h-[52px] w-full items-center gap-3 rounded-hz px-3 py-2 text-left";

  return (
    <div ref={box} className="relative block w-fit max-w-full" data-switcher>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${name}. Switch`}
        onClick={() => setOpen(!open)}
        className={clsx("-ml-1 flex w-fit max-w-full items-center gap-3 rounded-hz px-1 py-1", open && "bg-t-soft")}
      >
        <Tile logo={personal ? null : room?.logo_url} name={name} size={44} />
        <span className="flex flex-col text-left leading-tight">
          <b className="t-title block max-w-[240px] truncate whitespace-nowrap text-[17px] font-extrabold lg:text-[19px]">{name}</b>
          <span className="block max-w-[240px] truncate whitespace-nowrap font-body text-[13px] text-t-muted">{sub}</span>
        </span>
        <ChevronDown size={16} className="flex-none text-t-muted" aria-hidden />
      </button>

      {open && (
        <div role="menu" aria-label="Your workspaces" className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(340px,calc(100vw-24px))] rounded-hz border border-t-line bg-t-solid p-2 shadow-2xl">
          <p className="px-3 pb-1 pt-2 font-body text-[12.5px] font-bold text-t-muted">Your workspaces</p>
          <Link href="/host" role="menuitem" onClick={() => setOpen(false)} className={clsx(row, personal && "bg-t-soft")} data-ws="personal">
            <Tile name={me} size={36} />
            <b className="min-w-0 flex-1 truncate font-body text-[15px]">{me}</b>
            <span className="flex-none font-body text-[13px] text-t-muted">Personal</span>
          </Link>
          {list.map((r) => (
            <Link key={r.id} href={`/rooms/${encodeURIComponent(r.slug)}/admin`} role="menuitem" onClick={() => setOpen(false)} className={clsx(row, r.id === current && "bg-t-soft")} data-ws={r.slug}>
              <Tile logo={r.logo_url} name={r.name} size={36} />
              <b className="min-w-0 flex-1 font-body text-[15px] leading-tight">{r.name}</b>
              <span className="flex-none font-body text-[13px] text-t-muted">{roomLine(r)}</span>
            </Link>
          ))}
          <Link href="/create?mode=room" role="menuitem" onClick={() => setOpen(false)} className={row} data-ws="new">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-hz bg-t-soft text-t-accent" aria-hidden>
              <Plus size={16} strokeWidth={3} />
            </span>
            <b className="font-body text-[15px]">New room</b>
          </Link>
        </div>
      )}
    </div>
  );
}
