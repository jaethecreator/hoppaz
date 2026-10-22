"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronRight, MessageSquare } from "lucide-react";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import { CrewLogo } from "@/components/crew-room/HubHeader";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useR1Api, useR1Auth, useRooms } from "@/lib/events-r1/hooks";
import type { EventChat, RoomSummary } from "@/lib/events-r1/types";
import CreateButton from "../CreateButton";
import SignInSheet from "../SignInSheet";
import { closesWord, enterPath, memberWord, roomPath } from "./words";

const tab = "min-h-[44px] flex-1 rounded-hz border px-4 font-display text-[14px] font-bold";

/**
 * Release 1 ROOMZ tab (flag on): Hoppaz HQ pinned at the top, then Mine (your roomz and their event chats) or Discover.
 * Tapping a room's body opens its home; Enter room goes straight in. Reads only from the data layer.
 */
export default function RoomzTab() {
  const { data, loading, error } = useRooms();
  const { user } = useR1Auth();
  const [view, setView] = useState<"mine" | "discover">("mine");
  const [signin, setSignin] = useState(false);

  // Where an event chat lives: the room it belongs to.
  // A closed chat is gone from the list (its link still opens read only, with "This event has closed").
  const chats = (data?.eventChats ?? []).filter((c) => c.state !== "closed");
  const byId = new Map<string, RoomSummary>();
  if (data) for (const r of [data.hq, ...data.mine, ...data.discover]) byId.set(r.id, r);

  return (
    <div className="h-full overflow-y-auto px-4 pb-28">
      <div className="mx-auto w-full max-w-[560px]">
        <PageHeader title="ROOMZ" className="pb-3" />
        <div role="tablist" aria-label="Roomz" className="mb-4 flex gap-2">
          {(["mine", "discover"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={clsx(tab, view === v ? "border-cream bg-cream text-brand-ink" : "border-line text-cream")}
            >
              {v === "mine" ? "Mine" : "Discover"}
            </button>
          ))}
        </div>

        {loading && !data && <LoadingStub count={3} label="Loading Roomz" />}
        {error && !data && <p className="hint">Roomz could not load. Try again later.</p>}

        {data && (
          <>
            <HqRow hq={data.hq} />
            {view === "mine" ? (
              <>
                <p className="seclabel mb-2 mt-5">Your Roomz</p>
                {!user ? (
                  <div className="card flex items-center gap-3">
                    <p className="min-w-0 flex-1 font-body text-[14px]">Sign in to see your Roomz.</p>
                    <button type="button" className="btn flex-none px-4 normal-case" onClick={() => setSignin(true)}>
                      Sign in
                    </button>
                  </div>
                ) : data.mine.length === 0 ? (
                  <p className="hint">You are not in any Roomz yet. Find one in Discover.</p>
                ) : (
                  data.mine.map((r) => <MineRow key={r.id} room={r} />)
                )}

                {chats.length > 0 && (
                  <>
                    <p className="seclabel mb-2 mt-5">Event chats</p>
                    {chats.map((c) => (
                      <ChatRow key={c.event_id} chat={c} room={byId.get(c.room_id)} />
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                <p className="seclabel mb-2 mt-5">Open and brand Roomz</p>
                {data.discover.map((r) => (
                  <DiscoverRow key={r.id} room={r} onNeedSignIn={() => setSignin(true)} />
                ))}
                {data.discover.length === 0 && <p className="hint">You are in every Roomz there is.</p>}
              </>
            )}
          </>
        )}
      </div>

      {/* The same orange + Create as the Map and Events, bottom right above the tab bar. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3.5 pb-2.5">
        <div className="mx-auto flex max-w-[560px]">
          <CreateButton className="ml-auto" />
        </div>
      </div>

      <SignInSheet open={signin} reason="See your Roomz" onClose={() => setSignin(false)} onSignedIn={() => setSignin(false)} />
    </div>
  );
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="grid h-[22px] min-w-[22px] flex-none place-items-center rounded-full bg-orange px-1.5 font-display text-[12px] font-black text-brand-ink" aria-label={`${n} unread`}>
      {n}
    </span>
  );
}

/** Hoppaz HQ, pinned at the very top. Everyone is in it. */
function HqRow({ hq }: { hq: RoomSummary }) {
  return (
    <Link href={roomPath(hq)} className="card flex min-h-[44px] items-center gap-3 py-3" data-room-row="hq">
      <CrewLogo url={hq.logo_url} name={hq.name} size={44} />
      <span className="min-w-0 flex-1">
        <b className="flex items-center gap-1.5 font-display text-[16px] font-semibold">
          <span className="truncate">{hq.name}</span>
          {hq.verified && <VerifiedBadge size={16} />}
        </b>
        <span className="hint block truncate">Everyone is here · {hq.online.toLocaleString("en-NG")} online</span>
      </span>
      <Badge n={hq.unread} />
      <ChevronRight size={16} className="flex-none text-dim" aria-hidden />
    </Link>
  );
}

/** One of your roomz: the body opens the room home, the button goes straight in. */
function MineRow({ room }: { room: RoomSummary }) {
  const a = room.latest_announcement;
  return (
    <div className="card mb-2 flex items-center gap-2.5 py-3 pr-3" data-room-row={room.slug}>
      <Link href={roomPath(room)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3">
        <CrewLogo url={room.logo_url} name={room.name} size={44} />
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 font-display text-[16px] font-semibold">
            <span className="truncate">{room.name}</span>
            {room.verified && <VerifiedBadge size={15} />}
            <Badge n={room.unread} />
          </b>
          <span className="hint block truncate">{a ? a.body : memberWord(room.members)}</span>
        </span>
      </Link>
      <Link href={enterPath(room)} className="btn btn-ghost min-h-[40px] flex-none px-3 text-[13px] normal-case" aria-label={`Enter ${room.name}`}>
        Enter room
      </Link>
    </div>
  );
}

function ChatRow({ chat, room }: { chat: EventChat; room?: RoomSummary }) {
  const href = room ? `${roomPath(room)}/chat/${chat.event_id}` : `/rooms/events/chat/${chat.event_id}`;
  return (
    <Link href={href} className={clsx("card mb-2 flex min-h-[44px] items-center gap-3 py-3", chat.state === "closed" && "opacity-70")} data-chat-row={chat.event_id}>
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-ink-3 text-cream">
        <MessageSquare size={15} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-display text-[15px] font-semibold">{chat.event_title}</b>
        <span className="hint block truncate">{closesWord(chat)}</span>
      </span>
      <ChevronRight size={16} className="flex-none text-dim" aria-hidden />
    </Link>
  );
}

function DiscoverRow({ room, onNeedSignIn }: { room: RoomSummary; onNeedSignIn: () => void }) {
  const api = useR1Api();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const join = async () => {
    if (!api || busy) return;
    if (!api.auth.current()) return onNeedSignIn();
    setBusy(true);
    try {
      await api.rooms.join(room.id);
      router.push(roomPath(room));
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="card mb-2 flex items-center gap-2.5 py-3 pr-3" data-room-row={room.slug}>
      <Link href={roomPath(room)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3">
        <CrewLogo url={room.logo_url} name={room.name} size={44} />
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 font-display text-[16px] font-semibold">
            <span className="truncate">{room.name}</span>
            {room.verified && <VerifiedBadge size={15} />}
          </b>
          <span className="hint block truncate">{memberWord(room.members)}</span>
        </span>
      </Link>
      <button type="button" className="btn min-h-[40px] flex-none px-4 text-[13px] normal-case" onClick={join} disabled={busy || !api}>
        Join
      </button>
    </div>
  );
}
