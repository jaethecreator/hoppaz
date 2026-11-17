/**
 * Offline checks for the outreach mappers of the real layer (src/lib/events-r1/real/map.ts, reasons.ts, listings.ts): sample jsonb in,
 * expected objects out. No database, no network. Run from the repo root:  node --no-warnings scripts/events-r1-real-map-check.mts
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

const map = await import("../src/lib/events-r1/real/map.ts");
const { outreachReason, outreachStatus } = await import("../src/lib/events-r1/real/reasons.ts");
const { OUTREACH_REASONS } = await import("../src/lib/events-r1/types.ts");
const { withListing } = await import("../src/lib/events-r1/real/listings.ts");

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

test("mapListing: nulls stay null, price kept, flags are booleans", () => {
  eq(
    map.mapListing({ ticket_url: "https://tix.africa/e/1", instagram_url: null, price_from: 5000, price_to: "15000", sold_out: null, source_site: "Tix", claimed: true, organiser_name: "Lagos Nights" }),
    { ticket_url: "https://tix.africa/e/1", instagram_url: null, price_from: 5000, price_to: 15000, sold_out: false, source_site: "Tix", claimed: true, organiser_name: "Lagos Nights", ticket_platform: null, source_url: null, flyer_credit: null, organiser_ig: null, organiser_x: null },
    "listing"
  );
  eq(map.mapListing({}), { ticket_url: null, instagram_url: null, price_from: null, price_to: null, sold_out: false, source_site: null, claimed: false, organiser_name: null, ticket_platform: null, source_url: null, flyer_credit: null, organiser_ig: null, organiser_x: null }, "empty");
  eq(map.mapListing({ ticket_platform: "Tix", flyer_credit: "Flyer by @k", organiser_ig: "lekki", organiser_x: "lekki_x" }).organiser_x, "lekki_x", "the new fields are read");
  eq(map.mapListing({ price_from: 0 }).price_from, 0, "free is 0, not unknown");
});

test("withListing: a listing has no tickets, no going, no spots, price from the listing", () => {
  const ev = map.mapEvent({ id: ID, title: "Rave", price_naira: 0, going: 4, spots_left: 9, ticket_types: [{ id: ID2, event_id: ID, name: "General", price_naira: 0 }], host: { id: "h", name: "Hoppaz Listings" } });
  eq(ev.ticket_types.length, 1, "event had a type before");
  const l = withListing(ev, { [ID]: { ticket_url: "https://x.test/t", price_from: 7000, price_to: 12000, sold_out: true, claimed: false } });
  eq([l.ticket_types, l.going, l.spots_left, l.price_naira, l.listing?.sold_out, l.listing?.ticket_url], [[], 0, null, 7000, true, "https://x.test/t"], "listing merged");
  eq(withListing(ev, { [ID]: { price_from: null } }).price_naira, 0, "unknown price is 0 on the row");
  eq(withListing(ev, {}), ev, "not a listing: untouched");
  eq(ev.listing, undefined, "a normal event has no listing key");
});

test("mapOrganiser: defaults, handles, counts", () => {
  const o = map.mapOrganiser({
    id: ID, name: "Lagos Nights", ig_handle: "lagosnights", handles: { instagram: "lagosnights", x: "", bogus: "no" }, email: null, phone: "0801", room_id: ID2, room_slug: "lagos-nights",
    room_name: "Lagos Nights", stage: "offered", do_not_contact: false, last_contacted_at: "2026-10-30 09:00:00+00", last_contacted_by: "Jae", notes: null, claimed_at: null,
    declined_at: null, created_at: "2026-10-01T10:00:00Z", events_total: "3", events_upcoming: 2, pulled_waiting: 1, transfer_pending: true, claim_requests: 0,
  });
  eq(o.handles, { instagram: "lagosnights" }, "handles: only known keys with text");
  eq([o.stage, o.notes, o.last_contacted_at, o.events_total, o.transfer_pending, o.email], ["offered", "", "2026-10-30T09:00:00.000Z", 3, true, null], "fields");
  eq(map.mapOrganiser({ id: ID, name: "X", stage: "weird" }).stage, "pulled", "unknown stage reads pulled");
});

test("mapOrganiserDetail: log, events, transfers", () => {
  const d = map.mapOrganiserDetail({
    organiser: { id: ID, name: "Lagos Nights", stage: "listed" },
    log: [{ id: ID2, organiser_id: ID, at: "2026-10-30T09:00:00Z", by: "Jae", kind: "contact", channel: "instagram", body: "DM sent" }, { id: ID, kind: "odd", channel: "pigeon", body: "x" }],
    events: [{ id: ID2, title: "Rave", starts_at: "2026-11-07T20:00:00Z", status: "live", ticket_url: null, upcoming: true }],
    transfers: [],
  });
  eq([d.organiser.name, d.log[0].channel, d.log[1].kind, d.log[1].channel, d.events[0].upcoming, d.transfers], ["Lagos Nights", "instagram", "note", null, true, []], "detail");
});

test("mapPulled: fields tidied, flags filtered, unknown stays null", () => {
  const p = map.mapPulled({
    id: ID, source_site: "tix", source_id: "abc", status: "new", flags: ["no_pin", "bogus", "duplicate"], edited: ["name"], confidence: "lead", organiser_id: null, organiser_name: null,
    organiser_stage: null, event_id: null, duplicate_of: null, also_at: [{ source_site: "luma", source_id: "z", ticket_url: "https://l.test" }], first_seen_at: "2026-10-30T09:00:00Z",
    last_seen_at: "2026-10-31T09:00:00Z", missing_since: null,
    fields: { name: "Rave", starts_at: "2026-11-07T20:00:00+01:00", venue: null, lat: null, lng: null, pin_by: "osm", tickets: [{ name: "GA", price_naira: null, sold_out: false }], sold_out: false,
      ticket_url: "https://tix.test/abc", lineup: [{ name: "DJ A" }, { time: "22:00", name: "DJ B" }], capacity: null, last_seen: "2026-10-31T09:00:00Z", confidence: "lead" },
  });
  eq(p.flags, ["no_pin", "duplicate"], "flags");
  eq([p.fields.starts_at, p.fields.venue, p.fields.lat, p.fields.pin_by, p.fields.tickets, p.fields.lineup, p.fields.source_id], ["2026-11-07T19:00:00.000Z", null, null, "osm", [{ name: "GA", price_naira: null, sold_out: false }], [{ name: "DJ A" }, { time: "22:00", name: "DJ B" }], "abc"], "fields");
  eq([p.also_at, p.status, p.confidence, p.missing_since], [[{ source_site: "luma", source_id: "z", ticket_url: "https://l.test" }], "new", "lead", null], "row");
});

test("mapTransfer: shape, and an open link past its date reads expired", () => {
  const t = map.mapTransfer({ id: ID, kind: "claim", room_id: ID2, room_name: "Lagos Nights", organiser_id: ID, to_email: "a@b.co", status: "pending", created_at: "2026-10-01T00:00:00Z", created_by: "Jae", expires_at: "2099-01-01T00:00:00Z", accepted_at: null });
  eq([t.status, t.kind, t.to_email, t.accepted_at], ["pending", "claim", "a@b.co", null], "pending");
  eq(map.mapTransfer({ id: ID, status: "pending", expires_at: "2020-01-01T00:00:00Z", kind: "handover" }).status, "expired", "past date");
  eq(map.mapTransfer({ id: ID, status: "accepted", expires_at: "2020-01-01T00:00:00Z" }).status, "accepted", "accepted stays");
});

test("mapPreview: ok and the four bad-link reasons", () => {
  const p = map.mapPreview({ ok: true, kind: "claim", room: { name: "Lagos Nights", slug: "lagos-nights", logo_url: null, about: "" }, events: [{ id: ID, title: "Rave", starts_at: "2026-11-07T20:00:00Z" }], email_hint: "j***@gmail.com", organiser_name: "Lagos Nights", expires_at: "2026-11-15T00:00:00Z" });
  eq(p.ok && [p.room.slug, p.events.length, p.email_hint, p.expires_at], ["lagos-nights", 1, "j***@gmail.com", "2026-11-15T00:00:00.000Z"], "ok");
  for (const r of ["not_found", "expired", "used", "revoked"]) eq(map.mapPreview({ ok: false, reason: r }), { ok: false, reason: r }, r);
  eq(map.mapPreview({ ok: false, reason: "link_expired" }), { ok: false, reason: "expired" }, "link_ words");
  eq(map.mapPreview(null), { ok: false, reason: "not_found" }, "null");
});

test("mapAccept, mapClaimRequest, mapWeek, mapImportReport", () => {
  eq(map.mapAccept({ ok: true, room_id: ID, slug: "r", moved_events: "2", already_owned_other: true }), { room_id: ID, slug: "r", moved_events: 2, already_owned_other: true }, "accept");
  const c = map.mapClaimRequest({ id: ID, event_id: ID2, event_title: "Rave", name: "A", email: "a@b.co", note: null, status: "new", created_at: "2026-10-31T09:00:00Z" });
  eq([c.phone, c.note, c.organiser_id, c.status], [null, "", null, "new"], "claim request");
  const w = map.mapWeek({ from: "2026-10-26T00:00:00Z", to: "2026-11-02T00:00:00Z", contacted: 5, replies: 2, offers: 1, claimed: 1, declined: 0, listed: 7, pulled_new: 30, rejected: 4, claim_requests: 1, stages: { listed: 9, claimed: 1 }, waiting: [{ id: ID, name: "X", days: "9" }], previous: { contacted: 3 } });
  eq([w.stages, w.waiting, w.previous.contacted, w.previous.claimed, w.listed], [{ pulled: 0, listed: 9, offered: 0, claimed: 1, declined: 0 }, [{ id: ID, name: "X", days: 9 }], 3, 0, 7], "week");
  const r = map.mapImportReport({ dry_run: true, total: 2, new: 1, updated: 0, unchanged: 0, blocked: 1, skipped: 0, flagged_gone: 0, organisers_matched: 0, organisers_new: 1, lines: [{ source_site: "tix", source_id: "a", name: "Rave", action: "new", note: "" }, { source_site: "tix", source_id: "b", name: "X", action: "weird", note: null }] });
  eq([r.dry_run, r.lines[0].action, r.lines[1].action, r.lines[1].note], [true, "new", "unchanged", ""], "import report");
});

test("reasons: the shared words, has_registrations names the events, unknown is plain, statuses", () => {
  eq(outreachReason("external_tickets"), OUTREACH_REASONS.external_tickets, "external_tickets");
  eq(outreachReason("wrong_email"), "This link is for a different email", "wrong_email");
  eq(outreachReason("has_registrations", { events: [{ title: "Night one", count: 3 }, { title: "Night two", count: 1 }] }), `${OUTREACH_REASONS.has_registrations}: Night one (3), Night two (1)`, "has_registrations");
  eq(outreachReason("has_registrations"), OUTREACH_REASONS.has_registrations, "has_registrations without events");
  eq(outreachReason("confirm_name"), "Type the organiser name exactly to confirm", "confirm_name");
  eq(outreachReason("what_is_this"), "That did not work. Try again", "unknown");
  eq(["not_found", "has_registrations", "already_pending", "paid_sales", "bad_email", "no_listings_account", "weird"].map(outreachStatus), [404, 409, 409, 409, 400, 503, 400], "statuses");
});

test("claims and bulk approve: a claim link preview has no email; links, asks, the claimable list, tap counts and bulk results map cleanly", () => {
  const p = map.mapPreview({ ok: true, kind: "link", room: { name: "Lagos Nights", slug: "lagos-nights", logo_url: null, about: "" }, events: [], email_hint: null, organiser_name: "Lagos Nights", expires_at: "2026-11-15T00:00:00Z" });
  eq(p.ok && [p.kind, p.email_hint], ["link", null], "a claim link has kind link and no email hint");
  const l = map.mapClaimLink({ id: ID, room_id: ID2, room_name: "R", organiser_id: ID, event_id: null, status: "pending", created_at: "2026-11-01T10:00:00Z", created_by: "Jae", expires_at: "2020-01-01T00:00:00Z", used_at: null });
  eq([l.status, l.event_id, l.created_by], ["expired", null, "Jae"], "an open link past its date reads expired; no token field");
  eq(["token" in l, "token_hash" in l], [false, false], "no token, no hash");
  const a = map.mapClaimAsk({ id: ID, event_id: ID2, event_title: "Rave", organiser_id: null, organiser_name: null, name: "Ada", note: null, status: "weird", created_at: "2026-11-01T10:00:00Z", decided_by: null });
  eq([a.status, a.note, a.name], ["new", "", "Ada"], "a claim ask");
  eq(Object.keys(a).some((k) => /mail|phone/i.test(k)), false, "an ask has no email or phone");
  eq(map.mapClaimable({ event_id: ID, title: "Rave", starts_at: "2026-11-07T20:00:00Z", went_to_buy: "4", link_open: 1, asks: null }).went_to_buy, 4, "claimable: whole numbers");
  eq(map.mapTapCounts({ events: { [ID]: "3" }, organisers: { [ID2]: 5, bad: "x" } }), { events: { [ID]: 3 }, organisers: { [ID2]: 5, bad: 0 } }, "tap counts");
  eq(map.mapTapCounts(null), { events: {}, organisers: {} }, "no tap counts");
  const r = map.mapApproveMany({ ok: true, approved: [{ id: ID, event_id: ID2 }], skipped: [{ id: ID2, name: "Lead", reason: "no_time" }] }, outreachReason);
  eq([r.approved.length, r.skipped[0].reason, r.skipped[0].text], [1, "no_time", OUTREACH_REASONS.no_time], "bulk approve answers with the reason as words");
  eq(outreachReason("not_on"), OUTREACH_REASONS.not_on, "not_on has words");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
