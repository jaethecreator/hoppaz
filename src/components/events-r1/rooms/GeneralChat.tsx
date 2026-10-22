"use client";

import { useState } from "react";
import Link from "next/link";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import { useR1Api, useR1Auth, useRoom, useRoomMessages } from "@/lib/events-r1/hooks";
import SignInSheet from "../SignInSheet";
import { ChatTop, Composer, Lines, type Lock } from "./ChatView";
import { memberWord, roomPath } from "./words";

/**
 * Release 1 General (/rooms/<slug>/general): the room's own chat, always open. Anyone can read it; saying something needs
 * an account and, in every room but Hoppaz HQ, being in the room.
 */
export default function GeneralChat({ slug }: { slug: string }) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const { data: room, loading } = useRoom(slug);
  const { data: lines } = useRoomMessages(room?.id, "general");
  const [signin, setSignin] = useState(false);

  if (loading && !room) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the chat" lines={2} />
      </div>
    );
  }
  if (!room) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-[560px]">
          <PageHeader title="Room not found" back="/crew" />
          <Link href="/crew" className="btn btn-ghost mt-2 normal-case">
            Go to Roomz
          </Link>
        </div>
      </div>
    );
  }

  const lock: Lock | undefined = !user
    ? { line: "Sign in to chat", action: { label: "Sign in", onClick: () => setSignin(true) } }
    : !room.joined
      ? { line: `Join ${room.name} to chat`, action: { label: "Join", onClick: () => void api?.rooms.join(room.id) } }
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <ChatTop title="General" sub={`${room.name} · ${memberWord(room.members)}`} back={roomPath(room)} />
      <Lines lines={lines ?? []} meName={user?.name ?? null} />
      <Composer lock={lock} onSend={async (body) => void (await api?.rooms.send(room.id, "general", body))} />
      <SignInSheet open={signin} reason={`Chat in ${room.name}`} onClose={() => setSignin(false)} onSignedIn={() => setSignin(false)} />
    </div>
  );
}
