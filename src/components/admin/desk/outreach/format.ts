import type { Organiser, OrganiserStage, PulledEvent, PulledFlag, ScoutTicket } from "@/lib/events-r1/types";

/** Small pure helpers for the Outreach section: dates in Lagos time, plain words for stages and flags, the tracker order, the clipboard. */

const DAY = 86_400_000;

export const STAGE_LABEL: Record<OrganiserStage, string> = {
  pulled: "Pulled",
  listed: "Listed",
  offered: "Offered",
  claimed: "Claimed",
  declined: "Declined",
};

/** The pill colour of each stage. */
export const STAGE_TONE: Record<OrganiserStage, string> = {
  pulled: "",
  listed: "pill-lagoon",
  offered: "pill-danfo",
  claimed: "pill-keke",
  declined: "pill-fireant",
};

export const FLAG_LABEL: Record<PulledFlag, string> = {
  duplicate: "Possible duplicate",
  changed: "Changed at source",
  no_price: "Price missing",
  no_time: "Time missing",
  no_pin: "Pin not checked",
  blocked: "Blocked: they said no",
  moved: "Moved",
  gone: "No longer listed at source",
};

export const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

const LAGOS = "Africa/Lagos";

/** "Sat 8 Nov, 9:00 pm" in Lagos time. Empty for no date. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NG", { timeZone: LAGOS, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const stamp = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: LAGOS, dateStyle: "medium", timeStyle: "short" });

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/** "today", "yesterday", "3 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const d = daysSince(iso, now);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** "Not contacted yet" or "3 days ago by Jae". */
export function lastContact(o: Pick<Organiser, "last_contacted_at" | "last_contacted_by">, now = Date.now()): string {
  if (!o.last_contacted_at) return "Not contacted yet";
  return `${ago(o.last_contacted_at, now)}${o.last_contacted_by ? ` by ${o.last_contacted_by}` : ""}`;
}

/** The lowest and highest known ticket price. */
export function priceRange(tickets: ScoutTicket[]): { from: number; to: number } | null {
  const p = tickets.map((t) => t.price_naira).filter((n): n is number => typeof n === "number");
  if (!p.length) return null;
  return { from: Math.min(...p), to: Math.max(...p) };
}

/** "Free", "₦5,000", "From ₦5,000" or "Price missing". */
export function priceText(tickets: ScoutTicket[]): string {
  const r = priceRange(tickets);
  if (!r) return "Price missing";
  if (r.to === 0) return "Free";
  return r.to > r.from ? `From ${naira(r.from)}` : naira(r.from);
}

/** Lagos is UTC+1 all year, so a plain offset is exact. ISO to the value of a datetime-local input. */
export function toLagosInput(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 3_600_000).toISOString().slice(0, 16);
}

/** The value of a datetime-local input back to ISO with the +01:00 offset ("" is null). */
export function fromLagosInput(v: string): string | null {
  return v ? `${v}:00+01:00` : null;
}

export function igUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "")}`;
}

export const isLagos = (lat: number, lng: number) => lat >= 6.3 && lat <= 6.8 && lng >= 3.05 && lng <= 3.95;

/** Copy to the clipboard. Falls back to a hidden textarea where the clipboard API is not allowed. True when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** A flag shows once; the pin chip also covers a pin that came from a search instead of the venue file. */
export function flagsOf(row: PulledEvent): PulledFlag[] {
  const out = [...row.flags];
  if (row.fields.pin_by === "osm" && !out.includes("no_pin")) out.push("no_pin");
  if (!row.fields.starts_at && !out.includes("no_time")) out.push("no_time");
  return out;
}

/** Ready for "Approve all": confirmed, new, a start time, no flags. */
export const isClean = (row: PulledEvent) => row.status === "new" && row.confidence === "confirmed" && !!row.fields.starts_at && flagsOf(row).length === 0;

/* ---- the tracker order ---- */

export type Bucket = "never" | "waiting" | "followup" | "rest" | "claimed" | "declined";

export const BUCKET_TITLE: Record<Bucket, string> = {
  never: "Listed, never contacted",
  waiting: "No reply for 3 days or more",
  followup: "Follow up, 7 days or more",
  rest: "Everyone else",
  claimed: "Claimed",
  declined: "Declined",
};

/**
 * Who is next. A reply logged after the last contact (last_replied_at) takes them out of the waiting groups.
 */
export function bucketOf(o: Organiser, now = Date.now()): Bucket {
  if (o.stage === "claimed") return "claimed";
  if (o.stage === "declined" || o.do_not_contact) return "declined";
  const days = daysSince(o.last_contacted_at, now);
  if (o.stage === "listed" && days === null) return "never";
  const replied = !!o.last_replied_at && (!o.last_contacted_at || o.last_replied_at >= o.last_contacted_at);
  if (!replied && days !== null && (o.stage === "offered" || o.stage === "listed")) {
    if (days >= 7) return "followup";
    if (days >= 3) return "waiting";
  }
  return "rest";
}

export const BUCKET_ORDER: Bucket[] = ["never", "waiting", "followup", "rest", "claimed", "declined"];

/** Within a group the one waiting longest comes first; never contacted: the one with most upcoming events first. */
export function sortInBucket(b: Bucket, list: Organiser[]): Organiser[] {
  const at = (o: Organiser) => (o.last_contacted_at ? new Date(o.last_contacted_at).getTime() : 0);
  const out = [...list];
  if (b === "never") out.sort((a, c) => c.events_upcoming - a.events_upcoming || a.name.localeCompare(c.name));
  else if (b === "claimed" || b === "declined") out.sort((a, c) => a.name.localeCompare(c.name));
  else out.sort((a, c) => at(a) - at(c) || a.name.localeCompare(c.name));
  return out;
}
