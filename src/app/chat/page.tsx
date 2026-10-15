"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { useHoppaz, useToast } from "@/lib/store";
import { setMapShare, useSocial } from "@/lib/social";
import { useInbox, useMyEventRooms, type PeopleOf } from "@/lib/chat";
import PageHeader from "@/components/app/PageHeader";
import ChatList from "@/components/chat/ChatList";
import CrewTab from "@/components/chat/CrewTab";
import RoomView from "@/components/chat/RoomView";
import { sentence } from "@/components/event/copy";

export default function ChatPage() {
  return <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}><Chat /></Suspense>;
}

/**
 * Chat is people: CHATS (your private chats, with what is unread) and CREW (waves waiting for you, then everyone who is in
 * your crew). Rooms are places, so the event rooms live under ROOMZ (/crew); one is still opened from its event card or
 * from ROOMZ as /chat?c=<event id>, which shows that room with a way back.
 */
function Chat() {
  const params = useSearchParams();
  const linked = params.get("c");
  if (linked && !linked.startsWith("area:")) return <EventRoom id={linked} />;
  return <People />;
}

function People() {
  const router = useRouter();
  const { userId, hasAccount } = useSession();
  const [view, setView] = useState<"chats" | "crew">("chats");
  const say = useToast((s) => s.say);
  const { waves, crew, dms, unread, respond } = useInbox(userId);
  const supported = useSocial((s) => s.supported);
  const onMap = useSocial((s) => s.onMap);

  return <div className="flex h-full flex-col overflow-hidden px-4">
    <PageHeader title="Chat" caption="Say hi on your terms" className="flex-none" />
    <div role="tablist" aria-label="Chat" className="mb-3 flex flex-none gap-6 border-b border-line">
      <Tab on={view === "chats"} onClick={() => setView("chats")}>CHATS{unread > 0 ? ` · ${unread}` : ""}</Tab>
      <Tab on={view === "crew"} onClick={() => setView("crew")}>CREW{waves.length > 0 ? ` · ${waves.length}` : ""}</Tab>
    </div>

    {view === "chats" ? <ChatList dms={dms} hasAccount={hasAccount} /> : <CrewTab
      waves={waves}
      crew={crew}
      hasAccount={hasAccount}
      // The switch is on the server's new calls; an older server has nothing to remember it with.
      onMap={supported ? onMap : undefined}
      onToggleMap={() => void setMapShare(!onMap).then((ok) => { if (!ok) say("Couldn't save that. Try again.", "error"); })}
      onAnswer={async (w) => {
        const r = await respond(w.id, true);
        if (r.needAccount) { say("Make an account to chat."); router.push("/account?next=/chat"); }
        // Waving back made them crew: say so, and they join the list right here. Anyone else (an event room wave) opens
        // their chat, as before.
        else if (r.crew) say(`${w.name} is in your crew.`, "ok");
        else if (r.dm) router.push(`/chat/dm/${r.dm}`);
        else if (r.text) say(sentence(r.text), "error");
      }}
      onPass={(w) => void respond(w.id, false)}
    />}
  </div>;
}

/** One event room (or the Hop's), opened from its event card or from ROOMZ. */
function EventRoom({ id }: { id: string }) {
  const { userId, hasAccount } = useSession();
  const { fix } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const eventRooms = useMyEventRooms(userId);
  const mine = eventRooms.find((r) => r.id === id);
  const hop = id.startsWith("hop-");
  const title = hop ? "The Hop" : events.find((e) => e.id === id)?.title ?? mine?.title ?? "Event room";
  const member = !!mine;

  return <div className="flex h-full flex-col overflow-hidden px-4">
    <PageHeader title={title} caption={mine ? `CLOSES ${closes(mine.closesAt)}` : undefined} back="/crew" className="flex-none" />
    <RoomView
      key={id}
      channel={id}
      people={{ kind: "event", id } satisfies PeopleOf}
      userId={userId}
      hasAccount={hasAccount}
      empty={!member
        ? hop ? "This is the Hop's room, for riders on the bus." : "This room is for everyone going. Tap WE OUTSIDE on the event and you're in."
        : "You're in. Be the first to break the ice, and keep it friendly."}
      noPeople={!hop && member ? "Nobody else in yet. Bring your people." : undefined}
    />
  </div>;
}

/** A quiet tab: cream text and an orange underline when it is the one you are on, dim otherwise. */
function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={clsx(
        "-mb-px min-h-[44px] whitespace-nowrap border-b-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
        on ? "border-orange text-cream" : "border-transparent text-dim"
      )}
    >
      {children}
    </button>
  );
}

/** "SAT 2 AM": when an event room closes for good. */
function closes(at: number) {
  return new Date(at).toLocaleString("en-NG", { weekday: "short", hour: "numeric", timeZone: "Africa/Lagos" }).toUpperCase();
}
