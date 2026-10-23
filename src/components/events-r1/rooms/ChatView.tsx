"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, Send } from "lucide-react";
import type { RoomMessage } from "@/lib/events-r1/types";
import { clockWord } from "./words";

/** The top of a chat screen: back, a title and one small line. Kept slim so the lines get the room. */
export function ChatTop({ title, sub, back, children }: { title: string; sub?: string; back: string; children?: ReactNode }) {
  const router = useRouter();
  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const canGoBack = nav ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) router.back();
    else router.replace(back);
  };
  return (
    <header className="pad-top flex-none border-b border-line px-4 pb-2.5">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-1">
        <Link href={back} onClick={goBack} aria-label="Back" className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream">
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[20px] font-black leading-tight">{title}</h1>
          {sub && <p className="hint truncate">{sub}</p>}
        </div>
      </div>
      {children && <div className="mx-auto mt-2 w-full max-w-[560px]">{children}</div>}
    </header>
  );
}

/** Host Pops pinned at the top of an event chat. */
export function Pinned({ lines }: { lines: RoomMessage[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="max-h-[30vh] flex-none overflow-y-auto border-b border-line bg-ink-2 px-4 py-2" data-pinned>
      <div className="mx-auto w-full max-w-[560px] space-y-1">
        {lines.map((m) => (
          <p key={m.id} className="font-body text-[14px] leading-snug">
            <span className="font-semibold text-orange">Pop:</span> {m.body}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The lines of a chat, oldest first, mine on the right. It sticks to the newest line unless the reader has scrolled up. */
export function Lines({ lines, meName }: { lines: RoomMessage[]; meName: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const last = lines[lines.length - 1]?.id;

  useEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [last]);

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      role="log"
      aria-live="polite"
      aria-label="Chat"
    >
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2">
        {lines.map((m) => {
          const mine = !!meName && m.author_name === meName;
          return (
            <div key={m.id} className={clsx("flex max-w-[82%] flex-col", mine ? "items-end self-end" : "items-start self-start")} data-line={m.id}>
              {!mine && <span className="mb-0.5 px-1 font-body text-[12px] text-dim">{m.author_name}</span>}
              <p
                className={clsx(
                  "whitespace-pre-line break-words rounded-2xl px-3.5 py-2 font-body text-[15px] leading-snug",
                  mine ? "rounded-br-md bg-orange text-brand-ink" : "rounded-bl-md bg-ink-3 text-cream"
                )}
              >
                {m.body}
              </p>
              <span className="mt-0.5 px-1 font-body text-[11px] text-dim">{clockWord(m.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What stands in for the composer when the viewer cannot say anything right now. */
export type Lock = { line: string; action?: { label: string; onClick: () => void } };

/** The line to type in and a send button, or a locked line with its one button. */
export function Composer({ onSend, lock, hint }: { onSend: (body: string) => Promise<void>; lock?: Lock; hint?: string }) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again later");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-none border-t border-line bg-ink px-4 py-2.5">
      <div className="mx-auto w-full max-w-[560px]">
        {hint && !lock && <p className="hint mb-1.5">{hint}</p>}
        {error && (
          <p role="alert" className="mb-1.5 font-body text-[13px] text-fireant">
            {error}
          </p>
        )}
        {lock ? (
          <div className="flex items-center gap-3">
            <p className="hint min-w-0 flex-1">{lock.line}</p>
            {lock.action && (
              <button type="button" className="btn flex-none px-4 normal-case" onClick={lock.action.onClick}>
                {lock.action.label}
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label="Say something" maxLength={500} autoComplete="off" className="min-w-0 flex-1" />
            <button type="submit" className="btn grid h-11 w-11 flex-none place-items-center p-0" disabled={busy || !text.trim()} aria-label="Send">
              <Send size={18} aria-hidden />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
