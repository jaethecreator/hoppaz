"use client";

import { useMemo, useState } from "react";
import RequireAccount from "@/components/app/RequireAccount";
import Link from "next/link";
import { ChevronRight, MessageSquare, Plus } from "lucide-react";
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
import { useGroups } from "@/lib/game";
import { usePingGames } from "@/lib/game-time/hooks";
import { useEvents } from "@/lib/useEvents";
import { useTheme } from "@/lib/useTheme";
import VerifiedBadge from "@/components/VerifiedBadge";
import RoomCard from "./RoomCard";

/**
 * ROOMS (the middle tab, /crew): places. Your rooms with the one big button, event rooms and group chats, rooms to find, and
 * the leaderboard folded away at the bottom. People live on the Chat tab (CHATS and CREW): waves, your crew, your friends.
 */
function RoomsPage() {
  const { userId, profile, state } = useSession();
  const { crew } = useCrew(userId);
  const { groups, openGroups, create: createGroup, join: joinGroup, plan, rsvp } = useGroups(userId);
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
  const [invite, setInvite] = useState("");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [moving, setMoving] = useState<string | null>(null);
  const [form, setForm] = useState<"code" | "start" | null>(null);
  const [board, setBoard] = useState(false);

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
      setForm(null);
      say("Room created. Your invite code is ready.", "ok");
    } else {
      say("Couldn't start the room. Try again.", "error");
    }
  };

  const joinByCode = async () => {
    const ok = await joinGroup(invite);
    say(ok ? "You're in the room." : "Code not found. Check it and try again.", ok ? "ok" : "error");
    if (ok) {
      setInvite("");
      setForm(null);
    }
  };

  // The Game Time of each of my rooms: a live one first, then the one opening soonest.
  const gameOf = (crewId: string) =>
    games
      .filter((g) => g.crew_id === crewId && !g.won && g.boxes_left > 0)
      .sort((a, b) => (a.status === b.status ? Date.parse(a.opens_at) - Date.parse(b.opens_at) : a.status === "live" ? -1 : 1))[0] ?? null;

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <PageHeader title="Rooms" caption="Where your people are" />

      <p className="seclabel mb-2">Your rooms</p>
      {groups.length === 0 && settled && (
        <div className="card mb-2 flex flex-col items-center px-3 py-5 text-center">
          <Mascot state="oya" size={104} edge={theme === "day" ? "ink" : "ground"} label="The Hoppaz mascot, calling you over" />
          <p className="mt-3 font-display text-[19px] font-black leading-tight">No rooms yet.</p>
          <p className="hint mt-1 max-w-[17rem]">A room is your people, in a place of your own. Join one below, or start yours.</p>
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
            <p className="seclabel">Event rooms and group chats</p>
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
      {openGroups.map((g) => (
        <div key={g.id} className="flex items-center gap-2 border-t border-line py-2">
          <Link href={`/crew/${g.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate font-display text-[15px] font-semibold">{g.name}</span>
            {g.verified && <VerifiedBadge size={15} />}
          </Link>
          <button
            className="btn btn-ghost flex-none px-4"
            onClick={async () => {
              const ok = await joinGroup(g.id);
              say(ok ? "You're in the room. Tap ENTER ROOM to walk in." : "Couldn't join. Try again.", ok ? "ok" : "error");
            }}
          >
            JOIN
          </button>
        </div>
      ))}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn btn-ghost" aria-expanded={form === "code"} onClick={() => setForm(form === "code" ? null : "code")}>
          JOIN WITH CODE
        </button>
        <button className="btn btn-ghost" aria-expanded={form === "start"} onClick={() => setForm(form === "start" ? null : "start")}>
          <Plus size={15} aria-hidden /> START A ROOM
        </button>
      </div>
      {form === "code" && (
        <div className="mt-2 flex gap-2">
          <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Invite code" aria-label="Invite code" autoCapitalize="characters" />
          <button className="btn flex-none px-4" onClick={joinByCode}>JOIN</button>
        </div>
      )}
      {form === "start" && (
        <div className="mt-2 flex gap-2">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Name your room" aria-label="Name your room" maxLength={50} />
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "open")} aria-label="Who can find it" className="max-w-28">
            <option value="private">Private</option>
            <option value="open">Open</option>
          </select>
          <button className="btn flex-none px-4" onClick={createCrew}>CREATE</button>
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

/** Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function CrewPage() {
  return (
    <RequireAccount title="Rooms." caption="Make an account to join rooms, plan moves together and keep your group chats.">
      <RoomsPage />
    </RequireAccount>
  );
}
