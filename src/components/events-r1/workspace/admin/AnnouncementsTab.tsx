"use client";

import { useState } from "react";
import { useAnnouncements, useR1Api, useR1Now } from "@/lib/events-r1/hooks";
import type { RoomSummary } from "@/lib/events-r1/types";
import { whenWord } from "../../rooms/words";
import { Card, Err, errText, SoonRow } from "./ui";

const MAX = 280;

/**
 * Announcements: write one and send it to the room (it sits at the top of the room page), and the sent list. The pin, the schedule and the
 * chat rules have no backend yet, so they are marked Coming soon and do nothing.
 */
export default function AnnouncementsTab({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const list = useAnnouncements(room.id);
  const now = useR1Now();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!api || busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.rooms.postAnnouncement(room.id, text);
      setText("");
      setSent(true);
      window.setTimeout(() => setSent(false), 2200);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const who = room.members === 1 ? "your room" : `${room.members.toLocaleString("en-NG")} members`;

  return (
    <div className="flex flex-col gap-4">
      <Card title="New announcement">
        <label className="sr-only" htmlFor="ws-announce">
          New announcement
        </label>
        <textarea id="ws-announce" value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={4} placeholder={`Welcome to ${room.name}. Tell your members what is coming.`} maxLength={MAX} data-announce />
        <div className="mt-1 text-right font-body text-[12px] text-t-muted">
          {text.length}/{MAX}
        </div>
        <SoonRow title="Pin to the top of the room" hint="Keeps this one above newer ones" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="lip !px-5" disabled={busy || !text.trim()} onClick={() => void send()} data-send-announcement>
            {busy ? "Sending" : `Send to ${who}`}
          </button>
          {sent && (
            <span role="status" className="font-body text-[13.5px] font-bold text-t-muted">
              Sent to your room
            </span>
          )}
        </div>
        <Err>{error}</Err>
      </Card>

      <Card title="Sent">
        {list.data && list.data.length === 0 && <p className="font-body text-[14px] text-t-muted">Nothing sent yet. Say hi to your first members.</p>}
        <ul className="divide-y divide-t-line">
          {(list.data ?? []).map((a) => (
            <li key={a.id} className="py-3 first:pt-0" data-announcement>
              {a.event_title && <span className="mb-1 inline-block rounded-hz bg-t-soft px-2 py-0.5 font-body text-[11.5px] font-bold text-t-muted">Pop from {a.event_title}</span>}
              <p className="whitespace-pre-line break-words font-body text-[15px]">{a.body}</p>
              <small className="font-body text-[12.5px] text-t-muted">
                Sent {whenWord(a.created_at, now)} · {a.author_name}
              </small>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Room chat" aside="Rules for General">
        <SoonRow title="Who can post" hint="Every member, or admins only" />
        <SoonRow title="Slow mode" hint="One message every 30 seconds per person" />
        <SoonRow title="Links and photos" hint="Members can share them" />
        <SoonRow title="Reported messages" hint="Review what members flag" />
      </Card>
    </div>
  );
}
