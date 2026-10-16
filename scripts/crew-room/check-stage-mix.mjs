// Checks the pure stage voice rules with plain node (no browser, no LiveKit, no database):
//   node scripts/crew-room/check-stage-mix.mjs
// src/lib/crew-room/stageMix.ts (who a phone hears) and src/lib/crew-room/stageRights.ts (who may publish, the sweep).
import assert from "node:assert/strict";
import { stageMix, MAX_HEARD, HUSH } from "../../src/lib/crew-room/stageMix.ts";
import { tokenCanPublish, stageDecision, staleStage, parseStage, isStaffRole, MAX_STAGE } from "../../src/lib/crew-room/stageRights.ts";
import { createStageSender, STOP_RETRIES } from "../../src/lib/crew-room/stageSend.ts";

let n = 0;
const ok = (label, fn) => {
  fn();
  n++;
  console.log("PASS:", label);
};
const okAsync = async (label, fn) => {
  await fn();
  n++;
  console.log("PASS:", label);
};
const heard = (pairs) => new Map(pairs);

// ---- the mixer
ok("stage voices are full volume wherever they stand", () => {
  const m = stageMix({ stage: ["s1", "s2"], heard: heard([]), me: "me", mode: "mixed", stageMuted: false });
  assert.deepEqual([...m], [["s1", 1], ["s2", 1]]);
});
ok("people near me are capped at 0.5 while the stage is live", () => {
  const m = stageMix({ stage: ["s1"], heard: heard([["a", 1], ["b", 0.3]]), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(m.get("s1"), 1);
  assert.equal(m.get("a"), HUSH);
  assert.equal(m.get("b"), 0.3);
});
ok("with nobody on the stage the people near me are untouched", () => {
  const m = stageMix({ stage: [], heard: heard([["a", 1]]), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(m.get("a"), 1);
});
ok("a stage-only room drops everyone near me", () => {
  const m = stageMix({ stage: ["s1"], heard: heard([["a", 1]]), me: "me", mode: "stage", stageMuted: false });
  assert.deepEqual([...m], [["s1", 1]]);
});
ok("muting the stage maps its voices to 0", () => {
  const m = stageMix({ stage: ["s1"], heard: heard([["a", 1]]), me: "me", mode: "mixed", stageMuted: true });
  assert.equal(m.get("s1"), 0);
});
ok("I am never in my own mix", () => {
  const m = stageMix({ stage: ["me", "s1"], heard: heard([["me", 1], ["a", 1]]), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(m.has("me"), false);
  assert.equal(m.get("a"), HUSH); // s1 is still on the stage, so the people near me are capped
  const alone = stageMix({ stage: ["me"], heard: heard([["a", 1]]), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(alone.get("a"), 1); // I am the only one on the stage: nobody else is being broadcast, so no cap
});
ok("a stage voice that is also near me is counted once, at full volume", () => {
  const m = stageMix({ stage: ["s1"], heard: heard([["s1", 0.2]]), me: "me", mode: "mixed", stageMuted: false });
  assert.deepEqual([...m], [["s1", 1]]);
});
ok(`never more than ${MAX_HEARD} voices, stage first`, () => {
  const near = Array.from({ length: 20 }, (_, i) => [`p${i}`, 1]);
  const m = stageMix({ stage: ["s1", "s2", "s3"], heard: heard(near), me: "me", mode: "mixed", stageMuted: false });
  assert.equal(m.size, MAX_HEARD);
  assert.ok(["s1", "s2", "s3"].every((id) => m.get(id) === 1));
  assert.deepEqual([...m.keys()].slice(3), ["p0", "p1", "p2", "p3", "p4"]);
});

// ---- who may publish
ok("flag off: a walker may publish, as before", () => {
  assert.equal(tokenCanPublish({ stageFlag: false, stageOnly: true, walking: true, isStaff: false, onStage: false }), true);
  assert.equal(tokenCanPublish({ stageFlag: false, stageOnly: false, walking: false, isStaff: true, onStage: true }), false);
});
ok("mixed room: walkers publish, watchers do not", () => {
  assert.equal(tokenCanPublish({ stageFlag: true, stageOnly: false, walking: true, isStaff: false, onStage: false }), true);
  assert.equal(tokenCanPublish({ stageFlag: true, stageOnly: false, walking: false, isStaff: true, onStage: true }), false);
});
ok("stage-only room: only staff on the stage, walking, publish", () => {
  const base = { stageFlag: true, stageOnly: true, walking: true, isStaff: true, onStage: true };
  assert.equal(tokenCanPublish(base), true);
  assert.equal(tokenCanPublish({ ...base, isStaff: false }), false);
  assert.equal(tokenCanPublish({ ...base, onStage: false }), false);
  assert.equal(tokenCanPublish({ ...base, walking: false }), false);
});
ok("only the owner and admins are staff", () => {
  assert.deepEqual(["owner", "admin", "member", "", null, undefined, "boss"].map(isStaffRole), [true, true, false, false, false, false, false]);
});

// ---- the stage route's decision
const list = ["o", "a1"];
ok("staff in the database list go on the stage", () => {
  const d = stageDecision({ on: true, isStaff: true, list, me: "a1", walking: true, stageOnly: true });
  assert.deepEqual(d, { stage: true, canPublish: true, full: false });
});
ok("staff not in the list do not, and nothing is 'full'", () => {
  const d = stageDecision({ on: true, isStaff: true, list, me: "a2", walking: true, stageOnly: true });
  assert.deepEqual(d, { stage: false, canPublish: false, full: false });
});
ok("a fourth staff member is told the stage is full", () => {
  const d = stageDecision({ on: true, isStaff: true, list: ["o", "a1", "a2"], me: "a3", walking: true, stageOnly: false });
  assert.equal(d.full, true);
  assert.equal(d.stage, false);
  assert.equal(d.canPublish, true); // a mixed room: a walker keeps the mic for the people near them
  assert.equal(MAX_STAGE, 3);
});
ok("a member is never on the stage, even if the list had them", () => {
  assert.equal(stageDecision({ on: true, isStaff: false, list: ["m"], me: "m", walking: true, stageOnly: true }).stage, false);
});
ok("asking to stop takes the stage and (stage-only) the mic away", () => {
  assert.deepEqual(stageDecision({ on: false, isStaff: true, list, me: "a1", walking: true, stageOnly: true }), { stage: false, canPublish: false, full: false });
  assert.deepEqual(stageDecision({ on: false, isStaff: true, list, me: "a1", walking: true, stageOnly: false }), { stage: false, canPublish: true, full: false });
});

// ---- the sweep
ok("the sweep finds a stage attribute the database no longer backs", () => {
  const parts = [
    { identity: "o", attributes: { stage: "1" } },
    { identity: "gone", attributes: { stage: "1" } },
    { identity: "quiet", attributes: {} },
    { identity: "bare" },
  ];
  assert.deepEqual(staleStage(parts, ["o"]), ["gone"]);
});

// ---- the stage answer
ok("an odd answer from the database is 'nobody, not staff'", () => {
  const none = { stage: [], isStaff: false, isOwner: false, admins: [] };
  for (const v of [null, undefined, 7, "x", []]) assert.deepEqual(parseStage(v), none);
  assert.deepEqual(parseStage({ stage: [1, "a", null], is_staff: "yes" }), { ...none, stage: ["a"] });
});
ok("the answer is cut to three on the stage", () => {
  assert.equal(parseStage({ stage: ["a", "b", "c", "d"], is_staff: true, is_owner: true, admins: ["b"] }).stage.length, 3);
});


// ---- the stage sender: one request at a time, the latest wish wins (a "stop" is never lost)
// A fake server: every request waits until the test lets it answer, so the test decides what is "in flight".
const rig = (answer = (on) => ({ ok: on, full: false })) => {
  const sent = []; // what the server saw, in order
  const open = []; // requests waiting for an answer
  const settled = []; // what the phone showed
  const send = (on) =>
    new Promise((resolve) => {
      sent.push(on);
      open.push(() => resolve(answer(on, sent.length)));
    });
  const call = createStageSender(send, (on, a) => settled.push([on, a.ok]), { pause: async () => {} });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const reply = async () => {
    await tick();
    open.shift()?.();
    await tick();
  };
  return { call, sent, settled, reply, tick };
};

await okAsync("a stop asked while a start is in flight is sent after it, and the pill ends not-live", async () => {
  const r = rig();
  const start = r.call(true);
  await r.tick();
  const stop = r.call(false); // the speaker walked off
  await r.reply(); // the start comes back
  assert.deepEqual(r.sent, [true, false]);
  assert.deepEqual(r.settled, []); // the start's answer is not shown: it is already out of date
  await r.reply(); // the stop comes back
  assert.deepEqual(r.sent, [true, false]);
  assert.deepEqual(r.settled, [[false, false]]);
  assert.equal((await stop).ok, false);
  assert.equal((await start).ok, false); // both callers get the answer to the last wish
});
await okAsync("a stop asked while the 20 s keep-alive is in flight is not lost either", async () => {
  const r = rig();
  r.call(true);
  await r.reply();
  assert.deepEqual(r.settled, [[true, true]]); // I am live
  r.call(true); // keep-alive
  await r.tick();
  r.call(false); // 1.5 s after walking off
  await r.reply();
  await r.reply();
  assert.deepEqual(r.sent, [true, true, false]);
  assert.deepEqual(r.settled.at(-1), [false, false]);
});
await okAsync("a start asked while a stop is in flight is sent after it (the newest wish wins)", async () => {
  const r = rig();
  r.call(false);
  await r.tick();
  r.call(true);
  await r.reply();
  await r.reply();
  assert.deepEqual(r.sent, [false, true]);
  assert.deepEqual(r.settled, [[true, true]]);
});
await okAsync("the same wish asked again while in flight shares the request (no pile-up)", async () => {
  const r = rig();
  r.call(true);
  await r.tick();
  r.call(true);
  r.call(true);
  await r.reply();
  assert.deepEqual(r.sent, [true]);
  assert.deepEqual(r.settled, [[true, true]]);
});
await okAsync("on, off, on while one request is out sends nothing extra: the last wish is the one in flight", async () => {
  const r = rig();
  r.call(true);
  await r.tick();
  r.call(false);
  r.call(true);
  await r.reply();
  assert.deepEqual(r.sent, [true]);
  assert.deepEqual(r.settled, [[true, true]]);
});
await okAsync("the sender is free again afterwards: a later stop is a new request", async () => {
  const r = rig();
  r.call(true);
  await r.reply();
  r.call(false);
  await r.reply();
  assert.deepEqual(r.sent, [true, false]);
  assert.deepEqual(r.settled, [[true, true], [false, false]]);
});
await okAsync("a stop that never reaches the server is tried again, then shown as off", async () => {
  const r = rig((on) => (on ? { ok: true, full: false } : { ok: false, full: false, failed: true }));
  r.call(false);
  for (let i = 0; i < STOP_RETRIES + 1; i++) await r.reply();
  assert.deepEqual(r.sent, [false, false, false]);
  assert.equal(r.sent.length, STOP_RETRIES + 1);
  assert.deepEqual(r.settled, [[false, false]]); // not live, even though the server never answered
});
await okAsync("a stop that fails once and then gets through stops retrying", async () => {
  const r = rig((on, k) => (!on && k === 1 ? { ok: false, full: false, failed: true } : { ok: on, full: false }));
  r.call(false);
  await r.reply();
  await r.reply();
  await r.tick();
  assert.deepEqual(r.sent, [false, false]);
  assert.deepEqual(r.settled, [[false, false]]);
});
await okAsync("a start that fails is not retried by the sender and shows nothing new", async () => {
  const r = rig(() => ({ ok: false, full: false, failed: true }));
  r.call(true);
  await r.reply();
  assert.deepEqual(r.sent, [true]);
  assert.deepEqual(r.settled, [[true, false]]); // the session ignores a failed start; the sender only reports it
});
await okAsync("a start wished while a failed stop waits to retry goes out instead of the retry", async () => {
  const r = rig((on) => (on ? { ok: true, full: false } : { ok: false, full: false, failed: true }));
  r.call(false);
  await r.reply(); // the stop failed; the sender is about to retry it
  r.call(true);
  await r.reply();
  await r.reply();
  assert.equal(r.sent.at(-1), true);
  assert.deepEqual(r.settled.at(-1), [true, true]);
});

console.log(`ALL ${n} STAGE CHECKS PASSED`);
