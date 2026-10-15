"use client";

import Link from "next/link";
import { FaceDisc } from "@/components/Avatar";
import { markMentionsSeen, type ChatRow, type Mention } from "@/lib/social";
import AccountNudge from "./AccountNudge";
import ChatFace from "./ChatFace";
import { rowTime } from "./Bubble";

/**
 * The CHATS tab: private chats only, newest first. An orange count and a bolder line where something is unread.
 * Waves and the crew are the CREW tab's job (CrewTab.tsx).
 */
export default function ChatList({ dms, mentions = [], hasAccount }: { dms: ChatRow[]; mentions?: Mention[]; hasAccount: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {!hasAccount && <AccountNudge text="Make an account to chat privately." />}
      {mentions.length > 0 && (
        <>
          <p className="seclabel mb-2">Tagged you</p>
          {mentions.map((m) => (
            <Link
              key={m.id}
              href={m.slug ? `/room/${m.slug}` : "/"}
              onClick={() => void markMentionsSeen([m.id])}
              className="card mb-2 flex items-center gap-3 py-3"
            >
              <FaceDisc initial={m.alias} size={38} anon />
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{m.alias}</b>
                <span className="hint block truncate">
                  {m.place ? `${m.place}: ` : ""}
                  {m.excerpt}
                </span>
              </span>
              <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">OPEN →</span>
            </Link>
          ))}
          <p className="seclabel mb-2 mt-3">Chats</p>
        </>
      )}
      {dms.length === 0 ? (
        <p className="hint">Say hi to someone in a room. Wave back and you&apos;re crew.</p>
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
    </div>
  );
}
