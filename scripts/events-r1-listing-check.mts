/**
 * Plain checks for the listing helpers (src/lib/events-r1/listing.ts) and the screens' words that lean on them: the map's price,
 * the register button kind, the share text. No test framework. Run from the repo root:
 *   node --no-warnings scripts/events-r1-listing-check.mts
 * Same resolve hook as events-r1-check.mts, plus the "@/" alias for src.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith("@/");
    if ((alias || specifier.startsWith(".")) && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = alias ? new URL(specifier.slice(2), SRC).href : new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const L = await import("../src/lib/events-r1/listing.ts");
const geo = await import("../src/lib/geo.ts");
const { buttonFromEvent, registerLabel } = await import("../src/components/events-r1/labels.ts");
const { priceWord, rowMeta } = await import("../src/components/events-r1/words.ts");
const { shareText, sharePreview } = await import("../src/components/event/share.ts");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`, detail ?? "");
  }
}
const same = (name: string, got: unknown, want: unknown) => check(name, got === want, { got, want });

type Info = NonNullable<Parameters<typeof L.priceLine>[0]["listing"]>;
const info = (p: Partial<Info> = {}): Info => ({
  ticket_url: "https://tix.example.com/x",
  instagram_url: null,
  price_from: 5000,
  price_to: 15000,
  sold_out: false,
  source_site: "Tix",
  claimed: false,
  organiser_name: "Lekki Social Club",
  ...p,
});
const base = { title: "Sundown", price_naira: 0 };
const ev = (p: Partial<Info> = {}) => ({ ...base, listing: info(p) });

/* price line */
same("range is From", L.priceLine(ev()), "From ₦5,000");
same("one price", L.priceLine(ev({ price_to: 5000 })), "₦5,000");
same("one price, no max", L.priceLine(ev({ price_to: null })), "₦5,000");
same("free", L.priceLine(ev({ price_from: 0, price_to: 0 })), "Free");
same("free, no max", L.priceLine(ev({ price_from: 0, price_to: null })), "Free");
same("unknown price", L.priceLine(ev({ price_from: null, price_to: null })), "Check listing");
same("normal paid event", L.priceLine({ price_naira: 3000 }), "₦3,000");
same("normal free event", L.priceLine({ price_naira: 0 }), "Free");
same("null listing is normal", L.priceLine({ price_naira: 3000, listing: null }), "₦3,000");

/* the link and the button */
same("ticket link wins", L.ticketHref(ev({ instagram_url: "https://instagram.com/x" })), "https://tix.example.com/x");
same("only Instagram", L.ticketHref(ev({ ticket_url: null, instagram_url: "https://instagram.com/x" })), "https://instagram.com/x");
same("no link at all", L.ticketHref(ev({ ticket_url: null })), null);
same("normal event has no link", L.ticketHref({ ...base }), null);
same("button: tickets", L.ticketButtonLabel(ev()), "Get tickets");
same("button: sold out", L.ticketButtonLabel(ev({ sold_out: true })), "See the listing");
same("button: only a post", L.ticketButtonLabel(ev({ ticket_url: null, instagram_url: "https://instagram.com/x" })), "See the listing");

/* who, and the note under the button */
same("listed by", L.listedByLine(ev()), "Listed by Hoppaz");
same("claimed", L.listedByLine(ev({ claimed: true })), "Hosted by Lekki Social Club");
same("claimed, no name", L.listedByLine(ev({ claimed: true, organiser_name: null })), "Hosted by the organiser");
same("normal event says nothing", L.listedByLine({ ...base }), "");
same("sold at the site", L.soldAtLine(ev()), "Tickets are sold on Tix");
same("sold at, no site", L.soldAtLine(ev({ source_site: null })), "Tickets are sold by the organiser");
same("sold out at the source", L.soldAtLine(ev({ sold_out: true })), "Sold out at the source");
check("counts hidden for a listing", L.showsCounts(ev()) === false);
check("counts shown for a normal event", L.showsCounts({ ...base }) === true);
check("isListing", L.isListing(ev()) && !L.isListing({ ...base }) && !L.isListing({ ...base, listing: null }));

/* the error for an old register or checkout path */
same("external_tickets code", L.externalError(new Error("external_tickets")), "Tickets for this event are sold by the organiser");
same("server words", L.externalError(new Error("P0001: external_tickets: tickets are sold by the organiser")), L.EXTERNAL_TICKETS_ERROR);
same("other error passes", L.externalError(new Error("sold_out")), null);
same("not an error", L.externalError(undefined), null);

/* the map's capitals */
same("pin: From", geo.eventPrice(ev()), "FROM ₦5,000");
same("pin short: From", geo.eventPriceShort(ev()), "FROM ₦5K");
same("pin: one price short", geo.eventPriceShort(ev({ price_to: 5000 })), "₦5K");
same("pin: free", geo.eventPrice(ev({ price_from: 0, price_to: 0 })), "FREE");
same("pin: unknown", geo.eventPrice(ev({ price_from: null, price_to: null })), "CHECK LISTING");
same("pin short: unknown", geo.eventPriceShort(ev({ price_from: null, price_to: null })), "CHECK LISTING");
same("pin: normal event as before", geo.eventPrice({ ...base, price_naira: 10000 }), "₦10,000");
same("pin short: normal event as before", geo.eventPriceShort({ ...base, price_naira: 0 }), "FREE");
same("pin: a lead as before", geo.eventPrice({ title: "LEAD · Party", price_naira: 0 }), "CHECK LISTING");

/* lists and the register button */
same("list price word", priceWord(ev()), "From ₦5,000");
check("list meta carries the price", rowMeta({ ...ev(), id: "1", starts_at: new Date().toISOString(), area: "Ajah", venue_name: "", lat: 0, lng: 0, vibe: "", source: "partner", ig_url: null, flyer_url: null, distance_m: 0, heat: 0 } as never).endsWith("From ₦5,000"));
const live = { status: "live" as const, price_naira: 0, capacity: null, spots_left: null, waitlist_on: false, requires_approval: false, ticket_types: [] };
same("button kind: listing is external", buttonFromEvent({ ...live, listing: info() }), "external");
same("button kind: closed beats external", buttonFromEvent({ ...live, status: "cancelled", listing: info() }), "closed");
same("button kind: normal event", buttonFromEvent({ ...live, price_naira: 0, ticket_types: [{ price_naira: 0, spots_left: null }] }), "register");
same("label: Get tickets", registerLabel(null, { ...live, listing: info() }).text, "Get tickets");
same("label: sold out", registerLabel(null, { ...live, listing: info({ sold_out: true }) }).text, "See the listing");
same("a stale register state does not win", registerLabel({ button: "register" }, { ...live, listing: info() }).kind, "external");
check("label is a link, not disabled", registerLabel(null, { ...live, listing: info() }).disabled === false);

/* share text: no going count on a listing */
const row = { ...ev(), id: "1", starts_at: "2026-11-07T15:00:00.000Z", area: "Ajah", venue_name: "Elegushi Beach", lat: 0, lng: 0, vibe: "", source: "partner", ig_url: null, flyer_url: null, distance_m: 0, heat: 0 } as never;
check("share text: no going", !/going/i.test(shareText(row, 40)), shareText(row, 40));
check("share text: has the price", shareText(row, 40).includes("FROM ₦5,000"), shareText(row, 40));
check("share preview: listed", sharePreview(row).description.includes("Listed on Hoppaz"), sharePreview(row).description);
check("share preview: price, no going", sharePreview(row).description.includes("From ₦5,000") && !/going/i.test(sharePreview(row).description), sharePreview(row).description);
check("share text: a normal event still counts", /3 Hoppers going/.test(shareText({ ...base, id: "2", starts_at: "2026-11-07T15:00:00.000Z", area: "Ajah", venue_name: "", lat: 0, lng: 0, vibe: "", source: "hoppaz", ig_url: null, flyer_url: null, distance_m: 0, heat: 0 } as never, 3)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
