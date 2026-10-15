"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChatRow, CrewFace, WaveIn } from "@/lib/social";
import CrewSheet, { type CrewPerson } from "@/components/social/CrewSheet";
import { FaceDisc } from "@/components/Avatar";
import ChatFace from "./ChatFace";
import { rowTime } from "./Bubble";

/**
 * The first tab of Chat, kept tight (supabase/crew_friends.sql): waves waiting for me (WAVE BACK or PASS), a row of my
 * crew's faces (tap one for MESSAGE or POKE), then my chats with an orange dot and a count where something is unread.
 * Plain rows on the card colour. The only orange here is the one thing you can answer with, and the unread.
 */
export default function Inbox({
  waves,
  crew,
  dms,
  hasAccount,
  onAnswer,
  onPass,
}: {
  waves: WaveIn[];
  crew: CrewFace[];
  dms: ChatRow[];
  hasAccount: boolean;
  onAnswer: (wave: WaveIn) => void;
  onPass: (wave: WaveIn) => void;
}) {
  const [picked, setPicked] = useState<CrewPerson | null>(null);
  const empty = waves.length === 0 && crew.length === 0 && dms.length === 0;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {!hasAccount && <AccountNudge text="Make an account to answer waves and chat privately." />}

      {waves.length > 0 && (
        <>
          <p className="seclabel mb-2">Waved at you</p>
          {waves.map((w) => (
            <div key={w.id} className="card mb-2 flex items-center gap-3 py-3">
              <ChatFace look={w.look} alias={w.look ? null : w.name} size={38} caption={!w.look} />
              <div className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{w.room ? w.name : `@${w.name}`}</b>
                {w.where && <p className="hint truncate">{w.where}</p>}
              </div>
              <button className="btn px-3" onClick={() => onAnswer(w)}>WAVE BACK</button>
              <button className="btn btn-ghost px-3" onClick={() => onPass(w)}>PASS</button>
            </div>
          ))}
        </>
      )}

      {crew.length > 0 && (
        <>
          <p className={`seclabel mb-2 ${waves.length > 0 ? "mt-4" : ""}`}>Crew</p>
          <div className="-mx-4 mb-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-3">
              {crew.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-[56px] flex-none flex-col items-center gap-1 pb-1"
                  onClick={() => setPicked({ id: c.id, name: c.name, look: c.look })}
                  aria-label={`${c.name}${c.unread > 0 ? `, ${c.unread} unread` : ""}`}
                >
                  <span className="relative block">
                    <FaceDisc look={c.look} initial={c.name} size={48} />
                    {c.unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-ink-2 bg-orange" aria-hidden />}
                  </span>
                  <span className="w-full truncate text-center font-mono text-[10px] uppercase tracking-[0.04em] text-dim">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {(dms.length > 0 || empty) && <p className={`seclabel mb-2 ${waves.length > 0 || crew.length > 0 ? "mt-3" : ""}`}>Chats</p>}
      {empty ? (
        <p className="hint">Say hi to someone in a crew room. If they wave back, you&apos;re crew.</p>
      ) : (
        dms.map((d) => (
          <Link href={`/chat/dm/${d.id}`} key={d.id} className="card mb-2 flex items-center gap-3 py-3">
            <ChatFace look={d.other_look} alias={d.other_look ? null : d.other_name} size={38} />
            <span className="min-w-0 flex-1">
              <b className={`block truncate font-display text-[15px] ${d.unread > 0 ? "font-black" : "font-semibold"}`}>{d.other_name}</b>
              <p className={`hint truncate ${d.unread > 0 ? "!text-cream" : ""}`}>{d.last_body ?? (d.event_title ? `Met at ${d.event_title}` : "Say hello")}</p>
            </span>
            <span className="flex flex-none flex-col items-end gap-1.5">
              <span className="font-mono text-[10px] text-dim">{rowTime(d.last_at)}</span>
              {d.unread > 0 ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-orange px-1 font-mono text-[10px] font-medium text-ink" aria-label={`${d.unread} unread`}>
                  {d.unread > 9 ? "9+" : d.unread}
                </span>
              ) : (
                d.revealed && !d.crew && <span className="pill">KNOWN</span>
              )}
            </span>
          </Link>
        ))
      )}
      {picked && <CrewSheet person={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}

export function AccountNudge({ text }: { text: string }) {
  return (
    <Link href="/account?next=/chat" className="mb-3 flex min-h-[44px] flex-none items-center justify-between gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2">
      <span className="font-body text-[13px] leading-snug">{text}</span>
      <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">SIGN UP →</span>
    </Link>
  );
}
