/**
 * Outside ticket taps (the lightweight count behind "[N] people went to buy"). One row per event, Lagos day and person or device, so the
 * same person tapping a few times in a day counts once. Mirrors ev_ticket_tap and ev_ticket_tap_count in events_r1_outreach_ready.sql.
 * Nothing but the count leaves this module: no names, no devices.
 */
import { lagosDay } from "../outreach/match";
import { now, persist, S, viewer } from "./store";
import type { EventRec } from "./store";

/** "<event>|<Lagos day>|<who>". A signed in person is counted by account, everyone else by the device id the browser made. */
export function recordTap(e: EventRec, device: string | null | undefined): boolean {
  const v = viewer();
  const d = String(device ?? "").trim();
  const who = v ? `u:${v.id}` : /^[A-Za-z0-9_-]{8,64}$/.test(d) ? `d:${d}` : "";
  if (!who) return false;
  const key = `${e.id}|${lagosDay(now())}|${who}`;
  if (S().ticketTaps[key]) return false;
  S().ticketTaps[key] = true;
  persist();
  return true;
}

/** Distinct people and devices who tapped the outside ticket link of one event, all days. */
export function tapsOf(eventId: string): number {
  const who = new Set<string>();
  for (const k of Object.keys(S().ticketTaps)) {
    const [id, , w] = k.split("|");
    if (id === eventId && w) who.add(w);
  }
  return who.size;
}

/** The staff desk's numbers: per event, and per organiser (distinct across that organiser's events). */
export function allTaps(): { events: Record<string, number>; organisers: Record<string, number> } {
  const byEvent = new Map<string, Set<string>>();
  for (const k of Object.keys(S().ticketTaps)) {
    const [id, , w] = k.split("|");
    if (!id || !w) continue;
    if (!byEvent.has(id)) byEvent.set(id, new Set());
    byEvent.get(id)?.add(w);
  }
  const events: Record<string, number> = {};
  const orgSets = new Map<string, Set<string>>();
  for (const [id, set] of byEvent) {
    events[id] = set.size;
    const org = S().events[id]?.organiser_id;
    if (!org) continue;
    if (!orgSets.has(org)) orgSets.set(org, new Set());
    for (const w of set) orgSets.get(org)?.add(w);
  }
  const organisers: Record<string, number> = {};
  for (const [id, set] of orgSets) organisers[id] = set.size;
  return { events, organisers };
}
