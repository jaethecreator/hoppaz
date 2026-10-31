/** Small pure helpers for the email templates: escaping, event times in the event's own timezone, money, names. */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Every piece of host or guest written text goes through this before it is put in the HTML. */
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Same text with line breaks kept, for a Pop. */
export const escLines = (v: unknown): string => esc(v).replace(/\r\n|\r|\n/g, "<br>");

/** A header or subject must be one line: control characters (a newline in a title, say) become spaces. */
export const oneLine = (v: unknown, max = 120): string => {
  const s = String(v ?? "").replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
};

const LAGOS = "Africa/Lagos";

function zoneOk(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * "Saturday 8 Nov, 7:30 PM" in the event's timezone. The year is added only when it is not this year. A timezone other than Lagos
 * gets its short name after the time ("7:30 PM GMT+1"). null when there is no usable date.
 */
export function formatWhen(iso: unknown, timezone: unknown, now: Date = new Date()): string | null {
  if (iso == null || iso === "") return null;
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return null;
  const tz = typeof timezone === "string" && timezone && zoneOk(timezone) ? timezone : LAGOS;
  const parts = (date: Date, extra: Intl.DateTimeFormatOptions) =>
    Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: true, ...extra }).formatToParts(date).map((p) => [p.type, p.value]));
  const p = parts(d, { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const thisYear = parts(now, { year: "numeric" }).year;
  const time = `${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim();
  let out = `${p.weekday} ${p.day} ${p.month}${p.year !== thisYear ? ` ${p.year}` : ""}, ${time}`;
  if (tz !== LAGOS) out += ` ${parts(d, { timeZoneName: "short" }).timeZoneName ?? tz}`;
  return out;
}

/** 1250000 kobo -> "₦12,500"; with kobo left over -> "₦12,500.50". */
export function naira(kobo: unknown): string | null {
  const n = typeof kobo === "number" ? kobo : typeof kobo === "string" && kobo.trim() !== "" ? Number(kobo) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.trunc(n / 100);
  const rest = Math.round(n % 100);
  return `₦${whole.toLocaleString("en-US")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** The first word of a name, for "Hey Ada". Empty when there is none. */
export const firstName = (v: unknown): string => String(v ?? "").trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
