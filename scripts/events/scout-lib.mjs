/**
 * Pure helpers for the event scout (docs/skill/hoppaz-event-scout/SKILL.md). No dependencies, no file or network access
 * except where a function says so (the Photon geocoder takes an injected fetch). Imported by load-scout.mjs and the check
 * (scripts/events-scout-check.mts).
 *
 * The output is a ScoutBatch (src/lib/events-r1/types.ts). Rules that hold everywhere in this file:
 *   - Nothing is invented. Unknown stays null, "" or []. Capacity needs a quote from the page. A handle needs a note of where
 *     it was seen. An email or phone needs a note of where it was published.
 *   - A handle is never derived from a name.
 *   - Times leave here as ISO with a +01:00 offset (Lagos).
 */

/* ---------------------------------------------------------------- small utils -- */

export const LAGOS_BOX = { south: 6.3, north: 6.8, west: 3.05, east: 3.95 };
export const inLagosBox = (lat, lng) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= LAGOS_BOX.south && lat <= LAGOS_BOX.north && lng >= LAGOS_BOX.west && lng <= LAGOS_BOX.east;

const pad = (n) => String(n).padStart(2, "0");
const str = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "");
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
};

/** Same rule as the SQL _ev_name_key: lower(regexp_replace(normalize(x, NFKD), '[^a-zA-Z0-9]', '', 'g')). */
export function nameKey(s) {
  return String(s ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export const eventKey = (ev) => `${ev.source_site}:${ev.source_id}`;

/** A slug-like label for files: lower case, a-z0-9 . _ - only. */
export const fileSafe = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export function htmlToText(html, max = 4000) {
  let t = String(html ?? "");
  t = t.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ");
  t = t.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\s*\/\s*(div|p|li|h[1-6]|tr|ul|ol)\s*>/gi, "\n").replace(/<\s*li[^>]*>/gi, "- ");
  t = t.replace(/<[^>]*>/g, "").replace(/<[^>]*$/, ""); // tags, and a tag cut off at the end
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  t = t.replace(/[​-‍⁠﻿]/g, "").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t;
}

/** An http(s) url without tracking parameters or a fragment. Null when it is not a url. */
export function cleanUrl(u) {
  const s = str(u);
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|igshid|gclid|mc_)/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ handles -- */

const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "developer", "legal", "web", "directory", "share", "s", "_u", "tags", "locations"]);

/**
 * An Instagram handle from what the page showed: "@name", "name", or an instagram.com profile url. Lower case, no @, only
 * a-z 0-9 . _ up to 30. Anything else (a person's name with spaces, a post link, another site) is a problem and gives no handle.
 * It never looks at an event or organiser name, so a handle can only come from something that was shown.
 */
export function parseHandle(input) {
  if (input === null || input === undefined) return { handle: null, problem: null };
  let s = String(input).trim();
  if (!s) return { handle: null, problem: null };
  if (/^(https?:\/\/|www\.|m\.|instagram\.com|instagr\.am)/i.test(s) || /[/?#]/.test(s)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return { handle: null, problem: "not a url or a handle" };
    }
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return { handle: null, problem: "not an instagram profile url" };
    const first = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    if (!first) return { handle: null, problem: "instagram url without a profile" };
    if (IG_RESERVED.has(first.toLowerCase())) return { handle: null, problem: "instagram url is not a profile" };
    s = first;
  }
  s = s.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return { handle: null, problem: "not a handle (letters, numbers, dot, underscore, up to 30)" };
  if (/^[._]+$/.test(s) || s.includes("..") || s.endsWith(".")) return { handle: null, problem: "not a valid handle" };
  return { handle: s.toLowerCase(), problem: null };
}
export const normaliseHandle = (input) => parseHandle(input).handle;
export const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export function cleanEmail(v) {
  let s = str(v).replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : null;
}

/** E.164 for a Nigerian or international number as published; null when it cannot be read as one. */
export function cleanPhone(v) {
  let s = str(v).replace(/^tel:/i, "");
  if (!s) return null;
  const plus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0") && d.length === 11) d = `234${d.slice(1)}`;
  if (d.length < 8 || d.length > 15) return null;
  return `+${d}`;
}

/* -------------------------------------------------------------------- time -- */

/** An instant (ms) as Lagos wall time with the +01:00 offset. */
export function lagosIso(ms) {
  const d = new Date(ms + 3600e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+01:00`;
}

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
export const isIsoWithOffset = (s) => typeof s === "string" && ISO_OFFSET.test(s) && Number.isFinite(Date.parse(s));

/**
 * Tix startDate and endDate: Lagos wall clock stored as a UTC epoch (seconds). Format it in UTC and do not add an hour:
 * a 7pm show reads 19:00. A string is read the same way. Null when it cannot be read.
 */
export function tixWallToIso(v) {
  let ms;
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    ms = n < 1e11 ? n * 1000 : n;
  } else if (typeof v === "string" && Number.isFinite(Date.parse(v))) {
    ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(v.trim()) ? v : `${v.trim().replace(" ", "T")}Z`);
  } else return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+01:00`;
}

/** A real UTC instant (Chowdeck, Luma): the same moment written in Lagos time, which is one hour ahead. Needs a Z or an offset. */
export function utcToLagosIso(v) {
  const s = str(v);
  if (!isIsoWithOffset(s)) return null;
  return lagosIso(Date.parse(s));
}

/** Eventbrite and other schema.org dates: offset aware. A date and time with no offset is read as Lagos time. A date alone gives null (no time is invented). */
export function offsetAwareToLagosIso(v) {
  const s = str(v);
  if (isIsoWithOffset(s)) return lagosIso(Date.parse(s));
  if (ISO_NO_OFFSET.test(s)) {
    const t = s.replace(" ", "T");
    return lagosIso(Date.parse(`${t.length === 16 ? `${t}:00` : t.slice(0, 19)}+01:00`));
  }
  return null;
}

/** A published date and a clock time (Lagos). */
export function lagosWall(date, time) {
  const d = str(date);
  const t = str(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t) return null;
  const iso = `${d}T${pad(Number(t[1]))}:${t[2]}:00+01:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export const lagosDate = (iso) => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sat 07 Nov 19:00" in Lagos time. */
export function lagosWhen(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "no time";
  const d = new Date(Date.parse(iso) + 3600e3);
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/* ------------------------------------------------------------------- places -- */

/** Lagos areas as published on ticket pages. The first pattern that matches gives the name. */
const AREAS = [
  [/\bvictoria island\b/i, "Victoria Island"],
  [/\bV\.?I\b/, "Victoria Island"],
  [/\blekki phase 1\b|\blekki 1\b/i, "Lekki Phase 1"],
  [/\blekki\b/i, "Lekki"],
  [/\bikoyi\b/i, "Ikoyi"],
  [/\bikeja\b/i, "Ikeja"],
  [/\byaba\b/i, "Yaba"],
  [/\bsurulere\b/i, "Surulere"],
  [/\bajah\b/i, "Ajah"],
  [/\boniru\b/i, "Oniru"],
  [/\bmaryland\b/i, "Maryland"],
  [/\bgbagada\b/i, "Gbagada"],
  [/\bikorodu\b/i, "Ikorodu"],
  [/\bfestac\b/i, "Festac"],
  [/\bapapa\b/i, "Apapa"],
  [/\blagos island\b/i, "Lagos Island"],
  [/\bikate\b/i, "Ikate"],
  [/\belegushi\b/i, "Elegushi"],
  [/\bmagodo\b/i, "Magodo"],
  [/\boregun\b/i, "Oregun"],
  [/\bilupeju\b/i, "Ilupeju"],
  [/\balapere\b/i, "Alapere"],
  [/\biganmu\b/i, "Iganmu"],
  [/\bebute[- ]?metta\b/i, "Ebute Metta"],
  [/\bmushin\b/i, "Mushin"],
  [/\boshodi\b/i, "Oshodi"],
  [/\bisolo\b/i, "Isolo"],
  [/\bbadagry\b/i, "Badagry"],
  [/\bsangotedo\b/i, "Sangotedo"],
  [/\bbanana island\b/i, "Banana Island"],
  [/\bogudu\b/i, "Ogudu"],
  [/\bojota\b/i, "Ojota"],
  [/\bagege\b/i, "Agege"],
  [/\bikota\b/i, "Ikota"],
  [/\beko atlantic\b/i, "Eko Atlantic"],
  [/\balausa\b/i, "Alausa"],
  [/\bobalende\b/i, "Obalende"],
  [/\bojodu\b/i, "Ojodu"],
];
export function areaFromText(...texts) {
  for (const t of texts) {
    const s = str(t);
    if (!s) continue;
    for (const [re, name] of AREAS) if (re.test(s)) return name;
  }
  return null;
}

const OTHER_PLACES = /\b(abuja|port harcourt|ibadan|kano|enugu|benin city|kaduna|abeokuta|owerri|uyo|calabar|asaba|ilorin|jos|warri|akure|osogbo|ogun state|oyo state|ota|sagamu|accra|kumasi|nairobi|london|johannesburg|cape town|kigali|dubai|new york)\b/i;

/**
 * Is it in Lagos State? State or region first, then coordinates, then the text. lagos is true, false or null (no evidence either way).
 * A thing that never says where it is does not count as Lagos.
 */
export function lagosVerdict({ state, lat, lng, texts = [] } = {}) {
  const st = str(state);
  if (st) {
    if (/^(lagos|la|lagos state)$/i.test(st)) return { lagos: true, why: `state ${st}` };
    return { lagos: false, why: `state ${st}` };
  }
  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
    return inLagosBox(lat, lng) ? { lagos: true, why: "coordinates in Lagos" } : { lagos: false, why: "coordinates outside Lagos" };
  }
  const text = texts.map(str).filter(Boolean).join(" | ");
  if (/\blagos\b/i.test(text) || areaFromText(text)) return { lagos: true, why: "text names Lagos or a Lagos area" };
  if (OTHER_PLACES.test(text)) return { lagos: false, why: `text names ${text.match(OTHER_PLACES)[0]}` };
  return { lagos: null, why: "no place evidence" };
}

/* ------------------------------------------------------------------- prices -- */

/** The lowest known price in whole naira (a free ticket counts as 0). Null when no ticket has a known price. Sold out tickets count only if nothing else is on sale. */
export function priceFrom(tickets) {
  const known = (tickets ?? []).filter((t) => t && typeof t.price_naira === "number");
  if (!known.length) return null;
  const open = known.filter((t) => !t.sold_out);
  return Math.min(...(open.length ? open : known).map((t) => t.price_naira));
}
export function priceTop(tickets) {
  const known = (tickets ?? []).filter((t) => t && typeof t.price_naira === "number");
  return known.length ? Math.max(...known.map((t) => t.price_naira)) : null;
}
export const nairaFromKobo = (k) => {
  const n = numOrNull(k);
  return n === null || n < 0 ? null : Math.round(n / 100);
};
const nairaWhole = (v) => {
  const n = numOrNull(v);
  return n === null || n < 0 ? null : Math.round(n);
};

function cleanTicket(t) {
  const name = str(t?.name).slice(0, 120) || "Tickets";
  const price_naira = typeof t?.price_naira === "number" && Number.isFinite(t.price_naira) && t.price_naira >= 0 ? Math.round(t.price_naira) : null;
  return { name, price_naira, sold_out: t?.sold_out === true };
}

/** A price range from a page that only shows a lowest and a highest price (no tier names): two honest lines, not invented tiers. */
function rangeTickets(low, high, soldOut) {
  if (low === null && high === null) return [];
  if (low === 0 && (high === 0 || high === null)) return [{ name: "Free", price_naira: 0, sold_out: soldOut }];
  if (high === null || low === high || low === null) return [{ name: "Tickets", price_naira: low ?? high, sold_out: soldOut }];
  return [
    { name: "Lowest price", price_naira: low, sold_out: soldOut },
    { name: "Highest price", price_naira: high, sold_out: soldOut },
  ];
}

/* ---------------------------------------------------------------- the event -- */

/** A ScoutEvent with every field in place and nothing invented. */
export function blankEvent(source_site, source_id, name, lastSeen) {
  return {
    source_site,
    source_id,
    name,
    starts_at: null,
    ends_at: null,
    venue: null,
    area: null,
    lat: null,
    lng: null,
    pin_by: null,
    description: "",
    tickets: [],
    sold_out: false,
    ticket_url: null,
    flyer_url: null,
    category: null,
    organiser_name: null,
    organiser_handle: null,
    event_handle: null,
    organiser_email: null,
    organiser_phone: null,
    // Readiness fields: the ticket site in a word, the page the event was found on, the flyer credit, the organiser's public X handle.
    ticket_platform: null,
    source_url: null,
    flyer_credit: null,
    organiser_x: null,
    lineup: [],
    capacity: null,
    last_seen: lastSeen,
    confidence: "lead",
  };
}

/** The word shown as "Tickets are sold on <word>" for each source, when the row does not say. */
const PLATFORM = { tix: "Tix", eventbrite: "Eventbrite", chowdeck: "Chowdeck", luma: "Luma" };

const nowIso = (ctx) => new Date(ctx.nowMs ?? Date.now()).toISOString();

function finishEvent(ev) {
  if (!ev.ticket_platform && ev.ticket_url) ev.ticket_platform = PLATFORM[ev.source_site] ?? null;
  if (!ev.source_url && ev.ticket_url) ev.source_url = ev.ticket_url;
  ev.tickets = ev.tickets.map(cleanTicket);
  if (ev.tickets.length && ev.tickets.every((t) => t.sold_out)) ev.sold_out = true;
  if (ev.description) ev.description = ev.description.slice(0, 4000);
  if (ev.ends_at && ev.starts_at && Date.parse(ev.ends_at) <= Date.parse(ev.starts_at)) ev.ends_at = null;
  return ev;
}

/** Source geo goes in as a pin the resolver can still prefer the venue file over. */
function setSourceGeo(ev, lat, lng) {
  const la = numOrNull(lat), ln = numOrNull(lng);
  if (la !== null && ln !== null && !(la === 0 && ln === 0)) {
    ev.lat = la;
    ev.lng = ln;
    ev.pin_by = "source";
  }
}

/**
 * The fields an operator reads off the event page by eye (or the browser reads): handles, contact, lineup, capacity.
 * Each needs a note of where it was shown; without the note the value is dropped and the drop is reported.
 */
function applyExtras(raw, ev, prov, notes) {
  for (const [field, src, provKey] of [
    ["organiser_handle", "organiser_instagram", "handle_seen"],
    ["event_handle", "event_instagram", "event_handle_seen"],
  ]) {
    const v = raw[src];
    if (v === null || v === undefined || v === "") continue;
    const p = parseHandle(v);
    const seen = str(raw[`${src}_seen_on`]);
    if (p.problem) notes.push(`${field} dropped: ${p.problem}`);
    else if (!seen) notes.push(`${field} @${p.handle} dropped: no ${src}_seen_on (say where on the page it is shown)`);
    else {
      ev[field] = p.handle;
      prov[provKey] = seen;
    }
  }
  if (!ev.organiser_name && str(raw.organiser_name)) ev.organiser_name = str(raw.organiser_name);
  if (str(raw.flyer_credit)) ev.flyer_credit = str(raw.flyer_credit).slice(0, 80);
  if (str(raw.organiser_x)) ev.organiser_x = str(raw.organiser_x).replace(/^@/, "").slice(0, 15);
  const email = raw.organiser_email, phone = raw.organiser_phone;
  if ((email || phone) && !str(raw.contact_seen_on)) notes.push("organiser email or phone dropped: no contact_seen_on (where the page publishes it for contact)");
  else {
    if (email) {
      const e = cleanEmail(email);
      if (e) ev.organiser_email = e;
      else notes.push("organiser email dropped: not an email");
    }
    if (phone) {
      const p = cleanPhone(phone);
      if (p) ev.organiser_phone = p;
      else notes.push("organiser phone dropped: not a phone number");
    }
    if (ev.organiser_email || ev.organiser_phone) prov.contact_seen = str(raw.contact_seen_on);
  }
  if (Array.isArray(raw.lineup)) {
    ev.lineup = raw.lineup
      .map((l) => (typeof l === "string" ? { name: str(l) } : { ...(str(l?.time) ? { time: str(l.time) } : {}), name: str(l?.name) }))
      .filter((l) => l.name)
      .slice(0, 60);
  }
  if (raw.capacity !== null && raw.capacity !== undefined && raw.capacity !== "") {
    const n = intOrNull(raw.capacity);
    if (n === null || n < 1) notes.push("capacity dropped: not a number");
    else if (!str(raw.capacity_quote)) notes.push(`capacity ${n} dropped: no capacity_quote (the words on the page that give it)`);
    else {
      ev.capacity = n;
      prov.capacity = str(raw.capacity_quote);
    }
  }
}

/* ---------------------------------------------------------------- normalisers -- */

const skip = (reason) => ({ skip: reason });
/** Hoppaz's own Hops are on Hoppaz already; they are never listed as someone else's event. */
const isOwnOrganiser = (n) => /^hoppaz( ltd| limited)?$/i.test(str(n));

/** Tix event ids are base64 of "Event-<uuid>". The uuid never changes; a slug can. */
function tixId(id) {
  const s = str(id);
  if (!s) return null;
  try {
    const dec = Buffer.from(s, "base64").toString("utf8");
    const m = dec.match(/^Event-([0-9a-f-]{36})$/i);
    if (m) return m[1].toLowerCase();
  } catch {
    /* fall through */
  }
  return null;
}

/** Tix GraphQL filterEvents row. Shape: see the skill (id slug title description address locationName city state country lat lng startDate endDate timezone currency status discoveryImage headerImage tickets.edges.node). */
export function normaliseTix(raw, ctx = {}) {
  const slug = str(raw.slug);
  const source_id = tixId(raw.id) ?? slug;
  const name = str(raw.title);
  if (!source_id) return skip("no id or slug");
  if (!name) return skip("no title");
  const verdict = lagosVerdict({ state: raw.state, lat: numOrNull(raw.lat), lng: numOrNull(raw.lng), texts: [raw.address, raw.city, raw.locationName] });
  if (verdict.lagos !== true) return skip(`not Lagos (${verdict.why})`);
  if (/^(draft|cancelled|canceled|inactive|ended|deleted)$/i.test(str(raw.status))) return skip(`status ${raw.status}`);
  const notes = [], prov = {};
  const ev = blankEvent("tix", source_id, name, nowIso(ctx));
  ev.starts_at = tixWallToIso(raw.startDate);
  ev.ends_at = tixWallToIso(raw.endDate);
  if (!ev.starts_at) notes.push("no start time on the row");
  ev.venue = str(raw.locationName) || null;
  ev.area = areaFromText(raw.city, raw.address, raw.locationName);
  setSourceGeo(ev, raw.lat, raw.lng);
  ev.description = htmlToText(raw.description);
  const edges = Array.isArray(raw.tickets?.edges) ? raw.tickets.edges : Array.isArray(raw.tickets) ? raw.tickets.map((n) => ({ node: n })) : [];
  for (const { node: t } of edges) {
    if (!t) continue;
    if (t.status && !/^active$/i.test(str(t.status))) {
      notes.push(`ticket "${str(t.name)}" left out: status ${t.status}`);
      continue;
    }
    ev.tickets.push({ name: str(t.name), price_naira: nairaWhole(t.price), sold_out: t.soldOut === true });
  }
  ev.ticket_url = slug ? `https://tix.africa/discover/${slug}` : null;
  ev.flyer_url = cleanUrl(raw.headerImage) ?? cleanUrl(raw.discoveryImage);
  ev.category = str(raw.category) || null;
  ev.organiser_name = str(raw.organiser_name) || null;
  ev.confidence = ev.ticket_url ? "confirmed" : "lead";
  if (str(raw.timezone) && !/^(WAT|UTC)$/i.test(str(raw.timezone))) notes.push(`timezone label ${raw.timezone}: check the time against the page`);
  applyExtras(raw, ev, prov, notes);
  return { event: finishEvent(ev), prov, notes };
}

/** The Event object inside a JSON-LD blob (a subtype such as MusicEvent counts). */
export function findLdEvent(ld) {
  const list = Array.isArray(ld) ? ld.flat() : [ld];
  const stack = [...list];
  while (stack.length) {
    const x = stack.shift();
    if (!x || typeof x !== "object") continue;
    const t = [].concat(x["@type"] ?? []).join(" ");
    if (/Event\b/.test(t) && !/EventSeries/.test(t)) return x;
    if (Array.isArray(x["@graph"])) stack.push(...x["@graph"]);
  }
  return null;
}

const ebId = (url) => str(url).split("?")[0].match(/-(\d{8,})\/?$/)?.[1] ?? null;

/**
 * Eventbrite row: { page_url, ld (the Event JSON-LD of the event page), listing_ld (the item on the list page, optional) } plus the optional
 * operator fields. The id comes from the url the card links to (page_url), because the page's own JSON-LD url can name the series.
 */
export function normaliseEventbrite(raw, ctx = {}) {
  const ld = findLdEvent(raw.ld) ?? findLdEvent(raw.listing_ld) ?? (raw["@type"] ? raw : null);
  if (!ld) return skip("no Event JSON-LD");
  const pageUrl = cleanUrl(raw.page_url ?? raw.url ?? ld.url);
  const source_id = ebId(pageUrl) ?? ebId(ld.url);
  if (!source_id) return skip("no event id in the url");
  const name = str(ld.name);
  if (!name) return skip("no name");
  const mode = str(ld.eventAttendanceMode);
  if (/Online/.test(mode) && !/Mixed/.test(mode)) return skip("online only");
  const loc = ld.location ?? {}, addr = loc.address ?? {};
  const listLoc = findLdEvent(raw.listing_ld)?.location ?? {};
  const geo = loc.geo ?? listLoc.geo ?? {};
  const street = str(addr.streetAddress);
  const verdict = lagosVerdict({
    state: str(addr.addressCountry) && !/^(ng|nigeria)$/i.test(str(addr.addressCountry)) ? `outside Nigeria (${addr.addressCountry})` : addr.addressRegion,
    lat: numOrNull(geo.latitude), lng: numOrNull(geo.longitude),
    texts: [street, addr.addressLocality, loc.name],
  });
  if (verdict.lagos !== true) return skip(`not Lagos (${verdict.why})`);
  const notes = [], prov = {};
  const ev = blankEvent("eventbrite", source_id, name, nowIso(ctx));
  ev.starts_at = offsetAwareToLagosIso(ld.startDate);
  ev.ends_at = offsetAwareToLagosIso(ld.endDate);
  if (!ev.starts_at) notes.push("start time not on the page (a date alone is not a time)");
  ev.venue = str(loc.name) || null;
  const locality = str(addr.addressLocality);
  ev.area = areaFromText(street, loc.name, locality) ?? (locality && !/^lagos$/i.test(locality) ? locality : null);
  setSourceGeo(ev, geo.latitude, geo.longitude);
  ev.description = htmlToText(ld.description);
  const offers = [].concat(ld.offers ?? []);
  for (const o of offers) {
    const soldOut = /SoldOut/i.test(str(o.availability));
    const cur = str(o.priceCurrency).toUpperCase();
    const low = numOrNull(o.lowPrice ?? o.price), high = numOrNull(o.highPrice ?? o.price);
    if (low === null && high === null) continue;
    if (cur && cur !== "NGN") {
      // A price in another currency is not converted: the naira price is unknown.
      ev.tickets.push({ name: `Tickets (${cur} ${low ?? high}${high !== null && high !== low && low !== null ? ` to ${high}` : ""})`, price_naira: null, sold_out: soldOut });
      notes.push(`price is in ${cur}, naira price left unknown`);
    } else if (o["@type"] === "AggregateOffer" || o.lowPrice !== undefined) {
      ev.tickets.push(...rangeTickets(nairaWhole(low), nairaWhole(high), soldOut));
    } else {
      ev.tickets.push({ name: str(o.name) || "Tickets", price_naira: nairaWhole(o.price), sold_out: soldOut });
    }
  }
  ev.ticket_url = pageUrl ? pageUrl.split("?")[0] : null;
  ev.flyer_url = cleanUrl(Array.isArray(ld.image) ? ld.image[0] : ld.image);
  ev.organiser_name = str(ld.organizer?.name ?? ld.organizer?.[0]?.name) || null;
  ev.confidence = "confirmed";
  applyExtras(raw, ev, prov, notes);
  return { event: finishEvent(ev), prov, notes };
}

/** Chowdeck API row (customer/event). Times are real UTC. Prices are kobo. */
export function normaliseChowdeck(raw, ctx = {}) {
  const source_id = str(raw.id);
  const slug = str(raw.slug);
  const name = str(raw.name);
  if (!source_id) return skip("no id");
  if (!name) return skip("no name");
  if (raw.is_active === false) return skip("not active");
  if (raw.review_status && raw.review_status !== "published") return skip(`review status ${raw.review_status}`);
  if (raw.visibility && raw.visibility !== "public") return skip(`visibility ${raw.visibility}`);
  if (raw.event_type && raw.event_type !== "physical") return skip(`${raw.event_type} event`);
  if (isOwnOrganiser(raw.vendor?.name)) return skip("a Hoppaz event, already on Hoppaz");
  const a = raw.address ?? {};
  const verdict = lagosVerdict({ state: a.state, lat: numOrNull(a.latitude), lng: numOrNull(a.longitude), texts: [a.street, a.city, raw.landmark] });
  if (verdict.lagos !== true) return skip(`not Lagos (${verdict.why})`);
  const notes = [], prov = {};
  const ev = blankEvent("chowdeck", source_id, name, nowIso(ctx));
  ev.starts_at = utcToLagosIso(raw.starts_at);
  ev.ends_at = utcToLagosIso(raw.ends_at);
  if (!ev.starts_at) notes.push("no start time on the row");
  ev.venue = str(raw.landmark) || str(a.street) || null;
  ev.area = areaFromText(a.city, a.street, raw.landmark) ?? (str(a.city) && !/^lagos$/i.test(str(a.city)) ? str(a.city) : null);
  setSourceGeo(ev, a.latitude, a.longitude);
  ev.description = htmlToText(raw.description);
  for (const group of raw.ticket_types ?? []) {
    for (const t of group.tickets ?? []) {
      if (t.is_active === false || (t.visibility && t.visibility !== "public")) continue;
      let label = str(t.name);
      if (group.type === "group" && t.group_size && !/\d/.test(label)) label += ` (group of ${t.group_size})`;
      // The page has no sold out flag per ticket in this list. Unknown stays "not sold out"; the quantity is stock, not seats, and is not used.
      ev.tickets.push({ name: label, price_naira: nairaFromKobo(t.price), sold_out: t.sold_out === true || t.is_sold_out === true });
    }
  }
  if (!ev.tickets.length && raw.has_free_tickets) ev.tickets.push({ name: "Free", price_naira: 0, sold_out: false });
  else if (!ev.tickets.length && numOrNull(raw.min_ticket_price) !== null) ev.tickets.push({ name: "Tickets", price_naira: nairaFromKobo(raw.min_ticket_price), sold_out: false });
  ev.ticket_url = slug ? `https://chowdeck.com/events/${slug}` : null;
  ev.flyer_url = cleanUrl(raw.cover_image_url);
  ev.category = str(raw.category?.name) || null;
  ev.organiser_name = str(raw.vendor?.name) || null;
  ev.confidence = ev.ticket_url ? "confirmed" : "lead";
  applyExtras(raw, ev, prov, notes);
  return { event: finishEvent(ev), prov, notes };
}

const lumaPrice = (p, notes) => {
  if (p === null || p === undefined) return null;
  if (typeof p === "object") {
    const cur = str(p.currency).toUpperCase();
    const cents = numOrNull(p.cents ?? p.amount);
    if (cents === null) return null;
    if (cur && cur !== "NGN") {
      notes.push(`price is in ${cur}, naira price left unknown`);
      return null;
    }
    return Math.round(cents / 100);
  }
  notes.push("price shape not recognised, left unknown");
  return null;
};

/**
 * Luma discover item (luma.com/lagos __NEXT_DATA__ events[]): { api_id, event, hosts, calendar, ticket_info }. The host's own Instagram
 * handle is the one tied to the organiser. A page_description (from the event page) is used when given.
 */
export function normaliseLuma(raw, ctx = {}) {
  const e = raw.event ?? raw;
  const source_id = str(e.api_id ?? raw.api_id);
  const name = str(e.name);
  if (!source_id) return skip("no api_id");
  if (!name) return skip("no name");
  if (e.visibility && e.visibility !== "public") return skip(`visibility ${e.visibility}`);
  if (e.location_type && e.location_type !== "offline") return skip(`${e.location_type} event`);
  const g = e.geo_address_info ?? {};
  const c = e.coordinate ?? g.place_coordinate ?? {};
  const lat = numOrNull(c.latitude), lng = numOrNull(c.longitude);
  let verdict = lagosVerdict({ state: g.region, lat, lng, texts: [g.full_address, g.address, g.city_state] });
  if (verdict.lagos !== true && raw.featured_city?.slug === "lagos" && verdict.lagos === null) verdict = { lagos: true, why: "listed under the Lagos city page" };
  if (verdict.lagos !== true) return skip(`not Lagos (${verdict.why})`);
  const notes = [], prov = {};
  const ev = blankEvent("luma", source_id, name, nowIso(ctx));
  ev.starts_at = utcToLagosIso(e.start_at ?? raw.start_at);
  ev.ends_at = utcToLagosIso(e.end_at);
  if (!ev.starts_at) notes.push("no start time on the row");
  ev.venue = str(g.address) || str(g.short_address) || null;
  ev.area = areaFromText(g.full_address, g.address) ?? (str(g.sublocality) || null);
  setSourceGeo(ev, lat, lng);
  ev.description = htmlToText(raw.page_description ?? raw.description ?? "");
  const ti = raw.ticket_info ?? {};
  const soldOut = ti.is_sold_out === true;
  if (ti.is_free === true) ev.tickets.push({ name: "Free", price_naira: 0, sold_out: soldOut });
  else if (ti.price !== null && ti.price !== undefined) {
    ev.tickets.push(...rangeTickets(lumaPrice(ti.price, notes), lumaPrice(ti.max_price, notes), soldOut));
    if (!ev.tickets.length) ev.tickets.push({ name: "Tickets", price_naira: null, sold_out: soldOut });
  } else if (soldOut) ev.tickets.push({ name: "Tickets", price_naira: null, sold_out: true });
  ev.sold_out = soldOut || ev.sold_out;
  ev.ticket_url = e.url ? `https://luma.com/${str(e.url)}` : null;
  ev.flyer_url = cleanUrl(e.cover_url);
  const host = (raw.hosts ?? [])[0];
  ev.organiser_name = str(host?.name) || str(raw.calendar?.name) || null;
  const hostHandle = parseHandle(host?.instagram_handle);
  if (hostHandle.handle) {
    ev.organiser_handle = hostHandle.handle;
    prov.handle_seen = "Luma host profile";
  } else if (hostHandle.problem) notes.push(`organiser_handle dropped: ${hostHandle.problem}`);
  const cal = raw.calendar ?? {};
  const calHandle = cal.is_personal ? { handle: null } : parseHandle(cal.instagram_handle);
  if (calHandle.handle && calHandle.handle !== ev.organiser_handle) {
    ev.event_handle = calHandle.handle;
    prov.event_handle_seen = "Luma calendar profile";
  }
  // spots_remaining is what is left, not the capacity, so it is not used.
  ev.confidence = ev.ticket_url ? "confirmed" : "lead";
  applyExtras(raw, ev, prov, notes);
  return { event: finishEvent(ev), prov, notes };
}

const SITE_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * Any other source, read by eye or by the browser into a loose row:
 *   id|url, name, start (ISO) | date + time (Lagos), end | end_time, venue, address, area, lat, lng, description,
 *   tickets [{name, price, sold_out}] | price | free, sold_out, ticket_url, image, category, organiser, confidence,
 *   plus the optional operator fields (organiser_instagram + _seen_on, organiser_email, organiser_phone, contact_seen_on, lineup, capacity + capacity_quote).
 * Default confidence is "lead": only a row read on the event's ticket page says "confirmed".
 */
export function normaliseGeneric(raw, ctx = {}) {
  const site = str(ctx.site);
  if (!SITE_RE.test(site)) return skip(`source_site "${site}" is not a short lower case label`);
  const name = str(raw.name);
  if (!name) return skip("no name");
  if (isOwnOrganiser(raw.organiser ?? raw.organiser_name)) return skip("a Hoppaz event, already on Hoppaz");
  const startIso = raw.start ? (isIsoWithOffset(str(raw.start)) || ISO_NO_OFFSET.test(str(raw.start)) ? offsetAwareToLagosIso(raw.start) : null) : lagosWall(raw.date, raw.time);
  const datePart = str(raw.date) || (startIso ? lagosDate(startIso) : "") || str(raw.start).slice(0, 10);
  const source_id = str(raw.id) || str(cleanUrl(raw.url)) || `${datePart || "undated"}-${nameKey(name)}`;
  const lat = numOrNull(raw.lat), lng = numOrNull(raw.lng);
  const verdict = lagosVerdict({ state: raw.state, lat, lng, texts: [raw.venue, raw.address, raw.area, raw.city] });
  if (verdict.lagos !== true) return skip(`not Lagos (${verdict.why})`);
  const notes = [], prov = {};
  const ev = blankEvent(site, source_id, name, nowIso(ctx));
  ev.starts_at = startIso;
  if (!ev.starts_at) notes.push("no start time (a date alone is not a time)");
  ev.ends_at = raw.end ? offsetAwareToLagosIso(raw.end) : lagosWall(raw.date, raw.end_time);
  ev.venue = str(raw.venue) || null;
  ev.area = str(raw.area) || areaFromText(raw.address, raw.venue);
  setSourceGeo(ev, lat, lng);
  ev.description = htmlToText(raw.description);
  if (Array.isArray(raw.tickets)) {
    for (const t of raw.tickets) ev.tickets.push({ name: str(t?.name), price_naira: nairaWhole(t?.price ?? t?.price_naira), sold_out: t?.sold_out === true });
  } else if (raw.free === true) ev.tickets.push({ name: "Free", price_naira: 0, sold_out: false });
  else if (numOrNull(raw.price) !== null) ev.tickets.push({ name: "Tickets", price_naira: nairaWhole(raw.price), sold_out: false });
  if (raw.sold_out === true) ev.sold_out = true;
  ev.ticket_url = cleanUrl(raw.ticket_url);
  ev.flyer_url = cleanUrl(raw.image ?? raw.flyer_url);
  ev.category = str(raw.category) || null;
  ev.organiser_name = str(raw.organiser ?? raw.organiser_name) || null;
  ev.ticket_platform = str(raw.ticket_platform).slice(0, 40) || null;
  ev.source_url = cleanUrl(raw.source_url);
  ev.flyer_credit = str(raw.flyer_credit).slice(0, 80) || null;
  ev.organiser_x = str(raw.organiser_x).replace(/^@/, "").slice(0, 15) || null;
  ev.confidence = raw.confidence === "confirmed" && ev.ticket_url ? "confirmed" : "lead";
  if (raw.confidence === "confirmed" && !ev.ticket_url) notes.push("marked confirmed but no ticket page: kept as a lead");
  applyExtras(raw, ev, prov, notes);
  return { event: finishEvent(ev), prov, notes };
}

export const NORMALISERS = { tix: normaliseTix, eventbrite: normaliseEventbrite, chowdeck: normaliseChowdeck, luma: normaliseLuma, generic: normaliseGeneric };

/** One raw row to { event, prov, notes } or { skip }. A row that throws is skipped, never fatal. */
export function normaliseRow(source, raw, ctx = {}) {
  const fn = NORMALISERS[source];
  if (!fn) return skip(`unknown source kind "${source}"`);
  if (!raw || typeof raw !== "object") return skip("row is not an object");
  try {
    return fn(raw, ctx);
  } catch (e) {
    return skip(`could not read the row: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ extras -- */

/** The fields an operator may add to a raw row from the event page, in raw/<source>.extras.json. Nothing else is taken from that file. */
export const EXTRA_KEYS = [
  "organiser_name", "organiser_instagram", "organiser_instagram_seen_on", "event_instagram", "event_instagram_seen_on",
  "organiser_email", "organiser_phone", "contact_seen_on", "lineup", "capacity", "capacity_quote", "page_description",
  "flyer_credit", "organiser_x",
];

/** The key a row has in an extras file: Tix and Chowdeck slug, the number at the end of an Eventbrite event url, the Luma url slug, else id or name. */
export function extrasKey(source, row) {
  if (!row || typeof row !== "object") return null;
  if (source === "tix") return str(row.slug) || null;
  if (source === "chowdeck") return str(row.slug) || str(row.id) || null;
  if (source === "eventbrite") return ebId(cleanUrl(row.page_url ?? row.url)) ?? null;
  if (source === "luma") return str((row.event ?? row).url) || str((row.event ?? row).api_id ?? row.api_id) || null;
  return str(row.id) || str(row.name) || null;
}

/** Rows with the extras added (only EXTRA_KEYS), and the extras keys that matched no row. */
export function mergeExtras(source, rows, extras) {
  const used = new Set();
  const map = extras && typeof extras === "object" ? extras : {};
  const out = rows.map((row) => {
    const k = extrasKey(source, row);
    const x = k && map[k];
    if (!x || typeof x !== "object") return row;
    used.add(k);
    const add = {};
    for (const f of EXTRA_KEYS) if (x[f] !== undefined) add[f] = x[f];
    return { ...row, ...add };
  });
  return { rows: out, unmatched: Object.keys(map).filter((k) => !k.startsWith("_") && !used.has(k)) };
}

/* --------------------------------------------------------------------- batch -- */

const completeness = (ev) =>
  ["starts_at", "ends_at", "venue", "area", "lat", "description", "ticket_url", "flyer_url", "category", "organiser_name", "organiser_handle", "organiser_email", "organiser_phone", "capacity"].filter((k) => ev[k] !== null && ev[k] !== "").length +
  ev.tickets.length + ev.lineup.length;

/** One row per (source_site, source_id). Of two rows for the same key the fuller one stays, in the position of the first. */
export function dedupeEvents(events) {
  const at = new Map(), out = [], dropped = [];
  for (const ev of events) {
    const k = eventKey(ev);
    if (!at.has(k)) {
      at.set(k, out.length);
      out.push(ev);
    } else {
      const i = at.get(k);
      dropped.push(k);
      if (completeness(ev) > completeness(out[i])) out[i] = ev;
    }
  }
  return { events: out, dropped };
}

/**
 * Raw files to a batch. A raw file: { source: "tix"|"eventbrite"|"chowdeck"|"luma"|"generic", site?, fetched_at, complete, note?, rows }.
 * `site` is the source_site written into every event (defaults to the source; required for generic).
 * A site goes into sources_covered only if every raw file for it says complete: true, because the server marks upcoming rows of a covered
 * site that this batch does not contain as "gone".
 */
export function buildBatch(rawFiles, { now = Date.now(), runId } = {}) {
  const ctx = { nowMs: now };
  const events = [], provenance = {}, skipped = [], notes = [];
  const coverage = new Map();
  for (const f of rawFiles) {
    const source = str(f.source);
    const site = str(f.site) || (source === "generic" ? "" : source);
    const rows = Array.isArray(f.rows) ? f.rows : [];
    const prev = coverage.get(site);
    coverage.set(site, (prev === undefined ? true : prev) && f.complete === true);
    rows.forEach((raw, i) => {
      const r = normaliseRow(source, raw, { ...ctx, site });
      const label = str(raw?.title ?? raw?.name ?? raw?.ld?.name ?? raw?.event?.name) || `row ${i + 1}`;
      if (r.skip) {
        skipped.push({ source: site || source, name: label, reason: r.skip });
        return;
      }
      events.push(r.event);
      const key = eventKey(r.event);
      if (Object.keys(r.prov).length) provenance[key] = { ...(provenance[key] ?? {}), ...r.prov };
      for (const n of r.notes) notes.push({ key, name: r.event.name, note: n });
    });
  }
  const deduped = dedupeEvents(events);
  const iso = new Date(now).toISOString();
  const batch = {
    run_id: runId || `scout-${lagosDate(iso)}`,
    scouted_at: iso,
    sources_covered: [...coverage].filter(([site, ok]) => site && ok).map(([site]) => site).sort(),
    events: deduped.events,
  };
  return { batch, provenance, skipped, notes, duplicates: deduped.dropped };
}

/** Fill still-empty contact fields from an earlier run's batch, so a page is not opened again for what is already known. The earlier "seen on" notes come with the values. */
export function carryOver(events, provenance, prevEvents, prevProvenance) {
  const prev = new Map(prevEvents.map((e) => [eventKey(e), e]));
  const carried = [];
  for (const ev of events) {
    const old = prev.get(eventKey(ev));
    if (!old) continue;
    const key = eventKey(ev), oldProv = prevProvenance?.[key] ?? {};
    const prov = (provenance[key] ??= {});
    for (const [field, provKey] of [["organiser_handle", "handle_seen"], ["event_handle", "event_handle_seen"], ["capacity", "capacity"]]) {
      if (ev[field] === null && old[field] !== null && oldProv[provKey]) {
        ev[field] = old[field];
        prov[provKey] = oldProv[provKey];
        carried.push(`${key} ${field}`);
      }
    }
    if (ev.organiser_email === null && ev.organiser_phone === null && (old.organiser_email || old.organiser_phone) && oldProv.contact_seen) {
      ev.organiser_email = old.organiser_email;
      ev.organiser_phone = old.organiser_phone;
      prov.contact_seen = oldProv.contact_seen;
      carried.push(`${key} contact`);
    }
    if (!ev.lineup.length && old.lineup?.length) {
      ev.lineup = old.lineup;
      carried.push(`${key} lineup`);
    }
    if (!Object.keys(prov).length) delete provenance[key];
  }
  return carried;
}

/* ------------------------------------------------------------------ flyers -- */

/** The local file name a flyer is saved under: one per event, extension added by the download. */
export const flyerBase = (ev) => `${fileSafe(ev.source_site)}_${fileSafe(ev.source_id)}`;

/** A smaller JPEG address for known image hosts, so the download is not a webp. Other urls are used as they are. */
export function flyerDownloadUrl(url) {
  const u = cleanUrl(url);
  if (!u) return null;
  const m = u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^?]*)(\?.*)?$/);
  if (!m) return u;
  const parts = m[2].split("/");
  const isTransform = parts.length > 1 && /^[a-z]{1,3}_[^/]+(,[a-z]{1,3}_[^/]+)*$/i.test(parts[0]) && !/^v\d+$/.test(parts[0]);
  const rest = isTransform ? parts.slice(1) : parts;
  return `${m[1]}c_limit,f_jpg,w_1200/${rest.join("/")}${m[3] ?? ""}`;
}

export function flyerJobs(events) {
  return events.filter((e) => e.flyer_url).map((e) => ({ source_site: e.source_site, source_id: e.source_id, file: flyerBase(e), url: flyerDownloadUrl(e.flyer_url) })).filter((j) => j.url);
}

/* -------------------------------------------------------------- validation -- */

const MAX_NAIRA = 50_000_000;

/**
 * Every problem per event, nothing thrown. errors stop an event from being sent; warnings are shown.
 * opts: { now (ms), provenance (the notes of where capacity, handles and contact were shown) }.
 * Refuses: no name or source ids, a past only event, outside Lagos, online only, a capacity with no quote, a handle that is not a clean handle
 * or looks derived from a name with no note of where it was seen.
 */
export function validateBatch(batch, opts = {}) {
  const now = opts.now ?? Date.now();
  const prov = opts.provenance ?? {};
  const problems = [];
  const bad = new Set();
  const add = (level, code, message, index = null) => {
    const ev = index === null ? null : batch.events[index];
    problems.push({ level, code, message, index, source_site: ev?.source_site ?? null, source_id: ev?.source_id ?? null, name: ev?.name ?? null });
    if (level === "error" && index !== null) bad.add(index);
  };
  const done = () => ({ ok: !problems.some((p) => p.level === "error"), errors: problems.filter((p) => p.level === "error").length, warnings: problems.filter((p) => p.level === "warn").length, problems, bad });

  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    add("error", "batch_shape", "the batch is not an object");
    return done();
  }
  if (typeof batch.run_id !== "string" || !batch.run_id.trim()) add("error", "run_id", "run_id is missing");
  if (!isIsoWithOffset(batch.scouted_at)) add("error", "scouted_at", "scouted_at is not an ISO time with an offset");
  if (!Array.isArray(batch.sources_covered) || batch.sources_covered.some((s) => typeof s !== "string" || !SITE_RE.test(s))) add("error", "sources_covered", "sources_covered must be a list of short source labels");
  else if (new Set(batch.sources_covered).size !== batch.sources_covered.length) add("error", "sources_covered", "sources_covered repeats a source");
  if (!Array.isArray(batch.events)) {
    add("error", "events", "events is not a list");
    return done();
  }
  const seen = new Set();
  batch.events.forEach((ev, i) => {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return add("error", "event_shape", "event is not an object", i);
    const E = (code, msg) => add("error", code, msg, i);
    const W = (code, msg) => add("warn", code, msg, i);

    if (typeof ev.source_site !== "string" || !SITE_RE.test(ev.source_site)) E("source_site", "source_site is missing or not a short lower case label");
    if (typeof ev.source_id !== "string" || !ev.source_id.trim() || ev.source_id.length > 200) E("source_id", "source_id is missing");
    if (typeof ev.name !== "string" || !ev.name.trim()) E("name", "name is missing");
    else if (ev.name.length > 200) W("name_long", "name is over 200 characters");
    const key = eventKey(ev);
    if (seen.has(key)) E("duplicate_id", `${key} appears twice in the batch`);
    seen.add(key);

    for (const f of ["description"]) if (typeof ev[f] !== "string") E("type", `${f} must be text`);
    if (typeof ev.sold_out !== "boolean") E("type", "sold_out must be true or false");
    if (ev.confidence !== "confirmed" && ev.confidence !== "lead") E("confidence", 'confidence must be "confirmed" or "lead"');
    if (!isIsoWithOffset(ev.last_seen)) E("last_seen", "last_seen is not an ISO time with an offset");

    // Times.
    let startMs = null, endMs = null;
    if (ev.starts_at === null || ev.starts_at === undefined) W("no_time", "no start time (the server keeps it as a lead)");
    else if (!isIsoWithOffset(ev.starts_at)) E("starts_at", "starts_at is not an ISO time with an offset");
    else startMs = Date.parse(ev.starts_at);
    if (ev.ends_at !== null && ev.ends_at !== undefined) {
      if (!isIsoWithOffset(ev.ends_at)) E("ends_at", "ends_at is not an ISO time with an offset");
      else {
        endMs = Date.parse(ev.ends_at);
        if (startMs !== null && endMs <= startMs) E("ends_before_start", "ends_at is not after starts_at");
      }
    }
    if (startMs !== null) {
      const over = endMs !== null && endMs > startMs ? endMs : startMs + 3 * 3600e3;
      if (over < now) E("past", "the event is already over");
    }

    // Place.
    const hasLat = ev.lat !== null && ev.lat !== undefined, hasLng = ev.lng !== null && ev.lng !== undefined;
    if (hasLat !== hasLng) E("pin", "lat and lng must both be set or both null");
    else if (hasLat) {
      if (!inLagosBox(ev.lat, ev.lng)) E("not_lagos", "the pin is outside Lagos");
      if (!["venues", "source", "osm"].includes(ev.pin_by)) E("pin_by", "a pin needs pin_by: venues, source or osm");
    } else if (ev.pin_by) E("pin_by", "pin_by is set but there is no pin");
    const place = [ev.venue, ev.area].filter(Boolean).join(" | ");
    if (!hasLat && place) {
      const v = lagosVerdict({ texts: [place] });
      if (v.lagos === false) E("not_lagos", `the place looks outside Lagos (${v.why})`);
    }
    if (!hasLat && /^(online|virtual|zoom|google meet|ms teams|microsoft teams|webinar)\b/i.test(str(ev.venue))) E("online", "online only events are not listed");
    if (!hasLat && !str(ev.venue) && /\bwebinar\b/i.test(str(ev.name))) E("online", "a webinar with no venue is online only");
    if (!hasLat && !str(ev.venue)) W("no_venue", "no venue");

    // Tickets.
    if (!Array.isArray(ev.tickets)) E("tickets", "tickets must be a list");
    else {
      ev.tickets.forEach((t, j) => {
        if (!t || typeof t.name !== "string" || !t.name.trim()) return E("ticket", `ticket ${j + 1} has no name`);
        if (t.price_naira !== null && !(Number.isInteger(t.price_naira) && t.price_naira >= 0)) E("price", `ticket "${t.name}": price must be whole naira, 0 or more, or null`);
        else if (typeof t.price_naira === "number" && t.price_naira > MAX_NAIRA) E("price", `ticket "${t.name}": price over N${MAX_NAIRA.toLocaleString("en-NG")}`);
        else if (typeof t.price_naira === "number" && t.price_naira > 5_000_000) W("price_high", `ticket "${t.name}": N${t.price_naira.toLocaleString("en-NG")} looks high, check it`);
        if (typeof t.sold_out !== "boolean") E("ticket", `ticket "${t.name}": sold_out must be true or false`);
      });
      if (ev.tickets.length && ev.tickets.every((t) => t.sold_out) && ev.sold_out === false) W("sold_out", "every ticket is sold out but sold_out is false");
      if (!ev.tickets.length) W("no_price", "no ticket prices shown");
      else if (priceFrom(ev.tickets) === null) W("no_price", "no ticket has a known price");
    }

    // Links.
    for (const f of ["ticket_url", "flyer_url"]) {
      if (ev[f] === null || ev[f] === undefined) continue;
      if (!cleanUrl(ev[f])) E("url", `${f} is not a web address`);
    }
    if (ev.confidence === "confirmed" && !ev.ticket_url) W("no_ticket_url", "confirmed but no ticket link");

    // People. Handles must be clean, and must say where they were seen.
    for (const [f, provKey] of [["organiser_handle", "handle_seen"], ["event_handle", "event_handle_seen"]]) {
      const h = ev[f];
      if (h === null || h === undefined) continue;
      if (typeof h !== "string" || !HANDLE_RE.test(h) || parseHandle(h).handle !== h) {
        E("bad_handle", `${f} "${h}" is not a clean handle`);
        continue;
      }
      if (!prov[key]?.[provKey]) {
        const derived = h.replace(/[._]/g, "") === nameKey(ev.organiser_name) || h.replace(/[._]/g, "") === nameKey(ev.name);
        if (derived) E("handle_guess", `${f} @${h} matches a name and no note says where it was seen: a handle is never guessed`);
        else W("handle_unsourced", `${f} @${h} has no note of where it was seen`);
      }
    }
    if (ev.organiser_email !== null && ev.organiser_email !== undefined && cleanEmail(ev.organiser_email) !== ev.organiser_email) E("email", "organiser_email is not an email");
    if (ev.organiser_phone !== null && ev.organiser_phone !== undefined && cleanPhone(ev.organiser_phone) !== ev.organiser_phone) E("phone", "organiser_phone is not a phone number in +number form");
    if ((ev.organiser_email || ev.organiser_phone) && !prov[key]?.contact_seen) W("contact_unsourced", "organiser email or phone has no note of where it was published");
    if ((ev.organiser_email || ev.organiser_phone || ev.organiser_handle) && !ev.organiser_name) W("no_organiser_name", "contact details without an organiser name");

    if (!Array.isArray(ev.lineup)) E("lineup", "lineup must be a list");
    else if (ev.lineup.some((l) => !l || typeof l.name !== "string" || !l.name.trim())) E("lineup", "a lineup entry has no name");

    // Capacity is only what the page says.
    if (ev.capacity !== null && ev.capacity !== undefined) {
      if (!Number.isInteger(ev.capacity) || ev.capacity < 1 || ev.capacity > 500000) E("capacity", "capacity must be a whole number from 1 to 500000, or null");
      else if (!prov[key]?.capacity) E("capacity_unsourced", "capacity has no quote from the page: it stays null unless the page publishes it");
    }
  });
  return done();
}

/* ----------------------------------------------------------------- venues -- */

/** The venue names a piece of venue text can go by: the whole text, and the part before the first comma, dash or bracket. */
export function venueNames(text) {
  const t = str(text);
  if (!t) return [];
  const first = t.split(/,| - | – |\(/)[0].trim();
  return [...new Set([t, first].filter((x) => x.length >= 2))];
}

export function indexVenues(file) {
  const byKey = new Map();
  for (const [name, entry] of Object.entries(file ?? {})) {
    if (name.startsWith("_") || !entry || typeof entry.lat !== "number" || typeof entry.lng !== "number") continue;
    const k = nameKey(name);
    if (k && !byKey.has(k)) byKey.set(k, { name, entry });
    // "Wole Soyinka Centre (National Theatre)" is also found by the name before the bracket.
    const plain = name.includes("(") ? nameKey(name.split("(")[0]) : "";
    if (plain.length >= 6 && !byKey.has(plain)) byKey.set(plain, { name, entry });
  }
  return byKey;
}

const ratio = (a, b) => (a.length < b.length ? a.length / b.length : b.length / a.length);
const contains = (a, b) => (a.length <= b.length ? b.includes(a) : a.includes(b));

/** Exact name key first, then the part before the comma, then one name inside the other (6+ characters, at least 75% as long). */
export function lookupVenue(text, index) {
  const names = venueNames(text);
  for (const n of names) {
    const hit = index.get(nameKey(n));
    if (hit) return { ...hit, how: "exact" };
  }
  let best = null;
  for (const n of names) {
    const k = nameKey(n);
    if (k.length < 6) continue;
    for (const [vk, v] of index) {
      if (vk.length < 6 || !contains(k, vk)) continue;
      const r = ratio(k, vk);
      if (r >= 0.75 && (!best || r > best.r)) best = { ...v, how: "fuzzy", r };
    }
  }
  return best;
}

/** True for venue text that names no place worth a search ("TBA", "Lagos", "venue on ticket", "address sent after payment"). */
export function isVaguePlace(text) {
  const t = str(text).toLowerCase();
  if (t.length < 3) return true;
  return /^(tba|tbc|tbd|lagos|nigeria|online|virtual|secret|private|undisclosed|to be (announced|confirmed))\b/.test(t) || /(venue|address|location)[^|]{0,30}(sent|revealed|on (ticket|registration)|after|to be|will be)/.test(t);
}

export function distanceKm(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Where a venue is, in this order, never guessed:
 *   1. scripts/events/venues.json (exact or close name). pin_by "venues", or "osm" for a pin a past run saved that staff have not checked yet.
 *   2. coordinates the source itself published (inside Lagos). pin_by "source".
 *   3. OpenStreetMap search through Photon (only if opts.geocode is given): a result inside Lagos State whose name matches. pin_by "osm".
 *      Every answer, found or not, goes into opts.cache so the venue is asked once.
 *   4. nothing: lat and lng null.
 * opts: { venues (indexVenues), cache (object, changed in place), geocode (async query => results, or null for cache only), now }.
 */
export async function resolvePin(venueText, area, sourceGeo, opts = {}) {
  const none = { lat: null, lng: null, pin_by: null, detail: "no pin", confident: false, conflict_km: null };
  const src = sourceGeo && inLagosBox(sourceGeo.lat, sourceGeo.lng) ? sourceGeo : null;
  const hit = opts.venues && venueText ? lookupVenue(venueText, opts.venues) : null;
  if (hit) {
    const out = {
      lat: hit.entry.lat, lng: hit.entry.lng,
      pin_by: hit.entry.by === "osm" ? "osm" : "venues",
      detail: `venues.json "${hit.name}"${hit.how === "fuzzy" ? " (close name)" : ""}`,
      confident: true,
      conflict_km: src ? round5(distanceKm(hit.entry.lat, hit.entry.lng, src.lat, src.lng)) : null,
    };
    return out;
  }
  if (src) return { lat: src.lat, lng: src.lng, pin_by: "source", detail: "published by the source", confident: true, conflict_km: null };

  const names = venueNames(venueText);
  if (!names.length || isVaguePlace(venueText) || !opts.cache) return none;
  const primary = names.length > 1 ? names[1] : names[0];
  const ck = `${nameKey(primary)}|${nameKey(area ?? "")}`;
  const cached = opts.cache[ck];
  const nowMs = opts.now ?? Date.now();
  if (cached && (cached.found || nowMs - Date.parse(cached.asked_at) < 30 * 86400e3)) {
    return cached.found
      ? { lat: cached.lat, lng: cached.lng, pin_by: "osm", detail: `OpenStreetMap "${cached.osm_name}" (saved answer)`, confident: !!cached.confident, conflict_km: null, osm_name: cached.osm_name, cache_key: ck }
      : { ...none, detail: "searched before, not found" };
  }
  if (!opts.geocode) return { ...none, detail: "not searched (no --geocode)" };

  const query = [primary, area && !primary.toLowerCase().includes(String(area).toLowerCase()) ? area : "", "Lagos"].filter(Boolean).join(", ");
  let results;
  try {
    results = await opts.geocode(query);
  } catch (e) {
    return { ...none, detail: `search failed: ${e.message}` };
  }
  let found = null;
  for (const r of results ?? []) {
    if (!inLagosBox(r.lat, r.lng) || !/lagos/i.test(str(r.state))) continue;
    const a = nameKey(primary), b = nameKey(r.name);
    if (!a || !b) continue;
    const exact = a === b;
    const close = !exact && Math.min(a.length, b.length) >= 5 && contains(a, b) && ratio(a, b) >= 0.6;
    if (!exact && !close) continue;
    const confident = exact || ratio(a, b) >= 0.8;
    if (!found || (confident && !found.confident)) found = { r, confident };
    if (exact) break;
  }
  if (!found) {
    opts.cache[ck] = { venue: primary, area: area ?? null, found: false, asked_at: new Date(nowMs).toISOString() };
    return { ...none, detail: "OpenStreetMap had no matching place in Lagos State", cache_key: ck };
  }
  const entry = { venue: primary, area: area ?? null, found: true, lat: round5(found.r.lat), lng: round5(found.r.lng), osm_name: found.r.name, osm_id: found.r.osm_id ?? null, confident: found.confident, asked_at: new Date(nowMs).toISOString() };
  opts.cache[ck] = entry;
  return { lat: entry.lat, lng: entry.lng, pin_by: "osm", detail: `OpenStreetMap "${entry.osm_name}"`, confident: found.confident, conflict_km: null, osm_name: entry.osm_name, cache_key: ck };
}

/** Pins for a list of events, one venue asked at most once per run. Returns new event objects plus what happened. */
export async function applyPins(events, opts = {}) {
  const memo = new Map();
  const out = [], report = [], additions = new Map();
  for (const ev of events) {
    const geo = ev.pin_by === "source" && typeof ev.lat === "number" ? { lat: ev.lat, lng: ev.lng } : null;
    const mk = `${nameKey(ev.venue ?? "")}|${nameKey(ev.area ?? "")}|${geo ? `${geo.lat},${geo.lng}` : ""}`;
    let pin = memo.get(mk);
    if (!pin) {
      pin = await resolvePin(ev.venue, ev.area, geo, opts);
      memo.set(mk, pin);
    }
    out.push({ ...ev, lat: pin.lat, lng: pin.lng, pin_by: pin.pin_by });
    report.push({ key: eventKey(ev), venue: ev.venue, pin_by: pin.pin_by, detail: pin.detail, conflict_km: pin.conflict_km });
    if (pin.pin_by === "osm" && pin.confident && pin.cache_key && ev.venue) {
      const name = venueNames(ev.venue).slice(-1)[0];
      if (!additions.has(nameKey(name))) additions.set(nameKey(name), { key: name, lat: pin.lat, lng: pin.lng, osm_name: pin.osm_name });
    }
  }
  return { events: out, report, additions: [...additions.values()] };
}

/** venues.json in its own style: one line per venue. */
export function formatVenuesJson(obj) {
  const lines = Object.entries(obj).map(([k, v]) => {
    if (typeof v === "string") return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    const parts = Object.entries(v).map(([a, b]) => `${JSON.stringify(a)}: ${JSON.stringify(b)}`);
    return `  ${JSON.stringify(k)}: { ${parts.join(", ")} }`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** New pins added to a venues.json object, marked by "osm" for staff to check. Names already in the file (by name key) are left alone. */
export function withNewPins(obj, additions) {
  const known = new Set(Object.keys(obj).filter((k) => !k.startsWith("_")).map(nameKey));
  const next = { ...obj };
  const added = [];
  for (const a of additions) {
    if (known.has(nameKey(a.key))) continue;
    next[a.key] = { lat: a.lat, lng: a.lng, by: "osm", check: `found by OpenStreetMap search as "${a.osm_name}": check on a map, then change by to "checked"` };
    known.add(nameKey(a.key));
    added.push(a.key);
  }
  return { venues: next, added };
}

/* ------------------------------------------------------------------ Photon -- */

/**
 * The OpenStreetMap search used for pins. Keyless, bounded to the Lagos box, one request at most every minGapMs (default 1100).
 * fetchImpl, sleep and clock are injected so the check runs offline. Returns async (query) => [{ name, lat, lng, state, osm_id, osm_type }].
 * Data: OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright). Photon is run by komoot.
 */
export function makePhotonGeocoder({ fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = () => Date.now(), minGapMs = 1100, baseUrl = "https://photon.komoot.io", userAgent = "Hoppaz event scout, hoppaz.fun (staff tool, low volume)" } = {}) {
  let last = -Infinity;
  const calls = { count: 0, urls: [] };
  const search = async (query) => {
    const wait = last + minGapMs - clock();
    if (wait > 0) await sleep(wait);
    last = clock();
    const url = new URL("/api/", baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "6");
    url.searchParams.set("lang", "en");
    url.searchParams.set("bbox", `${LAGOS_BOX.west},${LAGOS_BOX.south},${LAGOS_BOX.east},${LAGOS_BOX.north}`);
    calls.count++;
    calls.urls.push(url.href);
    const res = await fetchImpl(url.href, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Photon answered ${res.status}`);
    return parsePhotonResults(await res.json());
  };
  search.calls = calls;
  return search;
}

export function parsePhotonResults(json) {
  const out = [];
  for (const f of json?.features ?? []) {
    const c = f?.geometry?.coordinates, p = f?.properties ?? {};
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    if (p.countrycode && String(p.countrycode).toUpperCase() !== "NG") continue;
    const name = str(p.name) || [str(p.housenumber), str(p.street)].filter(Boolean).join(" ");
    if (!name) continue;
    out.push({ name, lat: c[1], lng: c[0], state: str(p.state), osm_id: p.osm_id ?? null, osm_type: p.osm_type ?? null });
  }
  return out;
}
