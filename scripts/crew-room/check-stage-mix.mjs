// Checks the pure stage voice rules with plain node (no browser, no LiveKit, no database):
//   node scripts/crew-room/check-stage-mix.mjs
// src/lib/crew-room/stageMix.ts (who a phone hears) and src/lib/crew-room/stageRights.ts (who may publish, the sweep).
import assert from "node:assert/strict";
import { stageMix, MAX_HEARD, HUSH } from "../../src/lib/crew-room/stageMix.ts";
import { tokenCanPublish, stageDecision, staleStage, parseStage, isStaffRole, MAX_STAGE } from "../../src/lib/crew-room/stageRights.ts";

let n = 0;
const ok = (label, fn) => {
  fn();
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

console.log(`ALL ${n} STAGE CHECKS PASSED`);
