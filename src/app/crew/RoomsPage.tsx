"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, DoorOpen, MessageSquare, Plus, Search, Users } from "lucide-react";
import Sheet from "@/components/Sheet";
import { useEventGroups, useMyEventRooms } from "@/lib/chat";
import { dayLagos } from "@/lib/geo";
import { useSession } from "@/lib/useSession";
import { useCrew } from "@/lib/useCrew";
import { useHoppaz, useToast } from "@/lib/store";
import { levelFor } from "@/lib/brand";
import type { Profile } from "@/lib/types";
import { FaceDisc } from "@/components/Avatar";
import Mascot from "@/components/Mascot";
import PageHeader from "@/components/app/PageHeader";
import { useLinger } from "@/components/chat/useLinger";
import { useGroups, type CrewGroup } from "@/lib/game";
import { hereLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { getSupabase } from "@/lib/supabase/client";
import { usePingGames } from "@/lib/game-time/hooks";
import { useEvents } from "@/lib/useEvents";
import { useTheme } from "@/lib/useTheme";
import VerifiedBadge from "@/components/VerifiedBadge";
import RoomCard from "./RoomCard";

/**
 * ROOMZ (the middle tab, /crew): places. Your roomz with the one big button, event rooms and group chats, a search for a
 * room by name, and the leaderboard folded away at the bottom. People live on the Chat tab (CHATS and CREW): waves, your
 * crew, your friends. Open rooms are found by name, never listed in a heap; a private room is joined through its invite link.
 */
export default function RoomsPage() {
  const { userId, profile, state } = useSession();
  const { crew } = useCrew(userId);
  const { groups, create: createGroup, join: joinGroup, plan, rsvp } = useGroups(userId);
  const { groups: chats, join: joinChat, leave: leaveChat } = useEventGroups(userId);
  const eventRooms = useMyEventRooms(userId);
  const games = usePingGames(!!userId && state === "ready");
  const invites = chats.filter((g) => g.status === "invited");
  const joined = chats.filter((g) => g.status === "joined");
  const { fix, look } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const say = useToast((s) => s.say);
  const theme = useTheme();
  // Nothing says "no rooms yet" until the lists have had a moment to arrive.
  const settled = useLinger(state !== "loading", 900);

  const [groupName, setGroupName] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CrewGroup[] | null>(null);
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [moving, setMoving] = useState<string | null>(null);
  // The floating PLUS: "choose" is its two answers, "start" is the create form.
  const [menu, setMenu] = useState<"choose" | "start" | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const [board, setBoard] = useState(false);
  const [spots, setSpots] = useState(false);
  // Hotspots are places too: the one you stand in is your home base, and the rest are one tap away.
  const hs = useHotspots({ active: true, at: fix });
  const home = hs.yours;
  const open = hs.list.filter((h) => h.status === "open");
  // A hotspot with a room drawn opens it; one without goes to the map's sheet, as before.
  const roomHref = (h: Hotspot) => (hotspotRoomData(h.slug) ? `/room/${h.slug}` : `/?hotspot=${h.slug}`);

  // Find a room: open rooms by name, as you type. Row level security already lets everyone read an open room.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const sb = getSupabase();
      if (!sb) return;
      const like = t.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data } = await sb.from("crews").select("*").eq("visibility", "open").ilike("name", `%${like}%`).order("name").limit(20);
      if (live) setHits(((data ?? []) as CrewGroup[]).sort((a, b) => Number(!!b.verified) - Number(!!a.verified)));
    }, 280);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const standings = useMemo(() => {
    const me = {
      id: userId ?? "me",
      display_name: profile?.display_name ?? "You",
      area: profile?.area ?? fix?.area ?? null,
      xp: profile?.xp ?? 0,
      is_admin: false,
      avatar: profile?.avatar ?? look,
      mine: true,
    };
    return [...crew.map((c) => ({ ...c, mine: false })), me].sort((a, b) => b.xp - a.xp);
  }, [crew, userId, profile, fix, look]);

  const createCrew = async () => {
    if (!groupName.trim()) return;
    const id = await createGroup(groupName.trim(), visibility);
    if (id) {
      setGroupName("");
      setMenu(null);
      say("Room created. Your invite code is ready.", "ok");
    } else {
      say("Couldn't start the room. Try again.", "error");
    }
  };

  // The Game Time of each of my rooms: a live one first, then the one opening soonest.
  const gameOf = (crewId: string) =>
    games
      .filter((g) => g.crew_id === crewId && !g.won && g.boxes_left > 0)
      .sort((a, b) => (a.status === b.status ? Date.parse(a.opens_at) - Date.parse(b.opens_at) : a.status === "live" ? -1 : 1))[0] ?? null;

  return (
    <>
    <div className="h-full overflow-y-auto px-4 pb-24">
    <div className="mx-auto w-full max-w-[560px]">
      <PageHeader title="Roomz" caption="Where your people are" />

      {home && (
        <>
          <p className="seclabel mb-2">Your home base</p>
          <div className="card mb-2 p-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-full border border-line bg-ink-3 font-display text-lg font-black">
                {home.name.trim().charAt(0).toUpperCase() || "H"}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{home.name}</b>
                <span className="hint block truncate">{hereLabel(home)}</span>
              </span>
            </div>
            <Link href={roomHref(home)} className="btn mt-3 w-full text-[14px] lg:w-auto lg:px-10">
              <DoorOpen size={18} aria-hidden /> ENTER ROOM
            </Link>
          </div>
        </>
      )}
      {open.length > 0 && (
        <>
          <button
            type="button"
            className="mb-2 flex min-h-[44px] w-full items-center justify-between font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim"
            aria-expanded={spots}
            onClick={() => setSpots((v) => !v)}
          >
            <span>All hotspots · {open.length}</span>
            <ChevronRight size={14} aria-hidden className={spots ? "rotate-90" : undefined} />
          </button>
          {spots &&
            open.map((h) => (
              <Link key={h.slug} href={roomHref(h)} className="flex min-h-[44px] items-center gap-3 border-b border-line py-2">
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-display text-[15px] font-semibold">{h.name}</b>
                  <span className="hint block truncate">{h.zoneLabel}</span>
                </span>
                <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">OPEN →</span>
              </Link>
            ))}
        </>
      )}

      <p className="seclabel mb-2 mt-4">Your roomz</p>
      {groups.length === 0 && settled && (
        <div className="card mb-2 flex flex-col items-center px-3 py-5 text-center">
          <Mascot state="oya" size={104} edge={theme === "day" ? "ink" : "ground"} label="The Hoppaz mascot, calling you over" />
          <p className="mt-3 font-display text-[19px] font-black leading-tight">No roomz yet.</p>
          <p className="hint mt-1 max-w-[17rem]">A room is your people, in a place of your own. Find one below, or start yours.</p>
        </div>
      )}
      {groups.map((g) => (
        <RoomCard
          key={g.id}
          group={g}
          game={gameOf(g.id)}
          events={events}
          moving={moving === g.id}
          onPlan={() => setMoving(moving === g.id ? null : g.id)}
          onRsvp={rsvp}
          onSubmit={async (f) => {
            const ok = await plan(g.id, f);
            say(ok ? "Move added to the room." : "Couldn't plan that move. Try again.", ok ? "ok" : "error");
            setMoving(null);
          }}
        />
      ))}

      {(eventRooms.length > 0 || chats.length > 0) && (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between gap-2">
            <p className="seclabel">Event roomz and group chats</p>
            {invites.length > 0 && <span className="pill pill-lagoon">{invites.length} INVITE{invites.length === 1 ? "" : "S"}</span>}
          </div>
          {eventRooms.map((r) => (
            <Link key={r.id} href={`/chat?c=${r.id}`} className="card mb-2 flex min-h-[44px] items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{r.title}</b>
                <span className="hint block truncate">Room open · closes {closes(r.closesAt)}</span>
              </span>
              <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">OPEN →</span>
            </Link>
          ))}
          {invites.map((g) => (
            <div key={g.event_id} className="card mb-2 flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{g.title}</b>
                <span className="hint block truncate">{dayLagos(g.starts_at)} · {g.members} in the chat · you&apos;re invited</span>
              </span>
              <button
                className="btn px-3"
                onClick={async () => {
                  const ok = await joinChat(g.event_id);
                  say(ok ? "You're in the group chat." : "Couldn't join. Try again.", ok ? "ok" : "error");
                }}
              >
                JOIN
              </button>
              <button className="btn btn-ghost px-3" onClick={() => void leaveChat(g.event_id)} aria-label={`No thanks to ${g.title}`}>
                NO
              </button>
            </div>
          ))}
          {joined.map((g) => (
            <Link key={g.event_id} href={`/crew/group/${g.event_id}`} className="card mb-2 flex min-h-[44px] items-center gap-3 py-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-ink-3 text-cream">
                <MessageSquare size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{g.title}</b>
                <span className="hint block truncate">{g.last_body ?? `${g.members} in the chat · say hi`}</span>
              </span>
              <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">OPEN →</span>
            </Link>
          ))}
        </>
      )}

      <p className="seclabel mb-2 mt-4">Find a room</p>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-3.5 text-dim" aria-hidden />
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="pl-9" autoComplete="off" aria-label="Search for a room by name" />
      </div>
      {hits && (
        <div className="mt-1">
          {hits.filter((g) => !groups.some((m) => m.id === g.id)).map((g) => (
            <div key={g.id} className="flex items-center gap-2 border-b border-line py-2">
              <Link href={`/crew/${g.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate font-display text-[15px] font-semibold">{g.name}</span>
                {g.verified && <VerifiedBadge size={15} />}
              </Link>
              <button
                className="btn btn-ghost flex-none px-4"
                onClick={async () => {
                  const ok = await joinGroup(g.id);
                  say(ok ? "You're in. Tap ENTER ROOM to walk in." : "Couldn't join. Try again.", ok ? "ok" : "error");
                  if (ok) setQ("");
                }}
              >
                JOIN
              </button>
            </div>
          ))}
          {hits.filter((g) => !groups.some((m) => m.id === g.id)).length === 0 && <p className="hint py-2">No room by that name.</p>}
        </div>
      )}

      <button
        type="button"
        className="mt-4 flex min-h-[44px] w-full items-center justify-between border-t border-line font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-dim"
        aria-expanded={board}
        onClick={() => setBoard((v) => !v)}
      >
        Leaderboard <ChevronRight size={14} aria-hidden className={board ? "rotate-90" : undefined} />
      </button>
      {board &&
        standings.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
            <span className="w-5 flex-none font-mono text-[11px] font-medium tabular-nums text-dim">{i + 1}</span>
            <Face p={m} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display text-[15px] font-semibold">
                {m.display_name ?? "A Hopper"}
                {m.mine && " (you)"}
              </b>
              <p className="hint">
                {levelFor(m.xp).name} · {m.xp} XP{m.area ? ` · ${m.area}` : ""}
              </p>
            </span>
          </div>
        ))}
    </div>
    </div>

    {/* The map's own + (same place on the right, same size, same orange), here to join or start a room. */}
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3.5 pb-2.5">
      <div className="mx-auto flex max-w-[560px] items-end gap-2">
        <button
          type="button"
          aria-label="Join or start a room"
          title="Join or start a room"
          className="btn pointer-events-auto ml-auto grid h-11 w-11 flex-none place-items-center p-0"
          onClick={() => setMenu("choose")}
        >
          <Plus size={16} strokeWidth={3} aria-hidden />
        </button>
      </div>
    </div>

    {menu && (
      <>
        <div className="absolute inset-0 z-[39] bg-ink/60" onClick={() => setMenu(null)} aria-hidden />
        <Sheet open onClose={() => setMenu(null)} label={menu === "start" ? "Start a room" : "Join or start a room"}>
          <div className="mx-auto w-full max-w-[480px]">
          {menu === "choose" ? (
            <div className="grid gap-2 pt-1">
              <button
                className="btn w-full"
                onClick={() => {
                  setMenu(null);
                  const input = search.current;
                  if (input) {
                    input.scrollIntoView({ block: "center", behavior: "smooth" });
                    input.focus();
                  }
                }}
              >
                <Users size={15} aria-hidden /> JOIN A ROOM
              </button>
              <button className="btn btn-ghost w-full" onClick={() => setMenu("start")}>
                <Plus size={15} aria-hidden /> START A ROOM
              </button>
            </div>
          ) : (
            <div className="pt-1">
              <p className="seclabel mb-2">Start a room</p>
              <div className="flex gap-2">
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Name your room" aria-label="Name your room" maxLength={50} autoFocus />
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "open")} aria-label="Who can find it" className="max-w-28">
                  <option value="private">Private</option>
                  <option value="open">Open</option>
                </select>
              </div>
              <button className="btn mt-2 w-full" onClick={createCrew} disabled={!groupName.trim()}>
                CREATE
              </button>
            </div>
          )}
          </div>
        </Sheet>
      </>
    )}
    </>
  );
}

/** One face rule for every row: their look on the neutral circle, or their initial if they never dressed up. */
function Face({ p }: { p: Pick<Profile, "display_name" | "avatar"> }) {
  return <FaceDisc look={p.avatar} initial={p.display_name ?? undefined} size={36} />;
}

/** "SAT 2 AM": when an event room closes for good. */
function closes(at: number) {
  return new Date(at).toLocaleString("en-NG", { weekday: "short", hour: "numeric", timeZone: "Africa/Lagos" }).toUpperCase();
}
