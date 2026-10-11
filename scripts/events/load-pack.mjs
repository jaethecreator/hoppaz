#!/usr/bin/env node
/**
 * Loads a researched event pack (hoppaz-confirmed-events.json and its images/
 * folder) into the events table, so the events show on the Map and in the Today
 * deck. Dry run by default: it prints what it would write. --apply writes.
 *
 *   node scripts/events/load-pack.mjs ~/Downloads/hoppaz-event-pack            # dry run
 *   node scripts/events/load-pack.mjs ~/Downloads/hoppaz-event-pack --apply    # write
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (.env.local).
 *
 * What it does with each record:
 *   - point: from scripts/events/venues.json by venue name (a missing venue stops
 *     the run: add it there first, from a map). Online events are skipped.
 *   - category: the record's categories mapped onto the live ones (VIBE below).
 *   - rows: one per date. A daytime event over several days gets a row each day;
 *     an evening that runs past midnight is one row. SCHEDULE overrides the dates
 *     and times where the pack spells them out in words.
 *   - no published start time, or no published price: it goes in as a lead
 *     ("LEAD · " title, noon), so the app shows TIME TBC and CHECK LISTING
 *     instead of a made-up time or a wrong FREE.
 *   - flyer: the pack's image, shrunk to 1200 px JPEG and uploaded to the public
 *     event-flyers bucket (made on first run), so it never depends on a ticket
 *     site's hotlinking or an expiring link.
 *   - a row that is already there (same Lagos date, same name once "LEAD · " and
 *     punctuation are set aside, or one name starting with the other) is updated
 *     in place, keeping its id and everyone's going; anything else is inserted.
 *     Running it again changes nothing new.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const packDir = process.argv[2];
const apply = process.argv.includes("--apply");
if (!packDir) {
  console.error("Usage: node scripts/events/load-pack.mjs <pack folder> [--apply]");
  process.exit(1);
}

/* ------------------------------------------------------------------ config -- */
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, "")])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local");
  process.exit(1);
}
const BUCKET = "event-flyers";
const FOLDER = "pack";

/** The first category on this list that the record has decides its category. */
const VIBE = [
  ["Karaoke", "games & social"],
  ["Poetry", "culture & literature"],
  ["Theatre", "culture"],
  ["Afro", "afro"],
  ["Afro house", "afro"],
  ["Jazz", "concerts & live music"],
  ["Gospel", "concerts & live music"],
  ["Listening party", "concerts & live music"],
  ["Live music", "concerts & live music"],
  ["Halloween", "parties & raves"],
  ["Rave", "parties & raves"],
  ["Street music", "parties & raves"],
  ["Web3", "tech & startups"],
  ["Tech", "tech & startups"],
  ["Education", "education & careers"],
  ["Fitness", "sports & fitness"],
  ["Design", "art & exhibitions"],
  ["Art", "art & exhibitions"],
  ["Shopping", "markets & shopping"],
  ["Games", "games & social"],
  ["Food", "food & drinks"],
  ["Nightlife", "parties & raves"],
  ["Beauty", "business & industry"],
  ["Business", "business & industry"],
  ["Culture", "culture"],
  ["Community", "games & social"],
];

/** The pack's area names onto the app's areas (null where none fits). */
const AREA = {
  Ikeja: "Ikeja",
  "Ikeja GRA": "Ikeja",
  "Victoria Island": "Victoria Island",
  Oniru: "Victoria Island",
  Gbagada: "Gbagada",
  Ikoyi: "Ikoyi",
  "Lagos Island": "Lagos Island",
  Onikan: "Lagos Island",
  Iganmu: "Surulere",
  Surulere: "Surulere",
  "Ikate, Surulere": "Surulere",
};

/** Records whose dates or times the pack gives in words. [date, start, end?] per row; null skips the record. */
const SCHEDULE = {
  HP008: null, // online: nothing to put on a map
  HP058: null, // an exhibition running since September with no published hours
  HP017: [["2026-10-24", "10:00"]], // Oct 25's time is not verified
  HP023: [["2026-10-16", "20:00"], ["2026-10-17", "20:00"]],
  HP046: [["2026-10-24", "11:00", "18:00"], ["2026-10-25", "10:00", "17:00"]],
  HP051: ["2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25", "2026-10-31", "2026-11-01"].map((d) => [d, "17:30"]),
  HP052: ["2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25", "2026-10-31"].map((d) => [d, "17:00"]),
};

/* ----------------------------------------------------------------- mapping -- */
const venues = JSON.parse(readFileSync(join(here, "venues.json"), "utf8"));
const pack = JSON.parse(readFileSync(join(packDir, "hoppaz-confirmed-events.json"), "utf8"));

const lagos = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const norm = (t) => t.replace(/^LEAD · /, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const lagosDate = (iso) => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);

function price(text) {
  if (/^free(;|$)/i.test(text.trim())) return 0;
  const nums = [...text.matchAll(/(?:₦|NGN\s*)([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  return nums.length ? Math.min(...nums) : null;
}

function rowsFor(e) {
  if (e.id in SCHEDULE && SCHEDULE[e.id] === null) return { skip: e.id === "HP008" ? "online" : "no hours: ongoing exhibition" };
  if (e.venue === "Online") return { skip: "online" };
  const v = venues[e.venue];
  if (!v) return { error: `no point for venue "${e.venue}": add it to scripts/events/venues.json` };
  const vibe = (VIBE.find(([c]) => e.categories.includes(c)) ?? [null, "culture"])[1];
  const p = price(e.price);
  const times = [...e.time_wat.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  const start = times[0] ?? null;
  const end = times[1] && /–/.test(e.time_wat) ? times[1] : null;
  let plan = SCHEDULE[e.id];
  if (!plan) {
    const days = [];
    const multiDayDaytime = e.end_date > e.date && (!start || Number(start.slice(0, 2)) < 17);
    for (let d = e.date, i = 0; i < 7; d = addDays(d, 1), i++) {
      days.push(d);
      if (!multiDayDaytime || d >= e.end_date) break;
    }
    plan = days.map((d) => [d, start, end]);
  }
  const lead = !plan[0][1] || p === null;
  const title = `${lead ? "LEAD · " : ""}${e.name.replace(/\s+/g, " ").trim()}`;
  const area = AREA[e.area] ?? (/lekki phase 1/i.test(e.address) ? "Lekki Phase 1" : null);
  return {
    rows: plan.map(([date, s, en]) => ({
      title,
      venue_name: e.venue.slice(0, 120),
      area,
      lat: v.lat,
      lng: v.lng,
      starts_at: lagos(date, lead && !s ? "12:00" : s),
      ends_at: en ? lagos(date, en) : null,
      price_naira: p ?? 0,
      vibe,
      source: "partner",
      ig_url: e.source_url,
      status: "live",
      _pack: e.id,
      _image: e.image_file,
      _approx: v.by === "approx",
    })),
  };
}

/* --------------------------------------------------------------- database -- */
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };
async function rest(path, init = {}) {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: { ...H, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function ensureBucket() {
  const r = await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { headers: H });
  if (r.ok) return;
  await rest(`/storage/v1/bucket`, {
    method: "POST",
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 3145728, allowed_mime_types: ["image/jpeg"] }),
  });
  console.log(`made the public ${BUCKET} bucket`);
}

const shrinkDir = mkdtempSync(join(tmpdir(), "hoppaz-flyers-"));
async function uploadFlyer(packId, imageFile) {
  const src = join(packDir, imageFile);
  if (!existsSync(src)) throw new Error(`missing image ${src}`);
  const out = join(shrinkDir, `${packId}.jpg`);
  // macOS sips: longest side 1200 px, JPEG quality 80
  execFileSync("sips", ["-Z", "1200", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", out], { stdio: "ignore" });
  const path = `${FOLDER}/${packId}.jpg`;
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...H, "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=604800" },
    body: readFileSync(out),
  });
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return `${URL_}/storage/v1/object/public/${BUCKET}/${path}`;
}

/* -------------------------------------------------------------------- run -- */
const planned = [];
const skipped = [];
for (const e of pack) {
  const r = rowsFor(e);
  if (r.error) {
    console.error(`${e.id}: ${r.error}`);
    process.exit(1);
  }
  if (r.skip) skipped.push(`${e.id} ${e.name} (${r.skip})`);
  else planned.push(...r.rows);
}

// What is already there, in the pack's window, to update instead of duplicating.
const from = planned.reduce((a, r) => (r.starts_at < a ? r.starts_at : a), "9999");
const existing = await rest(
  `/rest/v1/events?select=id,title,starts_at&starts_at=gte.${encodeURIComponent(new Date(Date.parse(from) - 864e5).toISOString())}`
);
const match = (row) =>
  existing.find((x) => {
    if (lagosDate(x.starts_at) !== lagosDate(row.starts_at)) return false;
    const a = norm(x.title), b = norm(row.title);
    return a === b || a.startsWith(b) || b.startsWith(a);
  });

let inserts = 0, updates = 0;
for (const r of planned) {
  const m = match(r);
  r._match = m?.id ?? null;
  if (m) updates++;
  else inserts++;
  const when = new Date(r.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  console.log(`${m ? "UPDATE" : "insert"}  ${r._pack}  ${when}  ${r.title.slice(0, 48).padEnd(48)}  ${r.vibe.padEnd(22)} ${r.area ?? "-"}${r._approx ? "  (approx pin)" : ""}${m ? `  <- ${m.title.slice(0, 40)}` : ""}`);
}
console.log(`\n${planned.length} rows: ${inserts} new, ${updates} updated. Skipped: ${skipped.join("; ") || "none"}.`);
if (!apply) {
  console.log("Dry run. Run again with --apply to write.");
  process.exit(0);
}

await ensureBucket();
const flyers = {};
for (const r of planned) {
  if (!flyers[r._pack]) flyers[r._pack] = await uploadFlyer(r._pack, r._image);
}
console.log(`uploaded ${Object.keys(flyers).length} flyers`);

for (const r of planned) {
  const { _pack, _image, _approx, _match, lat, lng, ...cols } = r;
  const body = { ...cols, geog: `SRID=4326;POINT(${lng} ${lat})`, flyer_url: flyers[_pack] };
  if (_match) await rest(`/rest/v1/events?id=eq.${_match}`, { method: "PATCH", body: JSON.stringify(body), headers: { prefer: "return=minimal" } });
  else {
    const [made] = await rest(`/rest/v1/events?select=id,title,starts_at`, { method: "POST", body: JSON.stringify(body), headers: { prefer: "return=representation" } });
    existing.push(made); // a later row of the same name and date (none today) would update it, not duplicate it
  }
}
console.log(`done: ${inserts} inserted, ${updates} updated.`);
