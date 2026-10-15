"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useFeatured } from "@/lib/crew-room/featured";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { VoiceSession, voiceDataNoteSeen, voiceServerEnabled, type VoiceView } from "@/lib/crew-room/voice";
import { useSession } from "@/lib/useSession";
import css from "./Places.module.css";

/**
 * Ola's LiveKit voice, dark behind one flag (design section 14). Joins the room only when the flag is on.
 *
 * SCREEN CHROME, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 *
 * DARK: NEXT_PUBLIC_ROOM_VOICE=1 and GET /api/crew/rooms/voice answering { enabled: true } (the LIVEKIT_* env). With
 * either missing this renders null and loads nothing: no mic, no tip, no LiveKit code.
 *
 * What it draws: one mic control under the shell's HUD pill at the top right of the stage (top: var(--room-hud-bottom);
 * Headphones, then Mic, then MicOff),
 * a one second label for each change, a "<NAME> IS LIVE" chip with a mute toggle while the crew owner is live, and the
 * owner's GO LIVE / END LIVE pill on the stage (roomStore action id "go-live", priority 60). The mic starts off every
 * time. The speaking rings are the world's: this sets roomStore.speaking, and the music ducks (music.duckVoice).
 * The audio logic is in src/lib/crew-room/voice.ts.
 */
export type RoomVoiceProps = { crewId: string; layout: CampaignLayout };

export default function RoomVoice({ crewId, layout }: RoomVoiceProps) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void voiceServerEnabled().then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, []);
  return enabled ? <Voice crewId={crewId} layout={layout} /> : null;
}

const HINT_KEY = "hz:voice-hint";
/** "PEOPLE NEAR YOU CAN HEAR YOU", once per visit, the first time the mic goes on. */
function hintDue(): boolean {
  try {
    if (sessionStorage.getItem(HINT_KEY)) return false;
    sessionStorage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function Voice({ crewId, layout }: RoomVoiceProps) {
  const { userId } = useSession();
  const { isOwner } = useFeatured(crewId);
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const [view, setView] = useState<VoiceView | null>(null);
  const [label, setLabel] = useState("");
  const me = useRoomStore((s) => s.me);
  const peers = useRoomStore((s) => s.peers);
  const zone = useRoomStore((s) => s.zone);
  const phase = view?.phase ?? "off";

  const ensure = useCallback((): VoiceSession | null => {
    if (session.current) return session.current;
    if (!host.current || !userId) return null;
    const s = new VoiceSession(crewId, userId, host.current);
    session.current = s;
    setView(s.get());
    s.subscribe(setView);
    return s;
  }, [crewId, userId]);

  // Leaving the room (or the page) hangs up.
  useEffect(() => {
    const hangUp = () => session.current?.leave();
    window.addEventListener("pagehide", hangUp);
    return () => {
      window.removeEventListener("pagehide", hangUp);
      hangUp();
      session.current = null;
    };
  }, []);

  // Where everyone stands decides who I hear.
  useEffect(() => {
    if (phase === "off" || phase === "joining") return;
    session.current?.place(me, peers, layout);
  }, [phase, me, peers, layout]);

  // One short label per change, for about a second and a half.
  useEffect(() => {
    if (!view?.notice) return;
    let text = view.notice;
    if (text === "MIC ON" && hintDue()) text = "MIC ON. PEOPLE NEAR YOU CAN HEAR YOU";
    setLabel(text);
    const t = setTimeout(() => setLabel(""), text.length > 24 ? 3200 : 1600);
    return () => clearTimeout(t);
  }, [view?.noticeId, view?.notice]);

  // The owner's pill on the stage; END LIVE stays until pressed, even off the stage.
  const live = !!view?.iAmLive;
  useEffect(() => {
    const store = useRoomStore.getState();
    if (!isOwner || !me || (zone !== "stage" && !live)) {
      store.clearAction("go-live");
      return;
    }
    store.setAction({
      id: "go-live",
      label: live ? "END LIVE" : "GO LIVE",
      priority: 60,
      onPress: () => {
        const s = ensure();
        if (!s) return;
        void (live ? s.setMic(false) : s.goLive());
      },
    });
  }, [isOwner, me, zone, live, ensure]);
  useEffect(() => () => useRoomStore.getState().clearAction("go-live"), []);

  const press = () => {
    const s = ensure();
    if (!s) return;
    if (phase === "off") {
      if (!voiceDataNoteSeen()) {
        setLabel("Voice uses data.");
        setTimeout(() => setLabel(""), 2400);
      }
      void s.join();
    } else if (phase === "joining") {
      return;
    } else if (!view?.canPublish) {
      s.leave(); // a watcher only listens: pressing again stops
    } else {
      void s.setMic(phase !== "mic");
    }
  };

  const Icon = phase === "mic" ? Mic : phase === "muted" ? MicOff : Headphones;
  const name =
    phase === "off" ? "Join voice. Your microphone stays off." : phase === "joining" ? "Joining voice" : !view?.canPublish ? "Listening only. Tap to stop." : phase === "mic" ? "Mute microphone" : "Turn on microphone";

  return (
    <>
      <div ref={host} className="sr-only" aria-hidden />
      <button type="button" className={css.micButton} onClick={press} aria-label={name} aria-pressed={phase === "mic"} disabled={!userId} title={name}>
        <span className={css.micFace} style={phase === "mic" ? { borderColor: "rgb(var(--keke))" } : undefined}>
          {phase === "mic" && <span className={css.micRing} aria-hidden />}
          <Icon size={18} strokeWidth={2.2} aria-hidden />
          {(phase === "listening" || phase === "muted") && <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-keke" aria-hidden />}
        </span>
      </button>
      {label && (
        <p
          role="status"
          style={{ top: "calc(var(--room-hud-bottom, 56px) + 6px)" }}
          className="pointer-events-none absolute right-[56px] max-w-[70%] rounded-[4px] border border-line bg-ink/90 px-2 py-1 font-mono text-[10px] font-medium uppercase leading-[13px] tracking-[0.08em] text-cream"
        >
          {label}
        </p>
      )}
      {view?.liveBy && (
        <div className="pointer-events-auto absolute left-2 right-[60px] top-2 flex min-h-[44px] items-center gap-2 rounded-hz border border-line bg-ink-2/90 pl-3" role="status" data-voice-live>
          <span className="h-2 w-2 flex-none rounded-full bg-fireant" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-cream">
            {view.iAmLive ? "YOU ARE LIVE" : `${view.liveName} IS LIVE`} · {view.listening} LISTENING
          </span>
          {!view.iAmLive && (
            <button type="button" className="grid h-11 w-11 flex-none place-items-center text-cream" aria-label={view.liveMuted ? "Hear the live voice" : "Mute the live voice"} aria-pressed={view.liveMuted} onClick={() => session.current?.muteLive(!view.liveMuted)}>
              {view.liveMuted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
            </button>
          )}
        </div>
      )}
    </>
  );
}
