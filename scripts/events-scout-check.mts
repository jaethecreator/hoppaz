/**
 * Offline checks for the event scout: scripts/events/scout-lib.mjs and the dry run and apply paths of scripts/events/load-scout.mjs.
 * No network (fetch, the geocoder and sips are all injected), no database, no real site.
 * Run from the repo root:  node --no-warnings scripts/events-scout-check.mts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const lib = await import("./events/scout-lib.mjs");
const loader = await import("./events/load-scout.mjs");
const FIX = join(root, "scripts", "events", "fixtures");
const NOW = Date.parse("2026-11-02T09:00:00Z");

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
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
const ctx = { nowMs: NOW };
const tixRows = fixture("tix.json").rows;
const norm = (source: string, row: unknown, extra = {}) => lib.normaliseRow(source, row, { ...ctx, ...extra });
const allRaw = () => ["tix.json", "eventbrite.json", "chowdeck.json", "luma.json", "generic.json"].map((f) => fixture(f));
const built = () => lib.buildBatch(allRaw(), { now: NOW });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function tmp() {
  return mkdtempSync(join(tmpdir(), "hoppaz-scout-check-"));
}
/** A day folder with the fixtures as raw files. */
function dayFolder(name = "2026-11-02") {
  const home = tmp();
  const dir = join(home, name);
  mkdirSync(join(dir, "raw"), { recursive: true });
  for (const f of readdirSync(FIX)) copyFileSync(join(FIX, f), join(dir, "raw", f));
  const venuesPath = join(home, "venues.json");
  copyFileSync(join(root, "scripts", "events", "venues.json"), venuesPath);
  return { home, dir, venuesPath };
}
const logger = () => {
  const lines: string[] = [];
  return { lines, log: (...a: unknown[]) => lines.push(a.join(" ")), err: (...a: unknown[]) => lines.push(`ERR ${a.join(" ")}`), text: () => lines.join("\n") };
};
const noNetwork = () => {
  throw new Error("network was used");
};

/* -------------------------------------------------------------- small rules -- */

await test("name key follows the SQL rule", () => {
  eq(lib.nameKey("Fantasy, Ikoyi!"), "fantasyikoyi", "punctuation and case");
  eq(lib.nameKey("kó"), "ko", "NFKD drops the accent");
  eq(lib.nameKey("LiVE! Lounge"), "livelounge", "mixed case");
  eq(lib.nameKey(null), "", "null");
});

await test("handles: clean ones pass, urls reduce to the profile, anything else is a problem", () => {
  eq(lib.normaliseHandle("@FakeHub"), "fakehub", "at sign and case");
  eq(lib.normaliseHandle("https://www.instagram.com/Fake.Hub_1/?hl=en"), "fake.hub_1", "profile url");
  eq(lib.normaliseHandle("instagram.com/fakehub"), "fakehub", "no scheme");
  eq(lib.normaliseHandle(""), null, "empty");
  for (const bad of ["https://twitter.com/fakehub", "https://www.instagram.com/p/ABC123/", "https://www.instagram.com/", "https://www.instagram.com/reel/xyz", "Fake Hub Lagos", "a".repeat(31), "he!!o", "..", "https://evil.com/instagram.com/fakehub"]) {
    const r = lib.parseHandle(bad);
    ok(r.handle === null && r.problem, `"${bad}" must be refused, got ${JSON.stringify(r)}`);
  }
});

await test("email and phone are cleaned, or dropped", () => {
  eq(lib.cleanEmail("mailto:Bookings@Example.com?subject=hi"), "bookings@example.com", "mailto");
  eq(lib.cleanEmail("not an email"), null, "bad email");
  eq(lib.cleanPhone("0803 000 0000"), "+2348030000000", "Nigerian local number");
  eq(lib.cleanPhone("+44 20 7946 0958"), "+442079460958", "international");
  eq(lib.cleanPhone("12"), null, "too short");
});

await test("Lagos time: Tix wall clock, Chowdeck UTC, Eventbrite offset", () => {
  eq(lib.tixWallToIso(1793991600), "2026-11-06T19:00:00+01:00", "Tix: a 7pm show reads 19:00, no hour added");
  eq(lib.tixWallToIso(1793991600000), "2026-11-06T19:00:00+01:00", "Tix in milliseconds");
  eq(lib.utcToLagosIso("2026-11-07T19:00:00.000Z"), "2026-11-07T20:00:00+01:00", "Chowdeck: UTC plus one hour");
  eq(lib.utcToLagosIso("2026-11-07T19:00:00"), null, "no zone, no guess");
  eq(lib.offsetAwareToLagosIso("2026-11-08T12:00:00+01:00"), "2026-11-08T12:00:00+01:00", "Eventbrite already Lagos");
  eq(lib.offsetAwareToLagosIso("2026-11-08T12:00:00Z"), "2026-11-08T13:00:00+01:00", "Eventbrite in UTC");
  eq(lib.offsetAwareToLagosIso("2026-11-08T07:00:00-05:00"), "2026-11-08T13:00:00+01:00", "Eventbrite in another offset");
  eq(lib.offsetAwareToLagosIso("2026-11-09"), null, "a date alone is not a time");
  eq(lib.lagosWall("2026-11-21", "18:00"), "2026-11-21T18:00:00+01:00", "published date and clock time");
  eq(lib.lagosWhen("2026-11-07T20:00:00+01:00"), "Sat 07 Nov 20:00", "readable");
});

await test("price helpers", () => {
  eq(lib.priceFrom([{ name: "a", price_naira: 5000, sold_out: false }, { name: "b", price_naira: 0, sold_out: false }]), 0, "free counts");
  eq(lib.priceFrom([{ name: "a", price_naira: 5000, sold_out: true }, { name: "b", price_naira: 9000, sold_out: false }]), 9000, "sold out ticket ignored while another is on sale");
  eq(lib.priceFrom([{ name: "a", price_naira: 5000, sold_out: true }]), 5000, "all sold out: lowest");
  eq(lib.priceFrom([{ name: "a", price_naira: null, sold_out: false }]), null, "unknown stays null");
  eq(lib.priceFrom([]), null, "none");
  eq(lib.nairaFromKobo(107500), 1075, "kobo");
  eq(lib.htmlToText("<div>a&nbsp;b<br>c &amp; d</div><div>e</div>"), "a b\nc & d\ne", "html");
});

/* ------------------------------------------------------------- normalisers -- */

await test("Tix row: fields, WAT wall clock, tickets, contact with a source note", () => {
  const r = norm("tix", tixRows[0]);
  ok(r.event, "event expected");
  const e = r.event;
  eq(e.source_site, "tix", "site");
  eq(e.source_id, "11111111-2222-4333-8444-555555555555", "id is the uuid inside the Tix id");
  eq(e.starts_at, "2026-11-06T19:00:00+01:00", "start");
  eq(e.ends_at, "2026-11-07T01:00:00+01:00", "end");
  eq(e.venue, "Test Lounge", "venue");
  eq(e.area, "Victoria Island", "area");
  eq([e.lat, e.lng, e.pin_by], [6.4261, 3.4132, "source"], "Tix publishes coordinates");
  eq(e.tickets.map((t) => [t.name, t.price_naira, t.sold_out]), [["General", 5000, false], ["Table", 50000, true]], "inactive ticket left out, sold out kept");
  eq(e.sold_out, false, "one ticket still on sale");
  eq(e.description, "Doors at 8pm.\nDress code: bright & loud\nTwo floors", "description as text");
  eq(e.ticket_url, "https://tix.africa/discover/fake-friday-night", "ticket url");
  ok(e.flyer_url?.includes("fakeflyer1"), "flyer url");
  eq([e.organiser_name, e.organiser_handle, e.organiser_email, e.organiser_phone], ["Friday Fakers", "fakefridaynight", "bookings@example.com", "+2348030000000"], "organiser");
  eq(e.lineup, [{ time: "22:00", name: "DJ Fake" }, { name: "Host Fake" }], "lineup");
  eq(e.capacity, null, "capacity not invented");
  eq(e.confidence, "confirmed", "confidence");
  eq(r.prov.handle_seen, "Tix event page, Contact Us block", "handle note");
  ok(r.prov.contact_seen, "contact note");
  ok(r.notes.some((n) => n.includes("Old release")), "the dropped ticket is reported");
});

await test("Tix rows outside Lagos or without any place are skipped with a reason", () => {
  ok(norm("tix", tixRows[2]).skip?.includes("not Lagos"), "Abuja");
  ok(norm("tix", tixRows[3]).skip?.includes("not Lagos"), "no place evidence is not Lagos");
});

await test("unknown stays null, empty or []", () => {
  const e = norm("tix", tixRows[1]).event;
  eq([e.ends_at, e.venue, e.description, e.organiser_name, e.organiser_handle, e.organiser_email, e.organiser_phone, e.flyer_url, e.category, e.capacity], [null, null, "", null, null, null, null, null, null, null], "empty fields");
  eq([e.tickets, e.lineup, e.sold_out], [[], [], false], "empty lists");
});

await test("a guessed handle and an unquoted capacity are dropped, not stored", () => {
  const r = norm("tix", tixRows[4]);
  eq(r.event.organiser_handle, null, "no seen_on, no handle");
  eq(r.event.capacity, null, "no quote, no capacity");
  ok(r.notes.some((n) => n.includes("seen_on")) && r.notes.some((n) => n.includes("capacity_quote")), "both drops are reported");
  eq(r.event.tickets[0].price_naira, 0, "free is 0, not null");
  // A handle is never made from a name.
  const g = norm("generic", { name: "Hoppaz Night", organiser: "Hoppaz Crew", date: "2026-11-20", time: "20:00", venue: "Somewhere, Ikoyi" }, { site: "demo" });
  eq([g.event.organiser_handle, g.event.event_handle], [null, null], "no handle from names");
  const bad = norm("generic", { name: "X Night", venue: "Hall, Ikoyi", organiser_instagram: "https://twitter.com/xnight", organiser_instagram_seen_on: "page" }, { site: "demo" });
  eq(bad.event.organiser_handle, null, "not an instagram url");
});

await test("Eventbrite: id from the card url, offset time, ranges, other currency, online, date only, sold out", () => {
  const rows = fixture("eventbrite.json").rows;
  const a = norm("eventbrite", rows[0]).event;
  eq(a.source_id, "1000000000001", "id from the url the card links to, not the series url in the JSON-LD");
  eq(a.ticket_url, "https://www.eventbrite.com/e/fake-brunch-tickets-1000000000001", "query dropped");
  eq([a.starts_at, a.ends_at], ["2026-11-08T12:00:00+01:00", "2026-11-08T16:00:00+01:00"], "times");
  eq([a.lat, a.lng, a.pin_by, a.area], [6.45, 3.43, "source", "Ikoyi"], "geo from the page");
  eq(a.tickets.map((t) => t.price_naira), [10000, 25000], "AggregateOffer low and high");
  eq(lib.priceFrom(a.tickets), 10000, "price from");
  eq(a.organiser_name, "Fake Brunch Club", "organiser name");
  eq(a.organiser_handle, null, "no instagram on the page, none stored");
  const usd = norm("eventbrite", rows[1]);
  eq(usd.event.tickets[0].price_naira, null, "USD is not converted");
  ok(usd.event.tickets[0].name.includes("USD"), "USD shown in the label");
  ok(norm("eventbrite", rows[2]).skip === "online only", "online only");
  const dateOnly = norm("eventbrite", rows[3]).event;
  eq([dateOnly.starts_at, dateOnly.lat], [null, 6.6], "date only gives no time; geo from the listing");
  const sold = norm("eventbrite", rows[4]).event;
  eq([sold.tickets[0].sold_out, sold.sold_out, sold.tickets[0].price_naira], [true, true, 3000], "sold out");
});

await test("Chowdeck: kobo to naira, UTC to Lagos time, Lagos only, no stock as capacity", () => {
  const rows = fixture("chowdeck.json").rows;
  const e = norm("chowdeck", rows[0]).event;
  eq(e.source_id, "9001", "id");
  eq([e.starts_at, e.ends_at], ["2026-11-07T20:00:00+01:00", "2026-11-08T01:30:00+01:00"], "UTC plus one hour");
  eq(e.tickets.map((t) => [t.name, t.price_naira]), [["Regular", 5000], ["VIP", 20000], ["Squad (group of 5)", 40000]], "kobo to naira, hidden ticket left out");
  eq(e.capacity, null, "ticket quantity is stock, not capacity");
  eq([e.venue, e.area, e.category, e.organiser_name, e.pin_by], ["Fake Rooftop", "Lekki", "Nightlife", "Rooftop Co", "source"], "place and organiser");
  eq(e.ticket_url, "https://chowdeck.com/events/fake-rooftop-9001", "ticket url");
  ok(norm("chowdeck", rows[1]).skip?.includes("not Lagos"), "Oyo");
  ok(norm("chowdeck", rows[3]).skip?.includes("virtual"), "virtual");
  ok(norm("chowdeck", { ...rows[0], vendor: { name: "Hoppaz" } }).skip?.includes("Hoppaz"), "our own Hops are not listed as someone else's");
  const free = norm("chowdeck", rows[2]).event;
  eq([free.tickets[0].price_naira, free.lat, free.pin_by], [0, null, null], "free ticket; no source pin when none published");
});

await test("Luma: UTC to Lagos time, host handle, calendar handle, price in cents, sold out", () => {
  const rows = fixture("luma.json").rows;
  const r = norm("luma", rows[0]);
  const e = r.event;
  eq([e.source_id, e.starts_at, e.ends_at], ["evt-FAKE0000000001", "2026-11-10T18:00:00+01:00", "2026-11-10T20:30:00+01:00"], "id and times");
  eq(e.ticket_url, "https://luma.com/fakemixer", "ticket url");
  eq([e.organiser_name, e.organiser_handle, e.event_handle], ["Fake Hub", "fakehub", "fakehubevents"], "host and calendar handles");
  eq(r.prov.handle_seen, "Luma host profile", "note");
  eq(e.tickets.map((t) => t.price_naira), [5000, 10000], "cents to naira");
  eq([e.description, e.capacity, e.pin_by, e.area], ["A mixer for founders.", null, "source", "Yaba"], "description, no capacity from spots left");
  const club = norm("luma", rows[1]);
  eq([club.event.organiser_handle, club.event.event_handle, club.event.sold_out, club.event.tickets[0].price_naira], [null, null, true, 0], "bad host handle dropped, personal calendar handle ignored");
  ok(club.notes.some((n) => n.includes("organiser_handle dropped")), "reported");
  ok(norm("luma", rows[2]).skip?.includes("online"), "online");
});

await test("generic leads: date alone gives no time, ids are stable, confirmed needs a ticket page, capacity needs a quote", () => {
  const rows = fixture("generic.json").rows;
  const a = norm("generic", rows[0], { site: "partyverse" }).event;
  eq([a.starts_at, a.confidence, a.source_id, a.source_site], [null, "lead", "2026-11-14-fakebeachweekender", "partyverse"], "lead");
  eq(norm("generic", rows[0], { site: "partyverse" }).event.source_id, a.source_id, "same id on a rerun");
  const b = norm("generic", rows[1], { site: "partyverse" }).event;
  eq([b.starts_at, b.confidence, b.ticket_url, b.capacity, b.tickets[0].price_naira], ["2026-11-21T18:00:00+01:00", "confirmed", "https://example.com/tickets/fake-concert", 20000, 15000], "confirmed row, tracking parameter dropped");
  eq(norm("generic", rows[2], { site: "partyverse" }).event.capacity, null, "capacity without a quote");
  ok(norm("generic", rows[3], { site: "partyverse" }).skip?.includes("not Lagos"), "Abuja");
  ok(norm("generic", rows[0], { site: "Bad Site" }).skip, "a bad site label is refused");
});

/* ------------------------------------------------------------------- batch -- */

await test("a rerun gives the same source ids, and the same order", () => {
  const a = lib.buildBatch(allRaw(), { now: NOW });
  const b = lib.buildBatch(allRaw(), { now: NOW + 3 * 86400e3 });
  eq(a.batch.events.map(lib.eventKey), b.batch.events.map(lib.eventKey), "keys");
  ok(a.batch.events.length === 13, `expected the fixtures to give 13 events, got ${a.batch.events.length}`);
  ok(new Set(a.batch.events.map(lib.eventKey)).size === a.batch.events.length, "no repeats");
  ok(a.batch.run_id !== undefined && a.batch.scouted_at !== b.batch.scouted_at, "scouted_at changes, ids do not");
});

await test("sources_covered lists only complete sources", () => {
  eq(built().batch.sources_covered, ["chowdeck", "tix"], "tix and chowdeck are complete; eventbrite, luma and the leads are not");
  const raw = allRaw();
  raw[0].complete = false;
  eq(lib.buildBatch(raw, { now: NOW }).batch.sources_covered, ["chowdeck"], "an incomplete file takes the source out");
  const two = [clone(allRaw()[2]), { ...clone(allRaw()[2]), complete: false, rows: [] }];
  eq(lib.buildBatch(two, { now: NOW }).batch.sources_covered, [], "one incomplete file for a site is enough to leave it out");
});

await test("rows seen twice in a batch are merged by source ids; the fuller one stays", () => {
  const b = built();
  eq(b.duplicates, ["tix:11111111-2222-4333-8444-555555555555"], "the repeat is reported");
  const kept = b.batch.events.find((e) => e.source_id === "11111111-2222-4333-8444-555555555555");
  eq(kept.organiser_handle, "fakefridaynight", "the fuller row won");
  eq(b.batch.events.filter((e) => e.source_site === "tix" && e.name === "Fake Friday Night").length, 1, "one row");
});

await test("skipped rows are listed with a reason, never dropped silently", () => {
  const b = built();
  const reasons = b.skipped.map((s) => `${s.source}: ${s.reason}`);
  ok(reasons.some((r) => r.startsWith("tix: not Lagos")), "tix");
  ok(reasons.includes("eventbrite: online only"), "eventbrite");
  ok(reasons.some((r) => r.startsWith("chowdeck: virtual")), "chowdeck");
  ok(reasons.some((r) => r.startsWith("luma: online")), "luma");
});

await test("carry over: contact details found on an earlier day come back with their notes", () => {
  const first = built();
  const raw = allRaw();
  for (const k of ["organiser_instagram", "organiser_instagram_seen_on", "organiser_email", "organiser_phone", "contact_seen_on", "lineup"]) delete raw[0].rows[0][k];
  const second = lib.buildBatch(raw, { now: NOW });
  const ev = second.batch.events.find((e) => e.source_id.startsWith("11111111"));
  eq(ev.organiser_handle, null, "gone before carry over");
  const carried = lib.carryOver(second.batch.events, second.provenance, first.batch.events, first.provenance);
  ok(carried.length >= 3, "carried something");
  eq([ev.organiser_handle, ev.organiser_email, ev.lineup.length], ["fakefridaynight", "bookings@example.com", 2], "values back");
  ok(second.provenance[lib.eventKey(ev)].handle_seen, "with the note of where it was seen");
});

await test("extras files add page-read contact details to raw rows by key, and report keys that match nothing", async () => {
  const { home, dir, venuesPath } = dayFolder();
  const tix = fixture("tix.json");
  for (const k of ["organiser_instagram", "organiser_instagram_seen_on", "organiser_email", "organiser_phone", "contact_seen_on", "lineup"]) delete tix.rows[0][k];
  writeFileSync(join(dir, "raw", "tix.json"), JSON.stringify(tix));
  writeFileSync(join(dir, "raw", "tix.extras.json"), JSON.stringify({
    "fake-friday-night": { organiser_instagram: "@fakefridaynight", organiser_instagram_seen_on: "Tix event page, Contact Us block", organiser_email: "hi@example.com", contact_seen_on: "Tix event page, Contact Us block", sneaky_field: "ignored", capacity: 300, capacity_quote: "300 guests max, event page" },
    "no-such-slug": { organiser_instagram: "@x" },
  }));
  const out = logger();
  const r = await loader.runScout(loader.parseArgs([dir, "--build"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: noNetwork });
  eq(r.code, 0, "ok");
  const batch = JSON.parse(readFileSync(join(dir, "events.json"), "utf8"));
  const ev = batch.events.find((e: any) => e.source_id.startsWith("11111111"));
  eq([ev.organiser_handle, ev.organiser_email, ev.capacity], ["fakefridaynight", "hi@example.com", 300], "merged");
  ok(!("sneaky_field" in ev), "only listed keys are taken");
  ok(out.text().includes('no row for "no-such-slug"'), "unmatched key reported");
  const prov = JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8"));
  eq(prov[`tix:${ev.source_id}`].capacity, "300 guests max, event page", "capacity quote kept");
  eq(lib.extrasKey("eventbrite", { page_url: "https://www.eventbrite.com/e/x-tickets-1000000000001?a=b" }), "1000000000001", "eventbrite key");
  eq(lib.extrasKey("luma", { event: { url: "fakemixer", api_id: "evt-1" } }), "fakemixer", "luma key");
});

/* -------------------------------------------------------------- validation -- */

await test("the fixture batch validates; warnings are for missing time and price", () => {
  const b = built();
  const v = lib.validateBatch(b.batch, { now: NOW, provenance: b.provenance });
  eq(v.errors, 0, `no errors, got ${JSON.stringify(v.problems.filter((p) => p.level === "error"))}`);
  ok(v.problems.some((p) => p.code === "no_time"), "no_time warning for leads");
});

function oneEvent(mutate: (e: any) => void, withProvenance = true) {
  const b = built();
  const batch = clone(b.batch);
  batch.events = [clone(batch.events.find((e: any) => e.source_id.startsWith("11111111")))];
  mutate(batch.events[0]);
  return { batch, v: lib.validateBatch(batch, { now: NOW, provenance: withProvenance ? b.provenance : {} }) };
}
const codes = (v: any) => v.problems.filter((p: any) => p.level === "error").map((p: any) => p.code);

await test("validation reports every problem of an event, not just the first", () => {
  const { v } = oneEvent((e) => {
    e.name = "  ";
    e.source_id = "";
    e.starts_at = "2026-11-06 19:00";
    e.tickets[0].price_naira = 12.5;
    e.ticket_url = "not a url";
    e.organiser_email = "nope";
  });
  const c = codes(v);
  for (const want of ["name", "source_id", "starts_at", "price", "url", "email"]) ok(c.includes(want), `missing ${want} in ${c}`);
});

await test("validation refuses: past only, outside Lagos, online, unsourced capacity, guessed handle", () => {
  ok(codes(oneEvent((e) => { e.starts_at = "2026-10-30T19:00:00+01:00"; e.ends_at = "2026-10-30T23:00:00+01:00"; }).v).includes("past"), "past only");
  eq(codes(oneEvent((e) => { e.starts_at = "2026-10-30T19:00:00+01:00"; e.ends_at = "2026-11-04T23:00:00+01:00"; }).v).includes("past"), false, "a run that is still on is not past");
  ok(codes(oneEvent((e) => { e.lat = 9.07; e.lng = 7.4; }).v).includes("not_lagos"), "pin outside Lagos");
  ok(codes(oneEvent((e) => { e.lat = null; e.lng = null; e.pin_by = null; e.venue = "Hall, Abuja"; e.area = null; }).v).includes("not_lagos"), "text outside Lagos");
  ok(codes(oneEvent((e) => { e.lat = null; e.lng = null; e.pin_by = null; e.venue = "Zoom"; }).v).includes("online"), "online");
  ok(codes(oneEvent((e) => { e.capacity = 500; }).v).includes("capacity_unsourced"), "capacity with no quote");
  ok(codes(oneEvent((e) => { e.organiser_handle = "fakefridayfakers"; e.organiser_name = "Fake Friday Fakers"; }, false).v).includes("handle_guess"), "a handle that is the name and has no note");
  ok(codes(oneEvent((e) => { e.organiser_handle = "@Bad Handle"; }).v).includes("bad_handle"), "unclean handle");
});

await test("validation: duplicates, batch level problems, pin_by rules", () => {
  const b = built();
  const dup = clone(b.batch);
  dup.events.push(clone(dup.events[0]));
  ok(codes(lib.validateBatch(dup, { now: NOW, provenance: b.provenance })).includes("duplicate_id"), "duplicate ids");
  const bad = lib.validateBatch({ run_id: "", scouted_at: "yesterday", sources_covered: "tix", events: [] }, { now: NOW });
  ok(bad.errors >= 3 && !bad.ok, "batch level errors");
  ok(!lib.validateBatch({ events: "x" }).ok, "events must be a list");
  ok(!lib.validateBatch(null).ok, "not an object");
  ok(codes(oneEvent((e) => { e.pin_by = null; }).v).includes("pin_by"), "a pin needs pin_by");
  ok(codes(oneEvent((e) => { e.lng = null; }).v).includes("pin"), "lat without lng");
});

/* ---------------------------------------------------------------------- pins -- */

const venuesFile = JSON.parse(readFileSync(join(root, "scripts", "events", "venues.json"), "utf8"));
const venues = lib.indexVenues(venuesFile);

function fakeGeocoder(answers: Record<string, any[]>) {
  const calls: string[] = [];
  const fn = async (q: string) => {
    calls.push(q);
    return answers[q] ?? Object.values(answers)[0] ?? [];
  };
  return Object.assign(fn, { calls });
}
const OSM_HIT = { name: "Fake Rooftop", lat: 6.45, lng: 3.41, state: "Lagos", osm_id: 1, osm_type: "node" };

await test("pin order: venue file, then the source, then OpenStreetMap, then nothing", async () => {
  const cache = {};
  const geo = fakeGeocoder({ q: [OSM_HIT] });
  const o = { venues, cache, geocode: geo, now: NOW };
  const v = await lib.resolvePin("Octo Lagos, Victoria Island", "Victoria Island", { lat: 6.5, lng: 3.5 }, o);
  eq([v.pin_by, v.lat, v.lng], ["venues", 6.4295, 3.421], "the venue file wins over the source");
  ok(v.conflict_km > 5, "and the distance to the source's point is reported");
  const s = await lib.resolvePin("Unknown Place", null, { lat: 6.52, lng: 3.38 }, o);
  eq([s.pin_by, s.lat], ["source", 6.52], "source coordinates beat a search");
  eq(geo.calls.length, 0, "no search while the first two answer");
  const outside = await lib.resolvePin("Fake Rooftop", "Lekki", { lat: 9.07, lng: 7.4 }, { ...o, geocode: null });
  eq(outside.pin_by, null, "source coordinates outside Lagos are not used");
  const osm = await lib.resolvePin("Fake Rooftop", "Lekki", null, o);
  eq([osm.pin_by, osm.lat, osm.lng, osm.confident], ["osm", 6.45, 3.41, true], "OpenStreetMap");
  const none = await lib.resolvePin("Nowhere Special", null, null, { venues, cache, geocode: null, now: NOW });
  eq([none.pin_by, none.lat, none.lng], [null, null, null], "nothing, never a guess");
});

await test("the venue file: name keys, the part before the comma, close names, osm marked pins", () => {
  eq(lib.lookupVenue("National Theatre", venues).how, "exact", "exact");
  eq(lib.lookupVenue("Octo Lagos, 4b Musa Yar'Adua Street, Victoria Island", venues).name, "Octo Lagos", "before the comma");
  eq(lib.lookupVenue("kó", venues).entry.lat, 6.45695, "accents");
  eq(lib.lookupVenue("Wole Soyinka Centre for Culture and Creative Arts", venues)?.how, "exact", "the name before the bracket in the file");
  eq(lib.lookupVenue("The Terra Kulture Lawn", venues)?.how, "fuzzy", "a close name");
  eq(lib.lookupVenue("The", venues), null, "too short to match loosely");
  eq(lib.lookupVenue("Totally Unknown Venue", venues), null, "unknown");
});

await test("the geocoder is injected: asked once per venue, answers cached, wrong answers refused", async () => {
  const cache: Record<string, any> = {};
  const geo = fakeGeocoder({ "Fake Rooftop, Lekki, Lagos": [OSM_HIT] });
  const o = { venues, cache, geocode: geo, now: NOW };
  const first = await lib.resolvePin("Fake Rooftop", "Lekki", null, o);
  eq(first.pin_by, "osm", "found");
  await lib.resolvePin("Fake Rooftop", "Lekki", null, o);
  eq(geo.calls, ["Fake Rooftop, Lekki, Lagos"], "the second ask came from the cache");
  eq(Object.values(cache)[0].found, true, "cache holds the answer");
  // Offline run with the cache only.
  const again = await lib.resolvePin("Fake Rooftop", "Lekki", null, { venues, cache, geocode: null, now: NOW });
  eq(again.pin_by, "osm", "the saved answer is used with no geocoder");
  // Refusals.
  const c2: Record<string, any> = {};
  const bad = fakeGeocoder({ q: [{ ...OSM_HIT, state: "Ogun" }, { ...OSM_HIT, name: "Something Else Entirely" }, { ...OSM_HIT, lat: 9.07, lng: 7.4 }] });
  const r = await lib.resolvePin("Fake Rooftop", "Lekki", null, { venues, cache: c2, geocode: bad, now: NOW });
  eq(r.pin_by, null, "wrong state, wrong name and outside Lagos are all refused");
  const r2 = await lib.resolvePin("Fake Rooftop", "Lekki", null, { venues, cache: c2, geocode: bad, now: NOW });
  eq([bad.calls.length, r2.detail], [1, "searched before, not found"], "a miss is remembered too");
  // Vague text is not searched.
  const vague = fakeGeocoder({ q: [OSM_HIT] });
  for (const t of ["Lagos (venue on ticket)", "TBA", "Lekki Phase 1 (address sent after payment)", "Online"]) await lib.resolvePin(t, null, null, { venues, cache: {}, geocode: vague, now: NOW });
  eq(vague.calls.length, 0, "vague places never reach the search");
});

await test("the Photon geocoder: one request a second at most, bounded to Lagos, results parsed", async () => {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const urls: string[] = [];
  const fetchImpl = async (u: string) => {
    urls.push(u);
    return { ok: true, status: 200, json: async () => ({ features: [
      { geometry: { coordinates: [3.41, 6.45] }, properties: { name: "Fake Rooftop", state: "Lagos", countrycode: "NG", osm_id: 7, osm_type: "N" } },
      { geometry: { coordinates: [-0.1, 51.5] }, properties: { name: "London Rooftop", state: "England", countrycode: "GB" } },
    ] }) };
  };
  const g = lib.makePhotonGeocoder({ fetchImpl, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, clock: () => t, minGapMs: 1100 });
  const a = await g("Fake Rooftop, Lagos");
  await g("Other, Lagos");
  eq(sleeps.length, 1, "the second call waited");
  ok(sleeps[0] >= 1000, `waited ${sleeps[0]} ms`);
  eq(a.length, 1, "non Nigerian results dropped");
  eq([a[0].name, a[0].lat, a[0].lng, a[0].state], ["Fake Rooftop", 6.45, 3.41, "Lagos"], "parsed");
  ok(urls[0].startsWith("https://photon.komoot.io/api/") && urls[0].includes("bbox=3.05%2C6.3%2C3.95%2C6.8"), `bbox in ${urls[0]}`);
  eq(g.calls.count, 2, "calls counted");
});

await test("venues.json: formatting round trips, new pins are marked osm and never overwrite", () => {
  const text = readFileSync(join(root, "scripts", "events", "venues.json"), "utf8");
  eq(lib.formatVenuesJson(JSON.parse(text)), text, "same style, byte for byte");
  const { venues: next, added } = lib.withNewPins(venuesFile, [{ key: "Fake Rooftop", lat: 6.45, lng: 3.41, osm_name: "Fake Rooftop" }, { key: "national theatre", lat: 1, lng: 1, osm_name: "x" }]);
  eq(added, ["Fake Rooftop"], "only the new one");
  eq(next["Fake Rooftop"].by, "osm", "marked for staff");
  eq(next["National Theatre"].lat, 6.47461, "existing pin untouched");
  eq(Object.keys(next).slice(0, 2), Object.keys(venuesFile).slice(0, 2), "order kept, new ones last");
});

await test("a pin saved by a past run reads back as osm until staff check it", async () => {
  const idx = lib.indexVenues({ "Fake Rooftop": { lat: 6.45, lng: 3.41, by: "osm" }, "Octo Lagos": venuesFile["Octo Lagos"] });
  eq((await lib.resolvePin("Fake Rooftop", null, null, { venues: idx })).pin_by, "osm", "osm");
  eq((await lib.resolvePin("Octo Lagos", null, null, { venues: idx })).pin_by, "venues", "venues");
});

/* ------------------------------------------------------------------ flyers -- */

await test("flyer names and download urls", () => {
  const ev = { source_site: "tix", source_id: "11111111-2222-4333-8444-555555555555" };
  eq(lib.flyerBase(ev), "tix_11111111-2222-4333-8444-555555555555", "file base");
  eq(lib.flyerBase({ source_site: "luma", source_id: "evt-AbC/1" }), "luma_evt-abc-1", "unsafe characters");
  eq(lib.flyerDownloadUrl("https://res.cloudinary.com/tix-africa/image/upload/c_scale,f_webp,fl_lossy,w_640/v1793287196/abc.webp"), "https://res.cloudinary.com/tix-africa/image/upload/c_limit,f_jpg,w_1200/v1793287196/abc.webp", "transform replaced");
  eq(lib.flyerDownloadUrl("https://res.cloudinary.com/tix-africa/image/upload/v1/event_media/x/y.jpg?_a=B"), "https://res.cloudinary.com/tix-africa/image/upload/c_limit,f_jpg,w_1200/v1/event_media/x/y.jpg?_a=B", "transform added");
  eq(lib.flyerDownloadUrl("https://img.evbuc.com/a.jpg?w=1"), "https://img.evbuc.com/a.jpg?w=1", "other hosts as they are");
  eq(lib.flyerDownloadUrl("javascript:alert(1)"), null, "not a web address");
});

/* ------------------------------------------------------------------ loader -- */

await test("dry run is the default: builds, checks, prints, writes the normalized batch, uses no network", async () => {
  const { home, dir, venuesPath } = dayFolder();
  const out = logger();
  const r = await loader.runScout({ ...loader.parseArgs([dir]) }, { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: noNetwork, geocode: noNetwork });
  eq(r.code, 0, `exit code (${out.text().slice(-400)})`);
  for (const f of ["events.json", "provenance.json", "flyer-jobs.json", "skipped.json", "batch.normalized.json"]) ok(existsSync(join(dir, f)), `${f} written`);
  const text = out.text();
  ok(text.includes("Fake Friday Night") && text.includes("Fake Rooftop Sessions"), "the table lists events");
  ok(text.includes("Totals") && text.includes("Dry run. Nothing was sent."), "totals and the dry run line");
  ok(/pins: venues \d+, source \d+, osm 0/.test(text), "pin counts, none from osm offline");
  const norm = JSON.parse(readFileSync(join(dir, "batch.normalized.json"), "utf8"));
  eq(norm.sources_covered, ["chowdeck", "tix"], "coverage carried");
  ok(norm.events.every((e: any) => "pin_by" in e && "capacity" in e), "ScoutEvent fields present");
});

await test("dry run with a past event and a capacity nobody quoted: they are refused and listed", async () => {
  const { home, dir, venuesPath } = dayFolder();
  const b = built();
  const batch = clone(b.batch);
  batch.events[0].starts_at = "2026-10-20T19:00:00+01:00";
  batch.events[0].ends_at = "2026-10-20T23:00:00+01:00";
  batch.events[1].capacity = 900;
  writeFileSync(join(dir, "events.json"), JSON.stringify(batch));
  writeFileSync(join(dir, "provenance.json"), JSON.stringify(b.provenance));
  const out = logger();
  const r = await loader.runScout(loader.parseArgs([dir]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: noNetwork });
  eq(r.code, 0, "a dry run reports, it does not fail");
  ok(out.text().includes("Refused") && out.text().includes("past") && out.text().includes("capacity_unsourced"), "both refusals are printed");
  const norm = JSON.parse(readFileSync(join(dir, "batch.normalized.json"), "utf8"));
  eq(norm.events.length, batch.events.length - 2, "refused events are left out of the normalized batch");
});

await test("--geocode with an injected geocoder fills the cache; --save-pins writes osm pins into venues.json", async () => {
  const { home, dir, venuesPath } = dayFolder();
  const geo = fakeGeocoder({ q: [{ ...OSM_HIT, name: "Test Lounge", lat: 6.43, lng: 3.42 }] });
  const out = logger();
  // Make the Tix event lose its published point so only a search can pin it.
  const b = built();
  const batch = clone(b.batch);
  for (const e of batch.events) if (e.venue === "Test Lounge") { e.lat = null; e.lng = null; e.pin_by = null; }
  writeFileSync(join(dir, "events.json"), JSON.stringify(batch));
  writeFileSync(join(dir, "provenance.json"), JSON.stringify(b.provenance));
  const r = await loader.runScout(loader.parseArgs([dir, "--geocode", "--save-pins"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, geocode: geo, fetchImpl: noNetwork });
  eq(r.code, 0, out.text().slice(-300));
  ok(geo.calls.length >= 1, "the geocoder was asked");
  ok(existsSync(join(home, "venue-cache.json")), "cache file written");
  const saved = JSON.parse(readFileSync(venuesPath, "utf8"));
  eq(saved["Test Lounge"]?.by, "osm", "new pin saved and marked osm");
  const real = readFileSync(join(root, "scripts", "events", "venues.json"), "utf8");
  ok(!real.includes("Test Lounge"), "the repo's venues.json was not touched (the check works on a copy)");
  // Second run: nothing to ask.
  const before = geo.calls.length;
  await loader.runScout(loader.parseArgs([dir, "--geocode"]), { home, now: NOW, log: () => {}, err: () => {}, venuesPath, geocode: geo, fetchImpl: noNetwork });
  eq(geo.calls.length, before, "asked once, remembered");
});

function fakeSite(opts: { reportNew?: number } = {}) {
  const calls: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.authorization, body });
    if (body.action === "flyer") return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, url: `https://cdn.test/scout/${body.source_site}_${body.source_id}.jpg` }) };
    const n = body.batch.events.length;
    const report = { dry_run: body.dryRun, total: n, new: opts.reportNew ?? n, updated: 0, unchanged: 0, blocked: 0, skipped: 0, flagged_gone: 0, organisers_matched: 0, organisers_new: n, lines: body.batch.events.map((e: any) => ({ source_site: e.source_site, source_id: e.source_id, name: e.name, action: "new", note: "" })) };
    return { ok: true, status: 200, text: async () => JSON.stringify(report) };
  };
  return { calls, fetchImpl };
}
const TOKEN = "check-token-not-real-123";
const writeEnv = (home: string, site = "https://hoppaz.example") => writeFileSync(join(home, ".env"), `HOPPAZ_SITE_URL=${site}\nHOPPAZ_ADMIN_TOKEN=${TOKEN}\n`);

await test("--apply refuses a local site unless --allow-local, and refuses with no config", async () => {
  const { home, dir, venuesPath } = dayFolder();
  const site = fakeSite();
  let out = logger();
  let r = await loader.runScout(loader.parseArgs([dir, "--apply"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: site.fetchImpl });
  eq(r.code, 1, "no .env");
  ok(out.text().includes("No site"), "says what is missing");
  for (const local of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://192.168.1.5:3000", "http://hoppaz.local"]) {
    writeEnv(home, local);
    out = logger();
    r = await loader.runScout(loader.parseArgs([dir, "--apply"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: site.fetchImpl });
    eq(r.code, 1, `${local} refused`);
    ok(out.text().includes("looks like a local address"), "message");
  }
  eq(site.calls.length, 0, "nothing was posted");
  ok(!out.text().includes(TOKEN), "token never printed");
  writeEnv(home, "http://localhost:3000");
  r = await loader.runScout(loader.parseArgs([dir, "--apply", "--allow-local"]), { home, now: NOW, log: () => {}, err: () => {}, venuesPath, fetchImpl: site.fetchImpl });
  eq(r.code, 0, "--allow-local lets it through");
  ok(site.calls.length > 0, "and it posts");
});

await test("--apply uploads flyers, sends the batch with dryRun false and a bearer token, prints the server report", async () => {
  const { home, dir, venuesPath } = dayFolder();
  writeEnv(home);
  mkdirSync(join(dir, "flyers"), { recursive: true });
  writeFileSync(join(dir, "flyers", "tix_11111111-2222-4333-8444-555555555555.jpg"), Buffer.from("fake image bytes"));
  const site = fakeSite();
  const out = logger();
  let shrunk = 0;
  const r = await loader.runScout(loader.parseArgs([dir, "--apply"]), {
    home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: site.fetchImpl, shrink: async () => { shrunk++; return Buffer.from("small jpeg"); },
  });
  eq(r.code, 0, out.text().slice(-400));
  eq(shrunk, 1, "one flyer shrunk");
  const flyers = site.calls.filter((c) => c.body.action === "flyer");
  eq(flyers.length, 1, "one flyer upload");
  eq([flyers[0].body.source_site, flyers[0].body.source_id, flyers[0].body.jpeg_base64], ["tix", "11111111-2222-4333-8444-555555555555", Buffer.from("small jpeg").toString("base64")], "flyer body");
  const imp = site.calls.filter((c) => c.body.action === "import");
  eq(imp.length, 1, "one import");
  eq(imp[0].body.dryRun, false, "dryRun false");
  eq(imp[0].auth, `Bearer ${TOKEN}`, "bearer token");
  eq(imp[0].url, "https://hoppaz.example/api/admin/outreach", "route");
  const sent = imp[0].body.batch.events.find((e: any) => e.source_id.startsWith("11111111"));
  eq(sent.flyer_url, "https://cdn.test/scout/tix_11111111-2222-4333-8444-555555555555.jpg", "the returned flyer url is used");
  ok(site.calls.every((c) => c.body.action === "flyer" || c.body.action === "import"), "only the two actions");
  ok(out.text().includes("Server import") && out.text().includes("Nothing is live"), "report printed");
  ok(!out.text().includes(TOKEN), "token never printed");
  ok(existsSync(join(dir, "import-report.json")), "report saved");
});

await test("--plan asks the site for dryRun true and uploads nothing", async () => {
  const { home, dir, venuesPath } = dayFolder();
  writeEnv(home);
  const site = fakeSite();
  const out = logger();
  const r = await loader.runScout(loader.parseArgs([dir, "--plan"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: site.fetchImpl });
  eq(r.code, 0, "ok");
  eq(site.calls.map((c) => [c.body.action, c.body.dryRun]), [["import", true]], "one dry run call");
  ok(out.text().includes("Server dry run"), "report printed");
});

await test("--apply is blocked by a hard refusal unless --drop-invalid; past events do not block", async () => {
  const { home, dir, venuesPath } = dayFolder();
  writeEnv(home);
  const b = built();
  const batch = clone(b.batch);
  batch.events[0].starts_at = "2026-10-20T19:00:00+01:00";
  batch.events[0].ends_at = "2026-10-20T23:00:00+01:00";
  writeFileSync(join(dir, "events.json"), JSON.stringify(batch));
  writeFileSync(join(dir, "provenance.json"), JSON.stringify(b.provenance));
  let site = fakeSite();
  let r = await loader.runScout(loader.parseArgs([dir, "--apply"]), { home, now: NOW, log: () => {}, err: () => {}, venuesPath, fetchImpl: site.fetchImpl, shrink: async () => Buffer.from("x") });
  eq([r.code, site.calls.some((c) => c.body.action === "import")], [0, true], "a past event is simply left out");
  batch.events[1].capacity = 900;
  writeFileSync(join(dir, "events.json"), JSON.stringify(batch));
  site = fakeSite();
  const out = logger();
  r = await loader.runScout(loader.parseArgs([dir, "--apply"]), { home, now: NOW, log: out.log, err: out.err, venuesPath, fetchImpl: site.fetchImpl });
  eq([r.code, site.calls.length], [2, 0], "an unsourced capacity blocks the send");
  r = await loader.runScout(loader.parseArgs([dir, "--apply", "--drop-invalid"]), { home, now: NOW, log: () => {}, err: () => {}, venuesPath, fetchImpl: site.fetchImpl });
  eq(r.code, 0, "--drop-invalid sends the rest");
  const sent = site.calls.find((c) => c.body.action === "import").body.batch.events;
  ok(!sent.some((e: any) => e.capacity === 900), "the refused event is not in what was sent");
});

await test("flyer downloads: one at a time, with a pause, and they stop after three failures in a row", async () => {
  const dir = tmp();
  const jobs = Array.from({ length: 6 }, (_, i) => ({ source_site: "tix", source_id: `id${i}`, file: `tix_id${i}`, url: `https://img.test/${i}.jpg` }));
  const seen: number[] = [];
  const sleeps: number[] = [];
  let active = 0, maxActive = 0;
  const fetchImpl = async (u: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const i = Number(u.match(/(\d)\.jpg/)![1]);
    seen.push(i);
    await Promise.resolve();
    active--;
    if (i < 2) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array(900).buffer };
    return { ok: false, status: 403, headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const res = await loader.fetchFlyers(jobs, join(dir, "flyers"), { fetchImpl, sleep: async (ms: number) => { sleeps.push(ms); }, gapMs: 2000, log: () => {} });
  eq([res.got, res.failed], [2, 3], "two saved, three failed");
  eq(seen.length, 5, "stopped before the sixth");
  eq(maxActive, 1, "never two at once");
  ok(sleeps.every((s) => s >= 2000), "a pause after each");
  ok(existsSync(join(dir, "flyers", "tix_id0.jpg")), "saved with its extension");
});

await test("config comes only from ~/hoppaz-scout/.env: parsing, and no use of the repo's env files", () => {
  eq(loader.parseEnv('HOPPAZ_SITE_URL="https://a.b"\n# c\nHOPPAZ_ADMIN_TOKEN=abc\n'), { HOPPAZ_SITE_URL: "https://a.b", HOPPAZ_ADMIN_TOKEN: "abc" }, "parse");
  const src = readFileSync(join(root, "scripts", "events", "load-scout.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/\.env\.local/.test(code) && !/SUPABASE/.test(code), "no repo env reading, no database keys");
  ok(!/@supabase|\/rest\/v1\//.test(code), "no database access");
  ok(loader.isLocalSite("http://localhost:3000") && loader.isLocalSite("http://10.0.0.4") && !loader.isLocalSite("https://hoppaz.fun"), "local site detection");
});

await test("no em dashes in the scout files", () => {
  for (const f of ["scripts/events/scout-lib.mjs", "scripts/events/load-scout.mjs", "scripts/events-scout-check.mts", "docs/skill/hoppaz-event-scout/SKILL.md"]) {
    const p = join(root, f);
    if (existsSync(p)) ok(!readFileSync(p, "utf8").includes(String.fromCharCode(0x2014)), `${f} has an em dash`);
  }
});

/* --------------------------------------------------------- the old loaders -- */

await test("the old loaders refuse --apply without --skip-review, and keep their dry run", () => {
  for (const f of ["load-guide.mjs", "load-pack.mjs"]) {
    const r = spawnSync(process.execPath, [join(root, "scripts", "events", f), "/nonexistent-dir", "--apply"], { encoding: "utf8" });
    eq(r.status, 1, `${f} exit code`);
    ok(r.stderr.includes("--skip-review") && r.stderr.includes("no review"), `${f} says why`);
    const code = readFileSync(join(root, "scripts", "events", f), "utf8");
    ok(code.includes('process.argv.includes("--skip-review")'), `${f} checks the flag`);
    ok(code.includes("Dry run. Run again with --apply to write."), `${f} still has its dry run`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
