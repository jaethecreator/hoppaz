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

const { icsEscape } = await import("../src/components/events-r1/page/icsEscape.ts");
const { eventPageUrl, siteOrigin } = await import("../src/lib/events-r1/siteUrl.ts");
const { roomCopyAllowed } = await import("../src/lib/events-r1/popRoom.ts");
const { paidTicketsOn } = await import("../src/lib/events-r1/flags.ts");
const { platformFeeNaira, processingFeeNaira } = await import("../src/lib/events-r1/payFee.ts");
const { CREATE_LIMIT, PAID_UNAVAILABLE } = await import("../src/lib/events-r1/constants.ts");
const geo = await import("../src/lib/geocode/lagos.ts");
const { parsePhoton } = await import("../src/lib/geocode/photon.ts");

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
  as("Lagos HQ");
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
  eq(await api.pops.shareText(pop.id), `Bring water please\n\nhttps://hoppaz.fun/event/${ev.slug}`, "share text");
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

await test("silent rate limit: the sixth event in an hour says to wait, never the number", async () => {
  as("Kredete");
  for (let i = 0; i < 5; i++) await api.events.create({ title: `Rate ${i}` });
  await rejects(api.events.create({ title: "Rate 5" }), CREATE_LIMIT, "sixth");
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
  for (const s of fakeDev.allEvents()) ok(s.listing ? s.ticket_types.length === 0 : s.ticket_types.length >= 1, `every seeded event has a type (a listing has none): ${s.title}`);
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
  eq([l.hq.name, l.hq.kind, l.hq.joined], ["Lagos HQ", "hq", true], "HQ");
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
  eq([l.hq.is_owner, l.hq.can_post, l.hq.has_3d, l.hq.three_d_on, l.hq.online], [false, false, true, true, 320], "HQ for a guest: a room exists and it is on (chat stays first), people online");
  eq((await api.rooms.get("hq"))?.id, l.hq.id, "/rooms/hq finds Lagos HQ");
  eq((await api.rooms.get("lagos-hq"))?.id, l.hq.id, "and its own slug");
  eq(l.mine.map((r) => [r.name, r.is_owner, r.can_post]).sort(), [["360Playlist", false, false], ["Lagos Run Club", false, false]], "a member is not an owner");
  eq(await api.rooms.mine(), [], "Ada owns no room");
  as("Kredete");
  const mine = await api.rooms.mine();
  eq(mine.map((r) => [r.name, r.is_owner, r.can_post]), [["Kredete", true, true]], "Kredete owns one room");
  as("Hoppaz Staff");
  const hq = await api.rooms.get("hq");
  eq([hq?.can_post, hq?.is_owner], [true, false], "an admin may post but is not the owner");
  const kred = (await api.rooms.get("kredete"))!;
  eq([kred.has_3d, kred.three_d_on], [false, false], "a plain crew has no 3D room");
  fakeDev.setHas3d(kred.id, true);
  eq([(await api.rooms.get("kredete"))?.has_3d, (await api.rooms.get("kredete"))?.three_d_on], [true, true], "give it one and it is on by default");
  const made = await api.rooms.create({ name: "Check Room" });
  eq([made.is_owner, made.can_post, made.has_3d, made.three_d_on, made.slug], [true, true, false, false, "check-room"], "a new room is the maker's");
  eq((await api.rooms.mine()).map((r) => r.name), ["Check Room"], "listed in mine");
});

await test("rooms: the 3D room switch (defaults, who may set it, Enter room needs both)", async () => {
  const enter = (r: { has_3d: boolean; three_d_on: boolean }) => r.has_3d && r.three_d_on;
  await rejects(api.rooms.setThreeD("360playlist", false), "Sign in first", "signed out");
  await rejects(api.rooms.listForStaff(), "Sign in first", "signed out list");
  as("Ada Obi");
  const get = async (k: string) => (await api.rooms.get(k))!;
  const p360 = await get("360playlist");
  const roof = await get("rooftop-sessions");
  const hq = await get("hq");
  const kred = await get("kredete");
  eq([p360.has_3d, p360.three_d_on, roof.has_3d, roof.three_d_on], [true, true, true, true], "default: 360Playlist and the brand rooms have a 3D room and it is on");
  eq([hq.has_3d, hq.three_d_on, enter(hq)], [true, true, true], "default: Lagos HQ has a room and it is on, so Enter room shows");
  eq([kred.has_3d, kred.three_d_on, enter(kred)], [false, false, false], "a crew with no 3D room: nothing to enter");
  eq([enter(p360), enter(roof)], [true, true], "Enter room shows for the brand rooms");
  eq((await api.rooms.list()).mine.find((r) => r.name === "360Playlist")?.three_d_on, true, "the Rooms tab carries the switch");

  // A member who does not own it cannot.
  await rejects(api.rooms.setThreeD(p360.id, false), "Not allowed", "a member");
  await rejects(api.rooms.setThreeD(hq.id, false), "Not allowed", "a member, on HQ");
  eq((await get("360playlist")).three_d_on, true, "nothing changed");
  await rejects(api.rooms.listForStaff(), "Not allowed", "a member may not list for staff");

  // The owner can, for their own room only.
  as("360Playlist");
  eq((await get("360playlist")).is_owner, true, "the viewer owns it");
  let heard = 0;
  const un = api.rooms.subscribe(() => heard++);
  await api.rooms.setThreeD(p360.id, false);
  un();
  ok(heard > 0, "subscribers are told");
  const off = await get("360playlist");
  eq([off.has_3d, off.three_d_on, enter(off)], [true, false, false], "off: the room is still there but Enter room goes");
  eq((await api.rooms.mine()).find((r) => r.id === p360.id)?.three_d_on, false, "mine() shows it off");
  await rejects(api.rooms.listForStaff(), "Not allowed", "an owner may not list for staff");
  await api.rooms.setThreeD("360playlist", true);
  eq((await get("360playlist")).three_d_on, true, "back on (by slug too)");
  await rejects(api.rooms.setThreeD(kred.id, true), "Not allowed", "not another owner's room");
  await rejects(api.rooms.setThreeD("no-such-room", true), "Room not found", "unknown room");

  // Staff can, for any room.
  as("Hoppaz Staff");
  await api.rooms.setThreeD(hq.id, false);
  eq([(await get("hq")).three_d_on, (await api.rooms.list()).hq.three_d_on], [false, false], "staff switch Lagos HQ off (the get and the list agree)");
  await api.rooms.setThreeD(hq.id, true);
  eq((await get("hq")).three_d_on, true, "and on again");
  await api.rooms.setThreeD(roof.id, false);
  eq((await get("rooftop-sessions")).three_d_on, false, "staff switch a brand room off");
  await api.rooms.setThreeD(roof.id, true);

  const all = await api.rooms.listForStaff();
  eq(all.length, 14, "staff list: every room (10 plus the 4 organiser rooms)");
  eq(all[0].kind, "hq", "Lagos HQ first");
  ok(all.slice(2).every((r, i) => all[i + 1].members >= r.members), "then the biggest first");
  ok(all.every((r) => typeof r.three_d_on === "boolean" && typeof r.has_3d === "boolean"), "each carries has_3d and three_d_on");
  ok(all.some((r) => !r.joined), "including rooms the staff user is not in");
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
  await rejects(api.rooms.postAnnouncement(ev.room_id!, "nope"), "Only the room's owner and admins can post here", "a guest cannot post");
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

await test("paid switch on: any host sells at once, bank details only to withdraw, 5% held for 30 days, paid a day after asking", async () => {
  await withPaid(true, async () => {
    // Hoppaz collects (26 Oct): a new host sells with no payout setup.
    const me = await newPerson();
    const hp = await api.pay.hostPayout();
    eq([hp.status, hp.can_sell], ["not_started", false], "new host: cannot withdraw yet");
    ok(hp.requirements_due.includes("The bank account for your payouts"), "plain words");
    const ev = await api.events.create({ title: "Mine", tickets: PAID_TYPE(10000) });
    eq(ev.ticket_types[0].price_naira, 10000, "a paid type saves with no payout setup");
    await newPerson();
    const o = await api.pay.checkout(ev.id, ev.ticket_types[0].id, 1);
    fakeDev.completeCheckout(o.order_id, "card");
    fakeDev.signInAs(me.id);
    let sum = await api.pay.payoutSummary();
    eq([sum.earned_naira, sum.reserved_naira, sum.available_naira, sum.account.ready], [9550, 478, 9072, false], "4.5 percent to Hoppaz, 5 percent of the share held");
    await rejects(api.pay.requestWithdrawal(), "Add your bank details first", "no bank yet");
    await rejects(api.pay.checkAccount("058", "0000000000"), "We couldn't find that account. Check the number and the bank.", "an account the bank does not know");
    const saved = await api.pay.setupPayout({ firstName: "Ada", lastName: "Obi", dob: "1995-06-15", line1: "1 Test Street", city: "Ikeja", state: "Lagos", bankCode: "058", accountNumber: "0123456789" });
    eq([saved.ready, saved.bank_label], [true, "GTBank Plc ending 6789"], "ready at once: name, date of birth, address, bank");
    const w = await api.pay.requestWithdrawal();
    eq([w.amount_naira, w.status], [9072, "requested"], "the whole available balance, sent a day later");
    await rejects(api.pay.requestWithdrawal(), "A withdrawal is already on its way", "one at a time");
    fakeDev.advance(25 * HOUR);
    sum = await api.pay.payoutSummary();
    eq([sum.open_withdrawal, sum.recent[0].status, sum.recent[0].received_naira, sum.available_naira], [null, "paid", 9022, 0], "reached the bank less the N50 fee");
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

/* ---------------------------------------------------- review fixes (UI) -- */

await test("share links use <site>/event/<slug>, never /e/", async () => {
  const was = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    eq(siteOrigin(), "https://hoppaz.fun", "fallback with no window");
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.hoppaz.test/";
    eq(siteOrigin(), "https://staging.hoppaz.test", "env wins, no trailing slash");
    eq(eventPageUrl({ slug: "open-mic-3fa", id: "x" }), "https://staging.hoppaz.test/event/open-mic-3fa", "slug link");
    eq(eventPageUrl({ slug: "", id: "abc" }), "https://staging.hoppaz.test/event/abc", "id when there is no slug");
  } finally {
    if (was === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = was;
  }
  const ev = await kredeteEvent();
  const text = await api.pops.shareText((await api.pops.send({ eventId: ev.id, body: "Hello", audience: "going", alsoRoom: false })).id);
  ok(text.includes(`/event/${ev.slug}`) && !text.includes("/e/"), `Pop share text: ${text}`);
});

await test(".ics text escapes backslash, semicolon, comma and every line break", async () => {
  eq(icsEscape("a;b,c\\d"), "a\\;b\\,c\\\\d", "semicolon, comma, backslash");
  eq(icsEscape("one\r\ntwo\rthree\nfour"), "one\\ntwo\\nthree\\nfour", "CRLF, CR and LF");
  eq(icsEscape("Plain text"), "Plain text", "plain text is left alone");
});

await test("Pops: an invite only event never copies to the room; a community event only for going or everyone", async () => {
  eq([roomCopyAllowed("invite", "going"), roomCopyAllowed("invite", "everyone")], [false, false], "invite");
  eq([roomCopyAllowed("community", "going"), roomCopyAllowed("community", "everyone"), roomCopyAllowed("community", "pending"), roomCopyAllowed("community", "waitlist")], [true, true, false, false], "community");
  eq(roomCopyAllowed("public", "pending"), true, "public is unchanged");

  const inv = await kredeteEvent({ visibility: "invite" });
  ok(inv.room_id, "the invite event sits in the room");
  const before = (await api.rooms.announcements(inv.room_id!)).length;
  eq((await api.pops.send({ eventId: inv.id, body: "Gate code 4411", audience: "going", alsoRoom: true })).also_room, false, "not marked");
  const at = new Date(Date.now() + HOUR).toISOString();
  await api.pops.send({ eventId: inv.id, body: "Gate code later", audience: "going", alsoRoom: true, sendAt: at });
  fakeDev.advance(2 * HOUR);
  eq((await api.rooms.announcements(inv.room_id!)).length, before, "nothing reached the room, now or when scheduled");

  const com = await kredeteEvent({ visibility: "community" });
  const cBefore = (await api.rooms.announcements(com.room_id!)).length;
  eq((await api.pops.send({ eventId: com.id, body: "For pending", audience: "pending", alsoRoom: true })).also_room, false, "pending: not copied");
  eq((await api.pops.send({ eventId: com.id, body: "For going", audience: "going", alsoRoom: true })).also_room, true, "going: copied");
  eq((await api.rooms.announcements(com.room_id!)).length, cBefore + 1, "one copy");
});

await test("decline: a paid registration cannot be declined (use Refund); a free one can", async () => {
  await withPaid(true, async () => {
    const ev = await paidEvent(1500);
    const o = await buy(ev, 1);
    fakeDev.completeCheckout(o.order_id, "card");
    as("Kredete");
    const reg = (await api.registrations.list(ev.id))[0];
    await rejects(api.registrations.decline(reg.id), "This ticket was paid for. Use Refund instead.", "paid decline");
    eq((await api.registrations.list(ev.id))[0].status, "going", "still going");
    await api.pay.refund(o.order_id);
    await api.registrations.decline(reg.id); // the refund voided the tickets: nothing is left to refuse
  });
  const free = await kredeteEvent({ requires_approval: true });
  await newPerson();
  await api.registrations.register(free.id);
  as("Kredete");
  const r = (await api.registrations.list(free.id))[0];
  eq((await api.registrations.decline(r.id)).status, "declined", "free request declined");
});

await test("reports: a hidden event still scans at the door, and an event with paid orders is never hidden", async () => {
  const report3 = async (id: string) => {
    for (let i = 0; i < 3; i++) {
      await newPerson();
      await api.reports.report(id, "wrong_place", `Report ${i}`);
    }
  };
  const ev = await kredeteEvent();
  await newPerson();
  await api.registrations.register(ev.id);
  const [t] = await api.registrations.ticketsFor(ev.id);
  await report3(ev.id);
  eq((await api.events.list()).some((e) => e.id === ev.id), false, "hidden from lists");
  as("Kredete");
  const scan = await api.door.scan(ev.id, t.token, "express");
  eq([scan.ok, scan.ok && scan.kind], [true, "checked_in"], "the door still scans");

  await withPaid(true, async () => {
    const paid = await paidEvent(1000);
    const o = await buy(paid, 1);
    fakeDev.completeCheckout(o.order_id, "card");
    await report3(paid.id);
    eq((await api.events.list()).some((e) => e.id === paid.id), true, "an event with a paid order stays listed");
  });
});

await test("place pin: lat/lng saved, nearest area when none is given, Lagos box, name length", async () => {
  // Each event is made by a new person: the silent limit is 5 events an hour per host.
  const pinned = async (extra: Record<string, unknown>) => {
    await newPerson();
    return api.events.create({ title: `Pin ${++n}`, ...extra });
  };
  // Ikeja City Mall: a pin and a name, no area. The area is the nearest one, the point is kept as given.
  const ikeja = await pinned({ place_name: "Ikeja City Mall", lat: 6.6143785, lng: 3.357768 });
  eq([ikeja.lat, ikeja.lng, ikeja.area, ikeja.venue_name], [6.6143785, 3.357768, "Ikeja", "Ikeja City Mall"], "Ikeja pin");
  const lekki = await pinned({ place_name: "Admiralty Way", lat: 6.4471791, lng: 3.4637346 });
  eq([lekki.lat, lekki.lng, lekki.area], [6.4471791, 3.4637346, "Lekki Phase 1"], "Lekki pin");
  const fp = await pinned({ place_name: "Freedom Park", lat: 6.4488192, lng: 3.3965307 });
  eq(fp.area, "Lagos Island", "Freedom Park is nearest Lagos Island");
  // A hybrid event keeps its pin too; an online one has none.
  const hybrid = await pinned({ kind: "hybrid", place_name: "Yaba Hub", lat: 6.5, lng: 3.38, link_type: "zoom", online_link: "https://zoom.us/j/123" });
  eq([hybrid.lat, hybrid.lng, hybrid.area], [6.5, 3.38, "Yaba"], "hybrid pin");
  const online = await pinned({ kind: "online", place_name: "Ignored", lat: 6.5, lng: 3.38, link_type: "zoom", online_link: "https://zoom.us/j/123" });
  eq([online.lat, online.lng, online.venue_name], [6.5, 3.42, ""], "online has no pin");
  // A host's own area still wins, and an unknown one is ignored.
  const own = await pinned({ place_name: "Somewhere", area: "Ajah", lat: 6.45, lng: 3.5 });
  eq([own.area, own.lat], ["Ajah", 6.45], "a known area is kept");
  const odd = await pinned({ place_name: "Somewhere", area: "Narnia", lat: 6.6, lng: 3.35 });
  eq(odd.area, "Ikeja", "an unknown area is ignored for the nearest one");
  // Outside the box: lagos_only, on every side. The corners themselves are inside.
  for (const [lat, lng] of [[6.29, 3.4], [6.81, 3.4], [6.5, 3.04], [6.5, 3.96], [51.5, -0.12], [0, 0]]) {
    await newPerson();
    await rejects(api.events.create({ title: "Out", place_name: "Far", lat, lng }), "Hoppaz is Lagos only for now", `outside ${lat},${lng}`);
  }
  for (const [lat, lng] of [[6.3, 3.05], [6.8, 3.95]]) eq((await pinned({ place_name: "Edge", lat, lng })).lat, lat, `inside at the edge ${lat},${lng}`);
  // A place name is 2 to 120 characters.
  await newPerson();
  await rejects(api.events.create({ title: "Short", place_name: "x", lat: 6.5, lng: 3.4 }), "Check the place and try again", "one letter");
  await rejects(api.events.create({ title: "Long", place_name: "x".repeat(121), lat: 6.5, lng: 3.4 }), "Check the place and try again", "121 letters");
  eq((await pinned({ place_name: "x".repeat(120), lat: 6.5, lng: 3.4 })).venue_name.length, 120, "120 letters is fine");
});

await test("place search helpers: the Lagos box, query cleaning, result filtering, Photon rows", async () => {
  ok(geo.inLagosBox(6.5, 3.4) && geo.inLagosBox(6.3, 3.05) && geo.inLagosBox(6.8, 3.95), "inside, edges included");
  ok(!geo.inLagosBox(6.29, 3.4) && !geo.inLagosBox(6.5, 3.96) && !geo.inLagosBox(NaN, 3.4) && !geo.inLagosBox("6.5", "3.4"), "outside, NaN and strings");
  eq(geo.clampToLagos(7, 2), { lat: 6.8, lng: 3.05 }, "clamped to the corner");
  eq(geo.clampToLagos(6.5, 3.4), { lat: 6.5, lng: 3.4 }, "inside is untouched");
  eq([geo.cleanQuery("  Ikeja   City  Mall "), geo.cleanQuery("ab"), geo.cleanQuery("   a  "), geo.cleanQuery("x".repeat(81)), geo.cleanQuery(null), geo.cleanQuery("x".repeat(80))?.length], ["Ikeja City Mall", null, null, null, null, 80], "query cleaning");

  const row = (name: string, lat: number, lng: number) => ({ id: `${name}${lat}`, name, address: "", lat, lng });
  const kept = geo.keepLagos([
    row("Far away", 51.5, -0.12),
    row("Ikeja City Mall", 6.6143, 3.3577),
    row("ikeja city mall", 6.6153, 3.3569), // the same place about 130 m away: dropped
    row("Ikeja City Mall", 6.65, 3.36), // another one with the same name 4 km away: kept
    row("", 6.5, 3.4),
    row("Edge", 6.3, 3.05),
    ...Array.from({ length: 10 }, (_, i) => row(`Place ${i}`, 6.4 + i * 0.01, 3.4)),
  ]);
  eq(kept.map((r) => r.name).slice(0, 3), ["Ikeja City Mall", "Ikeja City Mall", "Edge"], "filtered, in order");
  eq(kept.length, 6, "at most six");
  ok(kept.every((r) => geo.inLagosBox(r.lat, r.lng)), "all inside Lagos");

  eq(geo.spotFromSuggestion({ id: "1", name: "x", address: "12 Allen Avenue, Ikeja", lat: 6.6, lng: 3.35 }).place_name, "12 Allen Avenue, Ikeja", "a one letter name falls back to the address");
  eq(geo.spotFromSuggestion({ id: "1", name: "n".repeat(200), address: "", lat: 6.6, lng: 3.35 }).place_name.length, 120, "name cut to 120");
  eq(geo.readSpot({ place_name: "A", address: "B", lat: 6.5, lng: 3.4 }), { place_name: "A", address: "B", lat: 6.5, lng: 3.4 }, "a saved spot reads back");
  eq([geo.readSpot({ place_name: "A", lat: 9, lng: 3.4 }), geo.readSpot("x"), geo.readSpot(null), geo.readSpot({ lat: "6.5", lng: "3.4" })], [null, null, null, null], "a bad saved spot is dropped");
  eq([geo.spotName({ place_name: " Yaba Hub ", address: "", lat: 6.5, lng: 3.4 }), geo.spotName({ place_name: " ", address: "", lat: 6.5, lng: 3.4, manual: true }), geo.spotName(null)], ["Yaba Hub", "", ""], "spotName");
  eq(geo.mapsUrl(6.4488192, 3.3965307), "https://www.google.com/maps/search/?api=1&query=6.448819,3.396531", "maps link");

  const found = parsePhoton({
    features: [
      { geometry: { type: "Point", coordinates: [3.357768, 6.6143785] }, properties: { osm_id: 1, osm_type: "W", name: "Ikeja City Mall", housenumber: "174/194", street: "Obafemi Awolowo Way", district: "Agidingbi", city: "Ikeja", countrycode: "NG" } },
      { geometry: { type: "Point", coordinates: [3.4543, 6.443] }, properties: { osm_id: 2, osm_type: "W", name: "Admiralty Way", district: "Maroko", city: "Lekki Phase I", countrycode: "NG" } },
      { geometry: { type: "Point", coordinates: [2.4, 6.4] }, properties: { name: "Cotonou", countrycode: "BJ" } },
      { geometry: { type: "Point", coordinates: [3.4, 6.5] }, properties: { housenumber: "5", street: "Allen Avenue", countrycode: "NG" } },
      { geometry: { type: "Point" }, properties: { name: "No point" } },
      { geometry: { type: "Point", coordinates: [3.4, 6.5] }, properties: {} },
    ],
  });
  eq(found.length, 3, "Photon: no foreign rows, no rows without a point or a name");
  eq([found[0].name, found[0].address, found[0].lat, found[0].lng], ["Ikeja City Mall", "174/194 Obafemi Awolowo Way, Agidingbi, Ikeja", 6.6143785, 3.357768], "Photon: name, address, lat and lng the right way round");
  eq([found[1].address, found[2].name], ["Maroko, Lekki Phase I", "5 Allen Avenue"], "Photon: address without a street, unnamed house");
  eq([parsePhoton(null), parsePhoton({}), parsePhoton({ features: "no" })], [[], [], []], "Photon: junk in, nothing out");
});

await test("rooms: a new room has a profile, a unique editable address, and who can join", async () => {
  await newPerson();
  const made = await api.rooms.create({ name: "South Social", about: "Lagos nights.", links: { instagram: "@southsocial", x: "nonsense words", website: "southsocial.fun" }, join_mode: "ask" });
  eq([made.slug, made.about, made.join_mode, made.my_role, made.is_owner], ["south-social", "Lagos nights.", "ask", "owner", true], "profile");
  eq(made.links, { instagram: "https://instagram.com/southsocial", website: "https://southsocial.fun" }, "links: a handle becomes a link, junk is dropped");
  eq((await api.rooms.create({ name: "South Social" })).slug, "south-social-2", "the same name gets -2");
  await rejects(api.rooms.create({ name: "Other", slug: "south-social" }), "That address is taken", "taken");
  await rejects(api.rooms.create({ name: "Other", slug: "Bad Slug" }), "Use 3 to 40 letters, numbers and dashes", "shape");
  await rejects(api.rooms.create({ name: "Other", slug: "admin" }), "That address is taken", "reserved");
  await rejects(api.rooms.create({ name: "Other", about: "a".repeat(601) }), "Keep the about under 600 characters", "about");
  await rejects(api.rooms.create({ name: "X" }), "Give your room a longer name", "name");
  eq([await api.rooms.slugAvailable("south-social"), await api.rooms.slugAvailable("south-social", made.id), await api.rooms.slugAvailable("fresh-one")], [false, true, true], "availability");
  const edited = await api.rooms.update(made.id, { slug: "south-social-lagos", about: "New words", join_mode: "invite" });
  eq([edited.slug, edited.about, edited.join_mode], ["south-social-lagos", "New words", "invite"], "owner edits");
  eq((await api.rooms.get("south-social-lagos"))?.id, made.id, "found by the new address");
  await rejects(api.rooms.update(made.id, { slug: "south-social-2" }), "That address is taken", "the other room's address");
  fakeDev.resetAll();
  as("Ada Obi");
  await rejects(api.rooms.update((await api.rooms.list()).discover[0].id, { about: "x" }), "Not allowed", "a stranger cannot edit");
});

await test("rooms: join modes (open joins, ask requests and the owner decides, invite needs the code), Discover hides invite rooms", async () => {
  as("Ada Obi");
  const list = await api.rooms.list();
  ok(!list.discover.some((r) => r.slug === "amapiano-fridays"), "invite only is not in Discover");
  ok(list.discover.some((r) => r.slug === "naija-tech-meetup" && r.join_mode === "open"), "open is");
  eq((await api.rooms.get("amapiano-fridays")), null, "an invite room is not found without its code");
  const film = (await api.rooms.get("lagos-film-club"))!;
  eq([film.join_mode, film.request], ["ask", "pending"], "Ada's seeded request shows as pending");
  eq(await api.rooms.join(film.id), "requested", "asking again is the same request");
  eq(await api.rooms.join("naija-tech-meetup"), "joined", "open joins");
  eq(await api.rooms.join("naija-tech-meetup"), "already", "and again");
  // Invite only: needs the code, which the owner (here: staff) can read.
  as("Hoppaz Staff");
  const code = (await api.rooms.inviteCode((await api.rooms.list()).discover.find((r) => r.slug === "lagos-film-club")!.id)) ?? "";
  ok(code.startsWith("HZ"), "staff read an invite code");
  const ama = (await api.rooms.list()).mine.concat((await api.rooms.list()).discover);
  ok(!ama.some((r) => r.slug === "amapiano-fridays"), "still hidden");
  const amaId = (await api.rooms.listForStaff()).find((r) => r.slug === "amapiano-fridays")!.id;
  const amaCode = (await api.rooms.inviteCode(amaId))!;
  as("Ada Obi");
  await rejects(api.rooms.join(amaId), "This room is invite only", "no code");
  await rejects(api.rooms.join(amaId, { invite: "WRONG" }), "This room is invite only", "wrong code");
  eq((await api.rooms.get("amapiano-fridays", { invite: amaCode }))?.join_mode, "invite", "the code opens the page");
  eq(await api.rooms.join(amaId, { invite: amaCode.toLowerCase() }), "joined", "the code joins (any case)");
  // Ask: the owner approves, the person is a member and gets a notice; a decline is quiet.
  as("Lagos Run Club");
  const lrc = (await api.rooms.mine())[0];
  eq(lrc.pending_requests, 2, "the owner sees two waiting");
  const reqs = await api.rooms.requests(lrc.id);
  eq(reqs.map((r) => r.name), ["Chidi Okafor", "Ngozi Adeyemi"], "oldest first");
  await api.rooms.decideRequest(reqs[0].id, true);
  await api.rooms.decideRequest(reqs[1].id, false);
  await rejects(api.rooms.decideRequest(reqs[0].id, true), "That request is already answered", "twice");
  eq((await api.rooms.requests(lrc.id)).length, 0, "none waiting");
  as("Chidi Okafor");
  eq((await api.rooms.get(lrc.id))?.joined, true, "approved: a member");
  const notes = await api.rooms.notices();
  eq([notes.length, notes[0]?.kind, notes[0]?.room_slug], [1, "request_approved", "lagos-run-club"], "approved: one notice");
  await api.rooms.markNoticesSeen(notes.map((n) => n.id));
  eq((await api.rooms.notices()).length, 0, "seen");
  as("Ngozi Adeyemi");
  eq([(await api.rooms.get(lrc.id))?.joined, (await api.rooms.get(lrc.id))?.request, (await api.rooms.notices()).length], [false, "declined", 0], "declined: not a member, no notice");
  await rejects(api.rooms.join(lrc.id), "The room's owner has not accepted your request", "declined stays declined");
  as("Ada Obi");
  await rejects(api.rooms.requests(lrc.id), "Not allowed", "a visitor cannot list requests");
});

await test("rooms: roles (owner, admin, host, member): owners and admins run the room's events, a hidden host gets what a member gets", async () => {
  as("Kredete");
  const room = (await api.rooms.mine())[0];
  const people = await api.rooms.members(room.id);
  eq(people.map((m) => [m.name, m.role]), [["Kredete", "owner"], ["Bisi Ogunleye", "admin"], ["Tunde Balogun", "host"]], "members, owner first");
  ok(people.every((m) => Number.isFinite(Date.parse(m.joined_at))), "everyone has a join date");
  const bisi = people[1].user_id, tunde = people[2].user_id;
  eq((await api.rooms.get(room.id))?.my_role, "owner", "my role");
  eq((await api.rooms.managed()).map((r) => r.id), [room.id], "the owner manages their room");
  as("Bisi Ogunleye");
  eq([(await api.rooms.get(room.id))?.my_role, (await api.rooms.get(room.id))?.can_post], ["admin", true], "admin may post");
  eq((await api.rooms.managed()).map((r) => r.id), [room.id], "an admin manages the room too");
  await api.rooms.update(room.id, { about: "Admin was here" });
  await rejects(api.rooms.setRole(room.id, tunde, "admin"), "Only the owner changes admins", "admin cannot make an admin");
  await api.rooms.setRole(room.id, tunde, "member");
  await api.rooms.setRole(room.id, tunde, "host");
  // An admin runs an event they did not make: dashboard data, guests and the door.
  const kEvent = fakeDev.allEvents().find((e) => e.room_id === room.id && e.status !== "cancelled")!;
  ok((await api.registrations.list(kEvent.id)).length > 0, "an admin sees the guests of the room's event");
  eq(typeof (await api.door.counts(kEvent.id)).going, "number", "an admin opens the door of an event they did not make");
  eq((await api.events.viewerState(kEvent.id)).isHost, true, "and the event page knows they can manage it");
  as("Kredete");
  await rejects(api.rooms.setRole(room.id, (await api.rooms.members(room.id))[0].user_id, "member"), "Nobody changes the owner", "owner fixed");
  await api.rooms.setRole(room.id, bisi, "member");
  as("Tunde Balogun");
  const host = (await api.rooms.get(room.id))!;
  eq([host.my_role, host.can_post, host.is_owner], ["host", false, false], "a host cannot post announcements");
  eq((await api.rooms.managed()).length, 0, "a host manages no room");
  await rejects(api.rooms.update(room.id, { about: "x" }), "Not allowed", "a host cannot edit the profile");
  await rejects(api.rooms.setRole(room.id, bisi, "host"), "Not allowed", "a host cannot set roles");
  await rejects(api.registrations.list(kEvent.id), "Not allowed", "a host cannot see guests of an event they did not make");
  await rejects(api.door.counts(kEvent.id), "Not allowed", "a host cannot open the door of the room's event");
  eq((await api.events.viewerState(kEvent.id)).isHost, false, "and the event page does not treat them as a host");
  // A host's own event is not put in the room for them: only an owner's or an admin's is.
  const ev = await api.events.create({ title: "Made by Tunde" });
  eq(ev.room_id, null, "a host's event stays their own");
  eq((await api.door.counts(ev.id)).going, 0, "and they open the door of their own event");
  as("Ada Obi");
  await rejects(api.rooms.guestsNotJoined(room.id), "Not allowed", "a visitor cannot see guests");
  as("Kredete");
  await api.rooms.setRole(room.id, bisi, "admin");
  as("Bisi Ogunleye");
  const mine = await api.events.create({ title: "Made by Bisi" });
  eq(mine.room_id, room.id, "an admin's event is posted as the room");
  as("Kredete");
  eq((await api.door.counts(mine.id)).going, 0, "and the owner opens its door");
  await rejects(api.rooms.removeMember(room.id, people[0].user_id), "Nobody changes the owner", "the owner cannot be removed");
  await api.rooms.removeMember(room.id, tunde);
  ok(!(await api.rooms.members(room.id)).some((m) => m.user_id === tunde), "a removed member is out");
  as("Bisi Ogunleye");
  await rejects(api.rooms.removeMember(room.id, people[0].user_id), "Nobody changes the owner", "an admin cannot remove the owner");
  as("Ada Obi");
  await rejects(api.rooms.removeMember(room.id, bisi), "Not allowed", "a visitor cannot remove anyone");
});

await test("door staff: added per event, they scan but cannot manage or add anyone", async () => {
  as("Kredete");
  const room = (await api.rooms.mine())[0];
  const ev = fakeDev.allEvents().find((e) => e.room_id === room.id && e.kind !== "online" && e.status !== "cancelled")!;
  eq(await api.door.staff(ev.id), [], "no door staff yet");
  as("Ada Obi");
  const guest = { user_id: api.auth.current()!.id };
  await rejects(api.door.staff(ev.id), "Not allowed", "a guest cannot list door staff");
  await rejects(api.door.setStaff(ev.id, guest.user_id, true), "Not allowed", "a guest cannot add door staff");
  await rejects(api.door.counts(ev.id), "Not allowed", "and cannot scan");
  as("Kredete");
  await api.door.setStaff(ev.id, guest.user_id, true);
  eq((await api.door.staff(ev.id)).map((p) => p.user_id), [guest.user_id], "added");
  fakeDev.signInAs(guest.user_id);
  eq(typeof (await api.door.counts(ev.id)).going, "number", "door staff open the door");
  eq((await api.door.search(ev.id, "")).length > 0, true, "and search the guests");
  await rejects(api.registrations.list(ev.id), "Not allowed", "but cannot open the guest list");
  await rejects(api.door.staff(ev.id), "Not allowed", "or list door staff");
  await rejects(api.door.setStaff(ev.id, guest.user_id, false), "Not allowed", "or add more");
  as("Kredete");
  await api.door.setStaff(ev.id, guest.user_id, false);
  eq(await api.door.staff(ev.id), [], "removed");
  fakeDev.signInAs(guest.user_id);
  await rejects(api.door.counts(ev.id), "Not allowed", "and the door is shut for them again");
});

await test("rooms: a new joiner shows with today's date, and an admin posts an announcement", async () => {
  const p = await newPerson();
  void p;
  as("Kredete");
  const room = (await api.rooms.mine())[0];
  const before = (await api.rooms.members(room.id)).length;
  const q = await newPerson();
  await api.rooms.join(room.id);
  as("Kredete");
  const after = await api.rooms.members(room.id);
  eq(after.length, before + 1, "one more member");
  const j = after.find((m) => m.user_id === q.id)!;
  ok(Date.now() - Date.parse(j.joined_at) < 60_000, "joined just now");
  ok(after.filter((m) => Date.now() - Date.parse(m.joined_at) < 7 * 86_400_000).length === 1, "new this week counts only the joiner");
  await api.rooms.setRole(room.id, q.id, "admin");
  fakeDev.signInAs(q.id);
  const a = await api.rooms.postAnnouncement(room.id, "Admin note");
  eq(a.body, "Admin note", "an admin posts an announcement");
});

await test("room growth chart: 8 weekly totals worked back from today's count", async () => {
  const { growthWeeks } = await import("../src/components/events-r1/workspace/words.ts");
  const now = Date.parse("2026-10-29T08:00:00Z");
  const day = 864e5;
  const iso = (d: number) => new Date(now - d * day).toISOString();
  // 20 members today: 3 joined this week, 2 joined 3 weeks ago, the rest long ago.
  const w = growthWeeks(20, [iso(1), iso(2), iso(3), iso(20), iso(22), iso(200)], now);
  ok(w.length === 8, `8 weeks: ${w.length}`);
  ok(w[7] === 20, `last week is today's count: ${w[7]}`);
  ok(w[6] === 17, `a week ago, before this week's 3: ${w[6]}`);
  ok(w[0] === 15, `8 weeks ago, before all 5 recent joins: ${w[0]}`);
  ok(w.every((v, k) => k === 0 || v >= w[k - 1]), "never goes down");
  ok(growthWeeks(2, [iso(1), iso(1), iso(1)], now)[0] === 0, "never below zero");
});

await test("rooms: went but have not joined counts guests of the room's events who are not members", async () => {
  as("Kredete");
  const room = (await api.rooms.mine())[0];
  const g = await api.rooms.guestsNotJoined(room.id);
  const roomEvents = fakeDev.allEvents().filter((e) => e.room_id === room.id && e.status !== "cancelled");
  const going = new Set<string>();
  for (const e of roomEvents) for (const r of await api.registrations.list(e.id)) if (r.status === "going" || r.status === "checked_in") going.add(r.user_id);
  eq(g.count, going.size, "everyone going who is not a member");
  ok(g.count > 20 && g.guests.length === 50, "the first 50 are listed");
  // A new person registers for a room event: the count goes up by one. Then they join: it drops back.
  const open = roomEvents.find((e) => e.requires_approval === false && e.capacity === null && Date.parse(e.starts_at) > Date.now())!;
  const p = await newPerson();
  await api.registrations.register(open.id);
  as("Kredete");
  eq((await api.rooms.guestsNotJoined(room.id)).count, g.count + 1, "a new guest is counted");
  fakeDev.signInAs(p.id);
  await api.rooms.join(room.id);
  as("Kredete");
  eq((await api.rooms.guestsNotJoined(room.id)).count, g.count, "a joiner leaves the count");
  // A new room takes the host's own events, so its guests are there to bring in.
  await newPerson();
  const mine = await api.events.create({ title: "Before the room", add_to_room: false });
  const made = await api.rooms.create({ name: "After", event_ids: [mine.id] });
  eq((await api.events.get(mine.id))?.room_id, made.id, "the event moved into the new room");
});

await test("rooms: leave (members only, owners and HQ cannot), preview of an invite room, channels, old addresses resolve to a channel", async () => {
  as("Tunde Balogun");
  const book = (await api.rooms.get("yaba-book-club"))!;
  eq([book.joined, book.members], [true, 3], "Tunde is in the brand new room (owner and two others)");
  await api.rooms.leave(book.id);
  const after = (await api.rooms.get("yaba-book-club"))!;
  eq([after.joined, after.members], [false, 2], "left: not a member, one fewer");
  await rejects(api.rooms.leave(book.id), "You are not in this room", "leaving twice");
  as("Folake Adewale");
  await rejects(api.rooms.leave(book.id), "Owners can't leave", "owners cannot leave");
  const hq = (await api.rooms.get("hq"))!;
  await rejects(api.rooms.leave(hq.id), "Everyone is in Lagos HQ", "HQ cannot be left");
  // An invite only room has a name to show without the code, and nothing else.
  as("Ada Obi");
  const pv = await api.rooms.preview("amapiano-fridays");
  eq([pv?.slug, pv?.join_mode], ["amapiano-fridays", "invite"], "preview of an invite room");
  eq(await api.rooms.preview("no-such-room"), null, "preview of nothing");
  // Channels: open first, then upcoming, then closed.
  const roof = (await api.rooms.get("rooftop-sessions"))!;
  const states = (await api.rooms.channels(roof.id)).map((c) => c.state);
  const rank = { open: 0, upcoming: 1, closed: 2 } as const;
  ok(states.every((v, i) => i === 0 || rank[states[i - 1]] <= rank[v]), `channels are ordered open, upcoming, closed (${states.join(",")})`);
  // The address an old link resolves to.
  const { eventChatHref, enterPath } = await import("../src/components/events-r1/rooms/words.ts");
  eq(eventChatHref({ id: "e1", host: { roomId: "r1" } }), "/rooms/r1?ch=e1", "event chat href is a channel of the room page");
  eq(eventChatHref({ id: "e1", host: { roomId: null } }), null, "no room: no event chat");
  const { oldChatRedirect } = await import("../src/components/events-r1/rooms/words.ts");
  as("Ada Obi");
  const evs = await api.events.list();
  const withRoom = evs.find((e) => e.host.roomId)!;
  const noRoom = evs.find((e) => !e.host.roomId);
  eq(oldChatRedirect(withRoom), `/rooms/${withRoom.host.roomId}?ch=${withRoom.id}`, "/chat?c=<event> with a room goes to its channel");
  if (noRoom) eq(oldChatRedirect(noRoom), `/event/${noRoom.id}`, "/chat?c=<event> with no room goes to the event page");
  eq(oldChatRedirect({ id: "e2", host: { roomId: null } }), "/event/e2", "no room: the event page");
  eq(enterPath({ slug: "x", kind: "crew", id: "r1", has_3d: false, three_d_on: false }), "/rooms/x?ch=general", "no walkable room: Enter goes to General");
});

await test("saved checkout details: per person, kept, replaced and deleted", async () => {
  eq(await api.account.savedDetails(), null, "signed out: nothing");
  await rejects(api.account.saveDetails({ first_name: "A", last_name: "", email: "a@x.co", phone: "" }), "Sign in first", "signed out cannot save");
  as("Chidi Okafor");
  eq(await api.account.savedDetails(), null, "nothing saved yet");
  await api.account.saveDetails({ first_name: " Chidi ", last_name: "Okafor", email: "chidi@example.com", phone: "0803 555 2211" });
  eq(await api.account.savedDetails(), { first_name: "Chidi", last_name: "Okafor", email: "chidi@example.com", phone: "0803 555 2211" }, "kept, trimmed");
  await rejects(api.account.saveDetails({ first_name: "", last_name: "", email: "x@y.co", phone: "" }), "Add your name and email", "no first name is refused");
  await api.account.saveDetails({ first_name: "Chidi", last_name: "O", email: "c@new.co", phone: "" });
  eq((await api.account.savedDetails())?.email, "c@new.co", "saving again replaces");
  as("Bisi Ogunleye");
  eq(await api.account.savedDetails(), null, "someone else sees only their own");
  await api.account.deleteSavedDetails();
  as("Chidi Okafor");
  ok(await api.account.savedDetails(), "their delete did not touch mine");
  await api.account.deleteSavedDetails();
  eq(await api.account.savedDetails(), null, "deleted");
  await api.account.deleteSavedDetails();
});

await test("asking to join from You're going tells the host about the ticket", async () => {
  const lrc = (await api.rooms.get("lagos-run-club"))!;
  eq(lrc.join_mode, "ask", "the run club asks");
  const run = fakeDev.allEvents().find((e) => e.room_id === lrc.id && e.status === "live" && Date.parse(e.starts_at) > Date.now())!;
  as("Chidi Okafor");
  const reg = await api.registrations.register(run.id);
  eq(await api.rooms.join(lrc.id, { forEvent: run.id }), "requested", "an ask room: requested");
  as("Bisi Ogunleye");
  eq(await api.rooms.join(lrc.id, { forEvent: run.id }), "requested", "no ticket: still a request");
  as("Lagos Run Club");
  const list = await api.rooms.requests(lrc.id);
  const chidi = list.find((q) => q.name === "Chidi Okafor")!;
  const bisi = list.find((q) => q.name === "Bisi Ogunleye")!;
  const going = reg.status === "going" || reg.status === "checked_in";
  eq(chidi.ticket_event?.title ?? null, going ? run.title : null, "the ticket holder's request names the event");
  eq(bisi.ticket_event ?? null, null, "a plain request has none");
  as("Chidi Okafor");
  eq(await api.rooms.join("naija-tech-meetup", { forEvent: run.id }), "joined", "an open room joins at once, forEvent or not");
});

await test("registrations.mine: going, not ended, not cancelled, soonest first, own only", async () => {
  eq(await api.registrations.mine(), [], "signed out: nothing");
  as("Ada Obi");
  const mine = await api.registrations.mine();
  ok(mine.length > 0, "Ada has tickets");
  const now = Date.now();
  for (const m of mine) {
    eq(m.registration.status, "going", `going only: ${m.event.title}`);
    eq(m.registration.event_id, m.event.id, "registration and event match");
    ok(m.event.status !== "cancelled", "no cancelled event");
    ok((m.event.ends_at ? Date.parse(m.event.ends_at) : Date.parse(m.event.starts_at) + 3 * HOUR) > now, `not ended: ${m.event.title}`);
  }
  const starts = mine.map((m) => Date.parse(m.event.starts_at));
  eq(starts, [...starts].sort((a, b) => a - b), "soonest first");
  const one = mine[0].event.id;
  await api.registrations.cancel(one);
  ok(!(await api.registrations.mine()).some((m) => m.event.id === one), "a cancelled registration leaves the list");
  as("Chidi Okafor");
  eq(await api.registrations.mine(), [], "someone else sees only their own");
});

await test("Me hosting desk: workspaces, request numbers, live dots, tonight, the ME dot", async () => {
  const { buildDesk, liveNow } = await import("../src/components/events-r1/workspace/desk.ts");
  const desk = async () => {
    const [mine, rooms] = await Promise.all([api.events.listMine(), api.rooms.managed()]);
    const roomEvents: Record<string, Awaited<ReturnType<typeof api.events.listForRoom>>> = {};
    for (const r of rooms) roomEvents[r.id] = await api.events.listForRoom(r.id);
    return buildDesk({ mine, rooms, roomEvents, now: Date.now() });
  };
  as("Ada Obi");
  const ada = await desk();
  eq([ada.hosted, ada.workspaces.length, ada.tonight, ada.needsYou], [false, 0, null, false], "never hosted: the one row, no dot");
  as("Lagos Run Club");
  const lrc = await desk();
  eq(lrc.workspaces.map((w) => [w.name, w.role, w.href.startsWith("/rooms/") || w.href === "/host"]), [["Personal", null, true], ["Lagos Run Club", "Owner", true]], "Personal first, then the room");
  ok(lrc.workspaces[1].waiting >= 2 && lrc.needsYou, "join requests: a number and the dot");
  eq(lrc.workspaces[1].href, "/rooms/lagos-run-club/admin", "a room opens its admin");
  as("Bisi Ogunleye");
  eq((await desk()).workspaces.map((w) => w.role), [null, "Admin"], "an admin's room says Admin");
  as("360Playlist");
  const p = await desk();
  ok(p.workspaces[1].live && p.needsYou, "an event on now: the live dot and the ME dot");
  ok(p.tonight && liveNow(p.tonight, Date.now()), "tonight: the event that is on");
  as("Lagos HQ");
  const hq = await desk();
  eq(hq.workspaces.map((w) => w.name), ["Personal"], "Lagos HQ is never a workspace: Personal only");
  const t = { status: "live" as const, starts_at: new Date(Date.now() - 4 * HOUR).toISOString(), ends_at: null };
  eq(liveNow(t, Date.now()), false, "3 hours after the start with no end: over");
});

await test("reset clears user-made changes", async () => {
  const before = fakeDev.allEvents().length;
  await kredeteEvent();
  eq(fakeDev.allEvents().length, before + 1, "one more");
  fakeDev.resetAll();
  eq([fakeDev.allEvents().length, api.auth.current()], [before, null], "back to the seed, signed out");
});

/* ===================================================== outreach: listings, queue, claim ===== */

const L = await import("../src/lib/events-r1/listing.ts");
const { S: state } = await import("../src/lib/events-r1/fake/store.ts");
const { nameKey, normHandle, maskEmail, stageRefusal } = await import("../src/lib/events-r1/outreach/match.ts");
const { randomToken, sha256Hex, sha256HexSync } = await import("../src/lib/events-r1/outreach/token.ts");
const { draftFor, OPT_OUT } = await import("../src/lib/events-r1/outreach/drafts.ts");
const { OUTREACH_REASONS } = await import("../src/lib/events-r1/types.ts");
const { DEMO_CLAIM_TOKEN, DEMO_CLAIM_EMAIL } = await import("../src/lib/events-r1/fake/seedOutreach.ts");
const { eventView: viewOf } = await import("../src/lib/events-r1/fake/rules.ts");

const DAY = 24 * HOUR;
const EXTERNAL = "Tickets for this event are sold by the organiser";
const R = OUTREACH_REASONS;
const isoAt = (ms: number) => new Date(ms).toISOString();

/** A scout row. Each call is a new event unless source_id is given. */
let sn = 0;
function scoutEv(o: Record<string, unknown> = {}) {
  sn++;
  return {
    source_site: "Tix", source_id: `t-${sn}`, name: `Market Night ${sn}`, starts_at: isoAt(Date.now() + 10 * DAY), ends_at: null, venue: "Ikoyi Hall", area: "Ikoyi", lat: 6.45, lng: 3.43,
    pin_by: "venues", description: "", tickets: [{ name: "Regular", price_naira: 3000, sold_out: false }], sold_out: false, ticket_url: "https://tix.example.com/market",
    flyer_url: null, category: "party", organiser_name: "Ikoyi Night Market", organiser_handle: "ikoyinightmkt", event_handle: null, organiser_email: null, organiser_phone: null,
    lineup: [], capacity: null, last_seen: isoAt(Date.now()), confidence: "confirmed", ...o,
  } as never as Parameters<typeof api.outreach.importBatch>[0]["events"][number];
}
const batchOf = (events: ReturnType<typeof scoutEv>[], covered: string[] = ["Tix"]) => ({ run_id: `run-${++sn}`, scouted_at: isoAt(Date.now()), sources_covered: covered, events });
const orgByName = async (name: string) => {
  const o = (await api.outreach.organisers()).find((x) => x.name === name);
  if (!o) throw new Error(`no organiser ${name}`);
  return o;
};
/** Import one event and approve it. */
async function listIt(o: Record<string, unknown> = {}) {
  const ev = scoutEv(o);
  await api.outreach.importBatch(batchOf([ev]), { dryRun: false });
  const row = (await api.outreach.queue()).find((p) => p.source_id === ev.source_id)!;
  const res = await api.outreach.approve(row.id, "Jae");
  return { ev, row, ...res };
}
const roomIdOf = async (eventId: string) => (await api.events.get(eventId))!.room_id!;
async function throws(p: Promise<unknown>, what: string): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error(`${what}: expected it to throw`);
}

await test("outreach seed: six organisers in every stage, a queue of six, the Listings account hidden", async () => {
  const orgs = await api.outreach.organisers();
  eq(orgs.map((o) => o.stage).sort(), ["claimed", "declined", "listed", "listed", "offered", "pulled"], "every stage");
  const wavy = orgs.find((o) => o.name === "Wavy Nights Lagos")!;
  eq([wavy.do_not_contact, wavy.room_id], [true, null], "declined: do not contact, no room");
  const afro = orgs.find((o) => o.name === "Afrobeats Island Parties")!;
  eq([afro.transfer_pending, afro.stage], [true, "offered"], "offered with a pending link");
  const lekki = orgs.find((o) => o.name === "Lekki Social Club")!;
  eq([lekki.events_total, lekki.room_slug], [2, "lekki-social-club"], "listed with 2 listings and a room");
  const queue = await api.outreach.queue();
  eq(queue.length, 6, "six rows in the queue");
  const flagsOf = (n: string) => queue.find((p) => p.fields.name === n && p.status !== "merged")!.flags;
  ok(flagsOf("Island Pool Party").includes("no_time"), "the lead has no time");
  ok(queue.some((p) => p.status === "blocked" && p.flags.includes("blocked")), "a blocked row");
  ok(queue.some((p) => p.status === "approved" && p.flags.includes("gone")), "an approved row gone from the source");
  ok(queue.some((p) => p.status === "approved" && p.flags.includes("moved")), "an approved row whose start moved");
  const dup = queue.filter((p) => p.fields.name === "Detty December Warm Up");
  eq([dup.length, new Set(dup.map((p) => p.source_site)).size, dup.filter((p) => p.flags.includes("duplicate")).length], [2, 2, 1], "a duplicate pair across two sites");
  // Listings: free, from-with-range, sold out, unknown price.
  const lines = new Map((await api.events.list()).filter((e) => e.listing).map((e) => [e.title, e]));
  eq(L.priceLine(lines.get("Lekki Social Brunch")!), "Free", "free");
  eq(L.priceLine(lines.get("Sundown Sessions at Elegushi")!), "From ₦5,000", "from, with a range");
  eq(L.priceLine(lines.get("Open Mic Night Yaba")!), "Check listing", "unknown price");
  eq([lines.get("Afro Island Boat Cruise")!.listing!.sold_out, L.ticketButtonLabel(lines.get("Afro Island Boat Cruise")!)], [true, "See the listing"], "sold out at the source");
  eq(L.priceLine(lines.get("Highlife Under the Stars")!), "₦8,000", "one price");
  eq([L.ticketHref(lines.get("Open Mic Night Yaba")!), L.ticketHref(lines.get("Sundown Sessions at Elegushi")!)], ["https://instagram.com/mainlandmic", "https://tix.example.com/sundown-sessions-elegushi"], "ticket link, else the Instagram post");
  eq([L.listedByLine(lines.get("Open Mic Night Yaba")!), L.listedByLine(lines.get("Highlife Under the Stars")!)], ["Listed by Hoppaz", "Hosted by Surulere Sound Collective"], "listed by Hoppaz, then hosted by the claimed organiser");
  ok(![...lines.values()].some((e) => L.showsCounts(e)), "no counts for a listing");
  for (const e of lines.values()) eq([e.ticket_types, e.going, e.spots_left], [[], 0, null], `listing shape: ${e.title}`);
  // Nobody signs in as the Listings account.
  ok(!fakeDev.users().some((u) => u.name === "Hoppaz Listings"), "not in the sign-in list");
  const id = Object.values(state().users).find((u) => u.name === "Hoppaz Listings")!.id;
  ok(!!id && (() => { try { fakeDev.signInAs(id); return false; } catch { return true; } })(), "cannot sign in as it");
  const e = await api.events.get(lines.get("Open Mic Night Yaba")!.id);
  eq(e!.host.name, "Hoppaz Listings", "the host is the Listings account");
});

await test("listings: nobody can register, buy or check out, signed in or not; the button says external", async () => {
  const mic = (await api.events.list()).find((e) => e.title === "Open Mic Night Yaba")!;
  await rejects(api.registrations.register(mic.id), "Sign in first", "signed out");
  await newPerson();
  await rejects(api.registrations.register(mic.id), EXTERNAL, "register");
  fakeDev.setPaid(true);
  const tix = (await api.events.list()).find((e) => e.title === "Sundown Sessions at Elegushi")!;
  await rejects(api.pay.quote(tix.id, "x", 1), EXTERNAL, "quote");
  await rejects(api.pay.checkout(tix.id, "x", 1), EXTERNAL, "checkout");
  await rejects(api.pay.checkout(mic.id, "x", 1), EXTERNAL, "checkout, unknown price");
  eq((await api.events.viewerState(tix.id)).button, "external", "button: external");
  eq(Object.values(state().orders).filter((o) => o.event_id === tix.id).length + Object.values(state().regs).filter((r) => r.event_id === tix.id).length, 0, "no order or registration was made");
  eq(await api.registrations.mine(), [], "nothing in Me");
  // The door finds nothing to scan and a stranger cannot host it.
  await rejects(api.events.update(tix.id, { title: "Mine now" }), "Not allowed", "a stranger cannot edit a listing");
  await rejects(api.events.cancel(tix.id), "Not allowed", "nor cancel it");
  await rejects(api.events.sellOnHoppaz(tix.id, [{ name: "General", price_naira: 0, capacity: null }]), "Not allowed", "nor sell on Hoppaz");
  // Staff can manage it.
  as("Hoppaz Staff");
  const upd = await api.events.update(tix.id, { description: "Updated by staff" });
  eq([upd.listing?.price_from, upd.ticket_types.length], [5000, 0], "staff edit keeps it a listing");
  await rejects(api.events.clone(tix.id), R.not_claimed, "an unclaimed listing is not cloned");
  fakeDev.setPaid(false);
});

await test("a scrape lands in the queue, not on the app; approved it appears with the right price and ticket link", async () => {
  const before = (await api.events.list()).length;
  const orgsBefore = (await api.outreach.organisers()).length;
  const a = scoutEv({ name: "Ikoyi Night Market One" });
  const b = scoutEv({ name: "Ikoyi Night Market Two", tickets: [{ name: "Regular", price_naira: 3000, sold_out: false }, { name: "VIP", price_naira: 12000, sold_out: false }] });
  const dry = await api.outreach.importBatch(batchOf([a, b], []), { dryRun: true });
  eq([dry.dry_run, dry.new, dry.organisers_new, dry.organisers_matched], [true, 2, 1, 0], "dry run reports");
  eq([(await api.outreach.queue()).length, (await api.outreach.organisers()).length, (await api.events.list()).length], [6, orgsBefore, before], "a dry run wrote nothing");
  const rep = await api.outreach.importBatch(batchOf([a, b], []), { dryRun: false });
  eq([rep.new, rep.updated, rep.unchanged, rep.blocked, rep.skipped, rep.organisers_new], [2, 0, 0, 0, 0, 1], "applied");
  eq((await api.events.list()).length, before, "the app shows nothing new");
  eq(await api.events.get(a.source_id), null, "no event for it");
  const queue = await api.outreach.queue();
  eq(queue.length, 8, "two more in the queue");
  const rowA = queue.find((p) => p.source_id === a.source_id)!;
  const rowB = queue.find((p) => p.source_id === b.source_id)!;
  eq([rowA.status, rowA.organiser_stage, rowA.event_id], ["new", "pulled", null], "a new row, organiser pulled");
  const ok1 = await api.outreach.approve(rowA.id, "Jae");
  const ok2 = await api.outreach.approve(rowB.id, "Jae");
  const evA = (await api.events.get(ok1.eventId))!;
  const evB = (await api.events.get(ok2.eventId))!;
  eq([L.priceLine(evA), L.ticketHref(evA), evA.listing?.source_site], ["₦3,000", "https://tix.example.com/market", "Tix"], "price and ticket link");
  eq([L.priceLine(evB), evB.listing?.price_to], ["From ₦3,000", 12000], "from, with the top price kept");
  eq([(await api.events.list()).length, (await api.outreach.organisers()).find((o) => o.name === "Ikoyi Night Market")!.stage], [before + 2, "listed"], "on the app, organiser listed");
  eq(evA.room_id, evB.room_id, "one room for the organiser, not one per event");
  // Nobody can register or buy, after signing in as a normal user too.
  await newPerson();
  await rejects(api.registrations.register(evA.id), EXTERNAL, "register");
  fakeDev.setPaid(true);
  await rejects(api.pay.checkout(evB.id, evB.ticket_types[0]?.id ?? "x", 1), EXTERNAL, "checkout");
  fakeDev.setPaid(false);
  as("Ada Obi");
  await rejects(api.registrations.register(evA.id), EXTERNAL, "register as Ada");
  // The dormant room is hidden: not in Discover, not found by its address for a stranger.
  const room = (await api.outreach.organiser(ok1.organiserId)).organiser;
  eq(await api.rooms.get(room.room_slug!), null, "the dormant room is invite only");
  ok(!(await api.rooms.list()).discover.some((r) => r.slug === room.room_slug), "not in Discover");
  ok(!!(await api.rooms.preview(room.room_slug!)), "but the claim page can preview it");
});

await test("a rerun creates no duplicates; edited fields are kept; the start moving is flagged", async () => {
  const x = await listIt({ name: "Rerun Night" });
  // A dry run that would flag rows as gone writes nothing.
  const dry = await api.outreach.importBatch(batchOf([], ["Tix"]), { dryRun: true });
  ok(dry.flagged_gone > 0 && !Object.values(state().pulled).some((p) => p.id === x.row.id && p.missing_since), "a dry run reports gone rows but flags none");
  const total = (await api.events.list()).length;
  const pulledCount = Object.keys(state().pulled).length;
  const orgCount = (await api.outreach.organisers()).length;
  const same = await api.outreach.importBatch(batchOf([x.ev]), { dryRun: false });
  eq([same.new, same.unchanged, same.organisers_matched, same.organisers_new], [0, 1, 1, 0], "the same batch again");
  eq([(await api.events.list()).length, Object.keys(state().pulled).length, (await api.outreach.organisers()).length], [total, pulledCount, orgCount], "no new event, row or organiser");
  // The source changes the price, the start and sold out. The listing follows.
  const later = isoAt(Date.parse(x.ev.starts_at!) + 2 * DAY);
  const moved = { ...x.ev, starts_at: later, tickets: [{ name: "Regular", price_naira: 4500, sold_out: false }], sold_out: true };
  const r2 = await api.outreach.importBatch(batchOf([moved]), { dryRun: false });
  eq([r2.updated, r2.new], [1, 0], "updated, not new");
  const ev = (await api.events.get(x.eventId))!;
  eq([L.priceLine(ev), ev.starts_at, ev.listing?.sold_out], ["₦4,500", later, true], "price, time and sold out follow the source");
  ok((await api.outreach.queue()).some((p) => p.id === x.row.id && p.flags.includes("moved")), "flagged moved in the queue");
  // Staff edit the ticket link. The next scrape keeps it.
  await api.outreach.edit(x.row.id, { ticket_url: "https://pay.example.com/the-right-one" });
  await api.outreach.importBatch(batchOf([{ ...moved, ticket_url: "https://tix.example.com/other" }]), { dryRun: false });
  const kept = (await api.events.get(x.eventId))!;
  eq(L.ticketHref(kept), "https://pay.example.com/the-right-one", "the edited ticket link is kept");
  const row = (await api.outreach.queue()).find((p) => p.id === x.row.id)!;
  ok(row.edited.includes("ticket_url"), "the row remembers what was edited");
  // The source stops showing it: gone. Seen again: cleared.
  await api.outreach.importBatch(batchOf([scoutEv({ name: "Other" })]), { dryRun: false });
  const gone = (await api.outreach.queue()).find((p) => p.id === x.row.id)!;
  ok(gone.flags.includes("gone") && !!gone.missing_since, "gone from the source");
  await api.outreach.importBatch(batchOf([moved]), { dryRun: false });
  ok(!(await api.outreach.queue()).find((p) => p.id === x.row.id)?.flags.includes("gone"), "seen again clears it");
  // A batch that does not cover this source does not flag it.
  await api.outreach.importBatch(batchOf([], ["Luma"]), { dryRun: false });
  ok(!(await api.outreach.queue()).find((p) => p.id === x.row.id)?.flags.includes("gone"), "a source not covered flags nothing");
});

await test("import: matches by handle, name and email; blocked organisers; bad rows are skipped; claimed listings are not touched", async () => {
  const rep = await api.outreach.importBatch(
    batchOf([
      scoutEv({ organiser_name: "Totally Different Label", organiser_handle: "@LekkiSocialClub" }), // by handle
      scoutEv({ organiser_name: "Mainland  MIC collective!", organiser_handle: null }), // by name key
      scoutEv({ organiser_name: "Someone", organiser_handle: null, organiser_email: "bookings@afroisland.example.com" }), // by email
      scoutEv({ organiser_name: "Wavy Nights Lagos", organiser_handle: "wavynightslagos" }), // declined
      scoutEv({ name: "  ", source_id: "bad-1" }), // no name
      scoutEv({ starts_at: "next friday", source_id: "bad-2" }), // bad time
    ]),
    { dryRun: false },
  );
  eq([rep.new, rep.blocked, rep.skipped, rep.organisers_matched, rep.organisers_new], [3, 1, 2, 4, 0], "three new, one blocked, two skipped");
  eq(rep.lines.map((l) => l.action), ["new", "new", "new", "blocked", "skipped", "skipped"], "per line");
  const queue = await api.outreach.queue();
  const by = (o: string) => queue.filter((p) => p.organiser_name === o && p.status === "new").length;
  eq([by("Lekki Social Club"), by("Mainland Mic Collective"), by("Afrobeats Island Parties")], [1, 1, 1], "matched to the right organiser");
  eq((await api.outreach.organisers()).length, 6, "no organiser was made");
  // A claimed listing is never touched: only flagged changed.
  const sound = await orgByName("Surulere Sound Collective");
  const detail = await api.outreach.organiser(sound.id);
  const ev = (await api.events.get(detail.events[0].id))!;
  const row = state().pulled[Object.keys(state().pulled).find((k) => state().pulled[k].event_id === ev.id)!];
  const src = { ...row.fields, tickets: [{ name: "Regular", price_naira: 9999, sold_out: false }], starts_at: isoAt(Date.parse(row.fields.starts_at!) + DAY) };
  const r = await api.outreach.importBatch(batchOf([src as never]), { dryRun: false });
  eq(r.updated, 1, "the row is updated");
  const after = (await api.events.get(ev.id))!;
  eq([after.listing?.price_from, after.starts_at, after.host.name], [8000, ev.starts_at, "Tola Ajayi"], "the claimed listing is untouched");
  ok((await api.outreach.queue()).find((p) => p.id === row.id)!.flags.includes("changed"), "flagged changed");
});

await test("a duplicate across two sites is flagged and can be folded; a lead with no time needs one before it goes live", async () => {
  const day = isoAt(Date.now() + 14 * DAY);
  const a = scoutEv({ name: "Same Night!", source_site: "Tix", starts_at: day });
  const b = scoutEv({ name: "same night", source_site: "Eventbrite", starts_at: isoAt(Date.parse(day) + HOUR) });
  await api.outreach.importBatch(batchOf([a, b], ["Tix", "Eventbrite"]), { dryRun: false });
  const q = await api.outreach.queue();
  const ra = q.find((p) => p.source_id === a.source_id)!;
  const rb = q.find((p) => p.source_id === b.source_id)!;
  eq([ra.flags.includes("duplicate"), rb.flags.includes("duplicate"), rb.duplicate_of], [false, true, ra.id], "the second is flagged");
  await api.outreach.merge(rb.id, ra.id, "Jae");
  const q2 = await api.outreach.queue();
  ok(!q2.some((p) => p.id === rb.id), "the folded row leaves the queue");
  eq(q2.find((p) => p.id === ra.id)!.also_at.map((x) => x.source_site), ["Eventbrite"], "the other source is kept");
  await api.outreach.importBatch(batchOf([a, b], ["Tix", "Eventbrite"]), { dryRun: false });
  ok(!(await api.outreach.queue()).some((p) => p.id === rb.id), "a rerun does not bring it back");
  // A lead with no time.
  const lead = scoutEv({ name: "Lead Party", starts_at: null, confidence: "lead", tickets: [], ticket_url: null });
  await api.outreach.importBatch(batchOf([lead]), { dryRun: false });
  const lr = (await api.outreach.queue()).find((p) => p.source_id === lead.source_id)!;
  ok(lr.flags.includes("no_time") && lr.flags.includes("no_price"), "flagged");
  await rejects(api.outreach.approve(lr.id, "Jae"), "This event has no start time yet. Add one first", "no time");
  const done = await api.outreach.approve(lr.id, "Jae", { starts_at: isoAt(Date.now() + 20 * DAY) });
  const ev = (await api.events.get(done.eventId))!;
  eq([L.priceLine(ev), L.ticketHref(ev)], ["Check listing", null], "unknown price, no link");
  // A reject stays rejected on a rerun.
  const c = scoutEv({ name: "Not For Us" });
  await api.outreach.importBatch(batchOf([c]), { dryRun: false });
  const cr = (await api.outreach.queue()).find((p) => p.source_id === c.source_id)!;
  await api.outreach.reject(cr.id, "Jae", "Not a Lagos event");
  await api.outreach.importBatch(batchOf([c]), { dryRun: false });
  ok(!(await api.outreach.queue()).some((p) => p.id === cr.id), "a rejected row is not brought back");
});

await test("outreach is tracked: contact log, last contacted, stages, the week", async () => {
  const x = await listIt({ name: "Tracked Night", organiser_name: "Tracked Collective", organiser_handle: "trackedcollective" });
  const org0 = (await api.outreach.organiser(x.organiserId)).organiser;
  eq([org0.stage, org0.last_contacted_at], ["listed", null], "starts listed, never contacted");
  await api.outreach.logContact(x.organiserId, { by: "Jae", kind: "contact", channel: "instagram", body: "Sent the first message" });
  const o = (await api.outreach.organiser(x.organiserId)).organiser;
  eq([o.last_contacted_by, o.stage, !!o.last_contacted_at], ["Jae", "listed", true], "contact sets last contacted, the stage stays");
  await api.outreach.logContact(x.organiserId, { by: "Jae", kind: "reply", channel: "instagram", body: "They said send details" });
  await api.outreach.logContact(x.organiserId, { by: "Jae", kind: "note", body: "Owner is called Seun" });
  await rejects(api.outreach.logContact(x.organiserId, { by: "Jae", kind: "reply", body: "  " }), "Write a note first", "an empty reply");
  const d1 = await api.outreach.organiser(x.organiserId);
  eq(d1.log.map((l) => l.kind).slice(0, 3), ["note", "reply", "contact"], "newest first");
  eq(d1.organiser.stage, "listed", "a reply does not move the stage");
  const off = await api.outreach.setStage(x.organiserId, "offered", "Jae");
  eq(off.stage, "offered", "offered by hand");
  const wk = await api.outreach.week();
  ok(wk.contacted >= 1 && wk.replies >= 1 && wk.offers >= 1, `the week counts it: ${JSON.stringify([wk.contacted, wk.replies, wk.offers])}`);
  eq(wk.stages.offered, 2, "stages now");
  eq(wk.previous.contacted, 3, "the week before: the three seeded first messages");
  ok(wk.waiting.some((w) => w.name === "Lekki Social Club" && w.days >= 9), "Lekki has waited 9 days");
  ok(!wk.waiting.some((w) => w.id === x.organiserId), "contacted today: not waiting");
  await rejects(api.outreach.setStage(x.organiserId, "claimed" as never, "Jae"), "Not found", "claimed is never set by hand");
  const sound = await orgByName("Surulere Sound Collective");
  await rejects(api.outreach.setStage(sound.id, "declined", "Jae"), "They own this room now, so Hoppaz cannot change it", "a claimed organiser is not moved");
  const handle = await api.outreach.saveOrganiser(x.organiserId, { ig_handle: "@NewHandle.x", email: "Seun@Example.com", notes: "Called" });
  eq([handle.ig_handle, handle.email], ["newhandle.x", "seun@example.com"], "saved, cleaned");
  await rejects(api.outreach.saveOrganiser(x.organiserId, { ig_handle: "lekkisocialclub" }), "Another organiser already has that Instagram handle", "handle taken");
  await rejects(api.outreach.saveOrganiser(x.organiserId, { email: "nope" }), R.bad_email, "bad email");
});

await test("transfer: made once, only the hash is kept; works for the right email only, and only once", async () => {
  const x = await listIt({ name: "Claim Night", organiser_name: "Claim Collective", organiser_handle: "claimcollective" });
  const roomId = await roomIdOf(x.eventId);
  const made = await api.outreach.createTransfer(x.organiserId, "  Seun@Example.com ", "Jae");
  const token = made.link.split("/claim/")[1];
  ok(made.link.includes("/claim/") && token.length >= 40, "a link with a long token");
  eq([made.transfer.to_email, made.transfer.status, made.transfer.kind], ["seun@example.com", "pending", "claim"], "lower cased, pending");
  eq(Math.round((Date.parse(made.transfer.expires_at) - Date.parse(made.transfer.created_at)) / DAY), 14, "14 days by default");
  const stored = Object.values(state().transfers).find((t) => t.id === made.transfer.id)!;
  eq(stored.token_hash, await sha256Hex(token), "the hash of the token is stored");
  ok(!JSON.stringify(state()).includes(token), "the token itself is stored nowhere");
  eq((await api.outreach.organiser(x.organiserId)).organiser.stage, "offered", "the stage moved to offered");
  await rejects(api.outreach.createTransfer(x.organiserId, "seun@example.com", "Jae"), R.already_pending, "a second link for the same email");
  await rejects(api.outreach.createTransfer(x.organiserId, "not an email", "Jae"), R.bad_email, "bad email");
  // The preview never gives the full email.
  const pv = await api.claims.preview(token);
  ok(pv.ok, "preview works signed out");
  if (pv.ok) {
    eq([pv.email_hint, pv.room.name, pv.organiser_name, pv.events.map((e) => e.id)], ["s***@example.com", "Claim Collective", "Claim Collective", [x.eventId]], "preview");
    ok(!JSON.stringify(pv).includes("seun@example.com"), "no full email");
  }
  eq(await api.claims.preview("nonsense"), { ok: false, reason: "not_found" }, "a bad link never throws");
  // Signed out, then the wrong person, then the right one.
  await rejects(api.claims.accept(token), "Sign in first", "signed out");
  await api.auth.sendCode("wrong@example.com");
  await api.auth.verifyCode("wrong@example.com", "123456", "Wrong Person");
  await rejects(api.claims.accept(token), R.wrong_email, "wrong email");
  eq((await api.claims.preview(token)).ok, true, "a wrong email does not burn the link");
  eq((await api.events.get(x.eventId))!.host.name, "Hoppaz Listings", "nothing moved");
  // No account yet: signing in with the code creates it, and then the link works.
  await api.auth.signOut();
  await api.auth.sendCode("seun@example.com");
  const seun = await api.auth.verifyCode("seun@example.com", "654321", "Seun Bello");
  const out = await api.claims.accept(token);
  eq([out.slug, out.moved_events, out.already_owned_other], ["claim-collective", 1, false], "accepted");
  eq(out.room_id, roomId, "the same room");
  // What changed.
  const ev = (await api.events.get(x.eventId))!;
  eq([ev.host.id, ev.host.roomName, ev.listing?.claimed, L.listedByLine(ev), L.ticketHref(ev)], [seun.id, "Claim Collective", true, "Hosted by Claim Collective", "https://tix.example.com/market"], "hosted by them, still the organiser's tickets");
  eq((await api.events.viewerState(x.eventId)).button, "external", "tickets are still on the organiser's page");
  const room = (await api.rooms.get("claim-collective"))!;
  eq([room.is_owner, room.join_mode], [true, "open"], "they own it, and it is open now");
  const rec = state().rooms[roomId];
  eq([rec.owner_id, rec.created_by, state().memberships[`${state().listingsUserId}:${roomId}`] ?? false], [seun.id, seun.id, false], "owner, created_by, and Listings left the room");
  eq((await api.rooms.managed()).map((r) => r.slug), ["claim-collective"], "they manage it");
  as("Hoppaz Staff");
  const org = (await api.outreach.organiser(x.organiserId)).organiser;
  eq([org.stage, !!org.claimed_at, org.transfer_pending], ["claimed", true, false], "organiser claimed");
  eq((await api.claims.transfersFor(roomId)).map((t) => t.status), ["accepted"], "transfer accepted");
  // Works once.
  await api.auth.signOut();
  await api.auth.sendCode("seun@example.com");
  await api.auth.verifyCode("seun@example.com", "654321");
  await rejects(api.claims.accept(token), R.link_used, "used");
  eq(await api.claims.preview(token), { ok: false, reason: "used" }, "preview says used");
});

await test("after accepting, the organiser runs the room and sells real tickets with sellOnHoppaz; their next event links to the same room", async () => {
  const x = await listIt({ name: "Switch Night", organiser_name: "Switch Collective", organiser_handle: "switchcollective" });
  const roomId = await roomIdOf(x.eventId);
  as("Hoppaz Staff");
  await rejects(api.events.sellOnHoppaz(x.eventId, [{ name: "General", price_naira: 0, capacity: 50 }]), R.not_claimed, "refused while Hoppaz lists it");
  const t = await api.outreach.createTransfer(x.organiserId, "boss@example.com", "Jae");
  await api.auth.signOut();
  await api.auth.sendCode("boss@example.com");
  await api.auth.verifyCode("boss@example.com", "123456", "Boss Switch");
  await api.claims.accept(t.link.split("/claim/")[1]);
  await rejects(api.events.sellOnHoppaz(x.eventId, []), R.set_tickets_first, "empty tickets");
  await rejects(api.events.sellOnHoppaz(x.eventId, [{ name: "VIP", price_naira: 5000, capacity: 10 }]), PAID_UNAVAILABLE, "a paid type needs paid tickets on");
  eq(L.isListing(await (async () => (await api.events.get(x.eventId))!)()), true, "still a listing after a refused switch");
  const sold = await api.events.sellOnHoppaz(x.eventId, [{ name: "General", price_naira: 0, capacity: 50 }, { name: "Table", price_naira: 0, capacity: 5 }]);
  eq([sold.listing ?? null, sold.ticket_types.map((tt) => tt.name), sold.price_naira], [null, ["General", "Table"], 0], "real ticket types, no listing field");
  eq((await api.events.viewerState(x.eventId)).button === "external", false, "no longer external");
  await rejects(api.events.sellOnHoppaz(x.eventId, [{ name: "General", price_naira: 0, capacity: 1 }]), "This event already sells tickets on Hoppaz", "only once");
  // Now people can register like for any Hoppaz event.
  await api.auth.signOut();
  as("Ada Obi");
  eq((await api.registrations.register(x.eventId)).status, "going", "Ada registers");
  eq((await api.events.get(x.eventId))!.going, 1, "going counts again");
  // Their next scraped event goes to the same room, hosted by them and still a listing.
  const next = await listIt({ name: "Switch Night Two", organiser_name: "Switch Collective", organiser_handle: "switchcollective" });
  const ev2 = (await api.events.get(next.eventId))!;
  eq([ev2.room_id, ev2.listing?.claimed, ev2.host.name, next.organiserId], [roomId, true, "Boss Switch", x.organiserId], "same room, same organiser, hosted by the owner");
  eq(Object.values(state().rooms).filter((r) => r.name === "Switch Collective").length, 1, "still one room");
});

await test("a no: deletes the event and room, keeps the organiser, blocks the next import, never auto lists", async () => {
  const x = await listIt({ name: "Doomed Night", organiser_name: "Doomed Collective", organiser_handle: "doomedcollective" });
  const slug = (await api.outreach.organiser(x.organiserId)).organiser.room_slug!;
  const declined = await api.outreach.setStage(x.organiserId, "declined", "Jae");
  eq([declined.stage, declined.do_not_contact, !!declined.declined_at], ["declined", true, true], "declined");
  await rejects(api.outreach.deleteListingAndRoom(x.organiserId, "doomed collective", "Jae"), "Type the organiser name exactly to confirm", "the name must match");
  eq(await api.events.get(x.eventId) !== null, true, "nothing deleted yet");
  await rejects(api.outreach.createTransfer(x.organiserId, "a@b.com", "Jae"), R.organiser_declined, "no link for someone who said no");
  await rejects(api.outreach.setStage(x.organiserId, "offered", "Jae"), R.organiser_declined, "no offer either");
  const del = await api.outreach.deleteListingAndRoom(x.organiserId, "Doomed Collective", "Jae");
  eq(del.events, 1, "one event deleted");
  as("Hoppaz Staff");
  eq([await api.events.get(x.eventId), await api.rooms.get(slug)], [null, null], "event and room are gone");
  ok(!(await api.events.list()).some((e) => e.title === "Doomed Night"), "not on the app");
  const o = (await api.outreach.organiser(x.organiserId)).organiser;
  eq([o.stage, o.do_not_contact, o.room_id, o.events_total], ["declined", true, null, 0], "the organiser row stays, declined");
  ok((await api.outreach.organiser(x.organiserId)).log[0].kind === "delete", "logged");
  // The same event again, and a new one under a different spelling of the name.
  const rep = await api.outreach.importBatch(
    batchOf([x.ev, scoutEv({ name: "A New One", organiser_name: "DOOMED  collective", organiser_handle: null })]),
    { dryRun: false },
  );
  eq([rep.blocked, rep.new, rep.organisers_new], [2, 0, 0], "both blocked, no new organiser");
  const rows = (await api.outreach.queue()).filter((p) => p.organiser_id === x.organiserId);
  ok(rows.length === 1 && rows[0].status === "blocked", "one blocked row in the queue; the deleted event's row stays rejected");
  await rejects(api.outreach.approve(rows[0].id, "Jae"), R.blocked, "approving a blocked row");
  ok(!(await api.events.list()).some((e) => e.title === "A New One"), "never auto listed");
  // Reopening is possible by hand: the rows come back as new, and a listing is still staff's call.
  const re = await api.outreach.setStage(x.organiserId, "listed", "Jae");
  eq([re.stage, re.do_not_contact], ["listed", false], "reopened");
  ok((await api.outreach.queue()).filter((p) => p.organiser_id === x.organiserId).every((p) => p.status === "new"), "blocked rows are new again");
  ok(!(await api.events.list()).some((e) => e.title === "A New One"), "still not listed until approved");
});

await test("delete is refused with registrations or a claimed organiser, and names the events", async () => {
  const x = await listIt({ name: "Busy Night", organiser_name: "Busy Collective", organiser_handle: "busycollective" });
  // A registration that exists from before the server guard (the fake only gets one by hand).
  const regId = "00000000-0000-4000-8000-000000000001";
  state().regs[regId] = {
    id: regId, event_id: x.eventId, user_id: "u1", name: "Early Bird", email: "e@example.com", phone: null, status: "going", ticket_type_id: "t", ticket_name: "General",
    quantity: 1, answers: {}, referrer_id: null, referrer_name: null, created_at: isoAt(Date.now()), checked_in_at: null, waitlist_pos: null,
  };
  const e = await throws(api.outreach.deleteListingAndRoom(x.organiserId, "Busy Collective", "Jae"), "delete with a registration");
  eq(e.message, `${R.has_registrations}: Busy Night (1)`, "names the event and the count");
  ok(!!(await api.events.get(x.eventId)), "nothing was deleted");
  eq((await api.outreach.organiser(x.organiserId)).organiser.room_id !== null, true, "the room is still there");
  state().regs[regId].status = "cancelled";
  eq((await api.outreach.deleteListingAndRoom(x.organiserId, "Busy Collective", "Jae")).events, 1, "a cancelled registration does not block it");
  const sound = await orgByName("Surulere Sound Collective");
  await rejects(api.outreach.deleteListingAndRoom(sound.id, "Surulere Sound Collective", "Jae"), "They own this room now, so Hoppaz cannot change it", "a claimed organiser");
});

await test("a no reply listing stays exactly as it was across 60 days; a link expires and nothing else changes", async () => {
  const far = isoAt(Date.now() + 100 * DAY);
  const quiet = await listIt({ name: "Quiet Night", starts_at: far, organiser_name: "Quiet Collective", organiser_handle: "quietcollective" });
  const offered = await listIt({ name: "Offered Night", starts_at: far, organiser_name: "Offered Collective", organiser_handle: "offeredcollective" });
  const link = await api.outreach.createTransfer(offered.organiserId, "offered@example.com", "Jae");
  const snap = async () =>
    JSON.stringify({
      quiet: await api.events.get(quiet.eventId),
      offered: await api.events.get(offered.eventId),
      orgs: (await api.outreach.organisers()).filter((o) => o.name.endsWith("Collective") && o.name !== "Detty December Collective").map((o) => [o.name, o.stage, o.do_not_contact, o.room_id, o.events_total, o.last_contacted_at]),
      pulled: Object.values(state().pulled).map((p) => [p.id, p.status, p.flags]),
    });
  const before = await snap();
  ok(!(await api.events.list()).some((e) => e.id === quiet.eventId), "100 days out: not in the 45 day window yet");
  fakeDev.advance(60 * DAY);
  eq(await snap(), before, "60 days later: events, organisers and queue are exactly the same");
  ok((await api.events.list()).some((e) => e.id === quiet.eventId), "and now it shows in the list");
  const t = (await api.outreach.organiser(offered.organiserId)).transfers[0];
  eq([t.id, t.status], [link.transfer.id, "expired"], "only the link expired");
  eq((await api.outreach.organiser(offered.organiserId)).organiser.stage, "offered", "the stage did not move");
  await api.auth.sendCode("offered@example.com");
  await api.auth.verifyCode("offered@example.com", "123456");
  await rejects(api.claims.accept(link.link.split("/claim/")[1]), R.link_expired, "expired link");
  eq(await api.claims.preview(link.link.split("/claim/")[1]), { ok: false, reason: "expired" }, "preview says expired");
  eq((await api.events.get(offered.eventId))!.host.name, "Hoppaz Listings", "still listed by Hoppaz");
});

await test("transfer refusals: revoked, ten wrong tries, paid sales, and a failed step rolls everything back", async () => {
  const mk = async (label: string, email: string) => {
    const x = await listIt({ name: `${label} Night`, organiser_name: `${label} Collective`, organiser_handle: `${label.toLowerCase()}collective` });
    const t = await api.outreach.createTransfer(x.organiserId, email, "Jae");
    return { ...x, t, token: t.link.split("/claim/")[1] };
  };
  const signUp = async (email: string) => {
    await api.auth.signOut();
    await api.auth.sendCode(email);
    return api.auth.verifyCode(email, "123456", "Some One");
  };
  // Revoked.
  const r = await mk("Revoked", "r@example.com");
  await api.outreach.revokeTransfer(r.t.transfer.id, "Jae");
  await signUp("r@example.com");
  await rejects(api.claims.accept(r.token), R.link_revoked, "revoked");
  eq(await api.claims.preview(r.token), { ok: false, reason: "revoked" }, "preview says cancelled");
  await rejects(api.outreach.revokeTransfer(r.t.transfer.id, "Jae"), R.link_revoked, "revoking twice");
  // Ten wrong tries lock the link, even for the right email afterwards.
  const w = await mk("Locked", "l@example.com");
  await signUp("someone.else@example.com");
  for (let i = 0; i < 9; i++) await rejects(api.claims.accept(w.token), R.wrong_email, `wrong try ${i + 1}`);
  await rejects(api.claims.accept(w.token), R.link_revoked, "the tenth locks it");
  await signUp("l@example.com");
  await rejects(api.claims.accept(w.token), R.link_revoked, "the right email is too late");
  // Paid sales: money on an event that would move.
  const p = await mk("Paid", "p@example.com");
  state().orders["order-1"] = { id: "order-1", event_id: p.eventId, status: "paid" } as never;
  await signUp("p@example.com");
  await rejects(api.claims.accept(p.token), R.paid_sales, "paid sales");
  eq((await api.events.get(p.eventId))!.host.name, "Hoppaz Listings", "nothing moved");
  eq((await api.claims.preview(p.token)).ok, true, "the link is still open");
  // A step that fails halfway: nothing is left changed.
  const f = await mk("Rollback", "f@example.com");
  const roomId = await roomIdOf(f.eventId);
  await signUp("f@example.com");
  const snap = () => JSON.stringify([state().rooms, state().memberships, state().roles, state().events, state().organisers, state().transfers, state().organiserLog]);
  const before = snap();
  for (const step of ["owner", "events", "organiser", "transfer", "others"]) {
    fakeDev.failAcceptAt(step);
    const e = await throws(api.claims.accept(f.token), `accept failing at ${step}`);
    eq(e.message, `Step "${step}" failed`, `the ${step} step failed`);
    eq(snap() === before, true, `rolled back: nothing changed after a failure at ${step}`);
  }
  fakeDev.failAcceptAt(null);
  const done = await api.claims.accept(f.token);
  eq([done.room_id, done.moved_events], [roomId, 1], "and then it works");
  // Other open links on the room are cancelled when one is accepted.
  const o = await mk("Several", "s1@example.com");
  await api.outreach.createTransfer(o.organiserId, "s2@example.com", "Jae");
  await signUp("s1@example.com");
  await api.claims.accept(o.token);
  const roomT = await api.claims.transfersFor(await roomIdOf(o.eventId));
  eq(roomT.map((t) => t.status).sort(), ["accepted", "revoked"], "the other link was cancelled");
});

await test("owner handover and owning two rooms", async () => {
  // Kredete already owns a room; a listing organiser's room is offered to Kredete's email too.
  const x = await listIt({ name: "Second Room Night", organiser_name: "Second Room Collective", organiser_handle: "secondroomcollective" });
  const t = await api.outreach.createTransfer(x.organiserId, "kredete@example.com", "Jae");
  as("Kredete");
  const out = await api.claims.accept(t.link.split("/claim/")[1]);
  eq([out.already_owned_other, out.moved_events], [true, 1], "allowed, and it says they own another room");
  eq((await api.rooms.mine()).map((r) => r.slug).sort(), ["kredete", "second-room-collective"], "they own both");
  eq((await api.events.get(x.eventId))!.room_id, out.room_id, "the event kept its own room");
  // Handover: only the owner starts it; the old owner becomes a plain member.
  await newPerson();
  await rejects(api.claims.startHandover(out.room_id, "x@example.com"), "Not allowed", "not the owner");
  as("Kredete");
  await rejects(api.claims.startHandover(out.room_id, "nope"), R.bad_email, "bad email");
  const h = await api.claims.startHandover(out.room_id, "New.Owner@Example.com");
  eq([h.transfer.kind, h.transfer.to_email], ["handover", "new.owner@example.com"], "handover link");
  await rejects(api.claims.startHandover(out.room_id, "new.owner@example.com"), R.already_pending, "no second link");
  eq((await api.claims.transfersFor(out.room_id)).map((t) => t.kind), ["handover", "claim"], "the owner lists both, newest first");
  await api.auth.sendCode("new.owner@example.com");
  await api.auth.verifyCode("new.owner@example.com", "123456", "New Owner");
  await rejects(api.claims.transfersFor(out.room_id), "Not allowed", "a stranger cannot list it");
  const got = await api.claims.accept(h.link.split("/claim/")[1]);
  eq(got.room_id, out.room_id, "same room");
  eq((await api.rooms.members(out.room_id)).map((m) => [m.name, m.role]), [["New Owner", "owner"], ["Kredete", "member"]], "the old owner is a plain member");
  const room = state().rooms[out.room_id];
  eq(room.created_by, state().users[room.owner_id!].id, "created_by follows");
  as("Kredete");
  const t2 = await api.claims.startHandover((await api.rooms.mine())[0].id, "other@example.com");
  await api.claims.revoke(t2.transfer.id);
  eq((await api.claims.transfersFor((await api.rooms.mine())[0].id))[0].status, "revoked", "the owner revokes");
});

await test("Is this your event: limits, dedupe, staff see it in the tracker", async () => {
  const mic = (await api.events.list()).find((e) => e.title === "Open Mic Night Yaba")!;
  const before = (await api.outreach.claimRequests()).length;
  await api.claims.requestClaim(mic.id, { name: "Seun Bello", email: "Seun@Example.com", phone: "0803", note: "Mine" });
  await api.claims.requestClaim(mic.id, { name: "Seun Bello", email: "seun@example.com" });
  eq((await api.outreach.claimRequests()).length, before + 1, "asking twice with the same email is one request");
  const rows = await api.outreach.claimRequests();
  eq([rows[0].email, rows[0].organiser_name, rows[0].status], ["seun@example.com", "Mainland Mic Collective", "new"], "lands in the tracker");
  eq((await orgByName("Mainland Mic Collective")).claim_requests, 2, "the organiser row counts it");
  await rejects(api.claims.requestClaim(mic.id, { name: "", email: "a@b.com" }), "Add your name", "needs a name");
  await rejects(api.claims.requestClaim(mic.id, { name: "A", email: "nope" }), R.bad_email, "needs an email");
  const normal = seeded("Afro Beach Day Party");
  await rejects(api.claims.requestClaim(normal.id, { name: "A", email: "a@b.com" }), R.not_found, "only for listings");
  const others = (await api.events.list()).filter((e) => e.listing && e.id !== mic.id);
  await api.claims.requestClaim(others[0].id, { name: "Seun Bello", email: "seun@example.com" });
  await api.claims.requestClaim(others[1].id, { name: "Seun Bello", email: "seun@example.com" });
  await rejects(api.claims.requestClaim(others[2].id, { name: "Seun Bello", email: "seun@example.com" }), "Too many requests. Try again later", "the fourth in a day");
  fakeDev.advance(2 * DAY);
  await api.claims.requestClaim(others[2].id, { name: "Seun Bello", email: "seun@example.com" });
  await api.outreach.handleClaimRequest(rows[0].id, "Jae");
  eq((await api.outreach.claimRequests()).find((c) => c.id === rows[0].id)!.status, "handled", "handled");
  eq((await api.outreach.organiser((await orgByName("Mainland Mic Collective")).id)).log.some((l) => l.kind === "claim_request"), true, "logged on the organiser");
});

await test("the seeded demo link works end to end", async () => {
  const pv = await api.claims.preview(DEMO_CLAIM_TOKEN);
  ok(pv.ok, "the demo link is open");
  if (pv.ok) eq([pv.room.name, pv.email_hint, pv.events.map((e) => e.title)], ["Afrobeats Island Parties", "b***@afroisland.example.com", ["Afro Island Boat Cruise"]], "demo preview");
  await api.auth.sendCode(DEMO_CLAIM_EMAIL);
  await api.auth.verifyCode(DEMO_CLAIM_EMAIL, "123456", "Afro Island");
  eq((await api.claims.accept(DEMO_CLAIM_TOKEN)).moved_events, 1, "accepted");
});

await test("message drafts: short, no em dash, always the opt-out line", async () => {
  const input = {
    organiser: { name: "Lekki Social Club", ig_handle: "lekkisocialclub" },
    events: [{ title: "Sundown Sessions", starts_at: isoAt(Date.now() + 5 * DAY) }, { title: "Social Brunch", starts_at: null }, { title: "A", starts_at: null }, { title: "B", starts_at: null }],
    roomName: "Lekki Social Club", link: "https://hoppaz.fun/claim/abc", staffName: "Jae",
  };
  let count = 0;
  for (const stage of ["first", "offer", "follow_up", "claimed", "declined"] as const) {
    for (const channel of ["instagram", "whatsapp", "email"] as const) {
      const d = draftFor({ ...input, stage, channel });
      const all = `${d.subject ?? ""}\n${d.body}`;
      ok(!/[—–]/.test(all), `${stage}/${channel}: no dash`);
      ok(/reply stop/i.test(d.body), `${stage}/${channel}: the opt-out line`);
      ok(d.body.includes("Lekki Social Club") && d.body.includes("Jae"), `${stage}/${channel}: names them and signs`);
      eq(!!d.subject, channel === "email", `${stage}/${channel}: only email has a subject`);
      ok(d.body.split("\n").every((l) => l.length <= 120), `${stage}/${channel}: short lines`);
      count++;
    }
  }
  eq(count, 15, "fifteen drafts");
  const offer = draftFor({ ...input, stage: "offer", channel: "whatsapp" });
  ok(offer.body.includes("https://hoppaz.fun/claim/abc"), "the offer has the link");
  const first = draftFor({ ...input, stage: "first", channel: "instagram" });
  ok(first.body.includes("Sundown Sessions") && first.body.includes("and 1 more") && first.body.includes("Nobody buys on Hoppaz"), "names up to three events, says what is true");
  ok(first.body.includes(OPT_OUT), "the shared opt-out line");
  const no = draftFor({ ...input, stage: "declined", channel: "email" });
  ok(no.body.includes("will not list you again"), "the acknowledgement after a no");
  ok(draftFor({ ...input, stage: "first", channel: "email" }).subject!.includes("Hoppaz"), "subject");
});

await test("matching and token helpers", async () => {
  eq([nameKey("Lekki Social Club!"), nameKey("  Café  Eko "), nameKey(null)], ["lekkisocialclub", "cafeeko", ""], "name key");
  eq([normHandle("@Lekki.Social"), normHandle("https://www.instagram.com/lekki.social/?hl=en"), normHandle("instagram.com/x_y"), normHandle("no spaces"), normHandle("")], ["lekki.social", "lekki.social", "x_y", null, null], "handles");
  eq([maskEmail("jae@gmail.com"), maskEmail("a@b.co")], ["j***@gmail.com", "a***@b.co"], "mask");
  eq([stageRefusal({ stage: "claimed", do_not_contact: false }, "declined"), stageRefusal({ stage: "declined", do_not_contact: true }, "offered"), stageRefusal({ stage: "listed", do_not_contact: false }, "offered"), stageRefusal({ stage: "declined", do_not_contact: true }, "listed")], ["is_claimed", "organiser_declined", null, null], "stage rules");
  const a = randomToken();
  const b = randomToken();
  ok(a !== b && /^[A-Za-z0-9_-]{43}$/.test(a), "a 32 byte base64url token");
  eq(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 of abc");
  for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "naija é ₦"]) eq(sha256HexSync(s), await sha256Hex(s), `sync and async agree on ${s.length} characters`);
  const ev = viewOf(Object.values(state().events).find((e) => e.ticket_mode === "external")!);
  ok(!("ticket_mode" in ev) && !("organiser_id" in ev) && !!ev.listing, "stored listing fields are not leaked into the view");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
