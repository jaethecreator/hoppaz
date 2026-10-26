#!/usr/bin/env node
/**
 * Loads a weekly event guide (events.json and banners/, the "hoppaz-events-W43-W44" format) into the events table so the
 * events show on the Map and in the Today deck. Dry run by default; --apply writes. Same rules as load-pack.mjs:
 *
 *   node scripts/events/load-guide.mjs ~/Downloads/hoppaz-events-W43-W44            # dry run
 *   node scripts/events/load-guide.mjs ~/Downloads/hoppaz-events-W43-W44 --apply    # write
 *
 *   - Rows that start more than 6 hours ago are left out. A multi-day event gets a row per day still to come.
 *   - No published start time or no published price, or confidence "lead": it goes in as a lead ("LEAD · " title), so the
 *     app shows TIME TBC and CHECK LISTING instead of a made-up time or a wrong FREE.
 *   - Point: PINS below, by the guide's venue text. A venue with no known place (null) is parked on LAGOS_CENTER, which the
 *     app keeps off the map (hasVenue) but lists in Today. "approx" pins are placed by street or neighbourhood: check them.
 *   - Flyer: the guide's banner (or its image_url when there is none), shrunk to 1200 px JPEG and uploaded to the public
 *     event-flyers bucket under guide/. No picture is fine: the row goes in without one.
 *   - A row already there (same Lagos date, same name once "LEAD · " is set aside, or one name starting the other) is
 *     updated in place, keeping its id and everyone's going. Running it again changes nothing new.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dir = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dir) {
  console.error("Usage: node scripts/events/load-guide.mjs <guide folder> [--apply]");
  process.exit(1);
}

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
const FOLDER = "guide";

/** The guide's categories onto the live ones (the names load-pack.mjs writes). A NAME rule wins over the category. */
const CATEGORY = {
  "Ravers & Late Nights": "parties & raves",
  "Live Music": "concerts & live music",
  "Film & Arts": "art & exhibitions",
  "Food Crawls": "food & drinks",
  Comedy: "games & social",
  "Tech & Founders": "tech & startups",
  "Run Club": "sports & fitness",
};
const BY_NAME = [
  [/market/i, "markets & shopping"],
  [/trivia|book club|hangout/i, "games & social"],
  [/fashion week|runway/i, "culture"],
  [/finance fair|wealth|cosmetics|energy|mobility/i, "business & industry"],
];

const LC = null; // no known place: parked on LAGOS_CENTER, off the map
const VI = [6.429, 3.424];
const ONIRU = [6.4325, 3.451];
const LANDMARK = [6.42362, 3.44782];
const LEKKI1 = [6.441, 3.47];
const ELEGUSHI = [6.4378, 3.4805];
const ADEOLA = [6.4287, 3.4195];
const SAPARA = [6.429, 3.426];
/** Venue text -> [lat, lng] (approx, from the street or neighbourhood). Check an event on the map before it matters. */
const PINS = {
  "District 19, 19 Ologun Agbaje St, Victoria Island": [6.4318, 3.4185],
  "District 19, Victoria Island": [6.4318, 3.4185],
  "Shiro, Block XVI, Oniru Estate, Victoria Island": [6.4325, 3.448],
  "LIVbykuiknosh Restaurant & Grills, Victoria Island": [6.4285, 3.421],
  "Nexthought Creative Hub, Elegushi Beach, Lekki 1": ELEGUSHI,
  "Victoria Island (festival runs 22 to 25 Oct)": VI,
  "Romeo's House, 7 Bishop Aboyade Cole St, Victoria Island": [6.43, 3.422],
  "Octo Lagos, Victoria Island": [6.4295, 3.421],
  "Alliance Française, 9 Osborne Rd, Ikoyi": [6.46013, 3.43244],
  "National Theatre, Iganmu": [6.47461, 3.36873],
  "Lagos Encourage Park, Osborne Rd, Ikoyi": [6.4525, 3.4345],
  "Tarkwa Bay Surf Club, Tarkwa Bay": [6.4125, 3.406],
  "The Lab Lagos, 23A Saka Tinubu St, Victoria Island": [6.4285, 3.4235],
  "Quays Lagos, 3 Tokunbo Omisore St, Lekki Phase 1": [6.442, 3.47],
  "The Back Lounge, Kusenla Rd, Ikate Elegushi": [6.4452, 3.4655],
  "Frozen Cabana, 26 Karimu Kotun St, Victoria Island": [6.4285, 3.424],
  "Lagos (venue on ticket)": LC,
  "Red Carpet Hall, Oniru, Victoria Island": [6.432, 3.448],
  "POP Landmark, Oniru, Victoria Island": LANDMARK,
  "The Lighthouse Bar and Grill": LC,
  "Queens Park Event Centre, Oniru": [6.4325, 3.451],
  "Adrenaline Lounge, 49 Lawani St, off University Rd, Yaba": [6.515, 3.388],
  "Curate, Landmark Village, Water Corporation Rd, Victoria Island": [6.425, 3.448],
  "White Space Creative Foundation, 59 Raymond Njoku St, Ikoyi": [6.451, 3.431],
  "Sixty by Chef Lu": LC,
  "Spotlight Creative Hub, 11B Ligali Ayorinde St, Victoria Island": [6.4298, 3.4225],
  "Sleek's Matcha, 7 Sapara Williams Close, Victoria Island": SAPARA,
  "Fantasy Ikoyi, Ademola St, Ikoyi": [6.4478, 3.4318],
  "La Madison Place": LC,
  "Gogi Lagos, 68 Admiralty Way, Lekki Phase 1": [6.441, 3.468],
  "Boca, Wings Tower, Victoria Island": VI,
  "CIIFA Safehouse, 4b Onikoyi Lane, Parkview, Ikoyi": [6.449, 3.442],
  "Homecoming Concept Space, 7A Sapara Williams Close, Victoria Island": SAPARA,
  "Casa 45, 35 Adeola Odeku St, Victoria Island": ADEOLA,
  "Lekki Phase 1 (address sent after payment)": LEKKI1,
  "Fired and Iced, 77 Admiralty Way, Lekki Phase 1": [6.4415, 3.469],
  "Yusuf Grillo Museum, 74 Ogunlowo St, Ikeja": [6.59, 3.35],
  "Master Cocoon Place": LC,
  "Praia Lagos, 20 Elsie Femi Pearse St, VI": [6.4295, 3.4235],
  "Diamond Throne Lifestyle": LC,
  "Muri Okunola Park, Victoria Island": [6.4285, 3.4215],
  "Turtle Bae Beach, Elegushi": ELEGUSHI,
  "Fantasy, Ikoyi": [6.4478, 3.4318],
  "National Stadium, Surulere": [6.4958, 3.3589],
  "Uncharted Grounds, 23 Obafemi Awolowo Way": [6.5985, 3.3495],
  "Casa 45 Night Club, Victoria Island": ADEOLA,
  "Tiger Bar": LC,
  "35 Adeola Odeku St, Victoria Island": ADEOLA,
  "Landmark Centre, Victoria Island": LANDMARK,
  "MAN Centre Complex, Ikeja": [6.601, 3.349],
  "The Zone, Gbagada": [6.54839, 3.38765],
  "Four Points by Sheraton, Victoria Island": [6.431, 3.452],
  "LagosFW Tents, Federal Palace Hotel, Victoria Island": [6.4268, 3.4108],
  "18b Hunponu-Wusu Rd, Lekki area": [6.4285, 3.4235],
  "Maroko, Lagos (venue on registration)": LC,
  Ikoyi: LC, // Founders Breakfast: invitation only, so no pin
  "371 Borno Way, Yaba": [6.505, 3.379],
  "University of Lagos": [6.518, 3.398],
  "Oregun, Ikeja": [6.605, 3.368],
  "Alagomeji, Yaba": [6.5035, 3.39],
  "Amah Studios (penthouse)": [6.4545, 3.3935],
  "114 A&B Ilupeju St, Dolphin Estate, Ikoyi": [6.4585, 3.439],
  "10A Adebisi Tolani, Gbagada": [6.556, 3.393],
  "G3 Event Centre": LC,
};
/** Rows the guide spells out in words: csv id -> [[date, start?, end?], ...] */
const SCHEDULE = {
  5: [["2026-10-25", "14:00", "23:35"]], // Super Story: festival 22 to 25 Oct
  10: [["2026-10-25", "12:00", "18:00"]], // Gather Market, second day
  24: [["2026-10-25", "15:00"]], // Choreo Cinema: Fri to Sun
  52: [["2026-10-28", null], ["2026-10-29", null]], // Moonshot: all day
  53: ["2026-10-27", "2026-10-28", "2026-10-29"].map((d) => [d, "10:00", "17:00"]),
  54: [["2026-10-28", "09:00"], ["2026-10-29", "09:00"]],
  55: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].map((d) => [d, "12:00"]),
  58: ["2026-10-29", "2026-10-30", "2026-10-31"].map((d) => [d, "17:00"]),
  27: [["2026-10-24", "16:00"]],
  43: [["2026-10-31", "12:00"]],
  66: [["2026-10-31", null]], // time on Tix reads 7am: confirm, so a lead
};

const lagos = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();
const norm = (t) => t.replace(/^LEAD · /, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const lagosDate = (iso) => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
const pad = (h, m) => `${String(h).padStart(2, "0")}:${m}`;

function priceOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const nums = [...String(v).matchAll(/([\d,]{3,})/g)].map((m) => Number(m[1].replace(/,/g, "")));
  return nums.length ? Math.min(...nums) : null;
}

function rowsFor(e, now) {
  if (!(e.venue in PINS)) return { error: `no pin for venue "${e.venue}": add it to PINS` };
  const pin = PINS[e.venue] ?? [6.5, 3.42];
  const times = [...String(e.time_wat).matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => pad(Number(m[1]), m[2]));
  const range = /\bto\b|–/.test(String(e.time_wat)) && times[1];
  let plan = SCHEDULE[e.id];
  if (!plan) {
    const d = String(e.date).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    plan = [[d[0], times[0] ?? null, range ? times[1] : null]];
  }
  const p = priceOf(e.price_ngn);
  const vibe = (BY_NAME.find(([re]) => re.test(e.name)) ?? [])[1] ?? CATEGORY[e.category] ?? "culture";
  const out = [];
  for (const [date, s, en] of plan) {
    const lead = e.confidence === "lead" || !s || p === null;
    const start = lagos(date, s ?? "12:00");
    if (Date.parse(start) < now - 6 * 3.6e6) continue; // already over
    let ends = null;
    if (en && s) {
      ends = lagos(date, en);
      if (Date.parse(ends) <= Date.parse(start)) ends = new Date(Date.parse(ends) + 864e5).toISOString();
    }
    out.push({
      title: `${lead ? "LEAD · " : ""}${e.name.replace(/\s+/g, " ").trim()}`,
      venue_name: e.venue.split(",")[0].slice(0, 120),
      area: null,
      lat: pin[0],
      lng: pin[1],
      starts_at: start,
      ends_at: ends,
      price_naira: p ?? 0,
      vibe,
      source: "partner",
      ig_url: e.ticket_url || e.instagram_url || null,
      status: "live",
      _id: e.id,
      _banner: e.banner_file,
      _image: e.image_url,
      _noPin: PINS[e.venue] === null,
    });
  }
  return { rows: out };
}

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

const work = mkdtempSync(join(tmpdir(), "hoppaz-guide-"));
/** The banner file, else the picture at image_url. Null when there is neither, or the download fails. */
async function flyerFor(id, banner, image) {
  let src = banner && existsSync(join(dir, banner)) ? join(dir, banner) : null;
  if (!src && image) {
    try {
      const r = await fetch(image, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        src = join(work, `${id}.src`);
        writeFileSync(src, Buffer.from(await r.arrayBuffer()));
      }
    } catch {
      /* no picture */
    }
  }
  if (!src) return null;
  const out = join(work, `${id}.jpg`);
  try {
    execFileSync("sips", ["-Z", "1200", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", out], { stdio: "ignore" });
  } catch {
    return null;
  }
  const path = `${FOLDER}/${id}.jpg`;
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...H, "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=604800" },
    body: readFileSync(out),
  });
  return r.ok ? `${URL_}/storage/v1/object/public/${BUCKET}/${path}` : null;
}

/* -------------------------------------------------------------------- run -- */
const guide = JSON.parse(readFileSync(join(dir, "events.json"), "utf8")).events;
const now = Date.now();
const planned = [];
let past = 0;
for (const e of guide) {
  const r = rowsFor(e, now);
  if (r.error) {
    console.error(`${e.id}: ${r.error}`);
    process.exit(1);
  }
  if (!r.rows.length) past++;
  planned.push(...r.rows);
}

const from = planned.reduce((a, r) => (r.starts_at < a ? r.starts_at : a), "9999");
const existing = await rest(`/rest/v1/events?select=id,title,starts_at&starts_at=gte.${encodeURIComponent(new Date(Date.parse(from) - 864e5).toISOString())}`);
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
  console.log(`${m ? "UPDATE" : "insert"}  #${String(r._id).padEnd(3)} ${when}  ${r.title.slice(0, 46).padEnd(46)}  ${r.vibe.padEnd(21)}${r._noPin ? " NO PIN (Today list only)" : ""}${m ? `  <- ${m.title.slice(0, 36)}` : ""}`);
}
console.log(`\n${planned.length} rows: ${inserts} new, ${updates} updated. ${past} events already over and left out.`);
if (!apply) {
  console.log("Dry run. Run again with --apply to write.");
  process.exit(0);
}

await ensureBucket();
const flyers = {};
for (const r of planned) {
  if (!(r._id in flyers)) flyers[r._id] = await flyerFor(r._id, r._banner, r._image);
}
console.log(`flyers: ${Object.values(flyers).filter(Boolean).length} of ${Object.keys(flyers).length}`);

for (const r of planned) {
  const { _id, _banner, _image, _noPin, _match, lat, lng, ...cols } = r;
  const body = { ...cols, geog: `SRID=4326;POINT(${lng} ${lat})`, flyer_url: flyers[_id] };
  if (!body.flyer_url) delete body.flyer_url;
  if (_match) await rest(`/rest/v1/events?id=eq.${_match}`, { method: "PATCH", body: JSON.stringify(body), headers: { prefer: "return=minimal" } });
  else {
    const [made] = await rest(`/rest/v1/events?select=id,title,starts_at`, { method: "POST", body: JSON.stringify(body), headers: { prefer: "return=representation" } });
    existing.push(made);
  }
}
console.log(`done: ${inserts} inserted, ${updates} updated.`);
