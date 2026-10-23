"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import { useAnnouncements, useR1Api, useR1Now, useRoom } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";
import Tag from "./AnnouncementTag";
import { roomPath } from "./words";

const LIMIT = 280;

/**
 * Release 1 Announcements (/rooms/<slug>/announcements): everything the room has said, newest first. Event Pops carry the
 * event's name; a plain announcement says "Announcement" and never reaches an event. Owners and admins can post one (280
 * characters); everyone else sees "Only admins can post".
 */
export default function Announcements({ slug }: { slug: string }) {
  const { data: room, loading } = useRoom(slug);
  const api = useR1Api();
  const { data: list } = useAnnouncements(room?.id);
  const now = useR1Now();

  // Opening the list is what clears the unread count.
  const roomId = room?.id;
  useEffect(() => {
    if (api && roomId) void api.rooms.markRead(roomId);
  }, [api, roomId]);

  if (loading && !room) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading announcements" lines={2} />
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

  return (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full max-w-[560px]">
        <PageHeader title="Announcements" caption={room.name} back={roomPath(room)} className="pb-3" />
        {room.can_post ? <Composer room={room} /> : <p className="hint mb-4 rounded-hz border border-line px-3.5 py-3">Only admins can post</p>}
        {list && list.length === 0 && <p className="hint">No announcements yet.</p>}
        <ul className="space-y-2.5">
          {(list ?? []).map((a) => (
            <li key={a.id} className="card" data-announcement={a.event_id ? "pop" : "plain"}>
              <Tag a={a} now={now} />
              <p className="mt-1.5 whitespace-pre-line break-words font-body text-[15px] leading-snug">{a.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** A plain announcement: up to 280 characters. It goes to this room's Announcements only. */
function Composer({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  const post = async () => {
    if (!api || busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.rooms.postAnnouncement(room.id, text);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again later");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4">
      <label className="sr-only" htmlFor="announce-body">
        Write an announcement
      </label>
      <textarea
        id="announce-body"
        ref={field}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, LIMIT))}
        placeholder="Write an announcement"
        rows={3}
        maxLength={LIMIT}
        className="w-full resize-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <span className="hint flex-1" aria-live="polite">
          {text.length}/{LIMIT}
        </span>
        <button type="button" className="btn px-5 normal-case" onClick={post} disabled={busy || !text.trim() || !api}>
          Post
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 font-body text-[14px] text-fireant">
          {error}
        </p>
      )}
    </div>
  );
}
