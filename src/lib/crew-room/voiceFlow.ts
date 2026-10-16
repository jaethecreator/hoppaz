/**
 * The state rules of area voice on the Hopper's phone. PURE (no imports), so they are checked alone
 * (scripts/crew-room/check-voice-flow.mjs). voice.ts runs LiveKit, RoomVoice.tsx draws the control, and both ask this file
 * "what happens now?" so the rules live in one place.
 *
 * VOICE IS ON BY DEFAULT, THE MICROPHONE IS NOT. Walking into a crew room joins voice as a LISTENER by itself: you hear the
 * people near you and the stage straight away. Nothing is published and no permission is asked on the way in. The
 * microphone is asked for the first time the Hopper taps the control to talk, and never again by itself.
 *
 *   off        not in voice (not joined yet, or left)
 *   joining    connecting
 *   listening  in voice, hearing the room, mic never turned on this visit
 *   mic        talking (mic on, the control is lit)
 *   muted      in voice, mic closed after talking (or closed because the app went away)
 *   blocked    the phone said no to the mic: listen-only, the control says "Mic blocked. Tap to allow"
 *
 * Safety: going to the background (visibilitychange hidden, a locked screen) closes the mic and keeps it closed until the
 * Hopper is back AND taps. Leaving the room hangs up (RoomVoice). The speaker is separate from the mic: it can be turned off
 * for silence, and that choice is remembered per room. The mic never is: every visit starts with it closed.
 */

export type VoicePhase = "off" | "joining" | "listening" | "mic" | "muted" | "blocked";

export type Flow = {
  phase: VoicePhase;
  /** The server let me publish a microphone: I am a walker. A watcher listens and cannot be heard. */
  canPublish: boolean;
  /** I turned the room's voices off on this phone (remembered per room). */
  speakerOff: boolean;
  /** The mic was closed because the app went to the background: it stays closed until a tap. */
  away: boolean;
};

export const IDLE_FLOW: Flow = { phase: "off", canPublish: false, speakerOff: false, away: false };

/** The one thing a step asks the caller to do. `ask-mic` only ever comes from a tap (see `tap`). */
export type Do = "join" | "leave" | "ask-mic" | "mic-off" | "release-mic";
export type Note = "blocked-again" | "still-muted";
export type Step = { flow: Flow; do?: Do; note?: Note };

/** What is on the screen, word for word. */
export const TEXT = {
  /** The one-time tip on the control, shown once per device. */
  tip: "You can hear the room. Tap to talk.",
  /** On the control while the phone says no to the mic. */
  blocked: "Mic blocked. Tap to allow",
  /** One-second labels (uppercased by the label style). */
  notes: {
    "blocked-again": "MIC BLOCKED. CHECK YOUR PHONE SETTINGS.",
    "still-muted": "MIC IS OFF. TAP TO TALK.",
  } satisfies Record<Note, string>,
  speakerOn: "ROOM VOICES ON",
  speakerOff: "ROOM VOICES OFF",
} as const;

/** The server answered and I am in the voice room: listening, mic closed. Never asks for the mic. */
export function joined(f: Flow, canPublish: boolean): Step {
  return { flow: { ...f, phase: "listening", canPublish, away: false } };
}

/**
 * The tap on the voice control. The only place that asks for the mic.
 *   not in voice        join (as a listener)
 *   a watcher           leave (a watcher only listens, so a tap stops)
 *   talking             mute
 *   listening, muted    ask for the mic
 *   blocked             ask again, once, because the Hopper tapped
 */
export function tap(f: Flow): Step {
  if (f.phase === "off") return { flow: f, do: "join" };
  if (f.phase === "joining") return { flow: f };
  if (!f.canPublish) return { flow: f, do: "leave" };
  if (f.phase === "mic") return { flow: { ...f, phase: "muted" }, do: "mic-off" };
  return { flow: { ...f, away: false }, do: "ask-mic" };
}

/** The phone answered the mic request. A "no" is listen-only: still in voice, hearing everyone, control says blocked. */
export function micAnswer(f: Flow, granted: boolean): Step {
  if (granted) return { flow: { ...f, phase: "mic", away: false } };
  return { flow: { ...f, phase: "blocked" }, ...(f.phase === "blocked" ? { note: "blocked-again" as const } : {}) };
}

/** The app went to the background or the screen locked: a live mic closes and is let go of, and stays closed. */
export function wentAway(f: Flow): Step {
  if (f.phase !== "mic") return { flow: f };
  return { flow: { ...f, phase: "muted", away: true }, do: "release-mic" };
}

/** Back in the app. Nothing turns on by itself: if the mic was closed because of the background, say so. */
export function cameBack(f: Flow): Step {
  return f.away && f.phase === "muted" ? { flow: f, note: "still-muted" } : { flow: f };
}

/** The room's voices on or off on this phone. Independent of the mic. */
export function speaker(f: Flow, on: boolean): Step {
  return { flow: { ...f, speakerOff: !on } };
}

/** With the speaker off nobody is heard, the stage included: an empty mix. Otherwise the mix as it is. */
export function silence<T>(mix: ReadonlyMap<string, T>, speakerOff: boolean): Map<string, T> {
  return speakerOff ? new Map() : new Map(mix);
}

// ---- what a phone remembers (a Storage, or anything shaped like one, so a check can stub it)

export type KV = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const speakerKey = (crewId: string) => `hz:voice-speaker:${crewId}`;
export const TIP_KEY = "hz:voice-tip";

/** Did this Hopper turn the room's voices off here last time? The first visit, or no storage: no, voices are on. */
export function speakerWasOff(kv: KV | null, crewId: string): boolean {
  try {
    return kv?.getItem(speakerKey(crewId)) === "off";
  } catch {
    return false;
  }
}

export function rememberSpeaker(kv: KV | null, crewId: string, on: boolean) {
  try {
    kv?.setItem(speakerKey(crewId), on ? "on" : "off");
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

/** True once per device: the first time the tip is due it is marked seen. No storage: never (a tip that cannot be remembered would repeat). */
export function tipDue(kv: KV | null): boolean {
  try {
    if (!kv || kv.getItem(TIP_KEY)) return false;
    kv.setItem(TIP_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
