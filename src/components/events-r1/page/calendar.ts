/**
 * Add to calendar: a .ics file built in the browser, and a Google Calendar link. The online link goes in only when the
 * event carries it (the data layer returns it to a registered person and the host, nobody else).
 */
import type { R1Event } from "@/lib/events-r1/types";
import { placeLine } from "../words";
import { icsEscape } from "./icsEscape";
import { eventUrl } from "./share";
import { endOf } from "./time";

const pad = (n: number) => String(n).padStart(2, "0");

/** 20261029T180000Z */
function utc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const esc = icsEscape;

/** Lines over 75 characters continue on the next line, indented by one space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

function details(e: R1Event): string {
  const parts = [e.description.trim(), e.online_link ? `Join: ${e.online_link}` : "", eventUrl(e)];
  return parts.filter(Boolean).join("\n\n");
}

export function icsText(e: R1Event): string {
  const start = Date.parse(e.starts_at);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hoppaz//Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@hoppaz.fun`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(endOf(e))}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(details(e))}`,
  ];
  const where = placeLine(e);
  if (where) lines.push(`LOCATION:${esc(where)}`);
  lines.push(`URL:${eventUrl(e)}`, "END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Saves the .ics (the phone's calendar offers to add it). */
export function downloadIcs(e: R1Event): void {
  const url = URL.createObjectURL(new Blob([icsText(e)], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.slug || e.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl(e: R1Event): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${utc(Date.parse(e.starts_at))}/${utc(endOf(e))}`,
    details: details(e),
  });
  const where = placeLine(e);
  if (where) q.set("location", where);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
