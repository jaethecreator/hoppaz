// Checks the state rules of voice on by default (listener in, mic only on a tap) with plain node (no browser, no LiveKit, no phone):
//   node scripts/crew-room/check-voice-flow.mjs
// src/lib/crew-room/voiceFlow.ts (the rules), with src/lib/crew-room/stageMix.ts for what the speaker toggle silences, and a few
// reads of the source that guard the promises no stub can see (no mic request on the way in, hotspot rooms voice-free).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDLE_FLOW, TEXT, TIP_KEY, cameBack, joined, micAnswer, rememberSpeaker, silence, speaker, speakerKey, speakerWasOff, tap, tipDue, wentAway } from "../../src/lib/crew-room/voiceFlow.ts";
import { stageMix, HUSH } from "../../src/lib/crew-room/stageMix.ts";

let n = 0;
const ok = (label, fn) => {
  fn();
  n++;
  console.log("PASS:", label);
};

// A phone: runs a step's one instruction like voice.ts does, with a scripted answer for the microphone prompt.
// `asked` counts how many times the phone was asked for the mic: the number that must stay small.
function phone({ allow = true } = {}) {
  const p = {
    flow: IDLE_FLOW,
    asked: 0,
    released: 0,
    notes: [],
    left: 0,
    allow,
    adopt(step) {
      p.flow = step.flow;
      if (step.note) p.notes.push(step.note);
      return step;
    },
    walkIn(canPublish = true) {
      // enter(): connect as a listener. joined() is the whole of it: nothing asks for the mic.
      p.adopt(joined(p.flow, canPublish));
    },
    press() {
      const step = tap(p.flow);
      if (step.do === "join") p.walkIn();
      else if (step.do === "leave") {
        p.left++;
        p.flow = { ...IDLE_FLOW, speakerOff: p.flow.speakerOff };
      } else if (step.do === "mic-off") p.adopt(step);
      else if (step.do === "ask-mic") {
        p.asked++;
        p.adopt(micAnswer(step.flow, p.allow));
      }
      return step.do;
    },
    hide() {
      const step = p.adopt(wentAway(p.flow));
      if (step.do === "release-mic") p.released++;
      return step.do;
    },
    show() {
      return p.adopt(cameBack(p.flow));
    },
  };
  return p;
}

// ---- 1. join on enter: a listener, the mic untouched
ok("walking in joins as a listener: hearing the room, the mic closed, nothing asked", () => {
  const p = phone();
  p.walkIn(true);
  assert.equal(p.flow.phase, "listening");
  assert.equal(p.flow.canPublish, true);
  assert.equal(p.asked, 0);
  assert.equal(joined(IDLE_FLOW, true).do, undefined); // joining carries no instruction at all
});
ok("a watcher joins too: listening, cannot talk, still nothing asked", () => {
  const p = phone();
  p.walkIn(false);
  assert.deepEqual([p.flow.phase, p.flow.canPublish, p.asked], ["listening", false, 0]);
});
ok("a tap before joining joins (as a listener), it does not open the mic", () => {
  const p = phone();
  assert.equal(p.press(), "join");
  assert.equal(p.flow.phase, "listening");
  assert.equal(p.asked, 0);
});
ok("a tap while joining does nothing", () => {
  assert.deepEqual(tap({ ...IDLE_FLOW, phase: "joining" }), { flow: { ...IDLE_FLOW, phase: "joining" } });
});

// ---- 2. the first tap on the control asks; yes means talking
ok("the first tap asks for the mic once, and a yes lights the control", () => {
  const p = phone({ allow: true });
  p.walkIn();
  assert.equal(p.press(), "ask-mic");
  assert.equal(p.asked, 1);
  assert.equal(p.flow.phase, "mic");
});

// ---- 3. permission denied: listen-only, blocked, never a loop
ok("a refused mic leaves me listening, in voice, with the control blocked", () => {
  const p = phone({ allow: false });
  p.walkIn();
  p.press();
  assert.equal(p.flow.phase, "blocked");
  assert.equal(p.flow.canPublish, true); // still in voice, still hearing the room
  assert.notEqual(p.flow.phase, "off");
  assert.deepEqual(p.notes, []); // the control says it (TEXT.blocked); no second label the first time
});
ok("nothing but a tap ever asks for the mic (no loop)", () => {
  const all = { ...IDLE_FLOW, canPublish: true };
  const states = ["off", "joining", "listening", "mic", "muted", "blocked"].flatMap((phase) => [true, false].flatMap((away) => [true, false].map((speakerOff) => ({ ...all, phase, away, speakerOff }))));
  for (const f of states) {
    for (const step of [joined(f, true), joined(f, false), micAnswer(f, true), micAnswer(f, false), wentAway(f), cameBack(f), speaker(f, true), speaker(f, false)]) {
      assert.notEqual(step.do, "ask-mic", `a non-tap step asked for the mic from ${JSON.stringify(f)}`);
    }
  }
  // and a refusal followed by a background and a return still asks nobody
  const p = phone({ allow: false });
  p.walkIn();
  p.press();
  const asked = p.asked;
  p.hide();
  p.show();
  assert.equal(p.asked, asked);
});
ok("tapping a blocked control asks again, once per tap; a second refusal says check your phone settings", () => {
  const p = phone({ allow: false });
  p.walkIn();
  p.press();
  assert.equal(p.press(), "ask-mic");
  assert.equal(p.asked, 2);
  assert.deepEqual(p.notes, ["blocked-again"]);
  assert.equal(TEXT.notes["blocked-again"], "MIC BLOCKED. CHECK YOUR PHONE SETTINGS.");
  p.allow = true; // the Hopper fixed it in settings and tapped
  p.press();
  assert.equal(p.flow.phase, "mic");
});

// ---- 4. mute toggle
ok("one tap mutes, another unmutes (MicOff, then Mic)", () => {
  const p = phone();
  p.walkIn();
  p.press();
  assert.equal(p.flow.phase, "mic");
  assert.equal(p.press(), "mic-off");
  assert.equal(p.flow.phase, "muted");
  assert.equal(p.press(), "ask-mic");
  assert.equal(p.flow.phase, "mic");
  assert.equal(p.press(), "mic-off");
  assert.equal(p.flow.phase, "muted");
});
ok("a watcher cannot talk: a tap stops listening instead", () => {
  const p = phone();
  p.walkIn(false);
  assert.equal(p.press(), "leave");
  assert.equal(p.flow.phase, "off");
  assert.equal(p.left, 1);
});

// ---- 5. background: muted, and it stays muted until back AND a tap
ok("the app going to the background closes a live mic and lets go of it", () => {
  const p = phone();
  p.walkIn();
  p.press();
  assert.equal(p.hide(), "release-mic");
  assert.deepEqual([p.flow.phase, p.flow.away, p.released], ["muted", true, 1]);
});
ok("coming back turns nothing on: still muted, told so", () => {
  const p = phone();
  p.walkIn();
  p.press();
  p.hide();
  const step = p.show();
  assert.equal(step.flow.phase, "muted");
  assert.deepEqual(p.notes, ["still-muted"]);
  assert.equal(TEXT.notes["still-muted"], "MIC IS OFF. TAP TO TALK.");
  assert.equal(step.do, undefined);
});
ok("only a tap after coming back opens the mic again", () => {
  const p = phone();
  p.walkIn();
  p.press();
  p.hide();
  p.show();
  assert.equal(p.flow.phase, "muted");
  assert.equal(p.press(), "ask-mic");
  assert.deepEqual([p.flow.phase, p.flow.away], ["mic", false]);
});
ok("going to the background while only listening, muted by hand or blocked changes nothing", () => {
  for (const phase of ["off", "joining", "listening", "muted", "blocked"]) {
    const f = { ...IDLE_FLOW, phase, canPublish: true };
    assert.deepEqual(wentAway(f), { flow: f }, phase);
  }
});
ok("a hand-muted mic that goes to the background and comes back gets no 'still muted' label", () => {
  const p = phone();
  p.walkIn();
  p.press();
  p.press(); // muted by hand
  p.hide();
  p.show();
  assert.deepEqual(p.notes, []);
});
ok("a second background in a row releases the mic once", () => {
  const p = phone();
  p.walkIn();
  p.press();
  p.hide();
  p.hide();
  assert.equal(p.released, 1);
});

// ---- 6. leaving the room hangs up (the session resets to idle but keeps the speaker choice)
ok("a hang up goes back to idle and keeps only the speaker choice", () => {
  const p = phone();
  p.walkIn();
  p.adopt(speaker(p.flow, false));
  p.press();
  p.flow = { ...IDLE_FLOW, speakerOff: p.flow.speakerOff }; // voice.ts reset()
  assert.deepEqual(p.flow, { ...IDLE_FLOW, speakerOff: true });
});

// ---- 7. the speaker toggle, and stage voice unchanged
ok("the speaker toggle is independent of the mic", () => {
  const p = phone();
  p.walkIn();
  p.press();
  const off = speaker(p.flow, false);
  assert.deepEqual([off.flow.speakerOff, off.flow.phase], [true, "mic"]);
  assert.equal(speaker(off.flow, true).flow.speakerOff, false);
});
ok("speaker on: the stage plays full and the people near me at the existing reduced level", () => {
  const mix = stageMix({ stage: ["s1"], heard: new Map([["a", 1], ["b", 0.3]]), me: "me", mode: "mixed", stageMuted: false });
  const heard = silence(mix, false);
  assert.equal(heard.get("s1"), 1);
  assert.equal(heard.get("a"), HUSH);
  assert.equal(heard.get("b"), 0.3);
  assert.deepEqual([...heard], [...mix]);
});
ok("speaker off: nobody is heard, the stage included", () => {
  const mix = stageMix({ stage: ["s1"], heard: new Map([["a", 1]]), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(silence(mix, true).size, 0);
  assert.equal(mix.size, 2); // and the original mix is not touched
});

// ---- 8. what a phone remembers
const store = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), m };
};
ok("the first visit to a room has the voices ON", () => {
  assert.equal(speakerWasOff(store(), "crewA"), false);
  assert.equal(speakerWasOff(null, "crewA"), false);
});
ok("the speaker choice is remembered per room", () => {
  const kv = store();
  rememberSpeaker(kv, "crewA", false);
  assert.equal(speakerWasOff(kv, "crewA"), true);
  assert.equal(speakerWasOff(kv, "crewB"), false);
  rememberSpeaker(kv, "crewA", true);
  assert.equal(speakerWasOff(kv, "crewA"), false);
  assert.equal(kv.m.get(speakerKey("crewA")), "on");
});
ok("the mic is never remembered as on: nothing in the keys says so", () => {
  const kv = store();
  const p = phone();
  p.walkIn();
  p.press();
  rememberSpeaker(kv, "crewA", true);
  assert.deepEqual([...kv.m.keys()], [speakerKey("crewA")]);
  assert.equal(joined({ ...IDLE_FLOW, speakerOff: false }, true).flow.phase, "listening"); // the next visit starts listening again
});
ok("a storage that throws is tolerated", () => {
  const bad = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(speakerWasOff(bad, "crewA"), false);
  assert.doesNotThrow(() => rememberSpeaker(bad, "crewA", false));
  assert.equal(tipDue(bad), false);
});
ok("the tip shows once per device, then is remembered", () => {
  const kv = store();
  assert.equal(tipDue(kv), true);
  assert.equal(kv.m.get(TIP_KEY), "1");
  assert.equal(tipDue(kv), false);
  assert.equal(tipDue(kv), false);
  assert.equal(tipDue(null), false); // no storage: it could not be remembered, so it never shows
});

// ---- 9. the words on the screen
ok("the on-screen strings are exactly these", () => {
  assert.equal(TEXT.tip, "You can hear the room. Tap to talk.");
  assert.equal(TEXT.blocked, "Mic blocked. Tap to allow");
  assert.equal(TEXT.speakerOn, "ROOM VOICES ON");
  assert.equal(TEXT.speakerOff, "ROOM VOICES OFF");
  for (const s of [TEXT.tip, TEXT.blocked, ...Object.values(TEXT.notes)]) assert.ok(!s.includes("—"), "no em dash");
});

// ---- 10. source guards (what no stub can see)
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");
const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((f) => {
    const rel = join(dir, f);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

ok("the microphone is requested in one place only: setMic, which only a tap reaches", () => {
  const voice = read("src/lib/crew-room/voice.ts");
  assert.equal(voice.match(/setMicrophoneEnabled\(/g).length, 2, "setMic(on) and away() (always false) and nothing else");
  assert.ok(/setMicrophoneEnabled\(false\)/.test(voice.slice(voice.indexOf("async away()"))), "away() only ever closes the mic");
  assert.equal([...voice.matchAll(/setMicrophoneEnabled\(true\)/g)].length, 0, "no literal request for the mic");
  assert.ok(/setMicrophoneEnabled\(on\)/.test(voice));
  // connect() (the entry and stage joins) never mentions the microphone
  const connect = voice.slice(voice.indexOf("private async connect("), voice.indexOf("/** A tap on the room unlocks audio"));
  assert.ok(!/Microphone|setMic\(/.test(connect.replace(/\/\/.*$/gm, "")), "connect() must not touch the mic");
  assert.ok(/Promise\.race\(\[room\.startAudio\(\)/.test(connect), "a join never waits on the browser's audio unlock");
  // enter() only connects
  const enter = voice.slice(voice.indexOf("  enter(): Promise<void>"), voice.indexOf("  private async bearer()"));
  assert.ok(!/setMic|Microphone/.test(enter));
});
ok("RoomVoice joins with enter() on the way in and hears the visibility change", () => {
  const ui = read("src/components/crew-room/RoomVoice.tsx");
  assert.ok(/\.enter\(\)/.test(ui));
  assert.ok(/visibilitychange/.test(ui) && /\.away\(\)/.test(ui) && /\.returned\(\)/.test(ui));
  assert.ok(/pagehide/.test(ui) && /\.leave\(\)/.test(ui), "leaving hangs up");
  const entry = ui.slice(ui.indexOf("useEffect(() => {\n    if (!VOICE_AUTO"), ui.indexOf("// Where everyone stands"));
  assert.ok(!/setMic\(/.test(entry), "the entry effect never calls setMic");
  assert.ok(/!placed/.test(entry), "the entry join waits for my walker (the server decides canPublish from my presence row)");
});
ok("hotspot rooms stay voice-free: nothing there mounts RoomVoice or a VoiceSession", () => {
  const files = [...walk("src/components/hotspots"), ...walk("src/app/room"), ...walk("src/components/chat")].filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 5);
  for (const f of files) assert.ok(!/RoomVoice|VoiceSession|crew-room\/voice/.test(read(f)), `${f} must not use voice`);
  const mounts = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /<RoomVoice\b/.test(read(f)));
  assert.deepEqual(mounts, ["src/components/campaign/CampaignExperience.tsx"]);
});

console.log(`ALL ${n} VOICE FLOW CHECKS PASSED`);
