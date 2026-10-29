"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { RoomAnnouncement, RoomMessage } from "@/lib/events-r1/types";
import { Avatar, GHOST, LINK, LIP, RoomLogo } from "./ui";
import { clock12 } from "./words";

/** Who is "the room" in a thread: lines by the room itself or one of its hosts carry the logo and a Host tag. */
export type Voice = { roomName: string; logo: string | null; hosts: Set<string> };
const isHost = (v: Voice, name: string) => name === v.roomName || v.hosts.has(name);

/** One line of a chat: avatar, name, time, text. */
export function Line({ m, voice }: { m: RoomMessage; voice: Voice }) {
  const host = isHost(voice, m.author_name);
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-2.5" data-line={m.id}>
      {host ? <RoomLogo url={voice.logo} name={voice.roomName} size={36} /> : <Avatar name={m.author_name} />}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <b className="font-body text-[14px]">{m.author_name}</b>
          {host && <span className="rounded-[4px] bg-t-accent px-1.5 py-px font-body text-[11px] font-extrabold text-t-on">Host</span>}
          <time className="font-body text-[12px] text-t-muted" dateTime={m.created_at}>{clock12(m.created_at)}</time>
        </div>
        <p className="mt-0.5 break-words font-body text-[14.5px] [overflow-wrap:anywhere]">{m.body}</p>
      </div>
    </div>
  );
}

/** Lines that stand in behind a lock. They are not the room's words: nobody outside reads those. */
export function PlaceholderLines() {
  const rows: Array<[string, number]> = [["Tolu", 46], ["Kemi", 72], ["Dami", 38], ["Ife", 58]];
  return (
    <div aria-hidden className="pointer-events-none flex select-none flex-col gap-3.5 opacity-60 blur-[5px]">
      {rows.map(([n, w]) => (
        <div key={n} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2.5">
          <Avatar name={n} />
          <div className="min-w-0">
            <b className="font-body text-[14px]">{n}</b>
            <p className="mt-1 h-3 rounded bg-t-muted/50" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A block of centred words with an optional action, where a chat has nothing to show yet. */
export function Note({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx("m-auto grid max-w-[360px] justify-items-center gap-2 p-6 text-center", className)}>
      <span className="font-display text-[18px] font-extrabold">{title}</span>
      {children}
    </div>
  );
}
export const NoteText = ({ children }: { children: ReactNode }) => <p className="font-body text-[14px] text-t-muted">{children}</p>;

/** The panel over a locked chat: who it is for and the way in. */
export function Lock({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="absolute inset-0 z-[2] grid place-items-center bg-gradient-to-b from-transparent to-t-tile to-30% p-5" data-lock>
      <div className="grid max-w-[340px] justify-items-center gap-2.5 rounded-hz border border-t-line bg-t-solid p-[18px] text-center shadow-[0_18px_40px_-20px_rgba(0,0,0,.5)]">
        <b className="font-display text-[18px] font-extrabold">{title}</b>
        <p className="font-body text-[14px] text-t-muted">{text}</p>
        {action}
      </div>
    </div>
  );
}

/** The announcements of a room as Pop cards, newest first. The newest one is the pinned one. */
export function PopList({ list, now }: { list: RoomAnnouncement[]; now: number }) {
  void now;
  return (
    <div className="grid content-start gap-3">
      {list.map((a, i) => (
        <article key={a.id} className="grid gap-1.5 rounded-hz border border-t-line bg-t-solid p-3.5" data-announcement={a.event_id ? "pop" : "plain"}>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-t-accent">{i === 0 ? "Pinned Pop" : a.event_id ? `Pop · ${a.event_title}` : "Announcement"}</span>
          {i === 0 && a.event_id && <b className="font-body text-[15px]">{a.event_title}</b>}
          <p className="whitespace-pre-line break-words font-body text-[14px]">{a.body}</p>
          <small className="font-body text-[12px] text-t-muted">{a.author_name} · {clock12(a.created_at)}</small>
        </article>
      ))}
    </div>
  );
}

/** Host Pops pinned at the top of an event chat. */
export function PinnedPops({ lines }: { lines: RoomMessage[] }) {
  if (!lines.length) return null;
  return (
    <div className="grid gap-2" data-pinned>
      {lines.map((m) => (
        <div key={m.id} className="grid gap-1 rounded-hz border border-t-line bg-t-solid p-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-t-accent">Pinned Pop</span>
          <p className="font-body text-[14px]">{m.body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The line to type in and its send button. `main` makes Send the screen's one lip button; a ticket holder who is not in the room has
 * Join room as the main one, so Send is the quieter button then. On a phone it sticks to the bottom of the page.
 */
export function Composer({
  phone, placeholder, label, main, onSend, onSent,
}: {
  phone: boolean;
  placeholder: string;
  label: string;
  main: boolean;
  onSend: (body: string) => Promise<void>;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSend(text);
      setText("");
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again later");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className={clsx(
        "flex flex-wrap items-end gap-x-2.5",
        phone
          ? "sticky bottom-0 z-[7] mt-auto gap-x-2 border-t border-t-line bg-t-bar px-3 pb-4 pt-2.5 backdrop-blur-[14px]"
          : "border-t border-t-line bg-t-tile px-4 py-3"
      )}
      data-composer
    >
      {error && <p role="alert" className="mb-1.5 basis-full font-body text-[13px] font-semibold text-t-text">{error}</p>}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={500}
        autoComplete="off"
        className={clsx("mb-1 min-h-[46px] min-w-0 flex-1 border bg-t-bg px-4 font-body text-[16px] text-t-text", phone ? "rounded-full bg-t-tile" : "rounded-hz")}
      />
      <button type="submit" disabled={busy || !text.trim()} className={clsx(main ? LIP : GHOST, phone && "!px-4")}>
        {label === "Write an announcement" ? "Post" : "Send"}
      </button>
    </form>
  );
}

/** What stands in for the composer when a visitor can read an open room: join to say something. */
export function ReadBar({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-t-line bg-t-soft px-4 py-3 font-body text-[14px]" data-readbar>
      <span>You can read along. Join to say something.</span>
      <button type="button" onClick={onJoin} className={LINK}>Join room</button>
    </div>
  );
}

/** "You're going to X, so you're in its chat. Join Y to stay after the night." On a phone it carries the Join button. */
export function TicketStrip({ event, room, phone, join }: { event: string; room: string; phone: boolean; join: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-t-line bg-t-soft px-4 py-2.5 font-body text-[13.5px]" data-ticket-strip>
      <span className="min-w-[200px] flex-1">You&apos;re going to {event}, so you&apos;re in its chat. Join {room} to stay after the night.</span>
      {phone && (
        <button type="button" onClick={join} className={clsx(LIP, "!min-h-[44px] !px-3.5 !py-2 !text-[14px]")}>Join</button>
      )}
    </div>
  );
}

/** Keeps a scrolling box on its newest line, unless the reader has scrolled up. */
export function useStick(deps: ReadonlyArray<unknown>) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const first = deps[0];
  useEffect(() => {
    stuck.current = true;
  }, [first]);
  useEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what changes
  }, deps);
  return {
    ref: box,
    onScroll: () => {
      const el = box.current;
      if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    },
  };
}
