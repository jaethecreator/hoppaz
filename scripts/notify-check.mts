/**
 * Plain checks for the notification layer (src/lib/notify and the run route). No test framework, no network, no database.
 * Run from the repo root:  node --no-warnings scripts/notify-check.mts
 * Covers: the enqueue helper's checks and defaults, the router (order, cap full, errors, limits, retries, WhatsApp skipped), the log
 * provider, the run loop against a stub of the SQL layer, the 80 percent warning, the provider list, and the run route's gate.
 * The SQL half is supabase/tests/events_r1_notify_test.sql (it needs the local database).
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { EmailProvider, SendResult } from "../src/lib/notify/provider.ts";
import type { NotifyDb } from "../src/lib/notify/db.ts";
import type { CapKind, CapStatus, ClaimedRow, EnqueueArgs, RowOutcome } from "../src/lib/notify/types.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context); // the route file imports it extensionless
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    return nextResolve(specifier, context);
  },
});

const { buildEnqueueArgs, notify } = await import("../src/lib/notify/enqueue.ts");
const { createLogProvider, maskAddress } = await import("../src/lib/notify/log.ts");
const { routeEmail, routeRow, retryDelayMinutes, newRouterState, skipWhatsApp, WHATSAPP_NOT_BUILT, FULL_CAP_WAIT_MINUTES } = await import("../src/lib/notify/router.ts");
const { runNotify, capWarnings } = await import("../src/lib/notify/run.ts");
const { buildProviders } = await import("../src/lib/notify/providers.ts");
const { runAllowed } = await import("../src/lib/notify/http.ts");
const { KIND_RULES, MAX_TRIES } = await import("../src/lib/notify/types.ts");
const route = await import("../src/app/api/notify/run/route.ts");

let pass = 0;
let fail = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (c: unknown, what: string) => {
  if (!c) throw new Error(what);
};
function throwsSync(fn: () => unknown, match: RegExp, what: string) {
  try {
    fn();
  } catch (e) {
    if (!match.test((e as Error).message)) throw new Error(`${what}: wrong error "${(e as Error).message}"`);
    return;
  }
  throw new Error(`${what}: expected it to throw`);
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
const quiet = () => {};

const UID = "11111111-1111-4111-8111-111111111111";
const EID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-02T10:00:00.000Z");
const now = () => NOW;

const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "r1",
  user_id: UID,
  kind: "reminder_day",
  event_id: EID,
  channel: "email",
  cap_kind: "guest",
  payload: { title: "Night" },
  priority: 2,
  tries: 1,
  dedupe_key: "k1",
  email: "ada@example.com",
  whatsapp_number: null,
  ...over,
});

/** A provider whose answers are scripted; remembers what it was asked. */
function fakeProvider(name: string, kinds: CapKind[], answer: SendResult | (() => SendResult | Promise<SendResult>)): EmailProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    kinds,
    calls,
    async send(msg) {
      calls.push(msg.queueId);
      return typeof answer === "function" ? answer() : answer;
    },
  };
}
const good = (id: string): SendResult => ({ ok: true, messageId: id, costUsd: 0.001 });

/** In-memory allowances: take succeeds while the provider has room, and counts. */
function memCaps(limits: Record<string, number>) {
  const used: Record<string, number> = {};
  const log: string[] = [];
  return {
    used,
    log,
    async take(provider: string, kind: CapKind) {
      const key = `${provider}:${kind}`;
      log.push(`take ${key}`);
      if (!(key in limits) || (used[key] ?? 0) + 1 > limits[key]) return false;
      used[key] = (used[key] ?? 0) + 1;
      return true;
    },
    async give(provider: string, kind: CapKind) {
      const key = `${provider}:${kind}`;
      log.push(`give ${key}`);
      used[key] = Math.max(0, (used[key] ?? 0) - 1);
    },
  };
}

// ------------------------------------------------------------------ enqueue ---
await test("enqueue: the email list priorities, from the plan, are the defaults", () => {
  eq(KIND_RULES.reminder_day.priority, 2, "G10");
  eq(KIND_RULES.reminder_hour.priority, 4, "G11");
  eq(KIND_RULES.thanks.priority, 5, "G15");
  eq(KIND_RULES.sign_in_code.capKind, "code", "A1 is a code");
  const a = buildEnqueueArgs({ userId: UID, kind: "reminder_hour", eventId: EID });
  eq(a.p_priority, 4, "priority from the kind");
  eq(a.p_cap_kind, "guest", "cap kind from the kind");
  eq(a.p_channel, "email", "email by default");
  eq(buildEnqueueArgs({ userId: UID, kind: "sign_in_code" }).p_cap_kind, "code", "a code spends the code allowance");
  eq(buildEnqueueArgs({ userId: UID, kind: "something_new" }).p_priority, 3, "an unknown kind is priority 3");
});
await test("enqueue: explicit values win, dates become ISO, blanks become null", () => {
  const a = buildEnqueueArgs({
    userId: UID, kind: "thanks", eventId: EID, priority: 1, channel: "whatsapp", capKind: "code", payload: { a: 1 },
    dueAt: new Date("2026-11-03T08:00:00Z"), expiresAt: "2026-11-04T00:00:00Z", dedupeKey: "  my-key  ",
  });
  eq(a, {
    p_user: UID, p_kind: "thanks", p_event: EID, p_payload: { a: 1 }, p_priority: 1, p_due_at: "2026-11-03T08:00:00.000Z",
    p_dedupe: "my-key", p_channel: "whatsapp", p_cap_kind: "code", p_expires_at: "2026-11-04T00:00:00.000Z",
  } satisfies EnqueueArgs, "all fields");
  const b = buildEnqueueArgs({ userId: UID, kind: "thanks", dedupeKey: "   ", dueAt: null });
  eq([b.p_dedupe, b.p_due_at, b.p_expires_at, b.p_event, b.p_payload], [null, null, null, null, {}], "defaults");
});
await test("enqueue: bad calls throw", () => {
  throwsSync(() => buildEnqueueArgs({ userId: "nope", kind: "thanks" }), /userId/, "user");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "Bad Kind" }), /kind/, "kind");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", eventId: "x" }), /eventId/, "event");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", priority: 6 as never }), /priority/, "priority 6");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", priority: 0 as never }), /priority/, "priority 0");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", channel: "sms" as never }), /channel/, "channel");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", capKind: "x" as never }), /capKind/, "cap kind");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", payload: [] as never }), /payload/, "payload");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", dueAt: "not a date" }), /dueAt/, "date");
  throwsSync(() => buildEnqueueArgs({ userId: UID, kind: "thanks", dedupeKey: "x".repeat(201) }), /dedupeKey/, "key length");
});
await test("enqueue: notify() reports queued for a new row and not queued for a duplicate or a switched-off channel", async () => {
  const seen = new Set<string>();
  const db = { async enqueue(a: EnqueueArgs) {
    if (a.p_kind === "off") return null;
    const key = a.p_dedupe ?? `${a.p_kind}:${a.p_event}:${a.p_user}:${a.p_channel}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return `id-${seen.size}`;
  } } as unknown as NotifyDb;
  eq(await notify(db, { userId: UID, kind: "registered", eventId: EID }), { queued: true, id: "id-1" }, "first");
  eq(await notify(db, { userId: UID, kind: "registered", eventId: EID }), { queued: false, id: null }, "the same again");
  eq((await notify(db, { userId: UID, kind: "off" })).queued, false, "switched off");
});

// ------------------------------------------------------------------ log provider ---
await test("log provider: sends nothing, answers with a fake id and no cost, never prints the whole address", async () => {
  const lines: string[] = [];
  const p = createLogProvider((l) => lines.push(l));
  eq(p.name, "log", "name");
  eq([...p.kinds].sort(), ["code", "guest"], "serves both");
  const a = await p.send({ to: "ada@example.com", kind: "ticket", payload: {}, queueId: "q1", dedupeKey: "k", priority: 1 });
  ok(a.ok && a.messageId.startsWith("log_") && a.costUsd === 0, "fake id, no cost");
  const b = await p.send({ to: "ada@example.com", kind: "ticket", payload: {}, queueId: "q2", dedupeKey: "k", priority: 1 });
  ok(a.ok && b.ok && a.messageId !== b.messageId, "ids are not reused");
  eq(lines.length, 2, "one line each");
  ok(!lines.join("").includes("ada@example.com") && lines[0].includes("a***@example.com"), "the address is masked");
  eq(maskAddress("nobody"), "***", "no @");
});

// ------------------------------------------------------------------ router ---
await test("router: the first provider with room sends it, and the others are not touched", async () => {
  const brevo = fakeProvider("brevo", ["guest"], good("b1"));
  const mailjet = fakeProvider("mailjet", ["code", "guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 2, "mailjet:guest": 1 });
  const out = await routeEmail(row(), [brevo, mailjet], caps, newRouterState(), now);
  eq(out.final, "sent", "sent");
  eq(out.attempts.map((a) => [a.provider, a.status, a.message_id, a.cost_usd]), [["brevo", "sent", "b1", 0.001]], "one attempt, with id and cost");
  eq(mailjet.calls.length, 0, "mailjet untouched");
  eq(caps.used, { "brevo:guest": 1 }, "one unit spent");
});
await test("router: a full cap moves on to the next provider", async () => {
  const brevo = fakeProvider("brevo", ["guest"], good("b1"));
  const mailjet = fakeProvider("mailjet", ["code", "guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 1, "mailjet:guest": 1 });
  const first = await routeEmail(row({ id: "a" }), [brevo, mailjet], caps, newRouterState(), now);
  const second = await routeEmail(row({ id: "b" }), [brevo, mailjet], caps, newRouterState(), now);
  eq([first.attempts[0].provider, second.attempts[0].provider], ["brevo", "mailjet"], "brevo then mailjet");
  eq(brevo.calls, ["a"], "brevo was not asked once its cap was full");
  const third = await routeEmail(row({ id: "c" }), [brevo, mailjet], caps, newRouterState(), now);
  eq(third.final, "queued", "both full: wait");
});
await test("router: a provider error moves on, hands the unit back, and both attempts are logged", async () => {
  const brevo = fakeProvider("brevo", ["guest"], { ok: false, error: "503 from brevo" });
  const mailjet = fakeProvider("mailjet", ["guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 5, "mailjet:guest": 5 });
  const out = await routeEmail(row(), [brevo, mailjet], caps, newRouterState(), now);
  eq(out.final, "sent", "mailjet sent it");
  eq(out.attempts.map((a) => [a.provider, a.status, a.error]), [["brevo", "failed", "503 from brevo"], ["mailjet", "sent", null]], "two attempts");
  eq(caps.used, { "brevo:guest": 0, "mailjet:guest": 1 }, "brevo's unit was handed back");
});
await test("router: a provider that throws is treated as an error", async () => {
  const boom: EmailProvider = { name: "boom", kinds: ["guest"], async send() { throw new Error("network down"); } };
  const mailjet = fakeProvider("mailjet", ["guest"], good("m1"));
  const out = await routeEmail(row(), [boom, mailjet], memCaps({ "boom:guest": 1, "mailjet:guest": 1 }), newRouterState(), now);
  eq(out.attempts.map((a) => [a.provider, a.status, a.error]), [["boom", "failed", "network down"], ["mailjet", "sent", null]], "thrown error logged, next one used");
});
await test("router: a provider that says its limit is reached is left alone for the rest of the run and its unit is not handed back", async () => {
  const brevo = fakeProvider("brevo", ["guest"], { ok: false, error: "daily limit", limit: true });
  const mailjet = fakeProvider("mailjet", ["guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 50, "mailjet:guest": 50 });
  const state = newRouterState();
  await routeEmail(row({ id: "a" }), [brevo, mailjet], caps, state, now);
  await routeEmail(row({ id: "b" }), [brevo, mailjet], caps, state, now);
  eq(brevo.calls, ["a"], "brevo asked once, then skipped");
  eq(caps.used, { "brevo:guest": 1, "mailjet:guest": 2 }, "no give back for a limit");
  ok(!caps.log.includes("give brevo:guest"), "no give call");
});
await test("router: every provider full means wait 15 minutes without losing a try", async () => {
  const brevo = fakeProvider("brevo", ["guest"], good("b1"));
  const out = await routeEmail(row({ priority: 1, tries: 3 }), [brevo], memCaps({ "brevo:guest": 0 }), newRouterState(), now);
  ok(out.final === "queued", "queued");
  if (out.final === "queued") {
    eq(out.freeRetry, true, "free retry");
    eq(out.retryAt, new Date(NOW.getTime() + FULL_CAP_WAIT_MINUTES * 60_000).toISOString(), "15 minutes");
  }
  eq(out.attempts.map((a) => [a.provider, a.status]), [["router", "skipped"]], "a log note");
  eq(brevo.calls.length, 0, "nothing sent");
});
await test("router: errors everywhere retry later with a growing wait, and fail after the last try", async () => {
  const bad = (n: string) => fakeProvider(n, ["guest"], { ok: false, error: "nope" });
  const caps = memCaps({ "a:guest": 99, "b:guest": 99 });
  const one = await routeEmail(row({ tries: 1 }), [bad("a"), bad("b")], caps, newRouterState(), now);
  ok(one.final === "queued" && !one.freeRetry && one.retryAt === new Date(NOW.getTime() + 5 * 60_000).toISOString(), "try 1: back in 5 minutes");
  const three = await routeEmail(row({ tries: 3 }), [bad("a")], caps, newRouterState(), now);
  ok(three.final === "queued" && three.retryAt === new Date(NOW.getTime() + 20 * 60_000).toISOString(), "try 3: back in 20 minutes");
  const last = await routeEmail(row({ tries: MAX_TRIES }), [bad("a")], caps, newRouterState(), now);
  eq(last.final, "failed", "the last try fails it");
  eq(caps.used, { "a:guest": 0, "b:guest": 0 }, "every unit was handed back");
  eq([1, 2, 3, 4, 5, 6].map(retryDelayMinutes), [5, 10, 20, 40, 60, 60], "the wait grows to an hour");
});
await test("router: a message that can never go is failed at once and not tried elsewhere", async () => {
  const brevo = fakeProvider("brevo", ["guest"], { ok: false, error: "invalid address", retryable: false });
  const mailjet = fakeProvider("mailjet", ["guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 5, "mailjet:guest": 5 });
  const out = await routeEmail(row(), [brevo, mailjet], caps, newRouterState(), now);
  eq(out.final, "failed", "failed");
  eq(mailjet.calls.length, 0, "mailjet not asked");
  eq(caps.used, { "brevo:guest": 0 }, "the unit came back");
});
await test("router: a provider only serves the allowances it is for (codes never go through Brevo)", async () => {
  const brevo = fakeProvider("brevo", ["guest"], good("b1"));
  const mailtrap = fakeProvider("mailtrap", ["code"], good("t1"));
  const mailjet = fakeProvider("mailjet", ["code", "guest"], good("m1"));
  const caps = memCaps({ "brevo:guest": 5, "mailtrap:code": 1, "mailjet:code": 5, "mailjet:guest": 5 });
  const code = await routeEmail(row({ cap_kind: "code", priority: 1, kind: "sign_in_code" }), [brevo, mailtrap, mailjet], caps, newRouterState(), now);
  eq(code.attempts[0].provider, "mailtrap", "mailtrap first for a code");
  const code2 = await routeEmail(row({ cap_kind: "code", priority: 1 }), [brevo, mailtrap, mailjet], caps, newRouterState(), now);
  eq(code2.attempts[0].provider, "mailjet", "then mailjet once mailtrap is full");
  eq(brevo.calls.length, 0, "brevo never saw a code");
  const none = await routeEmail(row({ cap_kind: "code" }), [brevo], caps, newRouterState(), now);
  eq(none.final, "failed", "no provider for codes");
});
await test("router: no address is skipped, and WhatsApp is skipped with a clear reason", async () => {
  const brevo = fakeProvider("brevo", ["guest"], good("b1"));
  const noAddr = await routeEmail(row({ email: null }), [brevo], memCaps({ "brevo:guest": 1 }), newRouterState(), now);
  eq([noAddr.final, noAddr.attempts[0].error], ["skipped", "no email address"], "no address");
  const wa = await routeRow(row({ channel: "whatsapp", email: null, whatsapp_number: "+2348012345678" }), [brevo], memCaps({}), newRouterState(), now);
  eq(wa.final, "skipped", "skipped");
  eq(wa.attempts.map((a) => [a.channel, a.provider, a.status, a.error]), [["whatsapp", "none", "skipped", WHATSAPP_NOT_BUILT]], "with the reason");
  eq(brevo.calls.length, 0, "no email provider was asked");
  eq(skipWhatsApp(row({ channel: "whatsapp" })).final, "skipped", "skipWhatsApp");
});

// ------------------------------------------------------------------ the run loop ---
/** A stub of the SQL layer: hands out the rows it was given once, and records how each was settled. */
function stubDb(rows: ClaimedRow[], status: CapStatus[] = [], limits: Record<string, number> = { "log:guest": 1e9, "log:code": 1e9 }) {
  const caps = memCaps(limits);
  const settled: { id: string; outcome: RowOutcome }[] = [];
  const claims: { limit: number; providers: string[] }[] = [];
  let handed = false;
  const db: NotifyDb = {
    async enqueue() { return null; },
    async claim(limit, providers) {
      claims.push({ limit, providers });
      if (handed) return [];
      handed = true;
      return rows;
    },
    takeCap: (p, k) => caps.take(p, k),
    giveCap: (p, k) => caps.give(p, k),
    async complete(id, outcome) { settled.push({ id, outcome }); return true; },
    async capStatus() { return status; },
  };
  return { db, settled, claims, caps };
}

await test("run: claims with the provider names, routes each row, settles each once, and a WhatsApp row is skipped", async () => {
  const rows = [row({ id: "e1" }), row({ id: "w1", channel: "whatsapp", email: null, whatsapp_number: "+2348012345678" }), row({ id: "e2", email: null })];
  const { db, settled, claims } = stubDb(rows);
  const lines: string[] = [];
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], log: (l) => lines.push(l), now });
  eq(claims, [{ limit: 500, providers: ["log"] }], "one claim of up to 500, naming the providers it can use");
  eq(out, { claimed: 3, sent: 1, failed: 0, skipped: 2, requeued: 0, stuck: 0, warnings: [] }, "summary");
  eq(settled.map((s) => [s.id, s.outcome.final]).sort(), [["e1", "sent"], ["e2", "skipped"], ["w1", "skipped"]], "each row settled once");
  const wa = settled.find((s) => s.id === "w1")!.outcome;
  eq(wa.attempts[0].error, WHATSAPP_NOT_BUILT, "with the clear reason");
  ok(settled.find((s) => s.id === "e1")!.outcome.attempts[0].message_id?.startsWith("log_"), "the log provider's fake id is recorded");
});
await test("run: nothing due does nothing but read the caps", async () => {
  const { db, settled } = stubDb([]);
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], log: quiet });
  eq([out.claimed, settled.length], [0, 0], "nothing");
});
await test("run: the limit is capped at 500 and the 80 percent warning is reported", async () => {
  const status: CapStatus[] = [
    { provider: "brevo", kind: "guest", daily_cap: 300, used: 250, percent: 83.3 },
    { provider: "mailjet", kind: "guest", daily_cap: 100, used: 10, percent: 10 },
    { provider: "log", kind: "code", daily_cap: 0, used: 0, percent: null },
  ];
  const { db, claims } = stubDb([], status);
  const lines: string[] = [];
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], limit: 9999, log: (l) => lines.push(l) });
  eq(claims[0].limit, 500, "never more than 500");
  eq(out.warnings, ["brevo guest mail has used 250 of 300 today (83.3%)"], "one warning");
  ok(lines.some((l) => l.includes("brevo guest")), "and it is logged");
  eq(capWarnings(status, 5).length, 2, "a lower threshold finds more");
});
await test("run: a provider that throws on one row costs that row a retry and the others still go", async () => {
  const rows = [row({ id: "ok1" }), row({ id: "bad" }), row({ id: "ok2" })];
  const { db, settled } = stubDb(rows);
  const flaky: EmailProvider = {
    name: "log", kinds: ["guest", "code"],
    async send(msg) { if (msg.queueId === "bad") throw new TypeError("boom"); return good("x"); },
  };
  const out = await runNotify({ db, providers: [flaky], log: quiet, now });
  eq([out.sent, out.requeued], [2, 1], "two sent, one retried later");
  const bad = settled.find((s) => s.id === "bad")!.outcome;
  ok(bad.final === "queued" && !bad.freeRetry && bad.attempts[0].error === "boom", "retried later, and it costs a try");
});
await test("run: a database error on one row puts that row back untouched and carries on", async () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
  const s = stubDb(rows);
  let takes = 0;
  const db: NotifyDb = {
    ...s.db,
    takeCap: async (p, k) => {
      if (++takes === 2) throw new Error("db down");
      return s.caps.take(p, k);
    },
  };
  const lines: string[] = [];
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], concurrency: 1, log: (l) => lines.push(l), now });
  eq([out.sent, out.requeued], [2, 1], "two sent, one put back");
  ok(lines.some((l) => l.includes("db down")), "logged");
  const back = s.settled.find((x) => x.outcome.final === "queued")!;
  ok(back.outcome.final === "queued" && back.outcome.attempts.length === 0 && !back.outcome.freeRetry, "put back untouched, a try counted");
});
await test("run: out of time puts the unstarted rows back without costing a try", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ id: `r${i}` }));
  const { db, settled } = stubDb(rows);
  let t = 0;
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], concurrency: 2, budgetMs: 10, clock: () => (t += 6), log: quiet, now });
  eq([out.sent, out.requeued], [2, 3], "the first batch ran, the rest went back");
  const back = settled.filter((x) => x.outcome.final === "queued");
  ok(back.length === 3 && back.every((x) => x.outcome.final === "queued" && x.outcome.freeRetry), "free retries");
});
await test("run: sending to a full provider waits, and a spent cap is counted once per message", async () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
  const { db, settled, caps } = stubDb(rows, [], { "log:guest": 2 });
  const out = await runNotify({ db, providers: [createLogProvider(quiet)], concurrency: 1, log: quiet, now });
  eq([out.sent, out.requeued], [2, 1], "two sent, the third waits for the next day's allowance");
  eq(caps.used, { "log:guest": 2 }, "two units spent");
  const w = settled.find((x) => x.outcome.final === "queued")!.outcome;
  ok(w.final === "queued" && w.freeRetry, "and its wait is free");
});

// ------------------------------------------------------------------ provider list ---
await test("providers: none by default, log in fake mode, log refused in production, unknown names ignored", () => {
  const w: string[] = [];
  const warn = (l: string) => w.push(l);
  eq(buildProviders({}, warn).length, 0, "nothing configured");
  eq(buildProviders({ NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }, warn).map((p) => p.name), ["log"], "fake mode");
  eq(buildProviders({ NOTIFY_PROVIDERS: "log", NODE_ENV: "production" }, warn).length, 0, "log in production");
  ok(w.some((l) => l.includes("not allowed in production")), "and it says so");
  eq(buildProviders({ NOTIFY_PROVIDERS: "log", NODE_ENV: "production", NEXT_PUBLIC_EVENTS_R1_FAKE: "1" }, warn).map((p) => p.name), ["log"], "fake mode wins");
  eq(buildProviders({ NOTIFY_PROVIDERS: " Log , log,brevo" }, warn).map((p) => p.name), ["log"], "trimmed, de-duplicated, unknown ignored");
  ok(w.some((l) => l.includes('"brevo"')), "the unknown name is reported");
});

// ------------------------------------------------------------------ the route ---
const req = (headers: Record<string, string> = {}) => new Request("https://hoppaz.test/api/notify/run", { method: "POST", headers });
await test("gate: only the shared secret gets in", () => {
  const env = { NOTIFY_RUN_SECRET: "s3cret-test-value" };
  eq(runAllowed(req(), env), false, "no header");
  eq(runAllowed(req({ authorization: "Bearer nope" }), env), false, "wrong secret");
  eq(runAllowed(req({ authorization: "Bearer s3cret-test-value" }), env), true, "right secret");
  eq(runAllowed(req({ authorization: "bearer   s3cret-test-value " }), env), true, "case and spaces are forgiven");
  eq(runAllowed(req({ authorization: "Bearer s3cret-test-value" }), {}), false, "no secret set: nobody gets in");
  eq(runAllowed(req({ authorization: "Bearer " }), { NOTIFY_RUN_SECRET: "" }), false, "empty secret and empty bearer");
});
await test("route: 401 without the secret, 503 when not configured, 503 with no provider; nothing is claimed in any of them", async () => {
  const keep = { ...process.env };
  try {
    for (const k of ["NOTIFY_RUN_SECRET", "NOTIFY_PROVIDERS", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_EVENTS_R1_FAKE"]) delete process.env[k];
    eq((await route.POST(req())).status, 401, "no secret set, no header");
    process.env.NOTIFY_RUN_SECRET = "s3cret-test-value";
    eq((await route.POST(req({ authorization: "Bearer wrong" }))).status, 401, "wrong secret");
    eq((await route.POST(req({ authorization: "Bearer s3cret-test-value" }))).status, 503, "right secret, no database configured");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.SUPABASE_SECRET_KEY = "not-a-real-key";
    const res = await route.POST(req({ authorization: "Bearer s3cret-test-value" }));
    eq(res.status, 503, "right secret, no provider (no network call is made)");
    eq(((await res.json()) as { error: string }).error, "No email provider is configured", "and it says why");
    eq(res.headers.get("cache-control"), "no-store", "never cached");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
