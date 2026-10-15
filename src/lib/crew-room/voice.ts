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

export type VoicePhase = "off" | "joining" | "listening" | "mic" | "muted";

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
  /** A one-line label for a moment ("VOICE ON", "MIC BLOCKED. ..."), or "". RoomVoice shows it for a second or two. */
  notice: string;
  noticeId: number;
};

const IDLE: VoiceView = { phase: "off", canPublish: false, reconnecting: false, liveBy: null, liveName: "", listening: 0, iAmLive: false, stageBy: [], canPlay: true, auto: false, liveMuted: false, notice: "", noticeId: 0 };

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
  private stageBusy: Promise<{ ok: boolean; full: boolean }> | null = null;
  private heard = new Map<string, number>();
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private joining: Promise<void> | null = null;
  private lk: typeof import("livekit-client") | null = null;

  constructor(
    private readonly crewId: string,
    private readonly userId: string,
    private readonly audioHost: HTMLElement,
  ) {}

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
    this.joining ??= this.connect(false).finally(() => {
      this.joining = null;
    });
    return this.joining;
  }

  /** Stage voice: join by myself, listen-only, because the stage went live. No label, no mic, no prompt. */
  joinListen(): Promise<void> {
    if (!STAGE_FLAG || this.room) return Promise.resolve();
    this.joining ??= this.connect(true).finally(() => {
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

  private async connect(auto: boolean) {
    this.set({ phase: "joining" });
    try {
      const bearer = await this.bearer();
      const res = await fetch("/api/crew/rooms/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ crewId: this.crewId }),
      });
      const body = (await res.json().catch(() => ({}))) as { serverUrl?: string; token?: string; canPublish?: boolean; owners?: string[]; mode?: string; error?: string };
      if (!res.ok || !body.serverUrl || !body.token) throw new VoiceError(errorLine(res.status, body.error), res.status);
      this.owners = body.owners ?? [];
      this.mode = body.mode === "stage" ? "stage" : "mixed";

      const lk = (this.lk ??= await import("livekit-client"));
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
      // The join came from a tap, so the browser lets the audio start now.
      await room.startAudio().catch(() => undefined);
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      const walker = !!body.canPublish;
      this.set({ phase: "listening", canPublish: walker, reconnecting: false, auto, canPlay: room.canPlaybackAudio });
      if (!auto) this.say(walker ? "VOICE ON" : "LISTEN ONLY");
      this.roster();
      this.queueApply(0);
    } catch (e) {
      this.room?.disconnect();
      this.room = null;
      this.set({ phase: "off" });
      if (!auto) this.say(e instanceof VoiceError ? e.message : "Voice isn't working right now.");
    }
  }

  /** A tap on the room unlocks audio that the browser held back after an automatic join. */
  unlockAudio() {
    const room = this.room;
    if (!room) return;
    void room.startAudio().then(() => this.set({ canPlay: room.canPlaybackAudio }), () => undefined);
  }

  /** The microphone: on, or off. Only a walker has one. Returns false when it could not be turned on. */
  async setMic(on: boolean): Promise<boolean> {
    const room = this.room;
    if (!room || !this.view.canPublish) return false;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      this.set({ phase: on ? "mic" : "muted", ...(on ? { auto: false } : {}) });
      this.say(on ? "MIC ON" : "MIC OFF");
      if (!on && this.view.iAmLive) await this.endLive();
      return true;
    } catch {
      this.say("MIC BLOCKED. CHECK YOUR PHONE SETTINGS.");
      return false;
    }
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
   */
  stageCall(on: boolean): Promise<{ ok: boolean; full: boolean }> {
    if (!STAGE_FLAG) return Promise.resolve({ ok: false, full: false });
    this.stageBusy ??= this.callStage(on).finally(() => {
      this.stageBusy = null;
    });
    return this.stageBusy;
  }

  private async callStage(on: boolean): Promise<{ ok: boolean; full: boolean }> {
    const none = { ok: false, full: false };
    if (!this.room) return none;
    try {
      const res = await fetch("/api/crew/rooms/voice/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.bearer()}` },
        body: JSON.stringify({ crewId: this.crewId, on }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; full?: boolean; canPublish?: boolean };
      if (!res.ok) return none;
      const ok = body.ok === true;
      const can = body.canPublish === true;
      this.set({
        iAmLive: ok,
        canPublish: can,
        // The server took my microphone right away (a stage-only room, off the stage): the button goes back to listening.
        ...(!can && (this.view.phase === "mic" || this.view.phase === "muted") ? { phase: "listening" as VoicePhase } : {}),
      });
      if (on && body.full === true) this.say("STAGE FULL");
      this.roster();
      return { ok, full: body.full === true };
    } catch {
      return none;
    }
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
    this.set({ ...IDLE, noticeId: this.view.noticeId, notice: this.view.notice });
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
    const { liveBy, liveMuted } = this.view;
    for (const p of room.remoteParticipants.values()) {
      const live = p.identity === liveBy;
      const volume = live ? (liveMuted ? 0 : 1) : (this.heard.get(p.identity) ?? 0);
      const want = live ? !liveMuted : volume > 0;
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
    const mix = stageMix({ stage: this.stageHeard, heard: this.heard, me: this.userId, mode: this.mode, stageMuted: this.view.liveMuted });
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
