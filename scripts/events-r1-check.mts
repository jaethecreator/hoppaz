/**
 * Plain checks for the Release 1 fake data layer (src/lib/events-r1/fake). No test framework.
 * Run from the repo root:  node --no-warnings scripts/events-r1-check.mts
 * (Node strips the types itself; tsx is not installed here. A small resolve hook below lets the extensionless
 * imports of the app source load under Node.)
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { fakeApi: api, fakeDev } = await import("../src/lib/events-r1/fake/index.ts");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 60_000;
const HOUR = 60 * MIN;

let pass = 0;
let fail = 0;

function eq(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
}
async function rejects(p: Promise<unknown>, message: string, what: string) {
  try {
    await p;
  } catch (e) {
    eq((e as Error).message, message, what);
    return;
  }
  throw new Error(`${what}: expected it to throw "${message}"`);
}

/** Every test starts from a fresh seed, signed out, real time. */
async function test(name: string, fn: () => Promise<void>) {
  fakeDev.resetAll();
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------ helpers -- */

const user = (name: string) => {
  const u = fakeDev.users().find((x) => x.name === name);
  if (!u) throw new Error(`no seed user ${name}`);
  return u;
};
const as = (name: string) => fakeDev.signInAs(user(name).id);
let n = 0;
/** A new person, signed in. */
async function newPerson() {
  const email = `tester${++n}@example.com`;
  await api.auth.sendCode(email);
  return api.auth.verifyCode(email, "123456", `Tester ${n}`);
}
const seeded = (title: string) => {
  const e = fakeDev.allEvents().find((x) => x.title === title);
  if (!e) throw new Error(`no seed event ${title}`);
  return e;
};
/** Kredete makes a small event and stays signed in as that host. */
async function kredeteEvent(extra: Record<string, unknown> = {}) {
  as("Kredete");
  return api.events.create({ title: `Check ${++n}`, ...extra });
}
const tamper = (token: string) => {
  const [body, sig] = token.split(".");
  return `${body}.${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`;
};

/* -------------------------------------------------------------- tests -- */

await test("seed: events, UUID ids, brand vibes, Lagos box, each link type, hybrid, paid, ended, cancelled", async () => {
  const all = fakeDev.allEvents();
  ok(all.length >= 18, `events: ${all.length}`);
  for (const e of all) {
    ok(UUID.test(e.id), `uuid ${e.id}`);
    ok(e.lat >= 6.3 && e.lat <= 6.8 && e.lng >= 3.05 && e.lng <= 3.95, `inside Lagos ${e.title}`);
    ok(["afro", "amapiano", "rave", "techno", "live band", "comedy", "beach", "rooftop", "food", "culture", "tech"].includes(e.vibe), `vibe ${e.vibe}`);
    eq(e.flyer_url, null, "no flyer");
  }
  const types = new Set(all.map((e) => e.link_type));
  for (const t of ["zoom", "meet", "whatsapp", "other"]) ok(types.has(t as never), `link type ${t}`);
  ok(all.some((e) => e.kind === "hybrid" && e.venue_name && e.link_type), "a hybrid has a place and a link");
  ok(all.some((e) => e.status === "cancelled"), "a cancelled event");
  ok(all.some((e) => e.status === "ended"), "an ended event");
  ok(all.filter((e) => e.kind === "online").every((e) => e.venue_name === "" && e.lat === 6.5 && e.lng === 3.42), "online events sit at LAGOS_CENTER, no venue");
  eq(seeded("Afro Beach Day Party").price_naira, 3000, "paid price");
  const soon = seeded("Hoppaz Host Q&A");
  const mins = (Date.parse(soon.starts_at) - Date.now()) / MIN;
  ok(mins > 38 && mins < 41, `an online event starts in about 40 minutes (${mins.toFixed(1)})`);
  const regs = await (async () => {
    as("Lagos Run Club");
    return api.registrations.list(seeded("Lagos Run Club 5K Social Run").id);
  })();
  ok(regs.length >= 30, "an audience of 30 or more");
});

await test("list: no invite, no cancelled, ended 2 hours ago still shown, community hidden from outsiders", async () => {
  const titles = (await api.events.list()).map((e) => e.title);
  ok(titles.includes("Highlife Live Band Night"), "ended 2 h ago is in the list window");
  ok(!titles.includes("Warehouse Techno Night"), "cancelled is not listed");
  ok(!titles.includes("Kredete Private Listening Dinner"), "invite only is never listed");
  ok(!titles.includes("Rooftop Sessions Members Night"), "community is hidden from a signed-out viewer");
  ok(titles.includes("Hoppaz Welcome Hop"), "a public event is listed");
});

await test("capacity counts going only; full with waitlist; a cancel promotes the next person", async () => {
  const ev = seeded("Kredete Open Mic and Laughs");
  eq([ev.going, ev.spots_left, ev.capacity], [9, 1, 10], "near capacity");
  const a = await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "register", "button before");
  eq((await api.registrations.register(ev.id)).status, "going", "last place");
  eq((await api.events.viewerState(ev.id)).button, "going", "button after");
  const b = await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "waitlist", "button when full");
  const rb = await api.registrations.register(ev.id);
  eq([rb.status, rb.waitlist_pos], ["waitlisted", 1], "b waitlisted first");
  await newPerson();
  const rc = await api.registrations.register(ev.id);
  eq([rc.status, rc.waitlist_pos], ["waitlisted", 2], "c waitlisted second");
  const c = rc.user_id;
  fakeDev.signInAs(a.id);
  await api.registrations.cancel(ev.id);
  fakeDev.signInAs(b.id);
  eq((await api.events.viewerState(ev.id)).registration?.status, "going", "b promoted");
  fakeDev.signInAs(c);
  eq((await api.events.viewerState(ev.id)).registration?.waitlist_pos, 1, "c moves up");
  eq((await api.events.get(ev.id))?.going, 10, "going back to 10");
});

await test("seeded full event: capacity 5, 5 going, 3 waitlisted", async () => {
  const ev = seeded("Jollof Tasting Table");
  eq([ev.going, ev.spots_left], [5, 0], "full");
  as("Kredete");
  const regs = await api.registrations.list(ev.id);
  eq(regs.filter((r) => r.status === "waitlisted").map((r) => r.waitlist_pos).sort(), [1, 2, 3], "waitlist positions");
  await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "waitlist", "join waitlist");
  eq((await api.registrations.register(ev.id)).waitlist_pos, 4, "fourth in line");
});

await test("full and waitlist off: button closed and register fails", async () => {
  const ev = await kredeteEvent({ capacity: 1 });
  await newPerson();
  eq((await api.registrations.register(ev.id)).status, "going", "first");
  await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "closed", "closed");
  await rejects(api.registrations.register(ev.id), "This event is full", "register when full");
});

await test("approval: request, approve to going, approve when full goes to the waitlist", async () => {
  const ev = await kredeteEvent({ requires_approval: true, capacity: 1, waitlist_on: true });
  const a = await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "request", "button");
  eq((await api.registrations.register(ev.id)).status, "requested", "a requested");
  const b = await newPerson();
  eq((await api.registrations.register(ev.id)).status, "requested", "b requested");
  as("Kredete");
  const regs = await api.registrations.list(ev.id);
  const ra = regs.find((r) => r.user_id === a.id)!;
  const rb = regs.find((r) => r.user_id === b.id)!;
  eq((await api.registrations.approve(ra.id)).status, "going", "a approved");
  const approvedB = await api.registrations.approve(rb.id);
  eq([approvedB.status, approvedB.waitlist_pos], ["waitlisted", 1], "b approved but full");
  eq(await api.door.counts(ev.id), { going: 1, checked_in: 0, pending: 0, waitlist: 1 }, "counts");
  // Declining the going person promotes the waitlisted one (approval event: they go back to the host as requested).
  await api.registrations.decline(ra.id);
  eq((await api.registrations.list(ev.id)).find((r) => r.id === rb.id)?.status, "requested", "waitlist moves up");
});

await test("approval seed: Ada is going; a new person is requested", async () => {
  const ev = seeded("360Playlist Listening Party");
  as("Ada Obi");
  eq((await api.events.viewerState(ev.id)).button, "going", "Ada");
  await newPerson();
  eq((await api.registrations.register(ev.id)).status, "requested", "new person");
});

await test("paid event: button get_ticket and register throws, no approval", async () => {
  const ev = seeded("Afro Beach Day Party");
  await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "get_ticket", "button");
  await rejects(api.registrations.register(ev.id), "Paid tickets are Release 2", "register");
});

await test("one registration per person per event", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  const p = await newPerson();
  const r1 = await api.registrations.register(ev.id);
  const r2 = await api.registrations.register(ev.id);
  eq(r1.id, r2.id, "same registration");
  as("Lagos Run Club");
  eq((await api.registrations.list(ev.id)).filter((r) => r.user_id === p.id).length, 1, "one row");
  // Cancel then register again keeps the one row.
  fakeDev.signInAs(p.id);
  await api.registrations.cancel(ev.id);
  const r3 = await api.registrations.register(ev.id);
  eq(r3.id, r1.id, "brought back, not duplicated");
});

await test("register needs a signed-in viewer", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  await rejects(api.registrations.register(ev.id), "Sign in first", "signed out");
  eq((await api.events.viewerState(ev.id)).signedIn, false, "viewerState says signed out");
});

await test("interested (swipe) never creates a registration", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  const p = await newPerson();
  await api.events.setInterested(ev.id, true);
  const st = await api.events.viewerState(ev.id);
  eq([st.interested, st.registration], [true, null], "interested only");
  as("Lagos Run Club");
  eq((await api.registrations.list(ev.id)).some((r) => r.user_id === p.id), false, "no registration row");
});

await test("visibility: invite hidden from lists but opens by id and slug; community follows room membership", async () => {
  const inv = seeded("Kredete Private Listening Dinner");
  ok(!(await api.events.list()).some((e) => e.id === inv.id), "signed out list");
  eq((await api.events.get(inv.id))?.id, inv.id, "get by id");
  eq((await api.events.get(inv.slug))?.id, inv.id, "get by slug");
  await newPerson();
  ok(!(await api.events.list()).some((e) => e.id === inv.id), "signed in list");
  as("Kredete");
  ok((await api.events.list()).some((e) => e.id === inv.id), "the host sees their own invite event");
  ok((await api.events.listMine()).some((e) => e.id === inv.id), "listMine");

  const com = seeded("Rooftop Sessions Members Night");
  as("Ada Obi");
  ok(!(await api.events.list()).some((e) => e.id === com.id), "non-member: not listed");
  eq(await api.events.get(com.id), null, "non-member: get is null");
  await api.rooms.join(com.room_id!);
  ok((await api.events.list()).some((e) => e.id === com.id), "member: listed");
  eq((await api.events.get(com.id))?.id, com.id, "member: get");
  as("Rooftop Sessions");
  ok((await api.events.list()).some((e) => e.id === com.id), "host: listed without joining");
  ok((await api.events.listMine()).some((e) => e.title === "Warehouse Techno Night" && e.status === "cancelled"), "listMine keeps cancelled");
});

await test("online_link is hidden unless going or host; link_type is public", async () => {
  const ev = seeded("Lagos Founders Office Hours");
  const out = await api.events.get(ev.id);
  eq([out?.link_type, out?.online_link], ["zoom", null], "signed out");
  ok((await api.events.list()).every((e) => e.online_link === null), "list hides every link");
  await newPerson();
  eq((await api.events.get(ev.id))?.online_link, null, "signed in, not registered");
  await api.registrations.register(ev.id);
  eq((await api.events.get(ev.id))?.online_link, ev.online_link, "going");
  as("Hoppaz HQ");
  eq((await api.events.get(ev.id))?.online_link, ev.online_link, "host");
});

await test("Join call opens 15 minutes before the start (fake clock) and closes at the end", async () => {
  const ev = seeded("Hoppaz Host Q&A");
  await newPerson();
  await api.registrations.register(ev.id);
  eq((await api.events.viewerState(ev.id)).joinCallOpen, false, "40 minutes before");
  fakeDev.advance(24 * MIN);
  eq((await api.events.viewerState(ev.id)).joinCallOpen, false, "16 minutes before");
  fakeDev.advance(2 * MIN);
  eq((await api.events.viewerState(ev.id)).joinCallOpen, true, "14 minutes before");
  fakeDev.advance(40 * MIN);
  eq((await api.events.viewerState(ev.id)).joinCallOpen, true, "during");
  fakeDev.advance(40 * MIN);
  eq((await api.events.viewerState(ev.id)).joinCallOpen, false, "after the end");
});

await test("Pops are one way: an event Pop reaches the room, a room announcement never reaches the event", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  const person = await newPerson();
  await api.registrations.register(ev.id);
  as("Lagos Run Club");
  const before = (await api.rooms.announcements(ev.room_id!)).length;
  const pop = await api.pops.send({ eventId: ev.id, body: "Bring water please", audience: "going", alsoRoom: true });
  eq(pop.status, "sent", "sent at once");
  eq(pop.recipients, ev.going + 1, "recipients = going count");
  const anns = await api.rooms.announcements(ev.room_id!);
  eq(anns.length, before + 1, "one new announcement");
  eq([anns[0].body, anns[0].event_id, anns[0].event_title], ["Bring water please", ev.id, ev.title], "tagged with the event");
  await api.rooms.postAnnouncement(ev.room_id!, "Plain room note");
  ok(!(await api.pops.visibleOnEvent(ev.id)).some((p) => p.body === "Plain room note"), "plain note not on the event (host)");
  ok(!(await api.pops.listForEvent(ev.id)).some((p) => p.body === "Plain room note"), "plain note not in host Pops");
  fakeDev.signInAs(person.id);
  const seen = (await api.pops.visibleOnEvent(ev.id)).map((p) => p.body);
  ok(seen.includes("Bring water please"), "the Pop shows on the event for a going person");
  ok(!seen.includes("Plain room note"), "plain note not on the event (guest)");
  as("Lagos Run Club");
  eq(await api.pops.shareText(pop.id), `Bring water please\n\nhttps://hoppaz.fun/e/${ev.slug}`, "share text");
  await rejects(api.pops.send({ eventId: ev.id, body: "  ", audience: "going", alsoRoom: false }), "Write a message first", "empty Pop");
});

await test("scheduled Pops stay scheduled, then flip to sent and copy to the room on the next read", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  as("Lagos Run Club");
  const at = new Date(api.clock.now() + HOUR).toISOString();
  const pop = await api.pops.send({ eventId: ev.id, body: "See you at the gate", audience: "everyone", alsoRoom: true, sendAt: at });
  eq([pop.status, pop.sent_at, pop.send_at], ["scheduled", null, at], "scheduled");
  ok(!(await api.rooms.announcements(ev.room_id!)).some((a) => a.body === "See you at the gate"), "not in the room yet");
  fakeDev.advance(61 * MIN);
  const after = (await api.pops.listForEvent(ev.id)).find((p) => p.id === pop.id)!;
  eq([after.status, after.sent_at], ["sent", at], "flipped");
  ok((await api.rooms.announcements(ev.room_id!)).some((a) => a.body === "See you at the gate" && a.event_id === ev.id), "copied to the room");
});

await test("automatic Pops: three scheduled rows per event, visible to the host", async () => {
  const ev = seeded("Lagos Run Club Sunrise Beach Run");
  as("Lagos Run Club");
  const autos = (await api.pops.listForEvent(ev.id)).filter((p) => p.auto);
  eq(autos.map((p) => p.auto).sort(), ["day_before", "doors_open", "hour_before"], "kinds");
  ok(autos.every((p) => p.status === "scheduled" && p.send_at), "scheduled");
  const created = await kredeteEvent();
  eq((await api.pops.listForEvent(created.id)).filter((p) => p.auto).length, 3, "a new event gets them too");
});

await test("door: express, standard confirm, already used, bad signature, wrong event, void, not going, typed code", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  as("Lagos Run Club");
  const c0 = await api.door.counts(ev.id);
  const t1 = (await fakeDev.sampleTicket(ev.id))!;

  const standard = await api.door.scan(ev.id, t1.token, "standard");
  eq([standard.ok, standard.kind], [true, "confirm"], "standard returns the person");
  eq((await api.door.counts(ev.id)).checked_in, c0.checked_in, "nobody checked in yet");
  const confirmed = await api.door.confirm(ev.id, t1.token);
  eq([confirmed.ok, confirmed.kind], [true, "checked_in"], "confirm checks in");
  eq((await api.door.counts(ev.id)).checked_in, c0.checked_in + 1, "one more checked in");
  const again = await api.door.scan(ev.id, t1.token, "express");
  ok(!again.ok && again.kind === "already_used" && again.name === t1.name && !!again.at, "already used returns the time");

  const t2 = (await fakeDev.sampleTicket(ev.id))!;
  const express = await api.door.scan(ev.id, t2.token, "express");
  eq([express.ok, express.kind], [true, "checked_in"], "express checks in at once");

  eq(await api.door.scan(ev.id, tamper(t2.token), "express"), { ok: false, kind: "not_valid", reason: "bad_signature" }, "tampered");
  eq(await api.door.scan(ev.id, "not.a.token", "express"), { ok: false, kind: "not_valid", reason: "bad_signature" }, "garbage");
  eq(await api.door.scan(ev.id, "ZZZZZZ", "express"), { ok: false, kind: "not_valid", reason: "unknown" }, "unknown code");

  const t3 = (await fakeDev.sampleTicket(ev.id))!;
  const other = seeded("Sunset Rooftop Sessions Vol. 12");
  as("Hoppaz Staff");
  eq(await api.door.scan(other.id, t3.token, "express"), { ok: false, kind: "not_valid", reason: "wrong_event" }, "wrong event");

  // A typed registration code.
  as("Lagos Run Club");
  const typed = await api.door.scan(ev.id, t3.code.toLowerCase(), "express");
  eq([typed.ok, typed.kind], [true, "checked_in"], "typed code");

  // Void: the person cancels after getting a ticket.
  const p = await newPerson();
  await api.registrations.register(ev.id);
  const mine = (await api.registrations.ticketFor(ev.id))!;
  ok(mine.token.split(".").length === 2 && mine.status === "valid", "ticket token has two parts");
  await api.registrations.cancel(ev.id);
  as("Lagos Run Club");
  eq(await api.door.scan(ev.id, mine.token, "express"), { ok: false, kind: "not_valid", reason: "void" }, "cancelled ticket");
  eq(p.name.startsWith("Tester"), true, "person made");

  // Not going: a code for someone whose request is still pending.
  const pending = seeded("360Playlist Listening Party");
  await newPerson();
  const reg = await api.registrations.register(pending.id);
  as("360Playlist");
  eq(await api.door.scan(pending.id, fakeDev.codeFor(reg.id)!, "express"), { ok: false, kind: "not_valid", reason: "not_going" }, "pending person");

  // Only a host or staff may scan.
  await newPerson();
  await rejects(api.door.scan(ev.id, t3.token, "express"), "Not allowed", "a guest cannot scan");
});

await test("silent rate limit: the sixth event in an hour says only 'Try again later'", async () => {
  as("Kredete");
  for (let i = 0; i < 5; i++) await api.events.create({ title: `Rate ${i}` });
  await rejects(api.events.create({ title: "Rate 5" }), "Try again later", "sixth");
  fakeDev.advance(61 * MIN);
  eq((await api.events.create({ title: "Rate after an hour" })).title, "Rate after an hour", "allowed again");
});

await test("create: a name is enough; online has no pin; WhatsApp defaults to 32", async () => {
  as("Kredete");
  const e = await api.events.create({ title: "Just a name" });
  eq([e.kind, e.visibility, e.requires_approval, e.capacity, e.price_naira, e.status], ["in_person", "public", false, null, 0, "live"], "defaults");
  ok(UUID.test(e.id), "uuid id");
  const online = await api.events.create({ title: "Call", kind: "online", link_type: "whatsapp", online_link: "https://call.whatsapp.com/video/abc" });
  eq([online.capacity, online.lat, online.lng, online.venue_name], [32, 6.5, 3.42, ""], "WhatsApp online");
  await rejects(api.events.create({ title: "Too big", kind: "online", link_type: "whatsapp", online_link: "https://x.example.com", capacity: 40 }), "WhatsApp calls hold up to 32 people", "limit");
  await rejects(api.events.create({ title: "" }), "Give your event a name", "no name");
  await rejects(api.events.create({ title: "Far", lat: 51.5, lng: -0.1 }), "Hoppaz is Lagos only for now", "outside Lagos");
  ok((await api.events.list()).some((x) => x.id === e.id), "appears in the list");
});

await test("auth: six digits, any code, Google signs in as Ada Obi, sign out", async () => {
  await rejects(api.auth.sendCode("nope"), "Enter a valid email", "bad email");
  await api.auth.sendCode("ada@example.com");
  await rejects(api.auth.verifyCode("ada@example.com", "12345"), "Enter the 6 digit code", "five digits");
  await rejects(api.auth.verifyCode("ada@example.com", "abcdef"), "Enter the 6 digit code", "letters");
  eq((await api.auth.verifyCode("ada@example.com", "000000")).name, "Ada", "any six digits");
  eq((await api.auth.google()).name, "Ada Obi", "google");
  eq(api.auth.current()?.name, "Ada Obi", "current");
  await api.auth.signOut();
  eq(api.auth.current(), null, "signed out");
});

await test("event chat: upcoming, open from 1 hour before, closed 3 days after the end; who can enter follows the event", async () => {
  const ev = seeded("360Playlist Listening Party");
  as("Ada Obi");
  eq((await api.rooms.eventChat(ev.id))?.state, "upcoming", "before");
  eq((await api.rooms.eventChat(ev.id))?.can_enter, true, "Ada is going");
  await newPerson();
  eq((await api.rooms.eventChat(ev.id))?.can_enter, false, "not registered");
  await api.registrations.register(ev.id);
  eq((await api.rooms.eventChat(ev.id))?.can_enter, false, "requested only: approval events let approved people in");
  fakeDev.jumpTo(Date.parse(ev.starts_at) - 30 * MIN);
  eq((await api.rooms.eventChat(ev.id))?.state, "open", "30 minutes before");
  fakeDev.jumpTo(Date.parse(ev.ends_at!) + 3 * 24 * HOUR + MIN);
  eq((await api.rooms.eventChat(ev.id))?.state, "closed", "3 days after");

  fakeDev.resetClock();
  const com = seeded("Rooftop Sessions Members Night");
  as("Ada Obi");
  eq((await api.rooms.eventChat(com.id))?.can_enter, false, "community: not a member");
  await api.rooms.join(com.room_id!);
  eq((await api.rooms.eventChat(com.id))?.can_enter, true, "community: member");
});

await test("rooms: HQ first and joined, announcements tagged from Pops, Ada's rooms, unread clears", async () => {
  as("Ada Obi");
  const l = await api.rooms.list();
  eq([l.hq.name, l.hq.kind, l.hq.joined], ["Hoppaz HQ", "hq", true], "HQ");
  ok(l.hq.members >= 1000, "HQ has about 1,200 members");
  eq(l.mine.map((r) => r.name).sort(), ["360Playlist", "Lagos Run Club"], "Ada's rooms");
  ok(l.discover.length >= 4, "discover rooms");
  const p360 = l.mine.find((r) => r.name === "360Playlist")!;
  ok(p360.verified, "360Playlist is verified");
  const anns = await api.rooms.announcements(p360.id);
  ok(anns.some((a) => a.event_id && a.event_title), "an announcement from an event Pop");
  ok(anns.some((a) => !a.event_id), "a plain announcement");
  ok(p360.unread > 0, "unread before");
  await api.rooms.markRead(p360.id);
  eq((await api.rooms.get(p360.id))?.unread, 0, "unread after");
  ok(l.eventChats.length > 0, "event chats listed");
});

await test("reports: anyone signed in reports, staff list and mark reviewed, others are refused", async () => {
  const ev = seeded("Afro Beach Day Party");
  await rejects(api.reports.report(ev.id, "other", "x"), "Sign in first", "signed out");
  await newPerson();
  await api.reports.report(ev.id, "fake_or_scam", "Looks fake");
  await rejects(api.reports.list(), "Not allowed", "guest list");
  as("Hoppaz Staff");
  const all = await api.reports.list();
  const mine = all.find((r) => r.note === "Looks fake")!;
  eq([mine.status, mine.event_title], ["open", "Afro Beach Day Party"], "open report");
  await api.reports.markReviewed(mine.id);
  eq((await api.reports.list()).find((r) => r.id === mine.id)?.status, "reviewed", "reviewed");
});

await test("clone, update and cancel", async () => {
  const ev = await kredeteEvent({ capacity: 3, waitlist_on: true, description: "Hello" });
  const copy = await api.events.clone(ev.id);
  eq([copy.title, copy.capacity, copy.description, copy.id === ev.id], [ev.title, 3, "Hello", false], "copy");
  eq(Date.parse(copy.starts_at) - Date.parse(ev.starts_at), 7 * 24 * HOUR, "a week on");
  const edited = await api.events.update(ev.id, { title: "New name", capacity: 5 });
  eq([edited.title, edited.capacity], ["New name", 5], "update");
  eq((await api.events.cancel(ev.id)).status, "cancelled", "cancel");
  eq((await api.events.viewerState(ev.id)).button, "closed", "closed after cancel");
  await newPerson();
  await rejects(api.events.cancel(copy.id), "Not allowed", "a guest cannot cancel");
});

await test("reset clears user-made changes", async () => {
  const before = fakeDev.allEvents().length;
  await kredeteEvent();
  eq(fakeDev.allEvents().length, before + 1, "one more");
  fakeDev.resetAll();
  eq([fakeDev.allEvents().length, api.auth.current()], [before, null], "back to the seed, signed out");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
