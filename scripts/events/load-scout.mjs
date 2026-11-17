#!/usr/bin/env node
/**
 * The scout loader. Takes a day folder of the event scout (docs/skill/hoppaz-event-scout/SKILL.md), checks it, and sends it to the
 * Hoppaz staff route as a batch for REVIEW. Nothing it sends goes live: rows land in the review queue (ev_pulled) and staff approve them.
 *
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02                  # dry run (the default): checks and prints, sends nothing
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02 --build          # raw/*.json to events.json first (also done when events.json is missing)
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02 --fetch-flyers   # download flyers into flyers/, one at a time, slowly
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02 --geocode        # also ask OpenStreetMap for venues not in venues.json (1 request a second, cached)
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02 --plan           # also ask the site for its own dry run report (writes nothing there)
 *   node scripts/events/load-scout.mjs ~/hoppaz-scout/2026-11-02 --apply          # upload flyers and send the batch for review
 *   --save-pins      write confident new OpenStreetMap pins into scripts/events/venues.json (by: "osm") for staff to check
 *   --site URL       the site to send to (default HOPPAZ_SITE_URL)
 *   --allow-local    allow --apply to a localhost address
 *   --drop-invalid   with --apply, send the valid events even if some were refused for reasons other than past, online or outside Lagos
 *
 * Config comes only from ~/hoppaz-scout/.env (HOPPAZ_SITE_URL, HOPPAZ_ADMIN_TOKEN). It never reads the repo's .env.local.
 * It never writes to a database and never contacts an organiser. The only network calls are: the site's /api/admin/outreach route (--plan,
 * --apply), flyer downloads (--fetch-flyers), and OpenStreetMap through Photon (--geocode).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  NORMALISERS, applyPins, buildBatch, carryOver, eventKey, flyerBase, flyerJobs, formatVenuesJson, indexVenues, lagosWhen,
  makePhotonGeocoder, mergeExtras, priceFrom, validateBatch, withNewPins,
} from "./scout-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const VENUES_PATH = join(here, "venues.json");
const SOFT_CODES = new Set(["past", "online", "not_lagos"]);
const FLYER_EXT = ["jpg", "jpeg", "png", "webp", "gif"];

/* ------------------------------------------------------------------- args -- */

export function parseArgs(argv) {
  const o = { dir: null, apply: false, plan: false, build: false, geocode: false, savePins: false, fetchFlyers: false, allowLocal: false, dropInvalid: false, site: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--plan") o.plan = true;
    else if (a === "--build") o.build = true;
    else if (a === "--geocode") o.geocode = true;
    else if (a === "--save-pins") o.savePins = true;
    else if (a === "--fetch-flyers") o.fetchFlyers = true;
    else if (a === "--allow-local") o.allowLocal = true;
    else if (a === "--drop-invalid") o.dropInvalid = true;
    else if (a === "--site") o.site = argv[++i] ?? null;
    else if (a.startsWith("--site=")) o.site = a.slice(7);
    else if (a.startsWith("--")) o.unknown = [...(o.unknown ?? []), a];
    else if (!o.dir) o.dir = a;
  }
  return o;
}

const expand = (p) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** KEY=VALUE lines. The file is ~/hoppaz-scout/.env. Values are never printed. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

/** localhost, loopback, .local, .localhost and private network addresses. */
export function isLocalSite(url) {
  let h;
  try {
    h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a === 0;
  }
  return false;
}

/* ---------------------------------------------------------------- building -- */

const readJson = (p, fallback = undefined) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${p}: ${e.message}`);
  }
};

/** raw/*.json to events.json, provenance.json, flyer-jobs.json and skipped.json inside the day folder. */
export function buildFromRaw(dir, { now, log }) {
  const rawDir = join(dir, "raw");
  const files = readdirSync(rawDir).filter((f) => f.endsWith(".json") && !f.endsWith(".extras.json")).sort();
  if (!files.length) throw new Error(`no raw/*.json in ${dir}`);
  const extraNotes = [];
  const rawFiles = files.map((f) => {
    const j = readJson(join(rawDir, f));
    const stem = basename(f, ".json");
    const source = j.source ?? (NORMALISERS[stem] ? stem : "generic");
    const site = j.site ?? (source === "generic" ? stem : source);
    let rows = j.rows ?? (Array.isArray(j) ? j : []);
    // raw/<name>.extras.json: { "<key>": { organiser_instagram, ..._seen_on, organiser_email, ... } } read off the event pages.
    const extrasFile = join(rawDir, `${stem}.extras.json`);
    if (existsSync(extrasFile)) {
      const merged = mergeExtras(source, rows, readJson(extrasFile));
      rows = merged.rows;
      for (const k of merged.unmatched) extraNotes.push(`${stem}.extras.json: no row for "${k}"`);
    }
    return { source, site, complete: j.complete === true, rows, file: f };
  });
  const built = buildBatch(rawFiles, { now, runId: `scout-${basename(dir)}` });
  for (const n of extraNotes) built.notes.push({ key: "extras", name: "extras", note: n });
  // Contact details found on an earlier day for the same event are reused, so pages are not opened again.
  const sibling = readdirSync(dirname(dir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < basename(dir) && existsSync(join(dirname(dir), d, "events.json"))).sort().pop();
  let carried = [];
  if (sibling) {
    const prevDir = join(dirname(dir), sibling);
    const prev = readJson(join(prevDir, "events.json"), null);
    if (prev?.events) carried = carryOver(built.batch.events, built.provenance, prev.events, readJson(join(prevDir, "provenance.json"), {}));
  }
  writeFileSync(join(dir, "events.json"), `${JSON.stringify(built.batch, null, 2)}\n`);
  writeFileSync(join(dir, "provenance.json"), `${JSON.stringify(built.provenance, null, 2)}\n`);
  writeFileSync(join(dir, "flyer-jobs.json"), `${JSON.stringify(flyerJobs(built.batch.events), null, 2)}\n`);
  writeFileSync(join(dir, "skipped.json"), `${JSON.stringify({ skipped: built.skipped, notes: built.notes, duplicates: built.duplicates, carried }, null, 2)}\n`);
  log(`built events.json: ${built.batch.events.length} events from ${files.length} raw files; ${built.skipped.length} rows skipped; sources covered: ${built.batch.sources_covered.join(", ") || "none"}`);
  const why = {};
  for (const s of built.skipped) why[`${s.source}: ${s.reason}`] = (why[`${s.source}: ${s.reason}`] ?? 0) + 1;
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`  skipped ${n} x ${k}`);
  for (const n of built.notes.slice(0, 25)) log(`  note: ${n.name}: ${n.note}`);
  if (built.notes.length > 25) log(`  ... and ${built.notes.length - 25} more notes in skipped.json`);
  if (built.duplicates.length) log(`  ${built.duplicates.length} repeated ids merged`);
  if (carried.length) log(`  reused from ${sibling}: ${carried.length} values (${carried.slice(0, 4).join(", ")}${carried.length > 4 ? ", ..." : ""})`);
  return built;
}

/* ----------------------------------------------------------------- flyers -- */

export function findFlyer(dir, ev) {
  const base = flyerBase(ev);
  for (const ext of FLYER_EXT) {
    const p = join(dir, "flyers", `${base}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

const EXT_OF = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** One flyer at a time, with a pause. Stops after three failures in a row (a block is a reason to ask Jae, not to push harder). */
export async function fetchFlyers(jobs, flyersDir, { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 2000, log = console.log } = {}) {
  mkdirSync(flyersDir, { recursive: true });
  let got = 0, had = 0, failed = 0, streak = 0;
  for (const j of jobs) {
    if (FLYER_EXT.some((e) => existsSync(join(flyersDir, `${j.file}.${e}`)))) {
      had++;
      continue;
    }
    if (streak >= 3) {
      log("  three flyer downloads failed in a row: stopping. Ask Jae (the site may be blocking), or save flyers from the browser by hand.");
      break;
    }
    try {
      const res = await fetchImpl(j.url, { headers: { "User-Agent": "Hoppaz event scout, hoppaz.fun (staff tool, low volume)", Accept: "image/*" }, signal: AbortSignal.timeout(20000) });
      const type = String(res.headers?.get?.("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = EXT_OF[type];
      if (!res.ok || !ext) throw new Error(`${res.status} ${type || "no type"}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || buf.length > 12e6) throw new Error(`size ${buf.length}`);
      writeFileSync(join(flyersDir, `${j.file}.${ext}`), buf);
      got++;
      streak = 0;
    } catch (e) {
      failed++;
      streak++;
      log(`  flyer failed: ${j.source_site}:${j.source_id}: ${e.message}`);
    }
    await sleep(gapMs);
  }
  log(`flyers: ${got} downloaded, ${had} already there, ${failed} failed`);
  return { got, had, failed };
}

/** Shrink to 1200 px JPEG with macOS sips (as load-guide.mjs does). Smaller again if it is still large. */
export async function shrinkWithSips(src) {
  const work = mkdtempSync(join(tmpdir(), "hoppaz-scout-"));
  const out = join(work, "flyer.jpg");
  for (const [px, q] of [[1200, 80], [900, 60]]) {
    execFileSync("sips", ["-Z", String(px), "-s", "format", "jpeg", "-s", "formatOptions", String(q), src, "--out", out], { stdio: "ignore" });
    const buf = readFileSync(out);
    if (buf.length <= 2.5e6) return buf;
  }
  throw new Error("still over 2.5 MB after shrinking");
}

/* ------------------------------------------------------------------ output -- */

const cut = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}~` : t.padEnd(n);
};
const naira = (n) => (n === null ? "?" : n === 0 ? "free" : `N${n.toLocaleString("en-NG")}`);
const PIN = { venues: "venue", source: "source", osm: "osm", null: "none" };

export function formatTable(rows) {
  const head = `${cut("source", 10)} ${cut("when (Lagos)", 16)} ${cut("name", 36)} ${cut("venue", 22)} ${cut("from", 9)} ${cut("pin", 7)} fly  flags`;
  return [head, "-".repeat(head.length + 12), ...rows.map((r) => `${cut(r.ev.source_site, 10)} ${cut(lagosWhen(r.ev.starts_at), 16)} ${cut(r.ev.name, 36)} ${cut(r.ev.venue ?? "-", 22)} ${cut(naira(priceFrom(r.ev.tickets)), 9)} ${cut(PIN[r.ev.pin_by ?? "null"], 7)} ${r.flyer ? "yes" : " no"}  ${r.flags.join(" ")}`)].join("\n");
}

export function formatReport(rep, log) {
  if (!rep || !Array.isArray(rep.lines)) {
    log(`The site answered, but not with an import report: ${JSON.stringify(rep).slice(0, 300)}`);
    return;
  }
  log(`${rep.dry_run ? "Server dry run" : "Server import"}: ${rep.total} events: ${rep.new} new, ${rep.updated} updated, ${rep.unchanged} unchanged, ${rep.blocked} blocked (organiser said no), ${rep.skipped} skipped`);
  log(`  organisers matched ${rep.organisers_matched}, new ${rep.organisers_new}; flagged gone ${rep.flagged_gone}`);
  const lines = rep.lines.filter((l) => l.action !== "unchanged");
  for (const l of lines.slice(0, 300)) log(`  ${l.action.padEnd(8)} ${cut(`${l.source_site}:${l.source_id}`, 30)} ${cut(l.name, 36).trimEnd()}${l.note ? `  (${l.note})` : ""}`);
  if (lines.length > 300) log(`  ... and ${lines.length - 300} more lines`);
}

/* -------------------------------------------------------------------- run -- */

/**
 * The whole run. io lets a check inject everything: log, fetchImpl, geocode, shrink, now (ms), home (the scout folder), venuesPath, sleep.
 * Returns { code, ... }; it never calls process.exit.
 */
export async function runScout(opts, io = {}) {
  const log = io.log ?? console.log;
  const err = io.err ?? console.error;
  const now = io.now ?? Date.now();
  const home = io.home ?? join(homedir(), "hoppaz-scout");
  const venuesPath = io.venuesPath ?? VENUES_PATH;
  const fail = (msg, code = 1) => {
    err(msg);
    return { code };
  };

  if (opts.unknown?.length) return fail(`Unknown option ${opts.unknown.join(", ")}`);
  if (!opts.dir) return fail("Usage: node scripts/events/load-scout.mjs <day folder with events.json> [--apply] [--plan] [--site URL]");
  const dir = resolve(expand(opts.dir));
  if (!existsSync(dir)) return fail(`No folder at ${dir}`);

  // Config, only when a call to the site is wanted. Never from the repo's .env.local.
  let site = null, token = null;
  if (opts.plan || opts.apply) {
    const envPath = join(home, ".env");
    const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
    site = String(opts.site ?? env.HOPPAZ_SITE_URL ?? "").trim().replace(/\/+$/, "");
    token = env.HOPPAZ_ADMIN_TOKEN ?? "";
    if (!site) return fail(`No site. Put HOPPAZ_SITE_URL=https://... in ${envPath} (or pass --site).`);
    if (!/^https?:\/\//i.test(site)) return fail(`The site address must start with https:// (got "${site}").`);
    if (!token) return fail(`No token. Put HOPPAZ_ADMIN_TOKEN=... in ${envPath}.`);
    if (opts.apply && isLocalSite(site) && !opts.allowLocal) return fail(`Refusing --apply: ${site} looks like a local address. Use the real site, or add --allow-local if you mean it.`);
  }

  // 1. events.json from raw files when asked or missing.
  if (opts.build || !existsSync(join(dir, "events.json"))) {
    if (!existsSync(join(dir, "raw"))) return fail(`No events.json and no raw/ folder in ${dir}`);
    buildFromRaw(dir, { now, log });
  }
  const batch = readJson(join(dir, "events.json"));
  const provenance = readJson(join(dir, "provenance.json"), {});

  // 2. flyer downloads (slow, on request).
  if (opts.fetchFlyers) {
    const jobs = flyerJobs(batch.events ?? []);
    await fetchFlyers(jobs, join(dir, "flyers"), { fetchImpl: io.fetchImpl ?? globalThis.fetch, sleep: io.sleep, log });
  }

  // 3. check, pins, check again.
  const first = validateBatch(batch, { now, provenance });
  const venuesFile = readJson(venuesPath, {});
  const cachePath = join(home, "venue-cache.json");
  const cache = readJson(cachePath, {});
  const geocode = opts.geocode ? (io.geocode ?? makePhotonGeocoder({ sleep: io.sleep })) : null;
  const events = Array.isArray(batch.events) ? batch.events : [];
  const goodIdx = events.map((_, i) => i).filter((i) => !first.bad.has(i));
  const pinned = await applyPins(goodIdx.map((i) => events[i]), { venues: indexVenues(venuesFile), cache, geocode, now });
  const withPins = events.slice();
  goodIdx.forEach((i, n) => (withPins[i] = pinned.events[n]));
  const checked = { ...batch, events: withPins };
  const v = validateBatch(checked, { now, provenance });
  if (geocode) {
    mkdirSync(home, { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }

  // 4. what staff will see.
  const rows = withPins.map((ev, i) => ({
    ev,
    bad: v.bad.has(i),
    flyer: !!findFlyer(dir, ev),
    flags: [
      ...v.problems.filter((p) => p.index === i).map((p) => `${p.level === "error" ? "REFUSED" : "warn"}:${p.code}`),
      ...(pinned.report.find((r) => r.key === eventKey(ev))?.conflict_km > 1.5 ? ["pin_differs_from_source"] : []),
    ],
  }));
  const ready = rows.filter((r) => !r.bad);
  log(`\n${basename(dir)}  run ${batch.run_id ?? "?"}\n`);
  if (rows.length) log(formatTable(rows));
  const batchErrors = v.problems.filter((p) => p.index === null && p.level === "error");
  for (const p of batchErrors) log(`BATCH PROBLEM: ${p.message}`);
  const refused = v.problems.filter((p) => p.level === "error" && p.index !== null);
  if (refused.length) {
    log("\nRefused (these are not sent):");
    for (const p of refused) log(`  ${p.source_site}:${p.source_id} ${cut(p.name, 40).trimEnd()}  ${p.code}: ${p.message}`);
  }
  const warns = v.problems.filter((p) => p.level === "warn" && !["no_time", "no_price", "no_venue"].includes(p.code));
  if (warns.length) {
    log("\nWarnings:");
    for (const p of warns.slice(0, 40)) log(`  ${p.source_site}:${p.source_id} ${cut(p.name, 40).trimEnd()}  ${p.code}: ${p.message}`);
    if (warns.length > 40) log(`  ... and ${warns.length - 40} more`);
  }
  const bySite = {};
  for (const r of ready) bySite[r.ev.source_site] = (bySite[r.ev.source_site] ?? 0) + 1;
  const count = (f) => ready.filter((r) => f(r.ev)).length;
  const pinCount = (k) => count((e) => (e.pin_by ?? null) === k);
  log(`
Totals
  events in file ${events.length}: ready ${ready.length}, refused ${rows.length - ready.length}
  by source: ${Object.entries(bySite).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}
  prices: known ${count((e) => priceFrom(e.tickets) !== null)}, none ${count((e) => priceFrom(e.tickets) === null)}, sold out ${count((e) => e.sold_out)}
  times: known ${count((e) => e.starts_at)}, none ${count((e) => !e.starts_at)}
  pins: venues ${pinCount("venues")}, source ${pinCount("source")}, osm ${pinCount("osm")} (staff check), none ${pinCount(null)}
  flyers on disk: ${ready.filter((r) => r.flyer).length} of ${count((e) => e.flyer_url)}
  organiser instagram ${count((e) => e.organiser_handle)}, email ${count((e) => e.organiser_email)}, phone ${count((e) => e.organiser_phone)}, lineup ${count((e) => e.lineup.length)}, capacity ${count((e) => e.capacity !== null)}
  sources covered (rows of these not seen are flagged gone): ${(batch.sources_covered ?? []).join(", ") || "none"}`);

  // 5. the normalized batch (always written).
  // Hoppaz keeps no organiser phone number or email in its database: the site drops them on import, and they are not sent at all.
  const outBatch = { run_id: batch.run_id, scouted_at: batch.scouted_at, sources_covered: batch.sources_covered ?? [], events: ready.map((r) => ({ ...r.ev, organiser_email: null, organiser_phone: null })) };
  writeFileSync(join(dir, "batch.normalized.json"), `${JSON.stringify(outBatch, null, 2)}\n`);
  log(`\nwrote ${join(dir, "batch.normalized.json")}`);

  if (opts.savePins) {
    const { venues, added } = withNewPins(venuesFile, pinned.additions);
    if (added.length) {
      writeFileSync(venuesPath, formatVenuesJson(venues));
      log(`saved ${added.length} new pins into venues.json (by "osm", staff to check): ${added.join("; ")}`);
    } else log("no new confident pins to save");
  }

  const hardRefusals = refused.filter((p) => !SOFT_CODES.has(p.code));
  const blocked = batchErrors.length > 0 || (hardRefusals.length > 0 && !opts.dropInvalid);

  // 6. the site's own dry run.
  const post = async (body, timeout = 90000) => {
    const f = io.fetchImpl ?? globalThis.fetch;
    const res = await f(`${site}/api/admin/outreach`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    if (!res.ok) throw new Error(`${body.action}: the site answered ${res.status} ${json?.reason ?? json?.error ?? text.slice(0, 200)}`);
    return json;
  };
  const reportOf = (j) => j?.report ?? j?.result ?? j;

  if (opts.plan && !opts.apply) {
    if (blocked) return fail("Not asking the site: fix the problems above first.", 2);
    try {
      log(`\nAsking ${site} for its dry run (nothing is written there)...`);
      const rep = reportOf(await post({ action: "import", batch: outBatch, dryRun: true }));
      formatReport(rep, log);
      return { code: 0, report: rep, batch: outBatch };
    } catch (e) {
      return fail(`${e.message}`, 3);
    }
  }

  if (!opts.apply) {
    log("\nDry run. Nothing was sent. Add --plan to see the site's own report, or --apply to send this batch for review.");
    return { code: batchErrors.length ? 2 : 0, batch: outBatch, problems: v.problems, rows, additions: pinned.additions };
  }

  // 7. apply: flyers first, then the batch, for review.
  if (blocked) return fail(`Not sending: ${batchErrors.length ? "the batch itself has problems" : `${hardRefusals.length} events were refused for reasons other than past, online or outside Lagos`}. Fix them, or add --drop-invalid to send the rest.`, 2);
  if (!ready.length) return fail("Nothing to send.", 2);
  const shrink = io.shrink ?? shrinkWithSips;
  let up = 0, keptSource = 0;
  for (const r of ready) {
    const file = findFlyer(dir, r.ev);
    if (!file) continue;
    try {
      const buf = await shrink(file);
      const j = await post({ action: "flyer", source_site: r.ev.source_site, source_id: r.ev.source_id, jpeg_base64: Buffer.from(buf).toString("base64") });
      const url = j?.url ?? j?.flyer_url ?? j?.report?.url;
      if (typeof url !== "string") throw new Error("no url in the answer");
      r.ev.flyer_url = url;
      up++;
    } catch (e) {
      log(`  flyer not uploaded for ${eventKey(r.ev)}: ${e.message}`);
    }
  }
  for (const r of ready) if (r.ev.flyer_url && !findFlyer(dir, r.ev)) keptSource++;
  log(`\nflyers uploaded ${up}; ${keptSource} events keep the organiser's own picture link (no file on disk): staff decide at review`);
  const finalBatch = { ...outBatch, events: ready.map((r) => ({ ...r.ev, organiser_email: null, organiser_phone: null })) };
  writeFileSync(join(dir, "batch.normalized.json"), `${JSON.stringify(finalBatch, null, 2)}\n`);
  try {
    log(`Sending ${finalBatch.events.length} events to ${site} for review...`);
    const rep = reportOf(await post({ action: "import", batch: finalBatch, dryRun: false }));
    formatReport(rep, log);
    writeFileSync(join(dir, "import-report.json"), `${JSON.stringify(rep, null, 2)}\n`);
    log("\nDone. Nothing is live: the events wait in the review queue in the staff desk.");
    return { code: 0, report: rep, batch: finalBatch };
  } catch (e) {
    return fail(`${e.message}`, 3);
  }
}

/* ------------------------------------------------------------------- main -- */

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const { code } = await runScout(parseArgs(process.argv.slice(2)));
  process.exitCode = code;
}
