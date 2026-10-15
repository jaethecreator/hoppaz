"use client";

import { useEffect, useState } from "react";

/**
 * Time in Game Time is the server's. A phone's clock can be minutes out, and a countdown that disagrees with the server
 * is a ticket nobody can win, so every countdown is worked out from `server_now` (docs/GAME-TIME.md section 4) plus the
 * time that has passed on this phone since it arrived. The sample with the shortest round trip is the most trustworthy.
 */

let offset = 0;
let bestRtt = Infinity;

/** A server time arrived in a response that was sent at `sentAt` and received at `receivedAt` (phone clock, ms). */
export function noteServerTime(serverNow: string, sentAt: number, receivedAt: number) {
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server)) return;
  const rtt = Math.max(0, receivedAt - sentAt);
  const sample = server - (sentAt + rtt / 2);
  if (bestRtt === Infinity || rtt <= bestRtt + 300) offset = sample;
  // The best round trip fades, so one lucky fast sample does not decide the offset for the whole night.
  bestRtt = Math.min(bestRtt === Infinity ? rtt : bestRtt * 1.05 + 5, rtt);
}

/** The server's clock right now, in ms since 1970. */
export const serverNow = () => Date.now() + offset;

/** The server's clock, re-read every `ms` while the component is mounted. */
export function useServerNow(ms = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 754000 gives "12:34"; over an hour it gives "2:14:09". Never negative. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "FRI 16 OCT, 8PM" in Lagos time, from an ISO string. */
export function lagosWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  const time = `${get("hour")}${minute && minute !== "00" ? `:${minute}` : ""}${get("dayPeriod").toUpperCase()}`;
  return `${get("weekday")} ${get("day")} ${get("month")}, ${time}`.toUpperCase();
}
