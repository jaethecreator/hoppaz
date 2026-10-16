"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeadphoneOff, Headphones, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { FaceDisc } from "@/components/Avatar";
import { stageZoneId, type CampaignLayout } from "@/lib/campaign/layout";
import { useFeatured } from "@/lib/crew-room/featured";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { STAGE_FLAG, useStagePoll, useStageStore } from "@/lib/crew-room/stage";
import { VOICE_AUTO, VoiceSession, voiceDataNoteSeen, voiceServerEnabled, type VoiceView } from "@/lib/crew-room/voice";
import { TEXT, tipDue } from "@/lib/crew-room/voiceFlow";
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
 * VOICE IS ON BY DEFAULT, THE MIC IS NOT (rules in lib/crew-room/voiceFlow.ts). Walking into the room joins as a LISTENER by
 * itself (VoiceSession.enter(): no mic, no permission prompt); the first tap on the control is when the phone is asked for
 * the mic, a "no" is listen-only with "Mic blocked. Tap to allow", and the app going to the background or a locked screen
 * closes the mic until the Hopper is back AND taps. A small speaker toggle under the control turns the room's voices off
 * (remembered per room). Audio the browser holds back is unlocked by the first tap anywhere in the room. The room is a crew
 * room only: hotspot rooms never mount this, so they stay voice-free. NEXT_PUBLIC_ROOM_VOICE_AUTO=0 goes back to tap-to-join.
 *
 * What it draws: one mic control under the shell's HUD pill at the top right of the stage (top: var(--room-hud-bottom);
 * Headphones while listening, a lit Mic while talking, MicOff when muted or blocked), the speaker toggle under it,
 * a one second label for each change, a one-time tip, a "<NAME> IS LIVE" chip with a mute toggle while the crew owner is
 * live, and the owner's GO LIVE / END LIVE pill on the stage (roomStore action id "go-live", priority 60). The mic starts
 * off every time. With NEXT_PUBLIC_ROOM_STAGE_VOICE=1 (stage voice, design 14.4) the owner-only GO LIVE is replaced: staff (owner and
 * admins) on the stage get SPEAK TO ALL (action id "stage-voice", priority 60), everyone else joins listen-only by
 * themselves when the stage goes live and sees one LIVE ON STAGE pill (the speakers' faces, the first name, the head
 * count, a mute toggle, and TAP TO LISTEN while the browser holds the audio back). Leaving the stage ends the
 * broadcast. The speaking dot over a head is the world's (CampaignWorld, Campaign.module.css .talk): this sets
 * roomStore.speaking (with or without the stage flag), and the music ducks (music.duckVoice).
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

const AUTO_RETRY_MS = 20_000;
const EMPTY_STAGE_MS = 30_000;
const LEAVE_GRACE_MS = 1500;
const KEEP_ALIVE_MS = 20_000;
const DECLINED_KEY = "hz:stage-declined";
/** I left voice myself this visit: the stage must not pull me back in. */
function declined(): boolean {
  try {
    return !!sessionStorage.getItem(DECLINED_KEY);
  } catch {
    return false;
  }
}
const decline = () => {
  try {
    sessionStorage.setItem(DECLINED_KEY, "1");
  } catch {
    /* private window: the stage may pull me back in, which is fine */
  }
};

const TIP_MS = 7000;
const localKV = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

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
  const { profile } = useSession();
  useStagePoll(crewId, STAGE_FLAG);
  const stage = useStageStore((s) => s.stage);
  const isStaff = useStageStore((s) => s.isStaff);
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const [view, setView] = useState<VoiceView | null>(null);
  const [label, setLabel] = useState("");
  const me = useRoomStore((s) => s.me);
  const peers = useRoomStore((s) => s.peers);
  const zone = useRoomStore((s) => s.zone);
  const phase = view?.phase ?? "off";
  const stageZone = stageZoneId(layout);
  const onStageZone = !!stageZone && zone === stageZone;
  const inStageList = !!userId && stage.includes(userId);
  const [retry, setRetry] = useState(0);
  const lastAuto = useRef(0);
  const [tip, setTip] = useState(false);
  const tipShown = useRef(false);
  const entered = useRef(false);

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

  // Leaving the room is the cleanup above. The app going to the background or the screen locking closes the mic and lets go of
  // it; coming back turns nothing on, it only says the mic is off (the Hopper taps to talk again).
  useEffect(() => {
    const onVisibility = () => {
      const s = session.current;
      if (!s) return;
      if (document.visibilityState === "hidden") void s.away();
      else s.returned();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // VOICE ON BY DEFAULT: walking in joins as a listener, once per visit to the room. No mic, no prompt. It waits for my walker
  // (the room's enter call has answered, so the server knows I am walking and the token can let me talk later). If it fails, or
  // the Hopper left voice themselves, the control is how they come back; nothing retries by itself (the stage effect below aside).
  const placed = !!me;
  useEffect(() => () => void (entered.current = false), []); // a development re-mount starts again
  useEffect(() => {
    if (!VOICE_AUTO || entered.current || !userId || !placed || phase !== "off" || declined()) return;
    const s = ensure();
    if (!s) return;
    entered.current = true;
    void s.enter();
  }, [userId, placed, phase, ensure]);

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

  // The one-time tip on the control, once per device: the first time someone who can talk is in the room listening.
  const canTalk = !!view?.canPublish;
  const voicesOff = !!view?.speakerOff;
  useEffect(() => {
    if (phase !== "listening" || !canTalk || voicesOff || tipShown.current || !tipDue(localKV())) return;
    tipShown.current = true;
    setTip(true);
  }, [phase, canTalk, voicesOff]);
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(false), TIP_MS);
    return () => clearTimeout(t);
  }, [tip]);

  // The owner's pill on the stage; END LIVE stays until pressed, even off the stage. (Flag off only: stage voice has its own.)
  const live = !!view?.iAmLive;
  useEffect(() => {
    if (STAGE_FLAG) return;
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

  // ---- Stage voice (flag). The database's stage list goes to the session; the session never trusts the browser's word.
  useEffect(() => {
    session.current?.setStage(stage);
  }, [stage, phase]);

  // The stage goes live: join by myself, listen-only. Not if I left voice myself this visit; at most one try every 20 s.
  useEffect(() => {
    if (!STAGE_FLAG || !userId || stage.length === 0 || phase !== "off" || declined()) return;
    const wait = lastAuto.current + AUTO_RETRY_MS - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setRetry((n) => n + 1), wait);
      return () => clearTimeout(t);
    }
    lastAuto.current = Date.now();
    void ensure()?.joinListen();
  }, [stage.length, phase, userId, ensure, retry]);

  // An automatic listener who never touched the mic goes 30 s after the stage empties, to save their data.
  const auto = !!view?.auto;
  useEffect(() => {
    if (!STAGE_FLAG || stage.length > 0 || !auto || phase === "off") return;
    const t = setTimeout(() => session.current?.leave(), EMPTY_STAGE_MS);
    return () => clearTimeout(t);
  }, [stage.length, auto, phase]);

  // Browsers hold audio back until a tap (voice now joins by itself, so this is for every room, not just the stage). Walking is
  // tapping, so the first touch anywhere in the room lets it play. On a
  // touch screen a pointerdown is NOT a gesture that unlocks audio (iPhones ignore it): the lift of the finger is. So it
  // listens for pointerup, with touchend and click as the fallback for a browser that only counts one of them, takes the
  // first of the three, and lets go of all of them. TAP TO LISTEN on the pill stays as the visible way if none of them took.
  const canPlay = view?.canPlay ?? true;
  useEffect(() => {
    if (phase === "off" || phase === "joining" || canPlay) return;
    const gestures = ["pointerup", "touchend", "click"] as const;
    const stop = () => gestures.forEach((g) => window.removeEventListener(g, unlock, true));
    const unlock = () => {
      stop();
      session.current?.unlockAudio();
    };
    gestures.forEach((g) => window.addEventListener(g, unlock, { capture: true, passive: true }));
    return stop;
  }, [phase, canPlay]);

  // Staff on the stage: SPEAK TO ALL. Their mic is never opened without this tap.
  useEffect(() => {
    if (!STAGE_FLAG) return;
    const store = useRoomStore.getState();
    if (!isStaff || !me || !onStageZone || live) {
      store.clearAction("stage-voice");
      return;
    }
    store.setAction({
      id: "stage-voice",
      label: "SPEAK TO ALL",
      priority: 60,
      onPress: () => {
        const s = ensure();
        if (s) void s.speakToAll();
      },
    });
  }, [isStaff, me, onStageZone, live, ensure]);
  useEffect(() => () => useRoomStore.getState().clearAction("stage-voice"), []);

  // A staff member whose mic is already on and whom the database puts on the stage starts talking to the room by itself.
  useEffect(() => {
    if (!STAGE_FLAG || !isStaff || !inStageList || live || phase !== "mic") return;
    void session.current?.stageCall(true);
  }, [isStaff, inStageList, live, phase]);

  // Leaving the stage ends the broadcast (1.5 s of grace so walking along the edge does not flicker). While on it, the
  // server is told every 20 s, which also lets it say no if the database no longer has me there.
  useEffect(() => {
    if (!STAGE_FLAG || !live) return;
    if (!onStageZone) {
      const t = setTimeout(() => void session.current?.stageCall(false), LEAVE_GRACE_MS);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => void session.current?.stageCall(true), KEEP_ALIVE_MS);
    return () => clearInterval(t);
  }, [live, onStageZone]);

  const press = () => {
    const s = ensure();
    if (!s) return;
    s.unlockAudio(); // a tap is a gesture: audio the browser held back plays now
    if (phase === "off" && !voiceDataNoteSeen()) {
      setLabel("Voice uses data.");
      setTimeout(() => setLabel(""), 2400);
    }
    // Not in voice: join. A watcher: stop (and the stage must not pull them back). Listening or muted: ask for the mic. Talking: mute.
    void s.tap().then((did) => did === "leave" && decline());
  };

  const speakerOff = !!view?.speakerOff;
  const connected = phase !== "off" && phase !== "joining";
  const showTip = tip && phase === "listening";
  const blocked = phase === "blocked";

  const Icon = phase === "mic" ? Mic : phase === "muted" || blocked ? MicOff : speakerOff ? HeadphoneOff : Headphones;
  const name =
    phase === "off"
      ? "Join voice. Your microphone stays off."
      : phase === "joining"
        ? "Joining voice"
        : !view?.canPublish
          ? "Listening only. Tap to stop."
          : phase === "mic"
            ? "Mute microphone"
            : blocked
              ? TEXT.blocked
              : "Tap to talk. Turn on your microphone";

  return (
    <>
      <div ref={host} className="sr-only" aria-hidden />
      <button type="button" className={css.micButton} onClick={press} aria-label={name} aria-pressed={phase === "mic"} disabled={!userId} title={name} data-voice-control data-voice-phase={phase}>
        <span className={`${css.micFace} ${phase === "mic" ? css.micLive : ""}`}>
          {phase === "mic" && <span className={css.micRing} aria-hidden />}
          <Icon size={18} strokeWidth={2.2} aria-hidden />
          {(phase === "listening" || phase === "muted") && !speakerOff && <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-keke" aria-hidden />}
          {blocked && <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-fireant" aria-hidden />}
        </span>
      </button>
      {connected && (
        <button
          type="button"
          className={css.speakerButton}
          onClick={() => session.current?.setSpeaker(speakerOff)}
          aria-label={speakerOff ? "Turn the room's voices on" : "Turn the room's voices off"}
          aria-pressed={speakerOff}
          title={speakerOff ? "Room voices are off. Tap to hear the room." : "Room voices are on. Tap for silence."}
          data-voice-speaker
        >
          <span className={`${css.speakerFace} ${speakerOff ? css.speakerOff : ""}`}>{speakerOff ? <VolumeX size={14} strokeWidth={2.2} aria-hidden /> : <Volume2 size={14} strokeWidth={2.2} aria-hidden />}</span>
        </button>
      )}
      {label ? (
        <p
          role="status"
          style={{ top: "calc(var(--room-hud-bottom, 56px) + 6px)", right: "calc(56px + var(--room-dock, 0px))" }}
          className="pointer-events-none absolute max-w-[70%] rounded-[4px] border border-line bg-ink/90 px-2 py-1 font-mono text-[10px] font-medium uppercase leading-[13px] tracking-[0.08em] text-cream"
        >
          {label}
        </p>
      ) : blocked ? (
        <button
          type="button"
          onClick={press}
          style={{ top: "calc(var(--room-hud-bottom, 56px) + 6px)", right: "calc(56px + var(--room-dock, 0px))" }}
          className="pointer-events-auto absolute max-w-[70%] rounded-[4px] border border-line bg-ink/90 px-2.5 py-1.5 text-left text-[12px] font-medium leading-[16px] text-cream"
          data-voice-blocked
        >
          {TEXT.blocked}
        </button>
      ) : showTip ? (
        <p
          role="status"
          style={{ top: "calc(var(--room-hud-bottom, 56px) + 6px)", right: "calc(56px + var(--room-dock, 0px))" }}
          className="pointer-events-none absolute max-w-[min(220px,70%)] rounded-[4px] border border-line bg-ink/90 px-2.5 py-1.5 text-[12px] font-medium leading-[16px] text-cream"
          data-voice-tip
        >
          {TEXT.tip}
        </p>
      ) : null}
      {STAGE_FLAG && view?.liveBy && (
        <div className="pointer-events-auto absolute left-2 right-[60px] top-2 flex min-h-[44px] items-center gap-2 rounded-hz border border-line bg-ink-2/90 pl-3" role="status" data-voice-stage>
          <span className="h-2 w-2 flex-none rounded-full bg-fireant" aria-hidden />
          <span className="flex flex-none -space-x-2">
            {(view.iAmLive && userId ? [userId, ...view.stageBy] : view.stageBy).slice(0, 3).map((id) => {
              const p = id === userId ? { name: "You", look: profile?.avatar } : peers.find((q) => q.id === id);
              return <FaceDisc key={id} look={p?.look} initial={p?.name} size={28} />;
            })}
          </span>
          <span className="min-w-0 flex-1 font-mono text-[10px] font-medium uppercase leading-[13px] tracking-[0.08em] text-cream">
            <span className="block">LIVE ON STAGE</span>
            <span className="block truncate text-dim">
              {view.iAmLive ? "YOU" : view.liveName} · {view.listening} LISTENING
            </span>
          </span>
          {!canPlay ? (
            <button type="button" className="min-h-[44px] flex-none px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-keke" onClick={() => session.current?.unlockAudio()}>
              TAP TO LISTEN
            </button>
          ) : (
            !view.iAmLive && (
              <button type="button" className="grid h-11 w-11 flex-none place-items-center text-cream" aria-label={view.liveMuted ? "Hear the stage" : "Mute the stage"} aria-pressed={view.liveMuted} onClick={() => session.current?.muteLive(!view.liveMuted)}>
                {view.liveMuted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
              </button>
            )
          )}
        </div>
      )}
      {!STAGE_FLAG && view?.liveBy && (
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
