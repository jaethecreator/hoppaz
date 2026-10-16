import { dropMark, MARK_MAX, parseDrop } from "@/lib/game-time/drops";
import { roomTemplate } from "@/lib/campaign/templates";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { HOUR, MINUTE, crewKey, dayWord, dropOf, dropTimes, hhmm, isRehearsalKey, lagosDate, lagosDay, lagosInput, lagosMs, lagosShort, overlapsAny, plural, seriesName, spotLabel, summaryLine } from "../format";
import type { Crew, Desk, RoomObject } from "../types";

/**
 * What the add-a-drop flow knows and decides, with no screens in it: the form the staff fill in, the plan that comes out of it
 * (the drop times, the codes, the win rule), the problem each step can have, the checks before saving, and the body the server
 * takes (src/app/api/admin/game-time/gameTime.ts, parseCreate). The screens (StepWhen ... StepCheck) only show it.
 */

export const STEP_NAMES = ["WHEN", "TICKETS", "WHERE", "WHO", "CHECK"] as const;
/** The server takes 1 to 10 codes per drop and a series is 2 to 24 drops (the old desk's REPEAT). */
export const MAX_TICKETS = 10;
export const MAX_DROPS = 24;
export const MAX_CODE = 80;
export const TITLE_MAX = 60;

export type LenKey = "15" | "30" | "60" | "120" | "other";
export type MinKey = "0" | "30" | "60" | "1440" | "other";
export type Rule = "series" | "crew" | "new";

export type Form = {
  // When
  mode: "schedule" | "now";
  /** "YYYY-MM-DD" in Lagos. */
  day: string;
  /** "HH:MM" in Lagos. */
  time: string;
  len: LenKey;
  lenOther: string;
  series: boolean;
  every: string;
  drops: string;
  mystery: boolean;
  seed: number;
  // Tickets
  perDrop: number;
  /**
   * The code fields, in order. Longer than the fields on screen when more codes were pasted than there are tickets: the codes
   * past the last field are the "extra" ones the warning talks about. Nothing is thrown away until staff choose to.
   */
  codes: string[];
  // Where
  picked: string[];
  relocate: number;
  /** null until staff edit it, so the default can follow the ticket count. */
  hot: string | null;
  warm: string | null;
  // Who
  rule: Rule;
  /** null until staff edit it, so the default can follow the opening day. */
  newName: string | null;
  minKey: MinKey;
  minOther: string;
  test: boolean;
  testKey: string;
  /** A series was switched off because a test run was switched on. */
  seriesOffNote: boolean;
  // Check
  title: string;
};

export type Ctx = {
  crew: Crew;
  desk: Desk;
  /** When the flow opened: the days to pick from and the default time start here. */
  t0: number;
  days: { value: string; label: string }[];
  spots: RoomObject[];
  layout: CampaignLayout;
  /**
   * The series this crew is running now, or "": the newest key (not its crew-wide rule, not a test run) that still has a drop
   * live or coming up, or a drop that closed in the last 12 hours. An older key is a finished series (or a staff test), and
   * reusing it by default would bar everyone who won there.
   */
  seriesKey: string;
  defaultTitle: string;
};

export function makeCtx(crew: Crew, desk: Desk, t0: number): Ctx {
  const mine = desk.games.filter((g) => g.crew_id === crew.id).sort((a, b) => Date.parse(b.opens_at) - Date.parse(a.opens_at));
  const current = (g: (typeof mine)[number]) => g.phase === "live" || g.phase === "upcoming" || Date.parse(g.closes_at) >= t0 - 12 * HOUR;
  const seriesKey = mine.find((g) => g.campaign_key && g.campaign_key !== crewKey(crew.id) && !isRehearsalKey(g.campaign_key) && current(g))?.campaign_key ?? "";
  const lastReal = mine.find((g) => !isRehearsalKey(g.campaign_key)) ?? mine[0];
  const title = lastReal ? parseDrop(lastReal.title).title.trim() : "";
  const days = Array.from({ length: 7 }, (_, i) => {
    const ms = t0 + i * 24 * HOUR;
    const day = lagosDay(ms);
    return { value: lagosDate(ms), label: i === 0 ? `Today, ${day}` : i === 1 ? `Tomorrow, ${day}` : day };
  });
  return {
    crew,
    desk,
    t0,
    days,
    spots: desk.objects[`${crew.template}:${crew.width}`] ?? [],
    layout: roomTemplate(crew.template, crew.width === 36 ? 36 : 30),
    seriesKey,
    defaultTitle: title || "Find the ticket",
  };
}

export function initForm(ctx: Ctx): Form {
  // The next :00 or :30 that is at least 15 minutes away. Lagos is a whole hour from UTC, so UTC half hours are Lagos half hours.
  const first = Math.ceil((ctx.t0 + 15 * MINUTE) / (30 * MINUTE)) * 30 * MINUTE;
  return {
    mode: "schedule",
    day: lagosDate(first),
    time: hhmm(first),
    len: "30",
    lenOther: "45",
    series: false,
    every: "3",
    drops: "8",
    mystery: true,
    seed: Math.floor(Math.random() * 2 ** 31),
    perDrop: 1,
    codes: [""],
    picked: [],
    relocate: 10,
    hot: null,
    warm: null,
    // Jae's call: when this crew already has a series, the default is to keep it going.
    rule: ctx.seriesKey ? "series" : "new",
    newName: null,
    minKey: "0",
    minOther: "120",
    test: false,
    testKey: "",
    seriesOffNote: false,
    title: ctx.defaultTitle,
  };
}

const intIn = (s: string, lo: number, hi: number): number | null => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const numOf = (s: string): number | null => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

/** "30 min", "2 h", "90 min". */
export const lenText = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The label of code field i: "Ticket 2", or for a series "Drop 3" (one ticket each) or "Drop 3 · 2". */
export function slotLabel(i: number, perDrop: number, series: boolean): string {
  if (!series) return `Ticket ${i + 1}`;
  return perDrop === 1 ? `Drop ${i + 1}` : `Drop ${Math.floor(i / perDrop) + 1} · ${(i % perDrop) + 1}`;
}

/**
 * Writes codes into the fields: the first into field `at`, the others into the empty fields after it. A field that already
 * holds a code is never overwritten; codes with no empty field left go past the last field (`total`), where the warning
 * shows them, so nothing is lost.
 */
export function writeCodes(codes: string[], at: number, parts: string[], total: number): string[] {
  const next = [...codes];
  while (next.length < Math.max(at + 1, total)) next.push("");
  next[at] = parts[0] ?? "";
  const rest = parts.slice(1);
  for (let j = at + 1; j < total && rest.length; j++) if (!next[j].trim()) next[j] = rest.shift() as string;
  next.push(...rest);
  return next;
}

/** Everything the screens read, worked out from the form. Cheap: runs on every render. */
export function derive(f: Form, ctx: Ctx, now: number) {
  const { crew, desk } = ctx;
  const isNow = f.mode === "now";
  // A test run is one drop, and START NOW is one drop.
  const series = f.mode === "schedule" && f.series && !f.test;

  // When
  const len = intIn(f.len === "other" ? f.lenOther : f.len, 1, 10080);
  const parsed = isNow ? NaN : lagosMs(f.day, f.time);
  const opens = Number.isFinite(parsed) ? parsed : null;
  const closes = opens !== null && len !== null ? opens + len * MINUTE : null;
  const every = series ? intIn(f.every, 1, 12) : null;
  const dropsN = series ? (intIn(f.drops, 2, MAX_DROPS) ?? 0) : 1;
  let times: number[] = [];
  if (opens !== null && len !== null) {
    if (!series) times = [opens];
    else if (every !== null && dropsN >= 2 && len * MINUTE < every * HOUR) times = dropTimes(opens, every * HOUR, dropsN, len * MINUTE, f.mystery, f.seed);
  }

  // Tickets
  const total = dropsN * f.perDrop;
  const slotCodes = Array.from({ length: total }, (_, i) => (f.codes[i] ?? "").trim());
  const overflow = f.codes.slice(total).map((c) => c.trim()).filter(Boolean);
  const filled = slotCodes.filter(Boolean).length;
  const firstSeen = new Map<string, number>();
  const codeErr = slotCodes.map((c, i) => {
    if (!c) return "";
    if (c.length > MAX_CODE) return `A code can have ${MAX_CODE} characters at most`;
    // "DAVE-1111 DAVE-2222" would hide one box whose winner gets both codes.
    if (/\s/.test(c)) return "This looks like 2 codes. Put each code in its own field.";
    const k = c.toLowerCase();
    const at = firstSeen.get(k);
    if (at !== undefined) return `Same code as ${lower(slotLabel(at, f.perDrop, series))}`;
    firstSeen.set(k, i);
    return "";
  });

  // Where
  const hotS = f.hot ?? (f.perDrop >= 3 ? "3" : "5");
  const warmS = f.warm ?? (f.perDrop >= 3 ? "6" : "10");
  const hot = numOf(hotS);
  const warm = numOf(warmS);
  const ringsOk = hot !== null && hot > 0 && hot <= 100 && warm !== null && warm >= hot && warm <= 200;

  // Who
  const rule: Rule = f.rule === "series" && !ctx.seriesKey ? "new" : f.rule;
  const newName = f.newName ?? `${crew.name} tickets, ${lagosDay(opens ?? now)}`;
  const nameT = newName.trim();
  const nameLow = nameT.toLowerCase();
  const nameOk = nameT.length >= 1 && nameT.length <= 80 && !/[\u0000-\u001f\u007f]/.test(nameT) && !nameLow.startsWith("crew:") && !nameLow.startsWith("rehearsal-");
  // The key the server gets. Empty means the crew's own rule ("one per person across every drop of this crew").
  const campaign = f.test ? f.testKey : rule === "series" ? ctx.seriesKey : rule === "new" ? nameT : "";
  // A "new" series under a name already used would quietly join that series and bar its winners.
  const nameUsed = !!nameT && desk.games.some((g) => g.campaign_key === nameT);
  const members = f.test ? 0 : f.minKey === "other" ? intIn(f.minOther, 0, 10080) : Number(f.minKey);

  // Check
  const baseTitle = parseDrop(f.title.trim()).title;
  const titleMax = series && f.mystery ? TITLE_MAX - MARK_MAX : TITLE_MAX;
  const titleOk = baseTitle.length >= 2 && baseTitle.length <= titleMax;
  const windows: [number, number][] = isNow ? (len !== null ? [[now, now + len * MINUTE]] : []) : times.map((t) => [t, t + (len ?? 0) * MINUTE]);
  let clash = "";
  for (let k = 0; k < windows.length && !clash; k++) {
    const g = overlapsAny(desk.games, crew.id, windows[k][0], windows[k][1]);
    if (g) clash = `${series ? `Drop ${k + 1} (${lagosShort(windows[k][0])} to ${hhmm(windows[k][1])}) clashes` : "Clashes"} with “${dropOf(g).title}” (${lagosShort(g.opens_at)} to ${hhmm(g.closes_at)}).`;
  }

  const firstCodeErr = codeErr.find(Boolean) ?? "";
  // What stops each step's NEXT, in words. "" when the step is fine.
  const problems = [
    len === null
      ? "How long it stays open: 1 to 10080 minutes."
      : isNow
        ? ""
        : opens === null
          ? "Pick the day and the time it opens."
          : opens <= now
            ? "That time has already passed. Pick a later time."
            : series
              ? every === null
                ? "Every: 1 to 12 hours."
                : dropsN < 2
                  ? "Drops: 2 to 24."
                  : len * MINUTE >= every * HOUR
                    ? "Each drop must close before the next slot starts."
                    : ""
              : "",
    overflow.length
      ? `${plural(filled + overflow.length, "code")} for ${plural(total, "ticket")}: fix this first`
      : filled < total
        ? "Fill in every ticket code"
        : firstCodeErr
          ? `${codeCheck(firstCodeErr)}: fix it first`
          : series && f.mystery && f.perDrop > 1
            ? "A mystery series gives 1 ticket per drop. Set the tickets to 1, or turn mystery times off."
            : "",
    f.picked.length < f.perDrop ? `Pick at least ${plural(f.perDrop, "spot")}: every ticket needs its own spot.` : !ringsOk ? "Hint rings: hot above 0 and up to 100, warm at least hot and up to 200." : "",
    !f.test && rule === "new" && !nameOk
      ? "Name the series: 1 to 80 characters on one line, not starting with “crew:” or “rehearsal-”."
      : !f.test && rule === "new" && nameUsed
        ? "That name is already a series. Give the new one another name."
        : members === null
        ? "Minutes in the crew: 0 to 10080."
        : "",
    !titleOk ? (titleMax < TITLE_MAX ? `The name needs 2 to ${titleMax} characters (the drop counter takes the rest).` : "The name needs 2 to 60 characters.") : clash,
  ];
  // The Check step saves, so every step's problem blocks it.
  const blocking = (step: number) => (step < 4 ? problems[step] : (problems.find(Boolean) ?? ""));

  return {
    isNow, series, len, opens, closes, every, dropsN, times, total, slotCodes, overflow, filled, codeErr,
    hotS, warmS, hot, warm, rule, newName, nameT, nameOk, nameUsed, campaign, members,
    baseTitle, titleMax, windows, clash, problems, blocking,
  };
}
export type Derived = ReturnType<typeof derive>;

/** A code field's error as a short check line: "Two tickets share a code". */
export function codeCheck(err: string): string {
  if (err.startsWith("Same")) return "Two tickets share a code";
  if (err.startsWith("A code can")) return "A code is too long";
  return "A field holds 2 codes";
}

export type StepProps = { f: Form; d: Derived; ctx: Ctx; set: (p: Partial<Form> | ((s: Form) => Partial<Form>)) => void; now: number };

/** The win rule as a phrase: “360 Dave tickets”, all 360Playlist drops, a test run. */
export const ruleName = (f: Form, d: Derived, ctx: Ctx) => seriesName(f.test ? f.testKey : d.campaign || crewKey(ctx.crew.id), ctx.crew.name);

/** The body of the create call for drop i (0 for a single drop). Same shape as parseCreate takes. */
export function createBody(f: Form, d: Derived, ctx: Ctx, i: number): Record<string, unknown> {
  const per = f.perDrop;
  const body: Record<string, unknown> = {
    action: "create",
    crew_id: ctx.crew.id,
    // A mystery series carries its place in the title ("Dave's concert · 2/5"): Hoppers' screens read it and never show it.
    title: d.series && f.mystery ? `${d.baseTitle}${dropMark(i + 1, d.dropsN)}` : d.baseTitle,
    codes: d.slotCodes.slice(i * per, (i + 1) * per),
    objects: f.picked,
    relocate_minutes: f.relocate,
    min_member_minutes: d.members ?? 0,
    hot_tiles: d.hot,
    warm_tiles: d.warm,
  };
  if (d.campaign) body.campaign_key = d.campaign;
  if (f.test) body.silent = true;
  if (f.mode === "now") {
    body.start_now = true;
    body.duration_minutes = d.len;
  } else {
    body.opens_at = lagosInput(d.times[i]);
    body.closes_at = lagosInput(d.times[i] + (d.len ?? 0) * MINUTE);
  }
  return body;
}

/** The first line of the answer for staff once it saved. */
export function doneMessage(f: Form, d: Derived): string {
  if (f.mode === "now") return "Drop is live.";
  const first = d.times[0];
  const at = `${dayWord(first)} ${hhmm(first)}`;
  return d.series ? `${d.dropsN} drops scheduled. The first opens ${at}.` : `Drop scheduled: opens ${at}.`;
}

export function saveLabel(f: Form, d: Derived, armed: boolean, progress: number): string {
  if (progress > 0) return d.series ? `SCHEDULING ${progress} OF ${d.dropsN}…` : "SAVING…";
  if (f.mode === "now") return armed ? (f.test ? "OPEN IT NOW?" : "OPEN IT AND PING THE CREW?") : "START NOW";
  return d.series ? `SCHEDULE ${d.dropsN} DROPS` : "SCHEDULE THIS DROP";
}

const endText = (open: number, end: number) => (lagosDate(end) === lagosDate(open) ? hhmm(end) : `${lagosDay(end)} ${hhmm(end)}`);

/** When, as a line: `long` for the Check rows, short for the side panel. */
export function whenText(f: Form, d: Derived, long: boolean): string {
  if (f.mode === "now") return d.len !== null ? `Now, runs ${lenText(d.len)}` : "Now";
  if (d.opens === null || d.len === null || d.closes === null) return "Not set yet";
  if (d.series) return long ? `${d.dropsN} drops, ${lenText(d.len)} each, every ${plural(d.every ?? 0, "hour")}` : `${d.dropsN} drops · first ${lagosDay(d.opens)}, ${hhmm(d.opens)}`;
  return long ? `${lagosDay(d.opens)}, ${hhmm(d.opens)} to ${endText(d.opens, d.closes)} (${lenText(d.len)})` : `${lagosDay(d.opens)} · ${hhmm(d.opens)} to ${endText(d.opens, d.closes)}`;
}

/** Tickets, for the side panel. */
export function ticketsText(f: Form, d: Derived): string {
  if (d.overflow.length) return `${plural(d.filled + d.overflow.length, "code")} for ${plural(d.total, "ticket")}`;
  if (d.series) return `${d.dropsN} drops × ${plural(f.perDrop, "ticket")}`;
  return d.total === 1 && d.slotCodes[0] ? `1 · ${d.slotCodes[0]}` : plural(f.perDrop, "ticket");
}

/** Where, as a line: spot names (Check rows) or their count (side panel), then how often the box moves. */
export function whereText(f: Form, long: boolean): string {
  const moves = f.relocate ? `moves every ${f.relocate} min` : "never moves";
  return `${long ? f.picked.map(spotLabel).join(", ") : plural(f.picked.length, "spot")} · ${moves}`;
}

/** Who, as a line: `long` for the Check rows, short for the side panel. */
export function whoText(f: Form, d: Derived, ctx: Ctx, long: boolean): string {
  const mins = d.members ?? 0;
  const members = mins === 0 ? "any member" : `in the crew ${lenText(mins)} or more`;
  if (f.test) return long ? `Crew members · test run, its own win rule · ${members}` : "Members · test run, its own win rule";
  if (long) return `Crew members · one per person across ${ruleName(f, d, ctx)} · ${members}`;
  return d.rule === "series" ? "Members · one per person in the series" : d.rule === "crew" ? `Members · one per person in all ${ctx.crew.name} drops` : "Members · one per person in the new series";
}

/** The sentence staff read before saving (summaryLine in format.ts). */
export const summary = (f: Form, d: Derived) =>
  summaryLine({ tickets: f.perDrop, opens: d.opens, closes: d.closes, spots: f.picked.length, drops: d.series ? d.dropsN : undefined, everyHours: d.every ?? undefined, startNow: f.mode === "now", minutes: d.len ?? undefined });

/** The short line of the phone's bottom bar: "1 ticket · Fri 12:00 to 12:30 · 3 spots". */
export function shortLine(f: Form, d: Derived): string {
  const parts = [d.series && d.dropsN ? `${d.dropsN} drops × ${plural(f.perDrop, "ticket")}` : plural(f.perDrop, "ticket")];
  if (f.mode === "now") parts.push(d.len !== null ? `now, ${lenText(d.len)}` : "now");
  else if (d.opens !== null && d.closes !== null) parts.push(d.series ? `first ${lagosShort(d.opens)}` : `${lagosShort(d.opens)} to ${endText(d.opens, d.closes)}`);
  if (f.picked.length) parts.push(plural(f.picked.length, "spot"));
  if (f.test) parts.push("test run");
  return parts.join(" · ");
}

export type CheckItem = { ok: boolean; text: string; short?: string; late?: boolean };

/**
 * The checks list. A check about a step the staff have not reached yet is left out (nothing to say), so the list grows as the
 * steps are done. `late` ones are only listed on the Check step (or when they fail).
 */
export function buildChecks(f: Form, d: Derived, step: number, now: number): CheckItem[] {
  const out: CheckItem[] = [];
  const per = f.perDrop;
  const boxes = plural(per, "box", "boxes");
  if (d.overflow.length) {
    const n = d.filled + d.overflow.length;
    out.push({ ok: false, text: `${plural(n, "code")} for ${plural(d.total, "ticket")}: ${plural(n, "winner")}` });
  } else if (d.codeErr.some(Boolean)) {
    out.push({ ok: false, text: codeCheck(d.codeErr.find(Boolean) ?? "") });
  } else if (d.total > 0 && d.filled === d.total) {
    out.push({ ok: true, text: `${plural(d.total, "code")} for ${plural(d.total, "ticket")}` });
  } else if (step === 4) {
    out.push({ ok: false, text: `${d.filled} of ${plural(d.total, "code")} filled in` });
  }
  if (f.picked.length >= per) out.push({ ok: true, text: `${plural(f.picked.length, "spot")} for ${boxes}` });
  else if (f.picked.length > 0 || step >= 3) out.push({ ok: false, text: `${plural(f.picked.length, "spot")} for ${boxes}: pick more` });
  if (d.windows.length) {
    out.push(
      d.clash
        ? { ok: false, text: d.clash }
        : { ok: true, text: d.series ? "No other drop in this room at any of those times" : "No other drop in this room at that time", short: "No other drop in this room then" },
    );
  }
  if (f.mode === "schedule") {
    if (d.opens !== null) out.push(d.opens > now ? { ok: true, text: "Opens in the future", late: true } : { ok: false, text: "That time has already passed", late: true });
  } else {
    out.push({ ok: true, text: "Opens the moment you save", late: true });
  }
  out.push(f.test ? { ok: true, text: "Test run: no push", late: true } : { ok: true, text: d.series ? "Members get a push when each drop opens" : "Members get a push when it opens", late: true });
  return out;
}
