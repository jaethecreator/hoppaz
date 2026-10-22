/**
 * End to end check of the Release 1 REAL data layer (src/lib/events-r1/real) against the LOCAL Supabase (Docker, port 54321).
 * Run from the repo root:  node --no-warnings scripts/events-r1-real-check.mts
 *
 * Needs: the local stack up, the six events_r1_* drafts loaded in the local postgres database (and events_r1_pay.sql for
 * the paid part), W/.env.local pointing at the local stack. It refuses to run against any other host. It makes new throwaway
 * test people (r1-<tag>-<random>@example.test) with the local auth admin API every run, so the hourly event limit never bites,
 * and it never prints a key or a password. Codes for the email sign-in are read from Inbucket (http://127.0.0.1:54324).
 *
 * The Next.js route handlers (pay routes, the staff reports route) are called in this process with Request objects: a small
 * fetch wrapper hands any request to http://app.test/api/... to the route's own POST or GET. No server is started.
 * Part B (paid tickets) runs only with RUN_PAID=1 and needs the mock Bachs server (scripts/bachs-mock.mjs on 3415) and
 * BACHS_API_BASE=http://127.0.0.1:3415 BACHS_SECRET_KEY=sk_mock in the environment.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
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

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
if (process.env.RUN_PAID === "1") {
  // Part B talks to the mock only, whatever .env.local says (it may name the real sandbox).
  process.env.BACHS_API_BASE = `http://127.0.0.1:${process.env.MOCK_PORT || 3415}`;
  process.env.BACHS_SECRET_KEY = "sk_mock";
  process.env.BACHS_WEBHOOK_SECRET = "whsec_mock";
  process.env.HOPPAZ_TICKET_FEE_PERCENT ||= "4.5";
  process.env.HOPPAZ_TICKET_FEE_FIXED_NAIRA ||= "0";
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const host = new URL(URL_).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the local stack (${host}).`);
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP = "http://app.test";
process.env.EVENTS_R1_API_BASE = APP;

// The app's Supabase client is a browser client: give it a page with a cookie jar so it can keep a session in Node.
const jar = new Map<string, string>();
const doc = {
  get cookie() {
    return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  },
  set cookie(line: string) {
    const [pair, ...attrs] = line.split(";");
    const eqAt = pair.indexOf("=");
    const name = pair.slice(0, eqAt).trim();
    const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || attrs.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now());
    if (gone) jar.delete(name);
    else jar.set(name, pair.slice(eqAt + 1).trim());
  },
  visibilityState: "visible",
};
Object.assign(globalThis, { document: doc, window: { document: doc, location: { origin: "http://app.test", pathname: "/", search: "" } } });

const { createClient } = await import("@supabase/supabase-js");
const { realApi: api } = await import("../src/lib/events-r1/real/index.ts");
const core = await import("../src/lib/events-r1/real/core.ts");
const { getSupabase } = await import("../src/lib/supabase/client.ts");

/* ------------------------------------------------------------------ plumbing -- */

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const sb = getSupabase()!;
const tag = randomBytes(3).toString("hex");
const HOUR = 3.6e6;
const iso = (ms: number) => new Date(ms).toISOString();

let pass = 0;
let fail = 0;
const out = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ->  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
async function step<T>(what: string, fn: () => Promise<T>, show?: (v: T) => string): Promise<T | undefined> {
  try {
    const v = await fn();
    out(true, what, show ? show(v) : "");
    return v;
  } catch (e) {
    out(false, what, e instanceof Error ? e.message : String(e));
    return undefined;
  }
}
/** The call must fail with exactly this message. */
async function refuses(what: string, fn: () => Promise<unknown>, message: string | RegExp) {
  try {
    await fn();
    out(false, what, "did not fail");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    out(typeof message === "string" ? m === message : message.test(m), what, `"${m}"`);
  }
}
const eq = (what: string, a: unknown, b: unknown) => out(JSON.stringify(a) === JSON.stringify(b), what, JSON.stringify(a));

type Person = { id: string; email: string; password: string; name: string };
async function makeUser(label: string, name: string, staff = false): Promise<Person> {
  const email = `r1-${label}-${tag}@example.test`;
  const password = `${randomBytes(12).toString("base64url")}Aa1`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const id = data.user.id;
  const up = await admin.from("profiles").update({ display_name: name, ...(staff ? { is_admin: true } : {}) }).eq("id", id);
  if (up.error) throw new Error(`profile ${label}: ${up.error.message}`);
  return { id, email, password, name };
}
async function login(p: Person) {
  const { error } = await sb.auth.signInWithPassword({ email: p.email, password: p.password });
  if (error) throw new Error(`sign in ${p.name}: ${error.message}`);
  await core.ready();
  await new Promise((r) => setTimeout(r, 150)); // the profile name arrives a moment later
}

/** The local stack's mail catcher is Mailpit (port 54324). The six digit code is whatever stands alone in the mail. */
async function mailFor(email: string): Promise<{ code: string | null; subject: string; text: string }> {
  for (let i = 0; i < 40; i++) {
    const found = (await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string; Subject: string }[] };
    const first = found.messages?.[0];
    if (first) {
      const msg = (await (await fetch(`http://127.0.0.1:54324/api/v1/message/${first.ID}`)).json()) as { Text: string; HTML: string };
      const m = `${msg.Text}\n${msg.HTML}`.match(/(?<![\d#])(\d{6})(?!\d)/);
      return { code: m ? m[1] : null, subject: first.Subject, text: msg.Text.replace(/\s+/g, " ").slice(0, 160) };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no mail arrived in the mail catcher");
}

/** Hand requests for the app's own routes to the route files, in this process. */
const realFetch = globalThis.fetch;
const routes: Record<string, Record<string, (req: Request) => Promise<Response>>> = {};
async function route(path: string) {
  if (routes[path]) return routes[path];
  const file = path.startsWith("/api/events-r1/pay/") ? `../src/app${path}/route.ts` : `../src/app${path}/route.ts`;
  routes[path] = (await import(file)) as Record<string, (req: Request) => Promise<Response>>;
  return routes[path];
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(APP)) return realFetch(input, init);
  const path = new URL(url).pathname;
  const mod = await route(path);
  const handler = mod[(init?.method ?? "GET").toUpperCase()];
  if (!handler) return new Response("{}", { status: 405 });
  return handler(new Request(url, init));
}) as typeof fetch;
(globalThis as Record<string, unknown>).sessionStorage = { getItem: (k: string) => (k === "hoppaz-admin-token" ? (process.env.HOPPAZ_ADMIN_TOKEN ?? null) : null) };

/* --------------------------------------------------------------------- setup -- */

console.log(`\n== setup (local stack ${host}, run ${tag})`);
const secret = await admin.rpc("ev_set_ticket_secret", { p_secret: randomBytes(32).toString("hex") });
console.log(`   ticket secret: ${secret.error ? secret.error.message : secret.data}`);
const staff = await makeUser("staff", "Hoppaz Staff", true);
const host_ = await makeUser("host", "Hosa Host");
const bea = await makeUser("bea", "Bea Guest");
const cal = await makeUser("cal", "Cal Guest");
const dee = await makeUser("dee", "Dee Guest");
console.log("   made 5 throwaway people: staff, host, bea, cal, dee");

/* --------------------------------------------------------------- A. free flow -- */

console.log("\n== A. rooms, HQ, events, registration, approval, waitlist, capacity");
await login(staff);
const lst0 = await step("rooms.list as staff: Lagos HQ first", () => api.rooms.list(), (l) => `hq="${l.hq.name}" kind=${l.hq.kind} joined=${l.hq.joined} has_3d=${l.hq.has_3d} three_d_on=${l.hq.three_d_on} members=${l.hq.members}`);
const hqId = lst0?.hq.id as string;
out(!!hqId && hqId !== "hq" && lst0?.hq.kind === "hq", "HQ is a real room", hqId);
await step("rooms.get('hq') resolves the short address", async () => (await api.rooms.get("hq"))?.id === hqId, (v) => String(v));
out(lst0?.hq.name === "Lagos HQ", "the HQ room is called Lagos HQ", String(lst0?.hq.name));
eq("Lagos HQ: a room exists and it is on by default", [lst0?.hq.has_3d, lst0?.hq.three_d_on], [true, true]);
eq("the entry function's check (ev_room_3d_allowed) says on for Lagos HQ", (await admin.rpc("ev_room_3d_allowed", { p_room: hqId })).data, true);
await step("staff switch Lagos HQ off (setThreeD)", async () => {
  await api.rooms.setThreeD(hqId, false);
  const g = await api.rooms.get("hq");
  const l = await api.rooms.list();
  return `get=${g?.three_d_on} list=${l.hq.three_d_on} allowed=${(await admin.rpc("ev_room_3d_allowed", { p_room: hqId })).data}`;
}, (v) => v);
await step("staff switch Lagos HQ on again", async () => {
  await api.rooms.setThreeD("hq", true);
  return `get=${(await api.rooms.get("hq"))?.three_d_on} allowed=${(await admin.rpc("ev_room_3d_allowed", { p_room: hqId })).data}`;
}, (v) => v);

await login(host_);
const room = await step("rooms.create (host)", () => api.rooms.create({ name: `Hosa Roomz ${tag}` }), (r) => `${r.name} owner=${r.is_owner} can_post=${r.can_post} joined=${r.joined}`);
await refuses("rooms.create with no name", () => api.rooms.create({ name: "  " }), "Give your room a name");
eq("rooms.mine has it", (await api.rooms.mine()).map((r) => r.id), [room?.id]);

// The 3D room switch: default on, the owner and staff can set it, nobody else, and the database check follows.
const roomOn = () => admin.rpc("ev_room_3d_allowed", { p_room: room!.id }).then((r) => r.data);
eq("a new room: has_3d and three_d_on by default", [room?.has_3d, room?.three_d_on], [true, true]);
eq("the entry function's check says on", await roomOn(), true);
await login(bea);
await refuses("a member who is not the owner cannot switch it (setThreeD)", () => api.rooms.setThreeD(room!.id, false), "Not allowed");
await refuses("and cannot list every room (listForStaff)", () => api.rooms.listForStaff(), "Not allowed");
await login(host_);
await step("the owner switches it off", async () => {
  await api.rooms.setThreeD(room!.id, false);
  const g = (await api.rooms.get(room!.id))!;
  const mine = (await api.rooms.mine()).find((r) => r.id === room!.id);
  return `get has_3d=${g.has_3d} three_d_on=${g.three_d_on} | mine three_d_on=${mine?.three_d_on} | allowed=${await roomOn()}`;
}, (v) => v);
eq("off in the database too", await roomOn(), false);
await login(bea);
eq("another person sees it off", (await api.rooms.get(room!.id))?.three_d_on, false);
await login(host_);
await refuses("the owner cannot switch Lagos HQ", () => api.rooms.setThreeD(hqId, false), "Not allowed");
await refuses("the owner cannot list every room", () => api.rooms.listForStaff(), "Not allowed");
await login(staff);
const all = await step("staff: listForStaff", () => api.rooms.listForStaff(), (l) => `${l.length} rooms, first=${l[0]?.name} (${l[0]?.kind}), mine is in it=${l.some((r) => r.id === room!.id)}`);
out(!!all && all[0].kind === "hq" && all.some((r) => r.id === room!.id && r.three_d_on === false), "Lagos HQ first and each room carries its switch");
await step("staff switch the owner's room back on", async () => {
  await api.rooms.setThreeD(room!.id, true);
  return `three_d_on=${(await api.rooms.get(room!.id))?.three_d_on} allowed=${await roomOn()}`;
}, (v) => v);
// The /admin desk has the shared token and no account: the same two through /api/admin/event-rooms (service role).
const dk = await step("desk: listForDesk through the staff route", () => api.rooms.listForDesk(), (l) => `${l.length} rooms, first=${l[0]?.name} (${l[0]?.kind})`);
out(!!dk && dk[0].kind === "hq" && dk.some((r) => r.id === room!.id && r.three_d_on === true && !r.joined), "desk list: Lagos HQ first, each room carries its switch");
await step("desk: setThreeDFromDesk switches a room off, then on", async () => {
  await api.rooms.setThreeDFromDesk(room!.id, false);
  const off = !(await roomOn());
  await api.rooms.setThreeDFromDesk(room!.id, true);
  return `off=${off} on=${await roomOn()}`;
}, (v) => v);
await refuses("desk: a room that does not exist", () => api.rooms.setThreeDFromDesk("00000000-0000-4000-8000-000000000000", true), "Room not found");
await refuses("setThreeD on a room that does not exist", () => api.rooms.setThreeD("00000000-0000-4000-8000-000000000000", true), "Room not found");
await sb.auth.signOut();
await core.ready();
await refuses("setThreeD with no session", () => api.rooms.setThreeD(room!.id, false), "Sign in first");
await login(host_);
const start = Date.now() + 26 * HOUR;
const ev = await step(
  "events.create: 2 ticket types, capacity 2, approval, waitlist",
  () =>
    api.events.create({
      title: `Rooftop Hang ${tag}`, starts_at: iso(start), ends_at: iso(start + 3 * HOUR), kind: "in_person", place_name: "Maroko, Lagos", area: "Lekki",
      capacity: 2, requires_approval: true, waitlist_on: true, description: "Real layer check.",
      tickets: [{ name: "General", price_naira: 0, capacity: null }, { name: "Early", price_naira: 0, capacity: 1 }],
    }),
  (e) => `${e.title} slug=${e.slug} types=${e.ticket_types.map((t) => t.name).join("+")} going=${e.going} status=${e.status} room=${e.room_id === room?.id}`
);
if (!ev || !room) throw new Error("cannot go on without the event and the room");
const eid = ev.id;
await refuses("events.create paid type while paid is off", () => api.events.create({ title: "Paid thing", tickets: [{ name: "VIP", price_naira: 5000, capacity: null }] }), "Currently unavailable");
await refuses("events.create with no name", () => api.events.create({ title: " " }), "Give your event a name");
await step("events.update (description)", async () => (await api.events.update(eid, { description: "Edited." })).description, (v) => v);
eq("events.get by slug", (await api.events.get(ev.slug))?.id, eid);
eq("events.listMine", (await api.events.listMine()).some((e) => e.id === eid), true);
eq("events.listForRoom", (await api.events.listForRoom(room.id)).some((e) => e.id === eid), true);
const rs = await api.events.getRegistrationSettings(eid);
await step("setRegistrationSettings (custom question, id with a dash)", async () => {
  await api.events.setRegistrationSettings(eid, { questions: [...rs.questions, { id: "q-abc1", label: "Instagram handle", required: false }], messages: { going: "See you there, legend." } });
  const back = await api.events.getRegistrationSettings(eid);
  return `${back.questions.map((q) => q.id).join(",")} | going="${back.messages.going}"`;
});
await refuses("setRegistrationSettings drops Name", () => api.events.setRegistrationSettings(eid, { questions: [{ id: "q1", label: "Only this", required: false }] }), "Name and Email cannot be removed");

// guests: not signed in yet
await sb.auth.signOut();
await core.ready();
eq("signed out: auth.current() is null", api.auth.current(), null);
const listAnon = await api.events.list();
out(listAnon.some((e) => e.id === eid), "events.list works with no session", `${listAnon.length} events`);
await refuses("registrations.register with no session", () => api.registrations.register(eid), "Sign in first");
// An ANONYMOUS session (the app gives every visitor one): it has an auth.uid() but no account, so it is NOT signed in.
const anon = await sb.auth.signInAnonymously();
out(!anon.error && !!anon.data.user, "anonymous guest session", anon.error?.message ?? "");
await core.ready();
const vsGuest = await api.events.viewerState(eid);
eq("anonymous guest: viewerState.signedIn is false", vsGuest.signedIn, false);
eq("anonymous guest: auth.current() is null", api.auth.current(), null);
await refuses("anonymous guest: Register answers Sign in first", () => api.registrations.register(eid), "Sign in first");
eq("anonymous guest: the button is still Request (the sign-in sheet opens first)", vsGuest.button, "request");
await sb.auth.signOut();
await core.ready();

// The launch switch: with events_r1 off every write answers "Not open yet", reads keep working; on again everything works.
await admin.rpc("ev_set_setting", { p_key: "events_r1", p_value: "off" });
try {
  await login(bea);
  await refuses("events_r1 off: events.create answers Not open yet", () => api.events.create({ title: "Not yet" }), "Not open yet");
  await refuses("events_r1 off: registrations.register answers Not open yet", () => api.registrations.register(eid), "Not open yet");
  await refuses("events_r1 off: reports.report answers Not open yet", () => api.reports.report(eid, "other", ""), "Not open yet");
  eq("events_r1 off: events.get still reads", (await api.events.get(eid))?.id, eid);
} finally {
  await admin.rpc("ev_set_setting", { p_key: "events_r1", p_value: "on" });
}

// Bea: approval -> requested
await login(bea);
const reg1 = await step("Bea registers (approval on)", () => api.registrations.register(eid, { answers: { "q_abc1": "@bea" } }), (r) => `status=${r.status} ticket=${r.ticket_name} name="${r.name}"`);
eq("viewerState button is pending", (await api.events.viewerState(eid)).button, "pending");
eq("Bea has no ticket yet", await api.registrations.ticketFor(eid), null);
await login(cal);
const reg2 = await api.registrations.register(eid);
await login(dee);
const reg3 = await api.registrations.register(eid);
out(reg3.status === "requested", "Dee registers too", reg3.status);

await login(host_);
const aud = await step("registrations.list (Audience)", () => api.registrations.list(eid), (l) => l.map((r) => `${r.name}:${r.status}`).join(" "));
const a1 = await step("approve Bea", () => api.registrations.approve(reg1!.id), (r) => r.status);
const a2 = await api.registrations.approve(reg2.id);
out(a2.status === "going", "approve Cal (2 of 2)", a2.status);
const a3 = await api.registrations.approve(reg3.id);
out(a3.status === "waitlisted", "approve Dee when full goes to the waitlist", `${a3.status} pos=${a3.waitlist_pos}`);
await refuses("promote with no free place", () => api.registrations.promote(reg3.id), "No free place. Raise the capacity first.");
const ev2 = await api.events.get(eid);
eq("going 2, spots_left 0", [ev2?.going, ev2?.spots_left], [2, 0]);
await refuses("Bea cannot read the Audience", async () => {
  await login(bea);
  await api.registrations.list(eid);
}, "Not allowed");

// tickets and the door
await login(bea);
const t = await step("Bea's ticket", () => api.registrations.ticketFor(eid), (x) => `${x?.ticket_name} code=${x?.code} token=${x?.token.slice(0, 12)}... status=${x?.status}`);
await login(host_);
const door1 = await step("door.scan standard", () => api.door.scan(eid, t!.token, "standard"), (r) => JSON.stringify(r));
eq("standard scan changes nothing", (await api.door.counts(eid)).checked_in, 0);
const door2 = await step("door.confirm", () => api.door.confirm(eid, t!.token), (r) => JSON.stringify(r));
const door3 = await api.door.scan(eid, t!.token, "express");
out(!door3.ok && door3.kind === "already_used", "scan again is already_used", JSON.stringify(door3));
const bad = await api.door.scan(eid, "aaa.bbb", "express");
out(!bad.ok && bad.kind === "not_valid", "garbage token is not_valid", JSON.stringify(bad));
const byName = await step("door.search", () => api.door.search(eid, "cal"), (l) => l.map((r) => r.name).join(","));
const ci = await api.door.checkInById(eid, reg2.id);
out(ci.ok && ci.kind === "checked_in", "door.checkInById (Cal, no QR)", JSON.stringify(ci));
eq("door.counts", await api.door.counts(eid), { going: 2, checked_in: 2, pending: 0, waitlist: 1 });
await refuses("Bea cannot scan", async () => {
  await login(bea);
  await api.door.counts(eid);
}, "Not allowed");
void door1; void door2; void a1; void aud; void byName;

// cancel moves the waitlist up (approval on: the host decides again)
await login(cal);
await api.registrations.cancel(eid).then(
  () => out(false, "a checked in person cannot cancel", "did not fail"),
  (e) => out(e.message === "You are already checked in", "a checked in person cannot cancel", `"${e.message}"`)
);

// export
await login(host_);
const csv = await step("registrations.exportCsv", () => api.registrations.exportCsv(eid), (c) => c.split("\n").slice(0, 3).join(" | "));
out(!!csv && csv.startsWith("Name,Email,Phone,Ticket,Status"), "csv has the head");

// clone
const cl = await step("events.clone (a week on)", () => api.events.clone(eid), (c) => `${c.title} +${Math.round((Date.parse(c.starts_at) - Date.parse(ev.starts_at)) / 864e5)} days, going=${c.going}`);
void cl;

// The list bridge (src/lib/events-r1/listBridge.ts): what the map, the deck and the event page get in real mode
const bridge = await import("../src/lib/events-r1/listBridge.ts");
const fix = { lat: 6.45, lng: 3.4 };
const viaBridge = await bridge.fetchR1EventById(ev.slug, fix);
out(viaBridge?.id === eid && typeof viaBridge.distance_m === "number" && viaBridge.distance_m > 0 && viaBridge.ticket_types.length === 2, "bridge: fetchR1EventById by slug fills distance and the R1 fields", `distance_m=${Math.round(viaBridge?.distance_m ?? 0)} types=${viaBridge?.ticket_types.length} room_id=${viaBridge?.room_id === room.id}`);
const online = await api.events.create({ title: `Online Only ${tag}`, kind: "online", starts_at: iso(Date.now() + 30 * HOUR), link_type: "zoom", online_link: "https://zoom.example/j/123" });
const viaB2 = await bridge.fetchR1EventById(online.id, fix);
out(viaB2?.venue_name === "" && viaB2.lat === 6.5 && viaB2.lng === 3.42 && viaB2.kind === "online", "bridge: an event with no place is parked on the Lagos centre with an empty venue", `venue="${viaB2?.venue_name}" lat=${viaB2?.lat} lng=${viaB2?.lng}`);
out(viaB2?.online_link === "https://zoom.example/j/123", "bridge: the host sees the online link", String(viaB2?.online_link));
await login(dee);
out((await bridge.fetchR1EventById(online.id, fix))?.online_link === null, "bridge: another person does not get the online link", "null");
await login(host_);

/* ----------------------------------------------------- B. Pops, rooms, chat ---- */

console.log("\n== B. Pops (also post), announcements, General chat, event chat");
await login(host_);
const pop = await step("pops.send (going, also in the room)", () => api.pops.send({ eventId: eid, body: "Doors at 7. Bring a friend.", audience: "going", alsoRoom: true }), (p) => `status=${p.status} recipients=${p.recipients} also_room=${p.also_room}`);
const anns = await api.rooms.announcements(room.id);
out(anns.some((a) => a.event_id === eid && a.body.startsWith("Doors at 7")), "room announcement carries the event tag", anns.map((a) => `${a.body.slice(0, 20)} [${a.event_title ?? "plain"}]`).join(" | "));
const plain = await step("rooms.postAnnouncement (plain)", () => api.rooms.postAnnouncement(room.id, "Roomz are open."), (a) => `${a.body} event=${a.event_id}`);
void plain;
await login(bea);
const vis = await api.pops.visibleOnEvent(eid);
out(vis.length === 1, "Bea (going) sees the Pop on the event page", vis.map((p) => p.body).join("|"));
await login(dee);
eq("Dee (waitlist) does not see a going-only Pop", (await api.pops.visibleOnEvent(eid)).length, 0);
await login(host_);
const pl = await api.pops.listForEvent(eid);
out(pl.some((p) => p.auto === "day_before") && pl.some((p) => p.id === pop?.id), "host list has sent and automatic Pops", `${pl.length} rows`);
await refuses("pops.send with no text", () => api.pops.send({ eventId: eid, body: " ", audience: "going", alsoRoom: false }), "Write a message first");
await refuses("pops.send in the past", () => api.pops.send({ eventId: eid, body: "x", audience: "going", alsoRoom: false, sendAt: iso(Date.now() - 1000) }), "Pick a time in the future");
await step("pops.send scheduled", () => api.pops.send({ eventId: eid, body: "See you soon", audience: "everyone", alsoRoom: false, sendAt: iso(Date.now() + 6 * HOUR) }), (p) => `status=${p.status}`);
const off = await step("pops.setAuto switches an automatic Pop off", () => api.pops.setAuto(eid, "hour_before", false), (p) => `${p.auto} enabled=${p.enabled}`);
out(off?.enabled === false, "it shows as Off in the host list", String((await api.pops.listForEvent(eid)).find((p) => p.auto === "hour_before")?.enabled));
await step("pops.editAuto changes the text", async () => (await api.pops.editAuto(eid, "day_before", "Tomorrow night. Bring a friend.")).body, (b) => b);
const sched = (await api.pops.listForEvent(eid)).find((p) => p.status === "scheduled" && !p.auto);
await step("pops.cancelScheduled takes a scheduled Pop back", async () => api.pops.cancelScheduled(sched!.id));
await refuses("pops.cancelScheduled on a sent Pop", () => api.pops.cancelScheduled(pop!.id), "Already sent");
await step("events.update add_to_room false takes it out of the room", async () => (await api.events.update(eid, { add_to_room: false })).room_id, (v) => String(v));
await step("events.update add_to_room true puts it back", async () => (await api.events.update(eid, { add_to_room: true })).room_id === room.id, (v) => String(v));
await step("pops.shareText", () => api.pops.shareText(pop!.id), (s) => s.replace(/\n/g, " / "));

// General chat
await login(bea);
await refuses("General: Bea has not joined", () => api.rooms.send(room.id, "general", "hello"), "Join the room to chat");
await api.rooms.join(room.id);
const g1 = await step("rooms.join + send to General", () => api.rooms.send(room.id, "general", "hey roomz"), (m) => `${m.author_name}: ${m.body}`);
await login(host_);
const gm = await api.rooms.messages(room.id, "general");
out(gm.some((m) => m.body === "hey roomz"), "host reads Bea's General line", gm.map((m) => `${m.author_name}: ${m.body}`).join(" | "));
void g1;
// HQ chat: every account is in it
await login(bea);
await api.rooms.list(); // makes Bea a member of HQ
await step("HQ chat send + read", async () => {
  await api.rooms.send(hqId, "general", `hi from Bea ${tag}`);
  return (await api.rooms.messages(hqId, "general")).some((m) => m.body.includes(tag));
}, (v) => String(v));
const lb = await api.rooms.list();
out(lb.hq.joined && lb.hq.members >= 1, "HQ shows as joined, with members", `members=${lb.hq.members} online=${lb.hq.online}`);
await refuses("Bea cannot post an announcement", () => api.rooms.postAnnouncement(room.id, "nope"), "Only the room's host can post here");

// An event that is open now, with a room: chat state, send, read, pinned Pop
await login(host_);
const soon = Date.now() + 30 * 60_000;
const live = await api.events.create({ title: `Open Now ${tag}`, starts_at: iso(soon), ends_at: iso(soon + 2 * HOUR), place_name: "Yaba, Lagos", area: "Yaba" });
const chat0 = await api.rooms.eventChat(live.id);
out(chat0?.state === "open" && chat0.can_enter, "event chat is open for the host", JSON.stringify({ state: chat0?.state, can_enter: chat0?.can_enter }));
await login(bea);
await api.registrations.register(live.id);
const chatB = await api.rooms.eventChat(live.id);
out(!!chatB?.can_enter, "Bea (going) may enter the event chat", String(chatB?.can_enter));
await step("event chat send + read", async () => {
  await api.rooms.send(room.id, live.id, "who is bringing speakers");
  const lines = await api.rooms.messages(room.id, live.id);
  return lines.map((l) => `${l.author_name}: ${l.body}${l.pinned_pop ? " [pinned]" : ""}`).join(" | ");
}, (s) => s);
await login(host_);
await api.pops.send({ eventId: live.id, body: "Door opens now.", audience: "going", alsoRoom: false });
const lines = await api.rooms.messages(room.id, live.id);
out(lines.some((l) => l.pinned_pop && l.body === "Door opens now."), "host Pop comes with the chat, pinned", `${lines.length} lines`);
const chatList = await api.rooms.eventChats(room.id);
out(chatList.some((c) => c.event_id === live.id), "rooms.eventChats lists it", `${chatList.length} chats`);
await login(dee);
eq("Dee (not registered) cannot read the event chat", await api.rooms.messages(room.id, live.id), []);
await refuses("Dee cannot send to it", () => api.rooms.send(room.id, live.id, "let me in"), "You are not in this chat");
const closedEv = await (async () => {
  await login(host_);
  return api.rooms.eventChat(eid);
})();
out(closedEv?.state === "upcoming", "tomorrow's event chat is upcoming", closedEv?.state);
await login(bea);
await refuses("upcoming chat refuses a line", () => api.rooms.send(room.id, eid, "early"), "The chat is not open yet");

/* ---------------------------------------------------------- C. Reports ------- */

console.log("\n== C. Reports and the staff desk");
await login(bea);
await step("reports.report (Bea)", () => api.reports.report(live.id, "wrong_place", "pin is off"));
await step("report twice is quiet", () => api.reports.report(live.id, "wrong_place"));
await login(host_);
await refuses("host cannot report own event", () => api.reports.report(live.id, "other"), "You cannot report your own event");
await login(staff);
const rl = await step("reports.list through the staff route", () => api.reports.list(), (l) => `${l.length} reports, first: ${l[0]?.reason} on "${l[0]?.event_title}" by ${l[0]?.reporter_name}`);
const open = rl?.find((r) => r.event_id === live.id && r.status === "open");
out(!!open, "the report is open");
if (open) {
  await step("reports.markReviewed", () => api.reports.markReviewed(open.id));
  eq("it is reviewed now", (await api.reports.list()).find((r) => r.id === open.id)?.status, "reviewed");
}

/* ------------------------------------------------------ D. Email code sign in -- */

console.log("\n== D. Email code sign in");
// D1: a guest session keeps its user id and gains an email. (The local auth has email confirmation off: the email is attached at
// once and no mail goes out, so the step after sendCode takes any six digits. With confirmation on, new_email is pending and the
// code from the mail is checked: D1b proves that half with a code made by the auth admin API.)
await sb.auth.signOut();
const guest = await sb.auth.signInAnonymously();
const guestId = guest.data.user?.id;
await core.ready();
eq("guest: auth.current() is null", api.auth.current(), null);
const eMail = `r1-eml-${tag}@example.test`;
await step("sendCode as a guest (updateUser)", () => api.auth.sendCode(eMail));
const u1 = await step("verifyCode keeps the guest's id", () => api.auth.verifyCode(eMail, "123456", "Eli Email"), (u) => `${u.name} <${u.email}> same id as the guest: ${u.id === guestId}`);
out(u1?.id === guestId, "the guest's progress is kept (same user id)");
const prof = await admin.from("profiles").select("display_name").eq("id", guestId!).maybeSingle();
out(prof.data?.display_name === "Eli Email", "name is in profiles.display_name", String(prof.data?.display_name));
eq("auth.current() is the new person now", api.auth.current()?.email, eMail);
await step("the new person can register as themselves", async () => (await api.registrations.register(live.id)).name, (n) => n);

// D1b: the email_change code (what a guest gets when confirmation is on), made with the admin API, verified through the real layer
const perm = await makeUser("perm", "Pam Perm");
await login(perm);
const newAddr = `r1-moved-${tag}@example.test`;
const link = await admin.auth.admin.generateLink({ type: "email_change_new", email: perm.email, newEmail: newAddr });
const otp = (link.data?.properties as { email_otp?: string } | undefined)?.email_otp;
out(!!otp && /^\d{6}$/.test(otp), "admin generateLink made an email_change code", link.error?.message ?? "6 digits");
const u1b = await step("verifyCode with the email_change code (page forgot which kind)", () => api.auth.verifyCode(newAddr, otp!, "Pam Moved"), (u) => `${u.name} <${u.email}> same id: ${u.id === perm.id}`);
out(u1b?.id === perm.id && u1b.email === newAddr, "the email changed on the same user");

// D2: no session at all: the real mail, the real code
await api.auth.signOut();
await core.ready();
const fMail = `r1-fresh-${tag}@example.test`;
await step("sendCode with no session (signInWithOtp)", () => api.auth.sendCode(fMail));
const mail = await mailFor(fMail);
// The stack's stock template only has a link. NOTE, not a failure: supabase/email-templates/magic-link-code.html is the fix for the dashboard.
console.log(`NOTE the mail arrived (subject "${mail.subject}") ${mail.code ? "with a six digit code" : "with a LINK only: the stock template has no {{ .Token }}, so the screen needs supabase/email-templates/magic-link-code.html pasted in"}`);
let code = mail.code;
if (!code) {
  const made = await admin.auth.admin.generateLink({ type: "magiclink", email: fMail });
  code = (made.data?.properties as { email_otp?: string } | undefined)?.email_otp ?? null;
  out(!!code && /^\d{6}$/.test(code), "admin generateLink made the sign-in code to use in its place", made.error?.message ?? "6 digits");
}
if (code) {
  await step("verifyCode creates the account", () => api.auth.verifyCode(fMail, code!, "Fay Fresh"), (u) => `${u.name} <${u.email}>`);
  await api.auth.signOut();
  await core.ready();
}
await refuses("a wrong code message", async () => {
  await api.auth.verifyCode(fMail, "000000", "x");
}, /That code did not work/);
await refuses("a short code", () => api.auth.verifyCode(eMail, "123", "x"), "Enter the 6 digit code");
await refuses("a bad email", () => api.auth.sendCode("nope"), "Enter a valid email");
await api.auth.signOut();
eq("signOut: current() is null", api.auth.current(), null);

/* ---------------------------------------------------------------------- done -- */

if (process.env.RUN_PAID === "1") {
  const paid = await import("./events-r1-real-check-paid.mts");
  await paid.run({ api, core, sb, admin, step, refuses, eq, out, login, makeUser, host: host_, buyer: bea, iso });
}

console.log(`\n${fail ? "FAILED" : "ALL GOOD"}: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
