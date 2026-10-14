"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, MessageCircle, X } from "lucide-react";
import Bubble, { chatTime } from "@/components/chat/Bubble";
import ChatFace from "@/components/chat/ChatFace";
import { clubhouseWidth, privateAreaAt, type PrivateArea } from "@/lib/campaign/layout";
import { draftKey, useRoomDrafts, type Draft } from "@/lib/crew-room/drafts";
import type { CrewRoomConnection } from "@/lib/crew-room/types";
import css from "./CrewRoom.module.css";

const NO_DRAFT: Draft = { text: "", circle: null };

/**
 * General and Area chat for one crew room. General reaches the whole crew, from anywhere in the room (and from the
 * door, for someone watching a full room). Area chat is the conversation of the marked area you stand in.
 *
 * Each conversation keeps its own unsent draft in the drafts store (lib/crew-room/drafts.ts), keyed by crew and area,
 * so it outlives this component: an expired session, a rejoin or a second tab never loses it. Leaving an area never
 * turns its draft into a General message, and a draft from an area's earlier session needs an explicit tap before it
 * goes to the new one.
 */
export default function CrewRoomChat({
  crewId,
  room,
  userId,
  open,
  onClose,
  mode,
  onMode,
  onVisit,
}: {
  crewId: string;
  room: CrewRoomConnection;
  userId: string;
  open: boolean;
  onClose: () => void;
  mode: "general" | "nearby";
  onMode: (mode: "general" | "nearby") => void;
  onVisit: (area: PrivateArea) => void;
}) {
  const drafts = useRoomDrafts((s) => s.drafts);
  const setDraft = useRoomDrafts((s) => s.set);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const layout = clubhouseWidth(room.snapshot?.room.width ?? 30);
  const circle = room.snapshot?.self?.circle_id ?? null;
  const area = layout.privateAreas.find((a) => a.id === room.world?.areaId) ?? null;
  const members = room.snapshot?.peers.filter((p) => circle && p.circle_id === circle) ?? [];
  const others = members.filter((p) => p.id !== userId);
  const generalKey = draftKey(crewId, null);
  const general = drafts[generalKey] ?? NO_DRAFT;
  const draft = area ? drafts[draftKey(crewId, area.id)] ?? { text: "", circle } : NO_DRAFT;
  const thread = mode === "general" ? room.threads.general : circle ? room.threads[circle] : undefined;
  const messages = thread?.items ?? [];
  const text = mode === "general" ? general.text : draft.text;
  const changed = mode === "nearby" && !!draft.text && draft.circle !== circle;
  const unavailable = !room.connected || (mode === "nearby" && (!area || !circle || changed));
  const firstId = messages[0]?.id;
  const lastId = messages[messages.length - 1]?.id;

  // A new message scrolls to the bottom; an older page keeps the reader where they were.
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el || !anchor.current) return;
    el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
    anchor.current = null;
  }, [firstId]);
  useLayoutEffect(() => {
    if (open && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [open, lastId, mode, circle]);

  const earlier = () => {
    const key = mode === "general" ? "general" : circle;
    if (!key || !feed.current) return;
    anchor.current = { height: feed.current.scrollHeight, top: feed.current.scrollTop };
    room.loadEarlier(key);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || unavailable || !text.trim()) return;
    setSending(true);
    setError("");
    // The draft that was sent is cleared, whatever the screen shows by the time the answer comes back.
    const key = mode === "general" ? generalKey : area ? draftKey(crewId, area.id) : null;
    try {
      const problem = await room.send(mode, text.trim(), mode === "nearby" ? draft.circle : null);
      if (problem) setError(problem);
      else if (key) setDraft(key, { text: "", circle: mode === "general" ? null : circle });
    } catch {
      setError("Could not send. Your message is still here; try again.");
    } finally {
      setSending(false);
    }
  };

  const pick = (next: "general" | "nearby") => {
    onMode(next);
    setError("");
  };

  const type = (value: string) => {
    if (mode === "general") setDraft(generalKey, { text: value, circle: null });
    // The session a draft was started in stays with it until it is sent or emptied.
    else if (area) setDraft(draftKey(crewId, area.id), { text: value, circle: draft.text ? draft.circle : circle });
  };

  return (
    <section
      hidden={!open}
      className={css.chat}
      aria-label="Crew conversation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className={css.chatHead}>
        <MessageCircle size={18} className="text-orange" aria-hidden />
        <div>
          <h2 className="font-display font-black">Crew chat</h2>
          <p className="font-mono text-[10px] text-dim">{room.snapshot?.peers.length ?? 0} in the room</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close crew chat" className={css.close}>
          <X size={19} aria-hidden />
        </button>
      </header>
      <div className={css.modes} role="group" aria-label="Conversation audience">
        <button type="button" aria-pressed={mode === "general"} onClick={() => pick("general")}>
          General
        </button>
        <button type="button" aria-pressed={mode === "nearby"} onClick={() => pick("nearby")}>
          Area chat {area && <span>{members.length}</span>}
        </button>
      </div>
      <div className={css.audience} role="status">
        {mode === "general" ? (
          room.watching ? "You're watching from the door. Everyone in this crew can read and reply here." : "Everyone in this crew can read and reply."
        ) : area ? (
          <>
            <strong>{area.name}</strong>
            <span>
              {others.length
                ? `With ${others.slice(0, 3).map((p) => p.name).join(", ")}${others.length > 3 ? ` and ${others.length - 3} others` : ""}.`
                : "You're the first here."}{" "}
              Only people inside this boundary receive new messages.
            </span>
          </>
        ) : room.watching ? (
          "Area chats are for people walking in the room. You'll walk in when a spot opens; your drafts stay here."
        ) : (
          "Walk into a marked area to join its conversation. Your area drafts stay there."
        )}
      </div>
      <div
        className={css.feed}
        ref={feed}
        role="log"
        aria-label={mode === "general" ? "General crew messages" : "Private area messages"}
        aria-live="polite"
        aria-relevant="additions"
      >
        {mode === "nearby" && !area ? (
          <div className={css.areaList}>
            {layout.privateAreas.map((item) => {
              const count = room.snapshot?.peers.filter((p) => privateAreaAt(layout, p)?.id === item.id).length ?? 0;
              const saved = !!drafts[draftKey(crewId, item.id)]?.text;
              return (
                <button
                  type="button"
                  key={item.id}
                  disabled={room.watching}
                  onClick={() => {
                    setError("");
                    onVisit(item);
                  }}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {count ? `${count} inside` : "Be the first"}
                      {saved ? " · Draft saved" : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden />
                </button>
              );
            })}
            <p className="hint">These areas are open to crew members. Walk in to join; walk out to leave.</p>
          </div>
        ) : (
          <>
            {thread?.more && thread.loaded && messages.length > 0 && (
              <button type="button" className={css.more} onClick={earlier} disabled={thread.loading}>
                {thread.loading ? "Loading…" : "Earlier messages"}
              </button>
            )}
            {messages.length ? (
              messages.map((message) => (
                <div key={message.id} className={`${css.message} ${message.author_id === userId ? css.own : ""}`}>
                  <ChatFace look={message.author_look} size={28} />
                  <Bubble
                    body={message.body}
                    author={message.author_id === userId ? "You" : message.author_name}
                    own={message.author_id === userId}
                    time={chatTime(message.created_at)}
                  />
                </div>
              ))
            ) : (
              <p className="hint">
                {!thread?.loaded
                  ? "Loading the conversation…"
                  : mode === "general"
                    ? "Your crew's conversation starts here."
                    : "This area's conversation starts here. Move around inside it; the conversation stays together."}
              </p>
            )}
          </>
        )}
      </div>
      <form className={css.composer} onSubmit={submit}>
        {changed && area && (
          <div className={css.draftNotice}>
            <p>A new conversation started here. Your draft is kept.</p>
            <button type="button" onClick={() => setDraft(draftKey(crewId, area.id), { ...draft, circle })}>
              Use this draft in this conversation
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className={css.error}>
            {error}
          </p>
        )}
        {!room.connected && (
          <p className="hint" role="status">
            Reconnecting. Your draft is kept.
          </p>
        )}
        <div className={css.inputRow}>
          <label className="sr-only" htmlFor="crew-room-message">
            {mode === "general" ? "Message your crew" : "Message this area"}
          </label>
          <input
            id="crew-room-message"
            value={text}
            disabled={sending || (mode === "nearby" && !area)}
            maxLength={400}
            autoComplete="off"
            placeholder={mode === "general" ? "Message your crew" : area ? `Message ${area.name}` : "Choose an area above"}
            onChange={(event) => type(event.target.value)}
          />
          <button type="submit" disabled={sending || unavailable || !text.trim()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
