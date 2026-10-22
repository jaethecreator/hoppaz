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

const { paidTicketsOn } = await import("../src/lib/events-r1/flags.ts");
const { platformFeeNaira, processingFeeNaira } = await import("../src/lib/events-r1/payFee.ts");
const { PAID_UNAVAILABLE } = await import("../src/lib/events-r1/constants.ts");

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
  await rejects(api.registrations.register(ev.id), paidTicketsOn() ? "use_checkout" : PAID_UNAVAILABLE, "register");
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

await test("Pops: each audience reaches only its people; recipients and the live count agree", async () => {
  const ev = await kredeteEvent({ requires_approval: true, capacity: 1, waitlist_on: true });
  const a = await newPerson();
  const ra = await api.registrations.register(ev.id);
  const b = await newPerson();
  const rb = await api.registrations.register(ev.id);
  const c = await newPerson();
  await api.registrations.register(ev.id);
  as("Kredete");
  await api.registrations.approve(ra.id);
  await api.registrations.approve(rb.id);
  const regs = await api.registrations.list(ev.id);
  eq(["going", "waitlisted", "requested"].map((s) => regs.filter((r) => r.status === s).length), [1, 1, 1], "one in each state");
  const sent = {
    going: await api.pops.send({ eventId: ev.id, body: "For going", audience: "going", alsoRoom: false }),
    pending: await api.pops.send({ eventId: ev.id, body: "For pending", audience: "pending", alsoRoom: false }),
    waitlist: await api.pops.send({ eventId: ev.id, body: "For waitlist", audience: "waitlist", alsoRoom: false }),
  };
  eq([sent.going.recipients, sent.pending.recipients, sent.waitlist.recipients], [1, 1, 1], "recipients");
  const seen = async (id: string) => {
    fakeDev.signInAs(id);
    return (await api.pops.visibleOnEvent(ev.id)).map((p) => p.body).sort();
  };
  eq(await seen(a.id), ["For going"], "going person");
  eq(await seen(c.id), ["For pending"], "pending person");
  eq(await seen(b.id), ["For waitlist"], "waitlisted person");
  eq((await api.pops.listForEvent(ev.id).catch((e: Error) => e.message)), "Not allowed", "a guest has no host list");
  as("Kredete");
  eq((await api.pops.listForEvent(ev.id)).filter((p) => !p.auto).length, 3, "the host sees all three");
});

await test("Pops: Also post off stays out of Announcements; on copies tagged; an event with no room copies nothing", async () => {
  const ev = seeded("Kredete Open Mic and Laughs");
  as("Kredete");
  const before = (await api.rooms.announcements(ev.room_id!)).length;
  await api.pops.send({ eventId: ev.id, body: "Only on the event", audience: "going", alsoRoom: false });
  const mid = await api.rooms.announcements(ev.room_id!);
  eq(mid.length, before, "nothing added with Also post off");
  ok((await api.pops.listForEvent(ev.id)).some((p) => p.body === "Only on the event" && !p.also_room), "still a Pop of the event");
  const p = await api.pops.send({ eventId: ev.id, body: "Also in the room", audience: "going", alsoRoom: true });
  eq(p.also_room, true, "marked");
  const after = await api.rooms.announcements(ev.room_id!);
  eq([after.length, after[0].body, after[0].event_id], [before + 1, "Also in the room", ev.id], "copied and tagged");
  const bare = await kredeteEvent({ add_to_room: false });
  eq(bare.room_id, null, "an event kept out of the room has none");
  eq((await api.pops.send({ eventId: bare.id, body: "No room", audience: "going", alsoRoom: true })).also_room, false, "no room: not marked");
});

await test("Pops: 280 characters at most, a future time up to the start, host only", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  await rejects(api.pops.send({ eventId: ev.id, body: "hi", audience: "going", alsoRoom: false }), "Sign in first", "signed out");
  as("Ada Obi");
  await rejects(api.pops.send({ eventId: ev.id, body: "hi", audience: "going", alsoRoom: false }), "Not allowed", "a guest");
  as("Lagos Run Club");
  ok((await api.pops.send({ eventId: ev.id, body: "x".repeat(280), audience: "going", alsoRoom: false })).body.length === 280, "280 is fine");
  await rejects(api.pops.send({ eventId: ev.id, body: "x".repeat(281), audience: "going", alsoRoom: false }), "Keep it under 280 characters", "281");
  const t = api.clock.now();
  await rejects(api.pops.send({ eventId: ev.id, body: "late", audience: "going", alsoRoom: false, sendAt: new Date(t - MIN).toISOString() }), "Pick a time in the future", "in the past");
  await rejects(api.pops.send({ eventId: ev.id, body: "late", audience: "going", alsoRoom: false, sendAt: new Date(Date.parse(ev.starts_at) + MIN).toISOString() }), "Pick a time before the event starts", "after the start");
  eq((await api.pops.send({ eventId: ev.id, body: "ok", audience: "going", alsoRoom: false, sendAt: ev.starts_at })).status, "scheduled", "at the start is fine");
});

await test("Pops: cancel a scheduled Pop and it never goes; a sent Pop or an automatic one cannot be cancelled", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  as("Lagos Run Club");
  const at = new Date(api.clock.now() + HOUR).toISOString();
  const keep = await api.pops.send({ eventId: ev.id, body: "Keep this one", audience: "going", alsoRoom: true, sendAt: at });
  const drop = await api.pops.send({ eventId: ev.id, body: "Drop this one", audience: "going", alsoRoom: true, sendAt: at });
  as("Ada Obi");
  await rejects(api.pops.cancelScheduled(drop.id), "Not allowed", "a guest cannot cancel");
  as("Lagos Run Club");
  await api.pops.cancelScheduled(drop.id);
  eq((await api.pops.listForEvent(ev.id)).some((p) => p.id === drop.id), false, "gone from the list");
  fakeDev.advance(2 * HOUR);
  const list = await api.pops.listForEvent(ev.id);
  eq(list.find((p) => p.id === keep.id)?.status, "sent", "the other one went");
  const bodies = (await api.rooms.announcements(ev.room_id!)).map((a) => a.body);
  ok(bodies.includes("Keep this one") && !bodies.includes("Drop this one"), "only the kept one reached Announcements");
  await rejects(api.pops.cancelScheduled(keep.id), "Already sent", "sent");
  await rejects(api.pops.cancelScheduled(list.find((p) => p.auto)!.id), "Switch it off instead", "automatic");
  await rejects(api.pops.cancelScheduled("nope"), "Pop not found", "unknown");
});

await test("automatic Pops: default on and sent at their time; Off is never sent; text can be edited until it goes", async () => {
  const ev = seeded("Lagos Run Club 5K Social Run");
  as("Lagos Run Club");
  const autos = async () => Object.fromEntries((await api.pops.listForEvent(ev.id)).filter((p) => p.auto).map((p) => [p.auto!, p]));
  const before = await autos();
  ok(["day_before", "hour_before", "doors_open"].every((k) => before[k].enabled !== false && before[k].status === "scheduled"), "all on, scheduled");
  const off = await api.pops.setAuto(ev.id, "hour_before", false);
  eq([off.enabled, off.status], [false, "scheduled"], "switched off");
  const edited = await api.pops.editAuto(ev.id, "doors_open", "  Gate is open. Bring your bib.  ");
  eq(edited.body, "Gate is open. Bring your bib.", "edited and trimmed");
  await rejects(api.pops.editAuto(ev.id, "doors_open", "  "), "Write a message first", "empty");
  await rejects(api.pops.editAuto(ev.id, "doors_open", "x".repeat(281)), "Keep it under 280 characters", "too long");
  as("Ada Obi");
  await rejects(api.pops.setAuto(ev.id, "day_before", false), "Not allowed", "a guest");
  await rejects(api.pops.editAuto(ev.id, "day_before", "hi"), "Not allowed", "a guest edit");
  fakeDev.jumpTo(Date.parse(ev.starts_at) + MIN);
  as("Lagos Run Club");
  const after = await autos();
  eq([after.day_before.status, after.hour_before.status, after.doors_open.status], ["sent", "scheduled", "sent"], "the Off one stayed unsent");
  eq(after.doors_open.body, "Gate is open. Bring your bib.", "the edited text went");
  eq(after.hour_before.sent_at, null, "never sent");
  eq((await api.pops.visibleOnEvent(ev.id)).some((p) => p.auto === "hour_before"), false, "not on the event");
  await rejects(api.pops.setAuto(ev.id, "hour_before", true), "That time has passed", "back on too late");
  await rejects(api.pops.setAuto(ev.id, "doors_open", false), "Already sent", "sent");
  await rejects(api.pops.editAuto(ev.id, "doors_open", "late edit"), "Already sent", "sent edit");
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
  eq([e.room_id !== null, (await api.events.create({ title: "Out of the room", add_to_room: false })).room_id], [true, null], "add_to_room defaults on, false keeps it out");
  await rejects(api.events.create({ title: "No room, community", visibility: "community", add_to_room: false }), "Community events need a room. Create a room first.", "community needs the room");
});

await test("ticket types: default is one free General with no limit; the seeded paid event is still Get ticket", async () => {
  const e = await kredeteEvent();
  eq(e.ticket_types.map((t) => [t.name, t.price_naira, t.capacity, t.sold, t.spots_left]), [["General", 0, null, 0, null]], "default type");
  eq(e.price_naira, 0, "price");
  for (const s of fakeDev.allEvents()) ok(s.ticket_types.length >= 1, `every seeded event has a type: ${s.title}`);
  const paid = seeded("Afro Beach Day Party");
  eq(paid.ticket_types.map((t) => [t.name, t.price_naira]), [["General", 3000]], "seeded paid type");
  await newPerson();
  eq((await api.events.viewerState(paid.id)).button, "get_ticket", "seeded paid event still shows Get ticket");
});

await test("ticket types: free with two types, per-type capacity, the register cases", async () => {
  const bad = (tickets: Array<{ name: string; price_naira: number; capacity: number | null }>) => api.events.create({ title: "Bad", tickets });
  as("Kredete");
  await rejects(bad([{ name: "A", price_naira: 0, capacity: null }, { name: "a", price_naira: 0, capacity: null }]), "Two ticket types have the same name", "unique names");
  await rejects(bad([{ name: " ", price_naira: 0, capacity: null }]), "Give every ticket type a name", "name needed");
  await rejects(bad([{ name: "A", price_naira: 0, capacity: 0 }]), "Capacity must be 1 or more", "capacity positive");
  await rejects(bad(Array.from({ length: 6 }, (_, i) => ({ name: `T${i}`, price_naira: 0, capacity: null }))), "Up to 5 ticket types", "five at most");

  const ev = await kredeteEvent({ tickets: [{ name: "General", price_naira: 0, capacity: 2 }, { name: "VIP list", price_naira: 0, capacity: 1 }] });
  eq(ev.ticket_types.map((t) => [t.name, t.capacity, t.spots_left]), [["General", 2, 2], ["VIP list", 1, 1]], "two types");
  const [gen, vip] = ev.ticket_types;
  await newPerson();
  eq((await api.registrations.register(ev.id)).ticket_name, "General", "no type asked: the first free type with room");
  await newPerson();
  const r2 = await api.registrations.register(ev.id, { ticketTypeId: vip.id });
  eq([r2.ticket_name, r2.ticket_type_id, r2.status], ["VIP list", vip.id, "going"], "type asked");
  eq((await api.events.get(ev.id))!.ticket_types.map((t) => [t.sold, t.spots_left]), [[1, 1], [1, 0]], "counted per type");
  eq((await api.registrations.ticketFor(ev.id))!.ticket_name, "VIP list", "the ticket carries the type name");
  await newPerson();
  await rejects(api.registrations.register(ev.id, { ticketTypeId: vip.id }), "That ticket is full", "full type, no waitlist");
  await rejects(api.registrations.register(ev.id, { ticketTypeId: "nope" }), "Pick a ticket", "unknown type");
  eq((await api.events.viewerState(ev.id)).button, "register", "another type still has room");
  eq((await api.registrations.register(ev.id)).ticket_type_id, gen.id, "no type asked: skips the full VIP, takes General");
  await newPerson();
  eq((await api.events.viewerState(ev.id)).button, "closed", "every free type full, no waitlist: closed");
  await rejects(api.registrations.register(ev.id), "That ticket is full", "closed");

  // A full type follows the event's waitlist.
  const wl = await kredeteEvent({ waitlist_on: true, tickets: [{ name: "General", price_naira: 0, capacity: 1 }, { name: "VIP list", price_naira: 0, capacity: 1 }] });
  const [wg, wv] = wl.ticket_types;
  const first = await newPerson();
  void first;
  await api.registrations.register(wl.id, { ticketTypeId: wg.id });
  await newPerson();
  const queued = await api.registrations.register(wl.id, { ticketTypeId: wg.id });
  eq([queued.status, queued.ticket_name], ["waitlisted", "General"], "full type, waitlist on");
  await newPerson();
  eq((await api.events.viewerState(wl.id)).button, "register", "VIP has room: Register");
  await api.registrations.register(wl.id, { ticketTypeId: wv.id });
  await newPerson();
  eq((await api.events.viewerState(wl.id)).button, "waitlist", "all full: Join waitlist");
  // The waitlisted person comes in when General opens up, not when only VIP does.
  as("Kredete");
  const audience = await api.registrations.list(wl.id);
  const goingGen = audience.find((r) => r.status === "going" && r.ticket_type_id === wg.id)!;
  const goingVip = audience.find((r) => r.status === "going" && r.ticket_type_id === wv.id)!;
  fakeDev.signInAs(goingVip.user_id);
  await api.registrations.cancel(wl.id);
  as("Kredete");
  eq((await api.registrations.list(wl.id)).find((r) => r.id === queued.id)!.status, "waitlisted", "a VIP place does not move a General waiter");
  fakeDev.signInAs(goingGen.user_id);
  await api.registrations.cancel(wl.id);
  as("Kredete");
  eq((await api.registrations.list(wl.id)).find((r) => r.id === queued.id)!.status, "going", "a General place does");

  // The event's own capacity applies on top.
  const cap = await kredeteEvent({ capacity: 1, tickets: [{ name: "General", price_naira: 0, capacity: null }, { name: "VIP list", price_naira: 0, capacity: 5 }] });
  eq(cap.ticket_types.map((t) => t.spots_left), [1, 1], "event capacity caps every type");
  await newPerson();
  await api.registrations.register(cap.id, { ticketTypeId: cap.ticket_types[1].id });
  eq((await api.events.get(cap.id))!.ticket_types.map((t) => t.spots_left), [0, 0], "event full: every type full");
  await newPerson();
  await rejects(api.registrations.register(cap.id), "This event is full", "event full");

  // Approval is for the event's free types: requested, not going.
  const appr = await kredeteEvent({ requires_approval: true, tickets: [{ name: "General", price_naira: 0, capacity: null }, { name: "VIP list", price_naira: 0, capacity: 3 }] });
  await newPerson();
  eq((await api.registrations.register(appr.id, { ticketTypeId: appr.ticket_types[1].id })).status, "requested", "approval on a free type");

  // Clone copies the types.
  as("Kredete");
  const copy = await api.events.clone(ev.id);
  eq(copy.ticket_types.map((t) => [t.name, t.capacity, t.sold]), [["General", 2, 0], ["VIP list", 1, 0]], "clone copies the types");
  ok(copy.ticket_types[0].id !== gen.id, "with new ids");
});

await test(`ticket types: paid is ${paidTicketsOn() ? "saved (switch on)" : "rejected (switch off)"}, and never registered`, async () => {
  as("Kredete");
  const paidDraft = { title: "Paid night", tickets: [{ name: "General", price_naira: 0, capacity: null }, { name: "Table", price_naira: 5000, capacity: 4 }] };
  if (!paidTicketsOn()) {
    await rejects(api.events.create(paidDraft), PAID_UNAVAILABLE, "paid type while the flag is off");
    const own = await kredeteEvent();
    await rejects(api.events.update(own.id, { tickets: paidDraft.tickets }), PAID_UNAVAILABLE, "update too");
    eq((await api.events.get(own.id))!.ticket_types.length, 1, "nothing changed");
    // Editing something else on the seeded paid event does not trip over its paid type.
    as("Rooftop Sessions");
    const beach = seeded("Afro Beach Day Party");
    eq((await api.events.update(beach.id, { description: "Same day, same sand." })).ticket_types[0].price_naira, 3000, "seeded paid event still editable");
  } else {
    const e = await api.events.create(paidDraft);
    eq([e.price_naira, e.ticket_types.map((t) => t.price_naira)], [0, [0, 5000]], "saved, lowest price is free");
    const table = e.ticket_types[1];
    await newPerson();
    await rejects(api.registrations.register(e.id, { ticketTypeId: table.id }), "use_checkout", "register on a paid type, switch on");
    eq((await api.registrations.register(e.id)).ticket_name, "General", "default skips the paid type");
    as("Kredete");
    const allPaid = await api.events.create({ title: "All paid", tickets: [{ name: "Table", price_naira: 5000, capacity: null }] });
    await newPerson();
    eq([allPaid.price_naira, (await api.events.viewerState(allPaid.id)).button], [5000, "get_ticket"], "every type paid: Get ticket");
    await rejects(api.registrations.register(allPaid.id), "use_checkout", "register, all paid");
    as("Kredete");
    eq((await api.events.clone(allPaid.id)).ticket_types[0].price_naira, 5000, "clone keeps prices");
  }
});

await test("date and time picker helpers: Lagos time, +01:00 ISO, 15 minute steps, Ends follows Starts", async () => {
  const d = await import("../src/components/events-r1/dateTime.ts");
  const t = Date.parse("2026-10-23T18:00:00Z"); // 19:00 in Lagos
  eq(d.lagosIso(t), "2026-10-23T19:00:00+01:00", "ISO with the offset");
  eq(Date.parse(d.lagosIso(t)), t, "the same instant");
  eq(d.formatWhen("2026-10-23T19:00:00+01:00"), "Fri 23 Oct · 19:00", "printed like the event page");
  eq(d.formatWhen("2026-10-23T23:30:00Z"), "Sat 24 Oct · 00:30", "after midnight is the next calendar day");
  eq(d.dayChips(t, 4).map((c: { label: string }) => c.label), ["Today", "Tomorrow", "Sun 25", "Mon 26"], "day chips");
  eq([d.TIMES.length, d.TIMES[0], d.TIMES[1], d.TIMES[95]], [96, 0, 15, 1425], "times");
  eq(d.clockOf(1425), "23:45", "clock");
  eq(d.withDay("2026-10-23T19:15:00+01:00", "2026-12-01"), "2026-12-01T19:15:00+01:00", "day moves, time stays");
  eq(d.withMinutes("2026-10-23T19:15:00+01:00", 600), "2026-10-23T10:00:00+01:00", "time moves, day stays");
  eq(d.moveEnd("2026-10-23T19:00:00+01:00", "2026-10-23T22:00:00+01:00", "2026-10-24T20:00:00+01:00"), "2026-10-24T23:00:00+01:00", "Ends keeps the length");
  eq(d.moveEnd("2026-10-23T19:00:00+01:00", "2026-10-23T18:00:00+01:00", "2026-10-24T20:00:00+01:00"), "2026-10-24T23:00:00+01:00", "a broken length falls back to 3 hours");
  eq([d.endError("2026-10-23T19:00:00+01:00", "2026-10-23T19:00:00+01:00"), d.endError("2026-10-23T19:00:00+01:00", "2026-10-23T19:15:00+01:00")], ["Ends must be after Starts", ""], "end error");
  const oct = d.monthCells("2026-10");
  eq([oct.length, oct[0], oct[3], oct[oct.length - 1]], [34, null, "2026-10-01", "2026-10-31"], "October 2026 starts on a Thursday, Monday first");
  eq(d.shiftMonth("2026-12", 1), "2027-01", "month shift");
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

await test("rooms: is_owner, can_post, has_3d, online, HQ short address and mine()", async () => {
  eq(await api.rooms.mine(), [], "signed out owns nothing");
  as("Ada Obi");
  const l = await api.rooms.list();
  eq([l.hq.is_owner, l.hq.can_post, l.hq.has_3d, l.hq.online], [false, false, false, 320], "HQ for a guest: chat first, no 3D, people online");
  eq((await api.rooms.get("hq"))?.id, l.hq.id, "/rooms/hq finds Hoppaz HQ");
  eq((await api.rooms.get("hoppaz-hq"))?.id, l.hq.id, "and its own slug");
  eq(l.mine.map((r) => [r.name, r.is_owner, r.can_post]).sort(), [["360Playlist", false, false], ["Lagos Run Club", false, false]], "a member is not an owner");
  eq(await api.rooms.mine(), [], "Ada owns no room");
  as("Kredete");
  const mine = await api.rooms.mine();
  eq(mine.map((r) => [r.name, r.is_owner, r.can_post]), [["Kredete", true, true]], "Kredete owns one room");
  as("Hoppaz Staff");
  const hq = await api.rooms.get("hq");
  eq([hq?.can_post, hq?.is_owner], [true, false], "an admin may post but is not the owner");
  fakeDev.setHas3d(hq!.id, true);
  eq((await api.rooms.get("hq"))?.has_3d, true, "a 3D room can be switched on");
  const made = await api.rooms.create({ name: "Check Room" });
  eq([made.is_owner, made.can_post, made.has_3d, made.slug], [true, true, false, "check-room"], "a new room is the maker's");
  eq((await api.rooms.mine()).map((r) => r.name), ["Check Room"], "listed in mine");
});

await test("rooms: General chat needs sign in and membership; lines come oldest first", async () => {
  const kredete = (await api.rooms.get("kredete"))!;
  const before = await api.rooms.messages(kredete.id, "general");
  ok(before.length >= 2, "seeded lines");
  ok(before.every((m) => m.channel === "general" && !m.pinned_pop), "all General");
  ok(before.every((m, i) => i === 0 || Date.parse(m.created_at) >= Date.parse(before[i - 1].created_at)), "oldest first");
  await rejects(api.rooms.send(kredete.id, "general", "hi"), "Sign in first", "signed out");
  as("Ada Obi");
  await rejects(api.rooms.send(kredete.id, "general", "hi"), "Join the room to chat", "not a member");
  await api.rooms.join(kredete.id);
  await rejects(api.rooms.send(kredete.id, "general", "   "), "Write a message first", "empty");
  const m = await api.rooms.send(kredete.id, "general", "  Count me in  ");
  eq([m.body, m.author_name, m.channel], ["Count me in", "Ada Obi", "general"], "sent");
  const after = await api.rooms.messages(kredete.id, "general");
  eq([after.length, after[after.length - 1].id], [before.length + 1, m.id], "it is last");
  const hq = (await api.rooms.get("hq"))!;
  await api.rooms.send(hq.id, "general", "HQ is open to everyone");
  eq((await api.rooms.messages(hq.id, "general")).at(-1)?.body, "HQ is open to everyone", "HQ needs no join");
});

await test("rooms: event chat messages carry host Pops pinned; send refuses closed, not open yet, and outsiders", async () => {
  const ev = seeded("360Playlist Listening Party");
  const room = ev.room_id!;
  as("Ada Obi");
  const upcoming = await api.rooms.messages(room, ev.id);
  ok(upcoming.some((m) => m.pinned_pop?.event_id === ev.id && m.body.startsWith("Doors open")), "the host Pop is in the chat, tagged");
  ok(upcoming.some((m) => !m.pinned_pop), "and the chat lines");
  await rejects(api.rooms.send(room, ev.id, "early"), "The chat is not open yet", "upcoming");
  fakeDev.jumpTo(Date.parse(ev.starts_at) - 30 * MIN);
  const m = await api.rooms.send(room, ev.id, "On my way");
  eq(m.channel, ev.id, "sent to the event chat");
  ok((await api.rooms.messages(room, ev.id)).some((x) => x.id === m.id), "shown");
  eq((await api.rooms.messages(room, "general")).some((x) => x.id === m.id), false, "not in General");
  await newPerson();
  eq(await api.rooms.messages(room, ev.id), [], "an outsider sees nothing");
  await rejects(api.rooms.send(room, ev.id, "hi"), "You are not in this chat", "outsider");
  as("Ada Obi");
  fakeDev.jumpTo(Date.parse(ev.ends_at!) + 3 * 24 * HOUR + MIN);
  await rejects(api.rooms.send(room, ev.id, "late"), "This event has closed", "closed");
  ok((await api.rooms.messages(room, ev.id)).some((x) => x.id === m.id), "a closed chat can still be read");
  await rejects(api.rooms.send(room, "no-such-event", "x"), "Chat not found", "no such chat");
});

await test("rooms: a plain announcement from the owner never shows on an event; Pops show tagged", async () => {
  const ev = seeded("Kredete Open Mic and Laughs");
  as("Ada Obi");
  await rejects(api.rooms.postAnnouncement(ev.room_id!, "nope"), "Only the room's host can post here", "a guest cannot post");
  as("Kredete");
  const a = await api.rooms.postAnnouncement(ev.room_id!, "Doors at 7");
  eq([a.event_id, a.event_title], [null, null], "plain: no event tag");
  eq((await api.rooms.announcements(ev.room_id!))[0].id, a.id, "newest first");
  eq((await api.pops.visibleOnEvent(ev.id)).some((p) => p.body === "Doors at 7"), false, "not on the event");
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

await test("reports: three open reports hide an event from the list until staff mark them reviewed; the list names the reporter", async () => {
  const ev = await kredeteEvent();
  eq((await api.events.list()).some((e) => e.id === ev.id), true, "listed at first");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await newPerson();
    ids.push(p.id);
    await api.reports.report(ev.id, "wrong_place", `Report ${i}`);
  }
  eq((await api.events.list()).some((e) => e.id === ev.id), false, "hidden at 3 open reports");
  as("Kredete");
  eq((await api.events.list()).some((e) => e.id === ev.id), true, "the host still sees it");
  as("Hoppaz Staff");
  const open = (await api.reports.list()).filter((r) => r.event_id === ev.id);
  eq(open.length, 3, "staff see all three");
  eq(open.map((r) => r.reporter_name).sort(), ["Tester " + (n - 2), "Tester " + (n - 1), "Tester " + n].sort(), "reporter names");
  eq((await api.events.list()).some((e) => e.id === ev.id), true, "staff still see it in the list");
  await api.reports.markReviewed(open[0].id);
  await newPerson();
  eq((await api.events.list()).some((e) => e.id === ev.id), true, "listed again with 2 open reports");
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

/* ------------------------------------------------------- paid tickets -- */

/** Run a test body with the paid switch forced on or off, then put it back. */
async function withPaid(on: boolean, fn: () => Promise<void>) {
  const was = process.env.HZ_PAID;
  process.env.HZ_PAID = on ? "1" : "";
  try {
    await fn();
  } finally {
    if (was === undefined) delete process.env.HZ_PAID;
    else process.env.HZ_PAID = was;
  }
}
const PAID_TYPE = (price: number, capacity: number | null = null) => [{ name: "General", price_naira: price, capacity }];
/** Kredete (payouts Ready) makes a paid event and stays signed in as that host. */
async function paidEvent(price = 1000, capacity: number | null = null, extra: Record<string, unknown> = {}) {
  as("Kredete");
  return api.events.create({ title: `Paid ${++n}`, tickets: PAID_TYPE(price, capacity), ...extra });
}
/** Sign in as a new person and open an order. */
async function buy(ev: { id: string; ticket_types: { id: string }[] }, quantity: number) {
  await newPerson();
  return api.pay.checkout(ev.id, ev.ticket_types[0].id, quantity);
}
const MINUTE = 60_000;

await test("pay fees: platform 4.5 percent half up and clamped, bank 1.5 percent capped at 2000, card 2 percent", async () => {
  eq(platformFeeNaira(3000), 135, "4.5 percent of 3000");
  eq(platformFeeNaira(1001), 45, "45.045 rounds down");
  eq(platformFeeNaira(100), 5, "half up: exactly 4.5 rounds up to 5");
  eq(platformFeeNaira(1012), 46, "45.54 rounds up");
  eq(platformFeeNaira(10), 1, "never 0 (0.45 rounds to 0, clamped to 1)");
  eq(platformFeeNaira(2, 99.9), 1, "always below the gross");
  eq(platformFeeNaira(1000, 4.5, 100), 145, "plus a fixed amount");
  eq(processingFeeNaira(10_000, "bank_transfer"), 150, "bank under the cap");
  eq(processingFeeNaira(200_000, "bank_transfer"), 2000, "bank capped");
  eq(processingFeeNaira(10_000, "card"), 200, "card");
});

await test("paid switch off: paid type, quote, checkout and register all say Currently unavailable", async () => {
  await withPaid(false, async () => {
    eq(paidTicketsOn(), false, "switch is off");
    const beach = seeded("Afro Beach Day Party");
    await newPerson();
    await rejects(api.pay.quote(beach.id, beach.ticket_types[0].id, 1), PAID_UNAVAILABLE, "quote");
    await rejects(api.pay.checkout(beach.id, beach.ticket_types[0].id, 1), PAID_UNAVAILABLE, "checkout");
    await rejects(api.registrations.register(beach.id), PAID_UNAVAILABLE, "register");
    as("Kredete");
    await rejects(api.events.create({ title: "Paid", tickets: PAID_TYPE(1000) }), PAID_UNAVAILABLE, "create");
  });
});

await test("paid switch on, payouts not ready: a paid type cannot be saved or bought (payouts_not_ready)", async () => {
  await withPaid(true, async () => {
    // A new host starts as Not started.
    const me = await newPerson();
    eq((await api.pay.hostPayout()).status, "not_started", "new host");
    eq((await api.pay.hostPayout()).can_sell, false, "cannot sell");
    ok((await api.pay.hostPayout()).requirements_due.includes("Upload your ID"), "plain words");
    await rejects(api.events.create({ title: "Mine", tickets: PAID_TYPE(1000) }), "payouts_not_ready", "create");
    for (const st of ["in_progress", "restricted"] as const) {
      fakeDev.setPayoutOf(me.id, st);
      eq((await api.pay.hostPayout()).can_sell, false, `${st} cannot sell`);
      await rejects(api.events.create({ title: "Mine", tickets: PAID_TYPE(1000) }), "payouts_not_ready", `create when ${st}`);
    }
    eq((await api.pay.startOnboarding("/host/x")).url, "/dev/fake-bachs/onboarding?return=%2Fhost%2Fx", "onboarding link");
    fakeDev.setPayoutOf(me.id, "ready");
    const hp = await api.pay.hostPayout();
    eq([hp.can_sell, hp.status, hp.requirements_due.length, hp.dashboard_url], [true, "ready", 0, "https://dashboard.bachs.io"], "ready");
    eq((await api.events.create({ title: "Mine", tickets: PAID_TYPE(1000) })).ticket_types[0].price_naira, 1000, "saved when ready");
    // The host loses the setup after the event exists: nobody can buy.
    const ev = await api.events.create({ title: "Mine 2", tickets: PAID_TYPE(1000) });
    fakeDev.setPayoutOf(me.id, "restricted");
    await newPerson();
    await rejects(api.pay.checkout(ev.id, ev.ticket_types[0].id, 1), "payouts_not_ready", "checkout");
    // Seeded: Rooftop Sessions and Kredete are Ready, others are not.
    eq(["Rooftop Sessions", "Kredete", "Lagos Run Club", "360Playlist"].map((h) => fakeDev.payoutStatus(user(h).id)), ["ready", "ready", "not_started", "not_started"], "seed");
  });
});

await test("checkout: sign in first, paid type only, quantity 1 to 5, reserves seats, last seat cannot be reserved twice", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1000, 3);
    const type = ev.ticket_types[0];
    await api.auth.signOut();
    await rejects(api.pay.checkout(ev.id, type.id, 1), "Sign in first", "signed out");
    await newPerson();
    await rejects(api.pay.checkout(ev.id, type.id, 0), "Pick 1 to 5 tickets", "zero");
    await rejects(api.pay.checkout(ev.id, type.id, 6), "Pick 1 to 5 tickets", "six");
    await rejects(api.pay.checkout(ev.id, type.id, 1.5), "Pick 1 to 5 tickets", "not whole");
    await rejects(api.pay.checkout(ev.id, "nope", 1), "Pick a ticket", "unknown type");
    as("Kredete");
    const freeEv = await api.events.create({ title: `Free ${++n}` });
    await newPerson();
    await rejects(api.pay.checkout(freeEv.id, freeEv.ticket_types[0].id, 1), "This ticket is free. Use Register.", "free type");

    // 3 seats: A takes 2, B asks for 2 and only 1 is left, B takes 1, C finds it sold out.
    const a = await buy(ev, 2);
    eq([a.checkout_url, Date.parse(a.expires_at) - Date.now() > 14 * MINUTE], [`/dev/fake-bachs/checkout/${a.order_id}`, true], "checkout_url and 15 minute hold");
    const after = (await api.events.get(ev.id))!;
    eq([after.ticket_types[0].spots_left, after.ticket_types[0].sold, after.going], [1, 0, 0], "held seats count against capacity, nothing sold or going yet");
    eq(await api.registrations.ticketsFor(ev.id), [], "no ticket before the payment");
    await newPerson();
    await rejects(api.pay.checkout(ev.id, type.id, 2), "Only 1 left", "two asked, one left");
    await api.pay.checkout(ev.id, type.id, 1);
    await newPerson();
    await rejects(api.pay.checkout(ev.id, type.id, 1), "Sold out", "last seat reserved twice");
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 0, "type full");
    await rejects(api.pay.quote(ev.id, type.id, 6), "Pick 1 to 5 tickets", "quote quantity");
    eq(await api.pay.quote(ev.id, type.id, 3), { gross_naira: 3000, platform_fee_naira: 135, quantity: 3, unit_price_naira: 1000 }, "quote");
  });
});

await test("pay by card: N tickets with seats, ONE registration, a second order adds, fees and host net", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(3000, null);
    const o1 = await buy(ev, 2);
    const buyer = api.auth.current()!;
    // The webhook, not the checkout, makes the tickets.
    const paid = fakeDev.completeCheckout(o1.order_id, "card");
    eq([paid.status, paid.payment_method, paid.gross_naira, paid.platform_fee_naira, paid.processing_fee_naira, paid.host_net_naira], ["paid", "card", 6000, 270, 120, 5610], "paid order and fees");
    const order = await api.pay.order(o1.order_id);
    eq([order.status, order.checkout_url, order.quantity, order.needs_refund], ["paid", null, 2, false], "buyer reads it");
    const tickets = await api.registrations.ticketsFor(ev.id);
    eq(tickets.map((t) => [t.seat_no, t.seats, t.ticket_name, t.status]), [[1, 2, "General", "valid"], [2, 2, "General", "valid"]], "two tickets, seats 1 of 2 and 2 of 2");
    ok(new Set(tickets.map((t) => t.token)).size === 2 && new Set(tickets.map((t) => t.code)).size === 2, "own token and code each");
    eq((await api.registrations.ticketFor(ev.id))!.id, tickets[0].id, "ticketFor is the first");
    const state = await api.events.viewerState(ev.id);
    eq([state.button, state.registration!.quantity, state.registration!.status], ["going", 2, "going"], "going with quantity 2");
    eq([(await api.events.get(ev.id))!.going, (await api.events.get(ev.id))!.ticket_types[0].sold], [2, 2], "going and sold count tickets");
    // A second order adds to the same registration.
    const o2 = await api.pay.checkout(ev.id, ev.ticket_types[0].id, 1);
    fakeDev.completeCheckout(o2.order_id, "card");
    as("Kredete");
    const list = (await api.registrations.list(ev.id)).filter((r) => r.user_id === buyer.id);
    eq(list.map((r) => [r.quantity, r.status]), [[3, "going"]], "one registration, quantity 3");
    fakeDev.signInAs(buyer.id);
    eq((await api.registrations.ticketsFor(ev.id)).map((t) => [t.seat_no, t.seats]), [[1, 3], [2, 3], [3, 3]], "three tickets now");
    eq((await api.pay.myOrders()).map((o) => o.status), ["paid", "paid"], "my orders");
    // Paying the same order again changes nothing.
    fakeDev.completeCheckout(o1.order_id, "bank_transfer");
    eq((await api.registrations.ticketsFor(ev.id)).length, 3, "paying twice makes no extra tickets");
    eq((await api.pay.order(o1.order_id)).payment_method, "card", "and keeps the method");
  });
});

await test("pay by bank transfer: 1.5 percent processing fee, capped at 2000", async () => {
  await withPaid(true, async () => {
    const small = await paidEvent(10_000);
    const o = await buy(small, 1);
    const p = fakeDev.completeCheckout(o.order_id, "bank_transfer");
    eq([p.processing_fee_naira, p.platform_fee_naira, p.host_net_naira], [150, 450, 9400], "10,000 gross: matches the spec example (host gets 9,400)");
    const big = await paidEvent(200_000);
    const o2 = await buy(big, 1);
    const p2 = fakeDev.completeCheckout(o2.order_id, "bank_transfer");
    eq([p2.processing_fee_naira, p2.host_net_naira], [2000, 200_000 - 9000 - 2000], "capped at 2000");
  });
});

await test("failed payment frees the seats; the buyer can start again", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1000, 1);
    const o = await buy(ev, 1);
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 0, "held");
    eq(fakeDev.failCheckout(o.order_id).status, "failed", "failed");
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 1, "seat back");
    await rejects(Promise.resolve().then(() => fakeDev.completeCheckout(o.order_id, "card")), "This payment already failed", "cannot pay a failed order");
    eq((await api.pay.checkout(ev.id, ev.ticket_types[0].id, 1)).order_id === o.order_id, false, "a new order");
  });
});

await test("an order runs out after 15 minutes: seats are free again, the order reads expired, no pay link", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1000, 2);
    const o = await buy(ev, 2);
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 0, "held");
    fakeDev.advance(14 * MINUTE);
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 0, "still held at 14 minutes");
    eq((await api.pay.order(o.order_id)).status, "open", "still open");
    fakeDev.advance(2 * MINUTE);
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 2, "free at 16 minutes");
    const after = await api.pay.order(o.order_id);
    eq([after.status, after.checkout_url], ["expired", null], "expired, no link");
    eq((await api.pay.myOrders())[0].status, "expired", "my orders agree");
    // Someone else can take the seats now.
    await buy(ev, 2);
    // Let it expire by hand.
    const ev2 = await paidEvent(1000, 2);
    const o2 = await buy(ev2, 1);
    eq(fakeDev.expireCheckout(o2.order_id).status, "expired", "expired by hand");
    eq((await api.events.get(ev2.id))!.ticket_types[0].spots_left, 2, "seat back");
  });
});

await test("late payment: seats still free means tickets; seats gone means a refund is owed (card) or a manual one (bank)", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1000, 2);
    // Free seats: the late payment takes them.
    const o1 = await buy(ev, 2);
    const first = api.auth.current()!;
    fakeDev.expireCheckout(o1.order_id);
    const late = fakeDev.completeCheckout(o1.order_id, "card");
    eq([late.status, late.needs_refund, late.needs_manual_refund], ["paid", false, false], "late but seats free");
    eq((await api.registrations.ticketsFor(ev.id)).length, 2, "tickets issued");
    // No seats: someone else holds them.
    const ev2 = await paidEvent(1000, 2);
    const o2 = await buy(ev2, 2);
    const slow = api.auth.current()!;
    fakeDev.expireCheckout(o2.order_id);
    const o3 = await buy(ev2, 2);
    fakeDev.completeCheckout(o3.order_id, "card");
    const lateCard = fakeDev.completeCheckout(o2.order_id, "card");
    eq([lateCard.status, lateCard.needs_refund, lateCard.needs_manual_refund], ["paid", true, false], "card: refund owed");
    fakeDev.signInAs(slow.id);
    eq((await api.registrations.ticketsFor(ev2.id)), [], "no tickets for the late buyer");
    // Bank transfer, same story.
    const ev3 = await paidEvent(1000, 1);
    const o4 = await buy(ev3, 1);
    const slow2 = api.auth.current()!;
    fakeDev.expireCheckout(o4.order_id);
    const o5 = await buy(ev3, 1);
    fakeDev.completeCheckout(o5.order_id, "card");
    const lateBank = fakeDev.completeCheckout(o4.order_id, "bank_transfer");
    eq([lateBank.needs_refund, lateBank.needs_manual_refund], [false, true], "bank: manual refund");
    // The host sees both as owed and neither as sold.
    as("Kredete");
    const s2 = await api.pay.sales(ev2.id);
    eq([s2.totals.sold, s2.refunds_owed], [2, 1], "sales: the late card order is owed, not sold");
    eq((await api.pay.sales(ev3.id)).refunds_owed, 1, "bank owed");
    void first;
    void slow2;
  });
});

await test("refund: card voids the tickets at once then settles; bank needs a manual refund; the seats come back", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(2000, 4);
    const o = await buy(ev, 2);
    const buyer = api.auth.current()!;
    fakeDev.completeCheckout(o.order_id, "card");
    const [t1] = await api.registrations.ticketsFor(ev.id);
    as("Kredete");
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 2, "two seats sold");
    await rejects(api.pay.refund("nope"), "Order not found", "unknown order");
    eq(await api.pay.refund(o.order_id), { method: "card", status: "refund_pending" }, "card refund");
    const mid = (await api.pay.eventOrders(ev.id))[0];
    eq([mid.status, mid.needs_manual_refund], ["refund_pending", false], "pending");
    eq((await api.events.get(ev.id))!.ticket_types[0].spots_left, 4, "seats back at once");
    eq((await api.door.scan(ev.id, t1.token, "express")).ok, false, "the QR is dead");
    await rejects(api.pay.refund(o.order_id), "A refund is already on its way.", "twice");
    eq((await api.pay.sales(ev.id)).totals.refunded_naira, 4000, "refunded gross counts");
    fakeDev.advance(2 * MINUTE);
    eq((await api.pay.eventOrders(ev.id))[0].status, "refunded", "refunded a minute later");
    await rejects(api.pay.refund(o.order_id), "This order was already refunded.", "again");
    fakeDev.signInAs(buyer.id);
    eq([(await api.events.viewerState(ev.id)).button, await api.registrations.ticketsFor(ev.id)], ["get_ticket", []], "no tickets left, can buy again");
    await rejects(api.pay.refund(o.order_id), "Not allowed", "the buyer cannot refund");

    // Bank transfer: tickets void, the host pays by hand.
    const o2 = await buy(ev, 1);
    fakeDev.completeCheckout(o2.order_id, "bank_transfer");
    as("Kredete");
    eq(await api.pay.refund(o2.order_id), { method: "manual", status: "manual_needed" }, "bank refund");
    const row = (await api.pay.eventOrders(ev.id)).find((x) => x.id === o2.order_id)!;
    eq([row.status, row.needs_manual_refund], ["paid", true], "manual task open");
    eq((await api.pay.sales(ev.id)).refunds_owed, 1, "owed");
    await rejects(api.pay.refund(o2.order_id), "A refund is already on its way.", "twice");
    await api.pay.markManualRefundDone(o2.order_id);
    const done = (await api.pay.eventOrders(ev.id)).find((x) => x.id === o2.order_id)!;
    eq([done.status, done.needs_manual_refund], ["refunded", false], "marked done");
    await rejects(api.pay.markManualRefundDone(o2.order_id), "There is nothing to mark.", "nothing to mark");
    // Staff may refund too.
    await buy(ev, 1).then((x) => fakeDev.completeCheckout(x.order_id, "card"));
    const o3 = (await api.pay.myOrders())[0];
    as("Hoppaz Staff");
    eq((await api.pay.refund(o3.id)).status, "refund_pending", "staff refund");
  });
});

await test("refund is refused when a ticket was checked in (tickets_used); a refund above the host balance is refused", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(2000);
    const o = await buy(ev, 2);
    fakeDev.completeCheckout(o.order_id, "card");
    const tickets = await api.registrations.ticketsFor(ev.id);
    as("Kredete");
    const scan = await api.door.scan(ev.id, tickets[1].token, "express");
    eq([scan.ok, scan.ok && scan.kind, scan.ok && scan.seat_no, scan.ok && scan.seats], [true, "checked_in", 2, 2], "scan reports the seat");
    await rejects(api.pay.refund(o.order_id), "tickets_used", "one ticket used");
    eq((await api.pay.eventOrders(ev.id))[0].status, "paid", "nothing changed");

    // A host whose only money is this sale cannot refund it: Hoppaz's fee is not returned, so the balance is short.
    const me = await newPerson();
    fakeDev.setPayoutOf(me.id, "ready");
    const mine = await api.events.create({ title: "Mine", tickets: PAID_TYPE(1000) });
    const o2 = await buy(mine, 1);
    fakeDev.completeCheckout(o2.order_id, "card");
    eq(fakeDev.hostBalance(me.id), 1000 - 45 - 20, "balance is the net");
    fakeDev.signInAs(me.id);
    await rejects(api.pay.refund(o2.order_id), "Not enough balance to refund yet", "balance too low");
    eq((await api.pay.eventOrders(mine.id))[0].status, "paid", "nothing changed");
  });
});

await test("door: check-in is per ticket; counts are tickets; a typed code finds one ticket; seats of an order check in alone", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(2000);
    const o = await buy(ev, 3);
    fakeDev.completeCheckout(o.order_id, "card");
    const buyer = api.auth.current()!;
    const tickets = await api.registrations.ticketsFor(ev.id);
    as("Kredete");
    eq(await api.door.counts(ev.id), { going: 3, checked_in: 0, pending: 0, waitlist: 0 }, "three tickets going");
    const c1 = await api.door.scan(ev.id, tickets[0].token, "express");
    eq(c1.ok && [c1.seat_no, c1.seats, c1.checked_in, c1.total], [1, 3, 1, 3], "seat 1 of 3");
    const again = await api.door.scan(ev.id, tickets[0].token, "express");
    eq(again.ok === false && again.kind === "already_used" && [again.seat_no, again.seats], [1, 3], "same QR twice");
    eq((await api.door.scan(ev.id, tickets[2].code, "standard")).ok && "confirm", "confirm", "typed code of seat 3 asks for confirmation");
    const c3 = await api.door.confirm(ev.id, tickets[2].code);
    eq(c3.ok && [c3.seat_no, c3.checked_in], [3, 2], "seat 3 by code");
    eq(await api.door.counts(ev.id), { going: 3, checked_in: 2, pending: 0, waitlist: 0 }, "two of three in");
    const reg = (await api.registrations.list(ev.id)).find((r) => r.user_id === buyer.id)!;
    eq([reg.status, reg.checked_in_count], ["going", 2], "not fully checked in yet");
    const byId = await api.door.checkInById(ev.id, reg.id);
    eq(byId.ok && [byId.seat_no, byId.checked_in], [2, 3], "by name: the next unused ticket");
    eq((await api.registrations.list(ev.id)).find((r) => r.user_id === buyer.id)!.status, "checked_in", "all three in");
    eq((await api.door.checkInById(ev.id, reg.id)).ok, false, "nothing left to check in");
  });
});

await test("sales: rows per type with both fees and net, totals add up, open orders counted", async () => {
  await withPaid(true, async () => {
    as("Kredete");
    const ev = await api.events.create({
      title: `Two types ${++n}`,
      tickets: [{ name: "Early", price_naira: 1000, capacity: null }, { name: "Table", price_naira: 5000, capacity: 4 }],
    });
    const [early, table] = ev.ticket_types;
    await newPerson();
    fakeDev.completeCheckout((await api.pay.checkout(ev.id, early.id, 3)).order_id, "card");
    await newPerson();
    fakeDev.completeCheckout((await api.pay.checkout(ev.id, table.id, 1)).order_id, "bank_transfer");
    await newPerson();
    fakeDev.completeCheckout((await api.pay.checkout(ev.id, table.id, 2)).order_id, "card");
    await newPerson();
    await api.pay.checkout(ev.id, early.id, 1); // left open
    as("Kredete");
    const s = await api.pay.sales(ev.id);
    eq(s.rows.map((r) => [r.name, r.sold, r.gross_naira, r.platform_fee_naira, r.processing_fee_naira, r.net_naira]), [
      ["Early", 3, 3000, 135, 60, 2805],
      ["Table", 3, 15_000, 675, 275, 14_050],
    ], "rows");
    const sum = (k: "sold" | "gross_naira" | "platform_fee_naira" | "processing_fee_naira" | "net_naira") => s.rows.reduce((n, r) => n + r[k], 0);
    eq(s.totals, { sold: sum("sold"), gross_naira: sum("gross_naira"), platform_fee_naira: sum("platform_fee_naira"), processing_fee_naira: sum("processing_fee_naira"), net_naira: sum("net_naira"), refunded_naira: 0 }, "totals are the sum of the rows");
    eq(s.totals.gross_naira - s.totals.platform_fee_naira - s.totals.processing_fee_naira, s.totals.net_naira, "gross less fees is net");
    eq([s.open_orders, s.refunds_owed], [1, 0], "one order still open");
    await newPerson();
    await rejects(api.pay.sales(ev.id), "Not allowed", "a guest cannot read sales");
    await rejects(api.pay.eventOrders(ev.id), "Not allowed", "nor the orders");
  });
});

await test("orders are private: the buyer, the host and staff only; the pay link goes only to the buyer", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1000);
    const o = await buy(ev, 1);
    eq((await api.pay.order(o.order_id)).checkout_url, o.checkout_url, "buyer has the link");
    await newPerson();
    await rejects(api.pay.order(o.order_id), "Order not found", "a stranger");
    as("Kredete");
    eq((await api.pay.order(o.order_id)).checkout_url, null, "host does not get the link");
    as("Hoppaz Staff");
    eq((await api.pay.order(o.order_id)).status, "open", "staff can read");
    await api.auth.signOut();
    await rejects(api.pay.myOrders(), "Sign in first", "signed out");
  });
});

await test("seeded paid event Afro Beach is buyable once the switch is on, and capacity counts held seats", async () => {
  await withPaid(true, async () => {
    const beach = seeded("Afro Beach Day Party");
    await newPerson();
    eq((await api.events.viewerState(beach.id)).button, "get_ticket", "get ticket");
    const o = await api.pay.checkout(beach.id, beach.ticket_types[0].id, 2);
    eq((await api.pay.order(o.order_id)).gross_naira, 6000, "2 x 3000");
    fakeDev.completeCheckout(o.order_id, "card");
    eq((await api.events.get(beach.id))!.going, beach.going + 2, "going counts tickets");
    eq((await api.events.viewerState(beach.id)).button, "going", "going");
    // Free register on a full event counts held seats: a 1 seat free event with a paid type held elsewhere is not a thing, so check the free path.
    as("Kredete");
    const mixed = await api.events.create({ title: `Mixed ${++n}`, capacity: 2, tickets: [{ name: "Free", price_naira: 0, capacity: null }, { name: "Paid", price_naira: 1000, capacity: null }] });
    await newPerson();
    await api.pay.checkout(mixed.id, mixed.ticket_types[1].id, 2);
    await newPerson();
    await rejects(api.registrations.register(mixed.id, { ticketTypeId: mixed.ticket_types[0].id }), "This event is full", "held seats fill the event for free tickets too");
  });
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
