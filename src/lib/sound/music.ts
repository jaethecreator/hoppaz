/**
 * The background music: a Play theme (a day loop and a night loop) and one softer loop under Today, Me
 * and Crew. The agreed behaviour is in docs/MUSIC.md; the loops are in public/music/ (musicPicks.ts).
 *
 * <MusicHost /> says which slot the screen wants (music.want); this file decides when it can sound.
 *
 * Chain: loop -> its fade gain -> bus (quiet hours) -> duck -> destination. It plays on the context
 * sfx.ts makes, in a chain of its own, so the sound effects keep their master, low-pass and compressor
 * and nothing in them changes. Web Audio only: never an <audio> element and never audioSession, so the
 * iPhone silent switch is respected.
 *
 * Rules:
 *  - Nothing is fetched, decoded or started before a real tap or key press (the same gesture rule as
 *    sfx.ts), and only for a slot a screen wants. Each loop is fetched once and its decoded buffer kept
 *    for the session. The other Play loop is fetched only for a Hopper on the Lagos clock close to dusk
 *    or dawn (warm()); for everyone else it would never sound, and start() loads it on demand.
 *  - Seamless loops: AudioBufferSourceNode with loop on. A phone that leaves the MP3's encoder delay in
 *    the decode gets it trimmed with loopStart and loopEnd (fit()).
 *  - Moving between slots is a 1.5 s equal power crossfade. Play day to Play night (dusk) is 3 s, and the
 *    night loop joins at the same place in the bar, so the beat does not move (both loops share a tempo).
 *    The menu loop keeps running across Today, Me and Crew; it is never restarted.
 *  - Levels: Play 0.17 on the bus, the menu loop 0.12 and mastered 3 dB lower, so about 6 dB under Play.
 *    Measured against the sound effects (K-weighted, through the real chain), that puts Play near -31
 *    LUFS and the menu near -37, under most Moment sounds and the loud rewards. Quiet hours (23:00 to
 *    07:00 Lagos) take the whole bus down another 6 dB.
 *  - Ducking: 6 dB under every Moment and Reward sound, 3 dB under a UI sound (its ticks are quiet and
 *    would be masked). Down in 40 ms; the dip is held a moment after the sound ends and back in about
 *    0.7 s, so the sounds of one box open are one dip, not a pump (DUCK_LANES).
 *  - Hidden page, pagehide, or an interrupted context (an iPhone call): fade out in 0.3 s and stop
 *    (sfx.ts waits that long before it suspends the context). It comes back on the next real tap on a
 *    visible page, never by itself: those stops clear `tapped`, and only onGesture sets it.
 *  - It holds a lease on the sfx context from the moment a start begins (before the fetch, so the idle
 *    sleep cannot suspend the context during a slow load) until the last loop is gone or the start is
 *    given up (sfx.acquire). It never calls resume(): a context that is asleep when the loop is ready
 *    waits for the next tap, which wakes it (sfx.unlock) and starts the loop from the kept buffer.
 *  - Low-tier phones (deviceTier() "low") get the menu loop only, in Play too: no Play loop is fetched
 *    or decoded.
 *  - The Music switch (music.setOn) is saved in localStorage key "hz-music" ("off" or "on"), default on,
 *    and is separate from Sound. Sound off (sfx.setMuted) silences the music as well.
 *  - A crew room plays at ROOM_LEVEL (0.35) of those levels: the room is a place to talk, and the loop is a bed under
 *    it. Only the room: Play on the map keeps today's level. While its voice room is joined and someone you can hear is
 *    talking, the music dips again to about 20 percent of today's level (the "voice" duck lane, music.duckVoice).
 *  - A screen can bring its own loop (music.want's `track`: a crew room's owner set one). It plays in place
 *    of the slot, by the same rules, about 7 dB down (a released track is mastered far louder than these
 *    loops). One that cannot play here (its host refuses, it is not audio, it is over MAX_TRACK) is
 *    given up for the visit and the slot plays instead. Low-tier phones get the menu loop, as in Play.
 */

import { deviceTier } from "@/lib/deviceTier";
import { DAY_FROM_MIN, DAY_UNTIL_MIN, forcedTheme, lagosMinutes, themePref } from "@/lib/theme";
import { MUSIC, type MusicSlot } from "./musicPicks";
import { decode, type Lane } from "./samples";
import { sfx } from "./sfx";

export type { MusicSlot };
/** A screen's own loop, by its address. */
type Track = `url:${string}`;
/** What can sound: one of the app's slots, or a screen's own loop. */
type Key = MusicSlot | Track;

const KEY = "hz-music";
const BASE = "/music/";
/** Each slot's level on the bus. Set by loudness against the sound effects; the menu loop is also mastered 3 dB lower. */
const LEVEL: Record<MusicSlot, number> = { play_day: 0.17, play_night: 0.17, menu: 0.12 };
/** A screen's own loop: a released track sits near -9 LUFS, the Play loops near -16, so about 7 dB under Play. */
const TRACK_LEVEL = 0.08;
/** A screen's own loop bigger than this (bytes) is not decoded: a phone would hold minutes of raw audio. */
const MAX_TRACK = 12_000_000;
/** Quiet hours: 6 dB down, so half the amplitude. */
const QUIET = 0.5;
/** A crew room plays the loop at this share of its slot's level (Play on the map is untouched). 0.35 of today's. */
const ROOM_LEVEL = 0.35;
/** Ducking: down in ATTACK s, held `hold` s after the sound ends, back up in RELEASE s (both to within 2%). */
const ATTACK = 0.04;
const RELEASE = 0.7;
/**
 * The lanes the music ducks under, and how far (`to` is the gain: 0.5 is 6 dB). Moment and Reward sounds come in
 * runs with gaps of 0.4 s or so, so the hold keeps a box open as one dip. The UI lane is ticks and toasts at 30%,
 * which the music would mask, so it gets a light, short dip.
 */
const DUCK_LANES: ReadonlyMap<Lane | "voice", { to: number; hold: number }> = new Map<Lane | "voice", { to: number; hold: number }>([
  ["moment", { to: 0.5, hold: 0.6 }],
  ["reward", { to: 0.5, hold: 0.6 }],
  ["ui", { to: 0.71, hold: 0.1 }],
  // Someone you can hear is talking in the room's voice chat. Held for as long as they talk (music.duckVoice), not
  // for a sound's length: 0.57 on top of ROOM_LEVEL 0.35 lands at 20 percent of today's level.
  ["voice", { to: 0.57, hold: 0.6 }],
]);
/** The voice lane's gain, and how fast the music follows it (seconds, both ways). */
const VOICE_DUCK = DUCK_LANES.get("voice")!.to;
const VOICE_EASE = 0.25;
/** One voice never holds the duck longer than this many seconds. */
const DUCK_MAX = 4;
/** Route changes and starts, dusk, and the quick stop (switch off, sound off, page hidden). Seconds. */
const FADE = 1.5;
const DUSK = 3;
const QUICK = 0.3;
/** The encoder delay of a LAME MP3 that a decoder ignoring the gapless tag leaves in. */
const DELAY = 1105;
/** After a failed fetch, wait this long (ms) before asking again. */
const RETRY = 60_000;
/** In Play, look at fetching the other Play loop this long (ms) after the first one started, and again every 30 s. */
const PREFETCH = 5000;
/** ...but only within this many minutes of dusk or dawn on the Lagos clock. */
const NEAR = 20;
/** A loop that is ready but whose context is asleep waits this long (ms) for the tap that woke it to be answered. */
const WAKE = 1500;
/** A loop still fading out is brought back, not restarted, while its gain is above this. */
const REVIVE = 0.02;

/** A decoded loop, and where in the buffer it loops. */
type Loop = { buf: AudioBuffer; ls: number; le: number; len: number };
/** One running loop: its gain does the fades. t0 is when it started (context seconds) at off seconds into the loop. */
type Voice = {
  slot: Key;
  src: AudioBufferSourceNode;
  g: GainNode;
  t0: number;
  off: number;
  len: number;
  dying: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/* ----------------------------------------------------------------- state -- */
let on = true;
let want: MusicSlot | null = null;
/** The screen's own loop, if it brought one (music.want's track). */
let track: Track | null = null;
/** A real tap since the page was last hidden or interrupted. Only onGesture sets it; the stops below clear it. */
let tapped = false;
/** Bumped by every start and stop, so a slow load or a timer can tell it was overtaken. */
let epoch = 0;
let pending: Key | null = null;
let cur: Voice | null = null;
let bound: AudioContext | null = null;
let bus: GainNode | null = null;
let duck: GainNode | null = null;
/** After the duck: the room's level and the voice dip, so neither fights the sound-effect ducking above it. */
let post: GainNode | null = null;
/** A crew room is the screen (its level), and someone you can hear is talking in its voice room. */
let roomMode = false;
let voiceDuck = false;
let busNow = 1;
let duckUntil = 0;
let duckTo = 1;
let held = false;
let tick: ReturnType<typeof setInterval> | undefined;
let prefetchT: ReturnType<typeof setTimeout> | undefined;
const voices = new Set<Voice>();
const loops = new Map<Key, Promise<Loop | null>>();
const retryAt = new Map<Key, number>();
/** Screens' own loops that could not play here this visit. */
const dead = new Set<Track>();
const watched = new WeakSet<AudioContext>();
const listeners = new Set<() => void>();

try {
  on = typeof localStorage === "undefined" || localStorage.getItem(KEY) !== "off";
} catch {
  /* storage blocked: music stays on for this visit */
}

const hidden = () => typeof document !== "undefined" && document.hidden;
const isTrack = (s: Key): s is Track => s.startsWith("url:");
const isPlay = (s: Key) => s === "play_day" || s === "play_night";
const level = (s: Key) => (isTrack(s) ? TRACK_LEVEL : LEVEL[s]);
/** What the post node should be: the room's share of the level, times the voice dip. */
const postTarget = () => (roomMode ? ROOM_LEVEL : 1) * (voiceDuck ? VOICE_DUCK : 1);
const emit = () => listeners.forEach((f) => f());

/**
 * What should sound right now, or null: nothing wanted, switch off, or sound off. The screen's own loop when it brought
 * one that can play; low-tier phones get the menu loop instead of Play or a screen's loop.
 */
function target(): Key | null {
  if (!want || !on || sfx.isMuted()) return null;
  const low = deviceTier() === "low";
  if (track && !low && !dead.has(track)) return track;
  return isPlay(want) && low ? "menu" : want;
}

/* ----------------------------------------------------------- the loops -- */
/**
 * The loop has to be exactly its length, or the wrap leaves a gap. Chrome and Safari read the gapless tag in the
 * MP3. A phone that does not leaves DELAY samples of encoder delay (and some padding) in: cut the loop out of the middle.
 */
function fit(buf: AudioBuffer, m: { file: string; samples: number; rate: number }): Loop {
  const sr = buf.sampleRate;
  const exact = m.samples ? Math.round((m.samples / m.rate) * sr) : buf.length;
  const extra = buf.length - exact;
  if (extra > 8 && extra <= 6000) {
    const ls = Math.round((DELAY / m.rate) * sr) / sr;
    const le = Math.min(buf.duration, ls + exact / sr);
    return { buf, ls, le, len: le - ls };
  }
  if (Math.abs(extra) > 8) console.warn("music " + m.file + ": length is off by " + extra + " samples, there may be a gap");
  return { buf, ls: 0, le: buf.duration, len: buf.duration };
}

async function grab(a: AudioContext, slot: Key): Promise<Loop | null> {
  // A screen's own loop has no known length: the decode is trusted as it is (samples 0).
  const m = isTrack(slot) ? { file: slot.slice(4), samples: 0, rate: 44100 } : MUSIC[slot];
  try {
    const r = await fetch(isTrack(slot) ? m.file : BASE + m.file);
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (isTrack(slot) && Number(r.headers.get("content-length") ?? 0) > MAX_TRACK) throw new Error("too big");
    const bytes = await r.arrayBuffer();
    if (isTrack(slot) && bytes.byteLength > MAX_TRACK) throw new Error("too big");
    return fit(await decode(a, bytes), m);
  } catch (e) {
    console.warn("music " + m.file, e instanceof Error ? e.message : e);
    loops.delete(slot);
    if (isTrack(slot)) {
      // Blocked by its host, not audio, or too big: it will not play on a retry either. The slot plays instead.
      dead.add(slot);
      emit();
    } else retryAt.set(slot, Date.now() + RETRY);
    return null;
  }
}

/** Fetch and decode a loop, once. Later calls get the same promise. Never throws. */
function load(a: AudioContext, slot: Key): Promise<Loop | null> {
  let p = loops.get(slot);
  if (!p) {
    p = grab(a, slot);
    loops.set(slot, p);
  }
  return p;
}

/* ----------------------------------------------------------- the chain -- */
/** The chain is made when the first loop starts and taken down when the last one ends. */
function bind(a: AudioContext) {
  if (bound === a && bus && duck) return;
  bound = a;
  busNow = sfx.quiet() ? QUIET : 1;
  bus = a.createGain();
  bus.gain.value = busNow;
  duck = a.createGain();
  post = a.createGain();
  post.gain.value = postTarget();
  bus.connect(duck);
  duck.connect(post);
  post.connect(a.destination);
  duckUntil = 0;
  duckTo = 1;
  if (!watched.has(a)) {
    watched.add(a);
    // An iPhone call or Siri takes the speaker: stop now, and come back on the next tap.
    a.addEventListener("statechange", () => {
      if ((a.state as string) === "interrupted") stopUntilTap(0.05);
    });
  }
}

/** The room's level or the voice dip changed: ease the post node to it. */
function syncPost() {
  if (!bound || !post) return;
  const t = bound.currentTime;
  post.gain.cancelScheduledValues(t);
  post.gain.setValueAtTime(post.gain.value, t);
  post.gain.setTargetAtTime(postTarget(), t, VOICE_EASE / 4);
}

/** Quiet hours begin or end. Cheap when nothing changed. */
function syncBus() {
  if (!bound || !bus) return;
  const v = sfx.quiet() ? QUIET : 1;
  if (v === busNow) return;
  busNow = v;
  const t = bound.currentTime;
  const g = bus.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(v, t + 2);
}

/** Equal power: sine in, cosine out (the audition page's dusk). Falls back to a linear ramp. */
function swell(p: AudioParam, from: number, to: number, at: number, secs: number, up: boolean) {
  const n = 128;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (Math.PI / 2);
    c[i] = up ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x);
  }
  p.cancelScheduledValues(0);
  p.setValueAtTime(from, bound ? bound.currentTime : 0);
  p.setValueAtTime(from, at);
  try {
    p.setValueCurveAtTime(c, at, secs);
  } catch {
    p.linearRampToValueAtTime(to, at + secs);
  }
}

/** A loop is over: free its nodes. When the last one goes, the lease and the chain go too. */
function drop(v: Voice) {
  if (!voices.delete(v)) return;
  v.src.onended = null;
  try {
    v.src.stop();
  } catch {
    /* already stopped */
  }
  try {
    v.src.disconnect();
    v.g.disconnect();
  } catch {
    /* already gone */
  }
  if (cur === v) cur = null;
  if (!voices.size) settle();
}

/** Take the lease on the sfx context (once), so its idle sleep cannot suspend it under a load in flight or a loop. */
function lease() {
  if (held) return;
  held = true;
  sfx.acquire();
}

/** A start that did not play: let go of the lease, unless a loop or another load still needs it. */
function giveUp() {
  if (!voices.size && !pending) settle();
}

function settle() {
  if (held && !pending) {
    held = false;
    sfx.release();
  }
  if (tick) clearInterval(tick);
  tick = undefined;
  if (prefetchT) clearTimeout(prefetchT);
  prefetchT = undefined;
  try {
    bus?.disconnect();
    duck?.disconnect();
    post?.disconnect();
  } catch {
    /* already gone */
  }
  bus = duck = post = bound = null;
}

/** Fade a loop out over `secs` from `at`, then stop it. The timer is for a context that is asleep and never gets there. */
function fade(v: Voice, at: number, secs: number) {
  if (v.dying || !bound) return;
  v.dying = true;
  if (cur === v) cur = null;
  swell(v.g.gain, v.g.gain.value, 0, at, secs, false);
  try {
    v.src.stop(at + secs + 0.05);
  } catch {
    /* not started */
  }
  v.timer = setTimeout(() => drop(v), (at - bound.currentTime + secs + 0.4) * 1000);
}

/** Everything fades out and stops. Anything still loading is called off. */
function halt(secs: number) {
  epoch++;
  pending = null;
  if (!voices.size) {
    // Only a load was on its way: its lease goes back now.
    settle();
    return;
  }
  if (!bound) return;
  const at = bound.currentTime + 0.01;
  voices.forEach((v) => fade(v, at, secs));
}

/* -------------------------------------------------------------- playing -- */
/** A loop that is still fading out comes back up from where it is. */
function bring(v: Voice, at: number, secs: number) {
  clearTimeout(v.timer);
  v.dying = false;
  try {
    v.src.stop(at + 86400);
  } catch {
    /* already stopped; the fade-out had set its stop, and the last call wins */
  }
  swell(v.g.gain, v.g.gain.value, level(v.slot), at, secs, true);
  return v;
}

/** A new copy of a loop, fading in. Joining another loop (dusk), it starts at the same place in the bar, so the beat does not move. */
function spawn(a: AudioContext, slot: Key, p: Loop, at: number, secs: number, join: Voice | null) {
  const off = join ? ((join.off + Math.max(0, at - join.t0)) % join.len) % p.len : 0;
  const src = a.createBufferSource();
  src.buffer = p.buf;
  src.loop = true;
  src.loopStart = p.ls;
  src.loopEnd = p.le;
  const g = a.createGain();
  g.gain.value = 0;
  src.connect(g);
  g.connect(bus as GainNode);
  const v: Voice = { slot, src, g, t0: at, off, len: p.len, dying: false };
  voices.add(v);
  src.onended = () => drop(v);
  swell(g.gain, 0, level(slot), at, secs, true);
  src.start(at, p.ls + off);
  return v;
}

/** Start a loop and crossfade the others out. Dusk (Play to Play) is longer. The caller has made sure the context is running. */
function begin(a: AudioContext, slot: Key, p: Loop) {
  bind(a);
  const at = a.currentTime + 0.05;
  const from = cur && !cur.dying ? cur : null;
  const dusk = !!from && isPlay(from.slot) && isPlay(slot);
  const secs = dusk ? DUSK : FADE;
  // Back on a screen whose loop is still fading out (a quick hop through a silent one): bring that copy back up. A
  // second copy started at the top would sound over it, out of step.
  const back = [...voices].filter((o) => o.dying && o.slot === slot && o.g.gain.value > REVIVE).sort((x, y) => y.g.gain.value - x.g.gain.value)[0];
  const v = back ? bring(back, at, secs) : spawn(a, slot, p, at, secs, dusk ? from : null);
  voices.forEach((o) => o !== v && fade(o, at, secs));
  cur = v;
  lease();
  if (!tick) tick = setInterval(every, 30_000);
  if (prefetchT) clearTimeout(prefetchT);
  prefetchT = undefined;
  if (isPlay(slot)) {
    prefetchT = setTimeout(() => {
      prefetchT = undefined;
      warm();
    }, PREFETCH);
  }
}

/** Every 30 s while a loop is alive: quiet hours begin or end, and dusk may be near. */
function every() {
  syncBus();
  warm();
}

/**
 * In Play, a Hopper on the Lagos clock close to dusk or dawn gets the other Play loop fetched, so the crossfade is
 * instant. Everyone else would download and decode a loop they never hear (a Hopper on Dark or Light never reaches
 * the other one); start() loads it on demand if the theme is changed, and the 3 s crossfade covers the load.
 */
function warm() {
  if (!bound || !cur || cur.dying || !isPlay(cur.slot) || hidden() || forcedTheme() || themePref() !== "clock") return;
  const m = lagosMinutes();
  if (Math.abs(m - DAY_FROM_MIN) > NEAR && Math.abs(m - DAY_UNTIL_MIN) > NEAR) return;
  const other: MusicSlot = cur.slot === "play_day" ? "play_night" : "play_day";
  if (!loops.has(other)) void load(bound, other);
}

/** Whether the context is running. One that is still waking gets WAKE ms: the tap asked (sfx.unlock), the answer comes a moment later. */
function awake(a: AudioContext): Promise<boolean> {
  if (a.state === "running") return Promise.resolve(true);
  return new Promise((done) => {
    const end = () => {
      clearTimeout(t);
      a.removeEventListener("statechange", end);
      done(a.state === "running");
    };
    const t = setTimeout(end, WAKE);
    a.addEventListener("statechange", end);
  });
}

async function start(a: AudioContext, slot: Key) {
  const my = ++epoch;
  pending = slot;
  // The lease first: a slow load must not let the idle sleep suspend the context. Only a tap wakes it again.
  lease();
  const p = await load(a, slot);
  const up = !!p && (await awake(a));
  if (my !== epoch) return;
  pending = null;
  // Never resume() here: a context that slept during the load waits for the next tap, which wakes it and comes back
  // through reconcile() to start the loop from the kept buffer.
  if (!p || !up || hidden() || target() !== slot) {
    giveUp();
    // A screen's own loop that cannot play: the slot takes over now, from the same tap.
    if (!p && isTrack(slot)) reconcile();
    return;
  }
  begin(a, slot, p);
}

/** Make what is playing match what should be. Called on every change of slot, switch or sound, and on every real tap. */
function reconcile() {
  const slot = target();
  if (!slot) {
    if (pending || voices.size) halt(!on || sfx.isMuted() ? QUICK : FADE);
    return;
  }
  if (!tapped || hidden()) return;
  const a = sfx.context();
  if (!a) return;
  if (cur && !cur.dying && cur.slot === slot) {
    // Already on it; a load for another slot that was on its way is called off.
    epoch++;
    pending = null;
    return;
  }
  if (pending === slot || (retryAt.get(slot) ?? 0) > Date.now()) return;
  void start(a, slot);
}

/* ------------------------------------------------------------ listeners -- */
/** Only a real tap or key press (not a script's dispatchEvent) lets music start. sfx.ts has already made the context by now. */
function onGesture(e: Event) {
  if (!e.isTrusted) return;
  tapped = true;
  reconcile();
}

/** A stop the Hopper did not ask for. The music comes back only on the next real tap, never on a route change or a timer. */
function stopUntilTap(secs: number) {
  tapped = false;
  halt(secs);
}

/** Hidden: fade out and stop (sfx.ts suspends the context once the fade has run). Visible again: nothing starts until the next tap. */
function onVisibility() {
  if (hidden()) stopUntilTap(QUICK);
  else voices.forEach((v) => v.dying && drop(v));
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  ["pointerdown", "touchend", "click", "keydown"].forEach((n) => document.addEventListener(n, onGesture, true));
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", () => stopUntilTap(QUICK));
  sfx.subscribe(reconcile);
  // Duck under the sounds that matter. The context's own clock keeps the dip exact: down now, held a moment after the
  // sound ends (so sounds that follow each other are one dip), then back up.
  sfx.onVoice((lane, t, e) => {
    const d = DUCK_LANES.get(lane);
    if (!d || !bound || !duck || !voices.size) return;
    const now = bound.currentTime;
    // A deeper dip that is still going is not made shallower by a tick on top of it.
    duckTo = duckUntil > now ? Math.min(duckTo, d.to) : d.to;
    duckUntil = Math.max(now, duckUntil, Math.min(e + d.hold, Math.max(t, now) + DUCK_MAX));
    const g = duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(duckTo, now, ATTACK / 4);
    g.setTargetAtTime(1, duckUntil, RELEASE / 4);
  });
}
install();

export const music = {
  /**
   * The slot this screen wants, or null for none, and the screen's own loop (an address) if it brought one: the loop
   * plays in place of the slot, and the slot is what plays when it cannot. <MusicHost /> calls it on every route and
   * Play change. Starts only after a real tap.
   */
  want(slot: MusicSlot | null, own?: string | null, room?: boolean) {
    want = slot;
    track = slot && own ? `url:${own}` : null;
    const inRoom = !!slot && !!room;
    if (roomMode !== inRoom) {
      roomMode = inRoom;
      if (!inRoom) voiceDuck = false;
      syncPost();
    }
    // A loop the room no longer uses is freed, unless it is still fading out.
    for (const k of loops.keys()) if (isTrack(k) && k !== track && ![...voices].some((v) => v.slot === k)) loops.delete(k);
    reconcile();
  },
  /**
   * The room's voice chat: true while joined and someone you can hear is talking, false when they stop. The music
   * eases down to the "voice" duck lane and back. Only dips a crew room's music; anywhere else it is ignored.
   */
  duckVoice(active: boolean) {
    const next = active && roomMode;
    if (voiceDuck === next) return;
    voiceDuck = next;
    syncPost();
  },
  /** True when a screen's own loop could not play here this visit (the slot played instead). */
  failed: (own: string) => dead.has(`url:${own}`),
  /** The Music switch. Persisted. Off fades the music out at once. */
  setOn(next: boolean) {
    if (on === next) return;
    on = next;
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    reconcile();
    emit();
  },
  isOn: () => on,
  /** For useSyncExternalStore: fires when the switch changes, or a screen's own loop could not play. */
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
