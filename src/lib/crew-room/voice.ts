"use client";

import { create } from "zustand";
import type { Participant, Room } from "livekit-client";
import { privateAreaAt, type CampaignLayout } from "@/lib/campaign/layout";
import type { Tile } from "@/lib/campaign/geometry";
import { music } from "@/lib/sound/music";
import { getSupabase } from "@/lib/supabase/client";
import { useRoomStore } from "./roomStore";
import { STAGE_FLAG } from "./stageRights";
import { stageMix } from "./stageMix";
import { createStageSender, type StageAnswer } from "./stageSend";
import { IDLE_FLOW, TEXT, cameBack, joined, micAnswer, rememberSpeaker, silence, speaker, speakerWasOff, tap as tapStep, wentAway, type Do, type Flow, type Step, type VoicePhase } from "./voiceFlow";

/**
 * Area voice for the crew room, on Ola's LiveKit pattern (components/queer/AudioRoom.tsx). DARK by default: nothing
 * here runs, and RoomVoice renders nothing, unless NEXT_PUBLIC_ROOM_VOICE=1 and the server says it is set up
 * (GET /api/crew/rooms/voice answers { enabled }, which needs the LIVEKIT_* env).
 *
 * What a Hopper hears (design 14.2), worked out on the phone from the walkers' tiles:
 *   same conversation area   full volume
 *   near, not in my area     joins at 6 tiles, drops at 8 (so nobody flickers at the edge); full volume to 2 tiles,
 *                            then falling in a straight line to 0.15 at 8
 *   the owner, live          full volume wherever they stand (the "live" attribute, only believed from a crew owner)
 * Only the people I can hear are subscribed to, so a room of 60 does not cost 60 audio streams on mobile data (at most
 * MAX_HEARD at once, nearest first). The microphone starts OFF every time and joining never turns it on.
 *
 * ON BY DEFAULT, AS A LISTENER (voiceFlow.ts has the rules): walking into a crew room joins by itself (enter()), so the room's
 * voices play without a tap. The mic is NOT touched on the way in and no permission is asked: the first tap on the control
 * asks (setMic), a "no" is listen-only with "Mic blocked. Tap to allow", and nothing here ever asks again by itself. A
 * backgrounded app or a locked screen closes the mic and lets go of it (away()); it stays closed until a tap. The speaker
 * can be turned off (setSpeaker), remembered per room. Hotspot rooms never mount RoomVoice, so they stay voice-free.
 *
 * Area privacy is as honest as the client: LiveKit does not know the room's areas (the route's comment says so).
 *
 * STAGE VOICE (NEXT_PUBLIC_ROOM_STAGE_VOICE=1, docs/ROOM-GAME-DESIGN.md 14.4) replaces the owner's "live" attribute: staff
 * (owner and admins) standing on the stage talk to the whole room. The database says who is on the stage (stage.ts,
 * setStage), the server sets their "stage" attribute (voice/stage/route.ts), and this phone subscribes to a stage voice
 * only when BOTH agree, at full volume wherever it stands; the people near it are capped at half while the stage is live
 * (stageMix.ts). Listeners join by themselves, listen-only, when the stage goes live. With the flag off none of this runs.
 */

type StageMode = "mixed" | "stage";

export const VOICE_FLAG = process.env.NEXT_PUBLIC_ROOM_VOICE === "1";
/** Voice on by default (join as a listener when you walk in). NEXT_PUBLIC_ROOM_VOICE_AUTO=0 turns only this off: back to tap-to-join. */
export const VOICE_AUTO = process.env.NEXT_PUBLIC_ROOM_VOICE_AUTO !== "0";

export const VOICE = {
  /** A walker this close starts being heard. */
  join: 6,
  /** A walker heard already stops being heard past this. */
  drop: 8,
  /** Full volume up to here. */
  full: 2,
  /** The volume at the drop distance. */
  floor: 0.15,
  /** Nobody hears more voices than this at once. */
  maxHeard: 8,
} as const;

export const tilesApart = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y);

/** Volume for a walker `d` tiles away who is not in my area: 1 up to 2 tiles, 0.15 at 8, nothing past it. */
export function falloff(d: number): number {
  if (d <= VOICE.full) return 1;
  if (d > VOICE.drop) return 0;
  return 1 - ((1 - VOICE.floor) * (d - VOICE.full)) / (VOICE.drop - VOICE.full);
}

export type Spot = { id: string; x: number; y: number };

/**
 * Who I hear and how loud (id to volume). `before` is who I heard a moment ago: they are kept until 8 tiles, new people
 * only join at 6. Anyone in my conversation area is always heard at full volume. Pure, so it can be tested alone.
 */
export function whoHears(args: { me: Tile; peers: Spot[]; before: ReadonlySet<string>; sameArea: (a: Tile, b: Tile) => boolean }): Map<string, number> {
  const { me, peers, before, sameArea } = args;
  const together: Spot[] = [];
  const near: { peer: Spot; d: number }[] = [];
  for (const peer of peers) {
    if (sameArea(me, peer)) {
      together.push(peer);
      continue;
    }
    const d = tilesApart(me, peer);
    if (d <= (before.has(peer.id) ? VOICE.drop : VOICE.join)) near.push({ peer, d });
  }
  const out = new Map<string, number>();
  for (const p of together.slice(0, VOICE.maxHeard)) out.set(p.id, 1);
  near.sort((a, b) => a.d - b.d);
  for (const { peer, d } of near) {
    if (out.size >= VOICE.maxHeard) break;
    out.set(peer.id, falloff(d));
  }
  return out;
}

/** True when both tiles are inside the same conversation area. */
export const makeSameArea = (layout: CampaignLayout) => (a: Tile, b: Tile) => {
  const area = privateAreaAt(layout, a);
  return !!area && privateAreaAt(layout, b)?.id === area.id;
};

/** The crew owner who is live to the whole room (their user id), or null. The stage lights in the world read this. */
export const useLiveStore = create<{ liveBy: string | null; setLiveBy: (id: string | null) => void }>((set) => ({
  liveBy: null,
  setLiveBy: (liveBy) => set((s) => (s.liveBy === liveBy ? s : { liveBy })),
}));

export type { VoicePhase };

export type VoiceView = {
  phase: VoicePhase;
  /** The server let me publish a microphone: I am a walker. A watcher listens and cannot be heard. */
  canPublish: boolean;
  reconnecting: boolean;
  /** The staff member who is live to the whole room right now (their user id), or null. With stage voice: the first stage speaker. */
  liveBy: string | null;
  liveName: string;
  /** Others connected to the voice room. */
  listening: number;
  iAmLive: boolean;
  /** Stage voice: the other staff speaking to the whole room (the database and the server agree), in stage order. */
  stageBy: string[];
  /** The browser lets audio play. False until a tap after an automatic join: RoomVoice then offers TAP TO LISTEN. */
  canPlay: boolean;
  /** Joined by itself because the stage went live, and the Hopper has not pressed the mic since. */
  auto: boolean;
  /** I silenced the live owner on this phone. */
  liveMuted: boolean;
  /** I turned the room's voices off on this phone: nobody is heard, the stage included. Remembered per room. */
  speakerOff: boolean;
  /** The mic was closed because the app went to the background. It stays closed until a tap. */
  away: boolean;
  /** A one-line label for a moment ("VOICE ON", "MIC BLOCKED. ..."), or "". RoomVoice shows it for a second or two. */
  notice: string;
  noticeId: number;
};

const IDLE: VoiceView = { ...IDLE_FLOW, reconnecting: false, liveBy: null, liveName: "", listening: 0, iAmLive: false, stageBy: [], canPlay: true, auto: false, liveMuted: false, notice: "", noticeId: 0 };

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** A permission prompt unanswered for this long no longer blocks the next tap. */
const MIC_ASK_STALE_MS = 30_000;

/** The longest a join waits for the browser to say audio may play. */
const AUDIO_WAIT_MS = 1200;

/** How a connection started: a tap on the control, the stage going live, or walking into the room. */
type How = "tap" | "stage" | "enter";

/** Does this phone's server speak voice? Asked once. False for any error, so nothing about voice shows. */
let enabledAsk: Promise<boolean> | null = null;
export function voiceServerEnabled(): Promise<boolean> {
  if (!VOICE_FLAG) return Promise.resolve(false);
  enabledAsk ??= fetch("/api/crew/rooms/voice", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: boolean }>) : { enabled: false }))
    .then((j) => !!j.enabled)
    .catch(() => false);
  return enabledAsk;
}

class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const errorLine = (status: number, text?: string) =>
  status === 401 ? "Sign in to use voice." : status === 403 ? "Voice is for people in this crew." : status === 429 ? "Give it a moment, then try again." : status === 503 ? "Voice is coming soon." : (text ?? "Voice isn't working right now.");

/** One Hopper's voice connection to the crew's LiveKit room. Created by RoomVoice, which owns the audio host element. */
export class VoiceSession {
  private room: Room | null = null;
  private view: VoiceView = IDLE;
  private readonly watchers = new Set<(v: VoiceView) => void>();
  private owners: string[] = [];
  private mode: StageMode = "mixed";
  /** The database's stage list (setStage). A stage voice is heard only if it is in here AND carries the server's attribute. */
  private stageIds: string[] = [];
  private stageHeard: string[] = [];
  private heard = new Map<string, number>();
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private joining: Promise<void> | null = null;
  private lk: typeof import("livekit-client") | null = null;
  /** Bumped by leave(): a join that was still on its way when I left sees it changed and drops what it built. */
  private epoch = 0;
  /** When the phone's permission prompt was put up (0: none). A tap while it is up does not ask twice; a prompt that never answers goes stale. */
  private micAskedAt = 0;

  constructor(
    private readonly crewId: string,
    private readonly userId: string,
    private readonly audioHost: HTMLElement,
  ) {
    // The room's voices are on unless this Hopper turned them off here last time.
    this.view = { ...IDLE, speakerOff: speakerWasOff(storage(), crewId) };
  }

  /** The part of the view that voiceFlow.ts decides. */
  private flow(): Flow {
    const { phase, canPublish, speakerOff, away } = this.view;
    return { phase, canPublish, speakerOff, away };
  }

  /** Show what a step decided (and its one-second label, if it has one). */
  private adopt(step: Step) {
    this.set(step.flow);
    if (step.note) this.say(TEXT.notes[step.note]);
  }

  get(): VoiceView {
    return this.view;
  }

  subscribe(fn: (v: VoiceView) => void) {
    this.watchers.add(fn);
    return () => void this.watchers.delete(fn);
  }

  private set(patch: Partial<VoiceView>) {
    this.view = { ...this.view, ...patch };
    this.watchers.forEach((fn) => fn(this.view));
  }

  private say(notice: string) {
    this.set({ notice, noticeId: this.view.noticeId + 1 });
  }

  /** Join as a listener. Loads LiveKit now (never before), asks the server for a token, connects with every mic off. */
  join(): Promise<void> {
    if (this.room) {
      if (this.view.auto) this.set({ auto: false }); // a tap on an automatic join keeps the connection
      return Promise.resolve();
    }
    this.joining ??= this.connect("tap").finally(() => {
      this.joining = null;
    });
    return this.joining;
  }

  /** Stage voice: join by myself, listen-only, because the stage went live. No label, no mic, no prompt. */
  joinListen(): Promise<void> {
    if (!STAGE_FLAG || this.room) return Promise.resolve();
    this.joining ??= this.connect("stage").finally(() => {
      this.joining = null;
    });
    return this.joining;
  }

  /**
   * Voice on by default: walking into the room joins as a LISTENER. Nothing is said, no microphone is opened and no
   * permission is asked (that waits for the first tap on the control). The audio is unlocked here when the browser allows it
   * (a same-page walk in from the ENTER button keeps the page's tap), and otherwise by the first tap in the room (RoomVoice).
   */
  enter(): Promise<void> {
    if (!VOICE_AUTO || this.room) return Promise.resolve();
    this.joining ??= this.connect("enter").finally(() => {
      this.joining = null;
    });
    return this.joining;
  }

  private async bearer(): Promise<string> {
    const sb = getSupabase();
    const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
    const bearer = data.session?.access_token;
    if (!bearer) throw new VoiceError("Sign in to use voice.", 401);
    return bearer;
  }

  private async connect(how: How) {
    const epoch = this.epoch;
    const auto = how === "stage";
    this.set({ phase: "joining" });
    try {
      const bearer = await this.bearer();
      const res = await fetch("/api/crew/rooms/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ crewId: this.crewId }),
      });
      const body = (await res.json().catch(() => ({}))) as { serverUrl?: string; token?: string; canPublish?: boolean; owners?: string[]; mode?: string; error?: string };
      if (epoch !== this.epoch) return; // I left while it was out
      if (!res.ok || !body.serverUrl || !body.token) throw new VoiceError(errorLine(res.status, body.error), res.status);
      this.owners = body.owners ?? [];
      this.mode = body.mode === "stage" ? "stage" : "mixed";

      const lk = (this.lk ??= await import("livekit-client"));
      if (epoch !== this.epoch) return;
      const room = new lk.Room({ webAudioMix: true, dynacast: true, adaptiveStream: false });
      this.room = room;
      const { RoomEvent, Track } = lk;
      const attach = (track: import("livekit-client").Track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.autoplay = true;
        this.audioHost.appendChild(el);
      };
      room
        .on(RoomEvent.TrackSubscribed, (track) => attach(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.TrackPublished, () => this.queueApply())
        .on(RoomEvent.ParticipantConnected, () => this.roster())
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          this.heard.delete(p.identity);
          this.roster();
        })
        .on(RoomEvent.ParticipantAttributesChanged, () => this.roster())
        .on(RoomEvent.ActiveSpeakersChanged, () => this.speakers())
        .on(RoomEvent.Reconnecting, () => {
          this.set({ reconnecting: true });
          this.say("VOICE LOST. TRYING AGAIN.");
        })
        .on(RoomEvent.Reconnected, () => this.set({ reconnecting: false }))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => this.set({ canPlay: room.canPlaybackAudio }))
        .on(RoomEvent.Disconnected, () => {
          if (this.room === room) this.reset();
        });
      await room.connect(body.serverUrl, body.token, { autoSubscribe: false });
      if (epoch !== this.epoch) {
        room.disconnect();
        return;
      }
      // Let the audio start. After a tap (or a same-page walk in from one) the browser allows it now. With no tap yet it can
      // stay pending until one, so the join never waits for it: canPlay says whether audio plays, and the first tap in the
      // room unlocks it (RoomVoice). The microphone is NOT touched here: no prompt.
      await Promise.race([room.startAudio().catch(() => undefined), new Promise<void>((done) => setTimeout(done, AUDIO_WAIT_MS))]);
      if (epoch !== this.epoch) return;
      const walker = !!body.canPublish;
      this.adopt(joined(this.flow(), walker));
      this.set({ reconnecting: false, auto, canPlay: room.canPlaybackAudio });
      if (how === "tap") this.say(walker ? "VOICE ON" : "LISTEN ONLY");
      this.roster();
      this.queueApply(0);
    } catch (e) {
      if (epoch !== this.epoch) return; // a newer join owns the state now
      this.room?.disconnect();
      this.room = null;
      this.set({ phase: "off" });
      if (how === "tap") this.say(e instanceof VoiceError ? e.message : "Voice isn't working right now.");
    }
  }

  /** A tap on the room unlocks audio that the browser held back after an automatic join. */
  unlockAudio() {
    const room = this.room;
    if (!room) return;
    void room.startAudio().then(() => this.set({ canPlay: room.canPlaybackAudio }), () => undefined);
  }

  /**
   * The microphone: on, or off. Only a walker has one. Turning it ON is the only place the phone is asked for it, and only a
   * tap gets here (the control, GO LIVE, SPEAK TO ALL): a "no" leaves me listening with the control saying blocked, and
   * nothing asks again until the next tap. Returns false when it could not be turned on.
   */
  async setMic(on: boolean): Promise<boolean> {
    const room = this.room;
    if (!room || !this.view.canPublish) return false;
    if (this.micAskedAt && Date.now() - this.micAskedAt < MIC_ASK_STALE_MS) return false;
    this.micAskedAt = Date.now();
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
    } catch {
      this.micAskedAt = 0;
      if (this.room === room && on) this.adopt(micAnswer(this.flow(), false));
      return false;
    }
    this.micAskedAt = 0;
    if (this.room !== room) return false; // I hung up while the phone was asking
    if (on) {
      this.adopt(micAnswer(this.flow(), true));
      this.set({ auto: false });
      this.say("MIC ON");
      // The app went to the background while the prompt was up: do not leave a live mic behind it.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") await this.away();
    } else {
      this.set({ phase: "muted" });
      this.say("MIC OFF");
      if (this.view.iAmLive) await this.endLive();
    }
    return true;
  }

  /**
   * While muted, the phone's microphone track (muted means silenced, not released), so the room can notice someone talking
   * into a muted mic and offer to unmute, as Google Meet does. Null when the mic is not muted or has been let go (the app
   * went to the background). Nothing is sent: the caller listens to a local copy only.
   */
  mutedMicTrack(): MediaStreamTrack | null {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk || this.view.phase !== "muted") return null;
    const track = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track?.mediaStreamTrack;
    return track && track.readyState === "live" ? track : null;
  }

  /** The tap on the voice control: join, leave, ask for the mic, or mute (voiceFlow.ts tap). Returns what it did. */
  async tap(): Promise<Do | undefined> {
    const step = tapStep(this.flow());
    if (step.do === "join") await this.join();
    else if (step.do === "leave") this.leave();
    else if (step.do === "mic-off") await this.setMic(false);
    else if (step.do === "ask-mic") await this.setMic(true);
    return step.do;
  }

  /**
   * The app went to the background or the screen locked: close the mic and let go of the phone's microphone (the light goes
   * out), and end a broadcast from the stage. It stays closed until the Hopper is back AND taps.
   */
  async away() {
    const room = this.room;
    const lk = this.lk;
    const step = wentAway(this.flow());
    if (!room || !lk || step.do !== "release-mic") return;
    this.adopt(step); // the control shows the muted mic at once
    const me = room.localParticipant;
    try {
      await me.setMicrophoneEnabled(false);
      const pub = me.getTrackPublication(lk.Track.Source.Microphone);
      if (pub?.track) await me.unpublishTrack(pub.track, true);
    } catch {
      /* the track is muted at the least */
    }
    if (this.view.iAmLive) await this.endLive();
  }

  /** Back in the app: nothing turns on by itself. If the mic was closed because the app went away, say so. */
  returned() {
    this.adopt(cameBack(this.flow()));
  }

  /** The room's voices on or off on this phone (remembered per room). Off: nobody is heard, the stage included. */
  setSpeaker(on: boolean) {
    this.adopt(speaker(this.flow(), on));
    rememberSpeaker(storage(), this.crewId, on);
    this.say(on ? TEXT.speakerOn : TEXT.speakerOff);
    this.queueApply(0);
    this.speakers();
  }

  /** The owner goes live to the whole room from the stage: mic on, the "live" attribute up. The route only lets an owner set it. */
  async goLive(): Promise<boolean> {
    await this.join();
    const room = this.room;
    if (!room || !this.view.canPublish || !this.owners.includes(this.userId)) return false;
    if (this.view.phase !== "mic" && !(await this.setMic(true))) return false;
    try {
      await room.localParticipant.setAttributes({ live: "1" });
      this.set({ iAmLive: true });
      this.roster();
      return true;
    } catch {
      this.say("Couldn't go live. Try again.");
      return false;
    }
  }

  async endLive(): Promise<void> {
    if (STAGE_FLAG) {
      await this.stageCall(false);
      return;
    }
    this.set({ iAmLive: false });
    await this.room?.localParticipant.setAttributes({ live: "" }).catch(() => undefined);
    this.roster();
  }

  /** Stage voice: the database's list of staff on the stage (stage.ts). Re-sorts who is heard. */
  setStage(ids: readonly string[]) {
    if (ids.length === this.stageIds.length && ids.every((id, i) => id === this.stageIds[i])) return;
    this.stageIds = [...ids];
    this.roster();
  }

  /**
   * Stage voice: ask the server to put me on the stage for the whole room (on) or take me off (off). The server checks
   * that I am staff and that the database has my walker on the stage; the answer is the only thing that sets iAmLive.
   * Returns { ok, full }: full means three others are already speaking.
   *
   * One request at a time and the LATEST wish wins (stageSend.ts): an "off" asked while an "on" (a start, the 20 s
   * keep-alive, a SPEAK TO ALL retry) is on its way is sent as soon as that one returns, so leaving the stage always ends
   * in a server stop and a not-live pill. The answer is the last request's.
   */
  stageCall(on: boolean): Promise<StageAnswer> {
    if (!STAGE_FLAG) return Promise.resolve({ ok: false, full: false });
    return this.stageSend(on);
  }

  private readonly stageSend = createStageSender<StageAnswer & { canPublish?: boolean }>(
    (on) => this.askStage(on),
    (on, answer) => this.settleStage(on, answer),
  );

  /** One request to the stage route. Never throws: a request that got no real answer is `failed`. */
  private async askStage(on: boolean): Promise<StageAnswer & { canPublish?: boolean }> {
    const none = { ok: false, full: false };
    if (!this.room) return none;
    try {
      const res = await fetch("/api/crew/rooms/voice/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.bearer()}` },
        body: JSON.stringify({ crewId: this.crewId, on }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; full?: boolean; canPublish?: boolean };
      if (!res.ok) return { ...none, failed: true };
      return { ok: body.ok === true, full: body.full === true, canPublish: body.canPublish === true };
    } catch {
      return { ...none, failed: true };
    }
  }

  /** Show the answer to the last wish. An "off" is shown even if it never got through: someone who left the stage is not LIVE. */
  private settleStage(on: boolean, answer: StageAnswer & { canPublish?: boolean }) {
    if (!this.room) return; // I hung up while it was out
    if (answer.failed) {
      if (!on && this.view.iAmLive) {
        this.set({ iAmLive: false });
        this.roster();
      }
      return;
    }
    const can = answer.canPublish === true;
    this.set({
      iAmLive: answer.ok,
      canPublish: can,
      // The server took my microphone right away (a stage-only room, off the stage): the button goes back to listening.
      ...(!can && (this.view.phase === "mic" || this.view.phase === "muted" || this.view.phase === "blocked") ? { phase: "listening" as VoicePhase } : {}),
    });
    if (on && answer.full) this.say("STAGE FULL");
    this.roster();
  }

  /** Wait until LiveKit has told this phone it may publish (the server grants it a moment after stageCall). */
  private async waitCanPublish(room: Room, ms = 2500): Promise<boolean> {
    const lk = this.lk;
    if (room.localParticipant.permissions?.canPublish) return true;
    if (!lk) return false;
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(t);
        room.off(lk.RoomEvent.ParticipantPermissionsChanged, onChange);
        resolve(v);
      };
      const onChange = () => room.localParticipant.permissions?.canPublish && done(true);
      const t = setTimeout(() => done(!!room.localParticipant.permissions?.canPublish), ms);
      room.on(lk.RoomEvent.ParticipantPermissionsChanged, onChange);
    });
  }

  /** The SPEAK TO ALL pill: join, ask the server for the stage, then (and only then) the microphone. Never opens a mic by itself. */
  async speakToAll(): Promise<boolean> {
    await this.join();
    const room = this.room;
    if (!room) return false;
    let answer = await this.stageCall(true);
    // My latest step may not have reached the database yet: try again for a moment before giving up.
    for (let tries = 0; !answer.ok && !answer.full && tries < 3; tries++) {
      await new Promise((r) => setTimeout(r, 1000));
      answer = await this.stageCall(true);
    }
    if (!answer.ok) {
      if (!answer.full) this.say("Couldn't start. Try again.");
      return false;
    }
    if (!(await this.waitCanPublish(room)) || (this.view.phase !== "mic" && !(await this.setMic(true)))) {
      await this.stageCall(false);
      return false;
    }
    return true;
  }

  /** Silence (or bring back) the live owner on this phone. */
  muteLive(muted: boolean) {
    this.set({ liveMuted: muted });
    this.queueApply(0);
  }

  /** Where everybody stands. Called as people move; the audio is re-sorted at most five times a second. */
  place(me: Tile | null, peers: Spot[], layout: CampaignLayout) {
    this.heard = me ? whoHears({ me, peers, before: new Set(this.heard.keys()), sameArea: makeSameArea(layout) }) : new Map();
    this.queueApply();
  }

  leave() {
    const room = this.room;
    this.epoch++;
    this.micAskedAt = 0;
    this.room = null;
    if (room) {
      room.disconnect();
      this.audioHost.replaceChildren();
    }
    this.reset();
  }

  private reset() {
    this.room = null;
    this.heard = new Map();
    this.stageHeard = [];
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = null;
    useRoomStore.getState().setSpeaking([]);
    useLiveStore.getState().setLiveBy(null);
    music.duckVoice(false);
    // The speaker choice is the Hopper's, not the connection's: it survives a hang up.
    this.set({ ...IDLE, speakerOff: this.view.speakerOff, noticeId: this.view.noticeId, notice: this.view.notice });
  }

  /** The owner who is live (believed only from a crew owner's identity), the head count, and my own live state. */
  private roster() {
    const room = this.room;
    if (!room) return;
    if (STAGE_FLAG) {
      const speaking = this.stageSpeakers(room);
      const first = speaking[0];
      const liveBy = first ?? (this.view.iAmLive ? this.userId : null);
      const liveName = first ? (room.remoteParticipants.get(first)?.name || "Staff") : this.view.iAmLive ? "You" : "";
      this.set({ liveBy, liveName, stageBy: speaking, listening: room.remoteParticipants.size });
      useLiveStore.getState().setLiveBy(liveBy);
      this.queueApply();
      return;
    }
    let liveBy: string | null = null;
    let liveName = "";
    for (const p of room.remoteParticipants.values()) {
      if (p.attributes?.live === "1" && this.owners.includes(p.identity)) {
        liveBy = p.identity;
        liveName = p.name || "The owner";
        break;
      }
    }
    if (!liveBy && this.view.iAmLive) {
      liveBy = this.userId;
      liveName = "You";
    }
    this.set({ liveBy, liveName, listening: room.remoteParticipants.size });
    useLiveStore.getState().setLiveBy(liveBy);
    this.queueApply();
  }

  private queueApply(delay = 200) {
    if (this.applyTimer || !this.room) return;
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      this.apply();
    }, delay);
  }

  /** Subscribe to exactly the people I hear, at the volume the distance gives. Cheap when nothing changed. */
  private apply() {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk) return;
    if (STAGE_FLAG) {
      this.applyStage(room, lk);
      return;
    }
    const { liveBy, liveMuted, speakerOff } = this.view;
    for (const p of room.remoteParticipants.values()) {
      const live = p.identity === liveBy;
      const volume = speakerOff ? 0 : live ? (liveMuted ? 0 : 1) : (this.heard.get(p.identity) ?? 0);
      const want = speakerOff ? false : live ? !liveMuted : volume > 0;
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.isSubscribed !== want) pub.setSubscribed(want);
      }
      if (want) p.setVolume(volume, lk.Track.Source.Microphone);
    }
    this.speakers();
  }

  /** Stage voice: the other staff who are on the stage by the database's word AND carry the server's "stage" attribute. */
  private stageSpeakers(room: Room): string[] {
    const out: string[] = [];
    for (const id of this.stageIds) {
      if (id !== this.userId && room.remoteParticipants.get(id)?.attributes?.stage === "1") out.push(id);
    }
    return out;
  }

  /** The stage leads (stageMix.ts): stage voices at full volume, the people near me capped, nobody by distance in a stage-only room. */
  private applyStage(room: Room, lk: typeof import("livekit-client")) {
    this.stageHeard = this.stageSpeakers(room);
    const mix = silence(stageMix({ stage: this.stageHeard, heard: this.heard, me: this.userId, mode: this.mode, stageMuted: this.view.liveMuted }), this.view.speakerOff);
    for (const p of room.remoteParticipants.values()) {
      const volume = mix.get(p.identity) ?? 0;
      const want = volume > 0;
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.isSubscribed !== want) pub.setSubscribed(want);
      }
      if (want) p.setVolume(volume, lk.Track.Source.Microphone);
    }
    this.speakers();
  }

  /** Who is talking that I can hear (and me), for the rings, and the music dips while someone I hear talks. */
  private speakers() {
    const room = this.room;
    if (!room) return;
    const ids: string[] = [];
    let heardTalking = false;
    for (const s of room.activeSpeakers as Participant[]) {
      if (s.identity === this.userId) {
        ids.push(s.identity);
        continue;
      }
      if (this.view.speakerOff) continue; // voices off: no dots over heads I cannot hear, no music dip
      const staged = this.stageHeard.includes(s.identity);
      if ((this.mode === "stage" && STAGE_FLAG ? staged : this.heard.has(s.identity) || staged) || s.identity === this.view.liveBy) {
        if (this.view.liveMuted && (s.identity === this.view.liveBy || staged)) continue;
        ids.push(s.identity);
        heardTalking = true;
      }
    }
    useRoomStore.getState().setSpeaking(ids);
    music.duckVoice(heardTalking);
  }
}

const SEEN_KEY = "hz:voice-data-seen";
/** The first time on this phone: say once that voice uses data. */
export function voiceDataNoteSeen(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY)) return true;
    localStorage.setItem(SEEN_KEY, "1");
    return false;
  } catch {
    return true;
  }
}
