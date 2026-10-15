"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, LocateFixed, MessageCircle, Settings2 } from "lucide-react";
import { MusicIcon, useMusicSwitch } from "@/components/campaign/RoomMusic";
import css from "@/components/campaign/Campaign.module.css";
import { useRoomStore } from "@/lib/crew-room/roomStore";

/**
 * The room's small controls, drawn by the shell (docs/ROOM-GAME-DESIGN.md sections 6.1 and 6.2):
 *
 *   HUD pill, top right: sound (an icon, the same switch as Me, Settings), full view or find me, and the owner's room
 *   settings. The voice control belongs to RoomVoice, which sits right under this pill (--room-hud-bottom).
 *   CHAT button, bottom left, with the unread count. It opens the chat sheet at half height; the sheet owns every state
 *   from there (ChatSheet.tsx) and the button hides while the sheet is up.
 *
 * Every icon button says what it is for one second the first time it changes, and carries an aria-label.
 */
export function HudPill({ audio, owner, watching, onSettings }: { audio: string | null; owner: boolean; watching: boolean; onSettings: () => void }) {
  const music = useMusicSwitch(audio);
  const view = useRoomStore((s) => s.view);
  const [label, setLabel] = useState<{ text: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, top: number) => {
    setLabel({ text, top });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel(null), 1100);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const full = view === "me";
  return (
    <>
      <div className={css.hud} role="group" aria-label="Room controls">
        <button
          type="button"
          aria-pressed={music.sounding}
          aria-label={music.muted ? "Music. Sound is off in Me, Settings" : "Music"}
          title={music.failed ? "This room's own track can't play on this phone, so the room plays its theme" : "Music"}
          onClick={() => {
            music.toggle();
            say(music.on ? "MUSIC OFF" : "MUSIC ON", 8);
          }}
        >
          <MusicIcon sounding={music.sounding} />
        </button>
        {!watching && (
          <button
            type="button"
            aria-label={full ? "See the whole room" : "Find me"}
            title={full ? "See the whole room" : "Find me"}
            onClick={() => {
              useRoomStore.getState().setView(full ? "full" : "me");
              say(full ? "FULL VIEW" : "BACK TO ME", 8 + 45);
            }}
          >
            {full ? <Maximize2 size={20} aria-hidden /> : <LocateFixed size={20} aria-hidden />}
          </button>
        )}
        {owner && (
          <button type="button" aria-label="Customise the room" title="Customise the room" onClick={onSettings}>
            <Settings2 size={20} aria-hidden />
          </button>
        )}
      </div>
      {label && (
        <span className={css.hudLabel} style={{ top: label.top + 12 }} role="status">
          {label.text}
        </span>
      )}
    </>
  );
}

/** The CHAT button. Hidden while the chat sheet is up (the sheet is the chat). */
export function ChatButton({ compact }: { compact: boolean }) {
  const sheet = useRoomStore((s) => s.sheet);
  const unread = useRoomStore((s) => s.unread);
  if (sheet !== "closed") return null;
  return (
    <button
      type="button"
      className={css.chatBtn}
      data-compact={compact || undefined}
      aria-label={unread ? `Open chat. ${unread} unread` : "Open chat"}
      onClick={() => useRoomStore.getState().setSheet("half")}
    >
      <MessageCircle size={18} aria-hidden />
      <span>Chat</span>
      {unread > 0 && <span className={css.unread}>{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}
