/**
 * Fake Pops. A Pop is a message to the people on an event. Sent now, or scheduled: a scheduled Pop becomes sent
 * the next time anything reads Pops or Announcements after its time (lazy, by the fake clock). Automatic Pops
 * (day before, 1 hour before, doors open) are scheduled rows made with each event.
 * One way: a Pop with "also post in room" is copied into the host room's Announcements tagged with the event; a plain
 * room announcement is never returned by visibleOnEvent.
 */
import type { PopsApi } from "../api";
import type { Pop, PopAudience, PopAuto } from "../types";
import { AUTO_KINDS, autoSendAt } from "./defaults";
import { assertManage, findEvent, isGoing, isHostOf, regOf, regsOf, userById } from "./rules";
import { emit, now, S, viewer } from "./store";
import { clone, newId, seedId } from "./util";

/** The longest a Pop may be, like a room announcement. */
const MAX_POP = 280;

export function recipientsFor(eventId: string, audience: PopAudience): number {
  const regs = regsOf(eventId);
  const n = (f: (s: string) => boolean) => regs.filter((r) => f(r.status)).length;
  const going = n((s) => s === "going" || s === "checked_in");
  const pending = n((s) => s === "requested");
  const waiting = n((s) => s === "waitlisted");
  return audience === "going" ? going : audience === "pending" ? pending : audience === "waitlist" ? waiting : going + pending + waiting;
}

/** Copy a sent Pop into its room's Announcements, tagged with the event. */
function copyToRoom(pop: Pop): void {
  const e = S().events[pop.event_id];
  if (!pop.also_room || !e?.room_id) return;
  const id = seedId(`pop-ann:${pop.id}`);
  S().announcements[id] = {
    id,
    room_id: e.room_id,
    body: pop.body,
    created_at: pop.sent_at ?? new Date(now()).toISOString(),
    author_name: pop.author_name,
    event_id: e.id,
    event_title: e.title,
  };
}

/** Turn every scheduled Pop whose time has come into a sent one. Returns whether anything changed. */
export function flushDuePops(): boolean {
  const t = now();
  let changed = false;
  for (const pop of Object.values(S().pops)) {
    if (pop.status !== "scheduled" || pop.enabled === false || !pop.send_at || Date.parse(pop.send_at) > t) continue;
    const e = S().events[pop.event_id];
    if (!e || e.status === "cancelled") continue;
    pop.status = "sent";
    pop.sent_at = pop.send_at;
    pop.recipients = recipientsFor(pop.event_id, pop.audience);
    copyToRoom(pop);
    changed = true;
  }
  if (changed) emit();
  return changed;
}

/** The start time moved: automatic Pops that have not gone yet move with it. */
export function retimeAutoPops(e: { id: string; title: string; starts_at: string; kind: string }): void {
  for (const auto of AUTO_KINDS) {
    const p = S().pops[seedId(`autopop:${e.id}:${auto}`)];
    if (p && p.status === "scheduled") p.send_at = autoSendAt(auto, e.starts_at);
  }
}

/** Is this sent Pop for the person looking? The host sees all; a guest sees the ones for their kind of registration. */
function visibleToViewer(pop: Pop): boolean {
  const e = S().events[pop.event_id];
  const v = viewer();
  if (!e || !v) return false;
  if (isHostOf(e) || v.staff) return true;
  const r = regOf(e.id, v.id);
  if (!r) return false;
  if (pop.audience === "going") return isGoing(r.status);
  if (pop.audience === "pending") return r.status === "requested";
  if (pop.audience === "waitlist") return r.status === "waitlisted";
  return isGoing(r.status) || r.status === "requested" || r.status === "waitlisted";
}

export const pops: PopsApi = {
  async listForEvent(eventId) {
    const e = assertManage(findEvent(eventId));
    flushDuePops();
    const key = (p: Pop) => Date.parse(p.sent_at ?? p.send_at ?? "") || 0;
    return clone(Object.values(S().pops).filter((p) => p.event_id === e.id).sort((a, b) => key(b) - key(a)));
  },

  async visibleOnEvent(eventId) {
    const e = findEvent(eventId);
    if (!e) return [];
    flushDuePops();
    return clone(
      Object.values(S().pops)
        .filter((p) => p.event_id === e.id && p.status === "sent" && visibleToViewer(p))
        .sort((a, b) => Date.parse(b.sent_at ?? "") - Date.parse(a.sent_at ?? ""))
    );
  },

  async send({ eventId, body, audience, alsoRoom, sendAt }) {
    const e = assertManage(findEvent(eventId));
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_POP) throw new Error(`Keep it under ${MAX_POP} characters`);
    const when = sendAt ? Date.parse(sendAt) : NaN;
    if (sendAt && !Number.isFinite(when)) throw new Error("Pick a time to send");
    if (sendAt && when <= now()) throw new Error("Pick a time in the future");
    if (sendAt && when > Date.parse(e.starts_at)) throw new Error("Pick a time before the event starts");
    const later = Number.isFinite(when);
    const author = userById(e.host_id)?.name ?? "Host";
    const pop: Pop = {
      id: newId(),
      event_id: e.id,
      event_title: e.title,
      author_name: author,
      body: text,
      audience,
      also_room: alsoRoom && !!e.room_id,
      send_at: later ? new Date(when).toISOString() : null,
      sent_at: later ? null : new Date(now()).toISOString(),
      status: later ? "scheduled" : "sent",
      auto: null,
      recipients: later ? 0 : recipientsFor(e.id, audience),
    };
    S().pops[pop.id] = pop;
    if (!later) copyToRoom(pop);
    emit();
    return clone(pop);
  },

  async shareText(popId) {
    const p = S().pops[popId];
    if (!p) throw new Error("Pop not found");
    const e = S().events[p.event_id];
    return `${p.body}\n\nhttps://hoppaz.fun/e/${e?.slug ?? p.event_id}`;
  },

  async cancelScheduled(popId) {
    const p = S().pops[popId];
    if (!p) throw new Error("Pop not found");
    assertManage(S().events[p.event_id]);
    flushDuePops();
    if (p.status === "sent") throw new Error("Already sent");
    if (p.auto) throw new Error("Switch it off instead");
    delete S().pops[popId];
    emit();
  },

  async setAuto(eventId, auto, enabled) {
    const p = autoPop(eventId, auto);
    flushDuePops();
    if (p.status === "sent") throw new Error("Already sent");
    if (enabled && p.send_at && Date.parse(p.send_at) <= now()) throw new Error("That time has passed");
    p.enabled = enabled;
    emit();
    return clone(p);
  },

  async editAuto(eventId, auto, body) {
    const p = autoPop(eventId, auto);
    flushDuePops();
    if (p.status === "sent") throw new Error("Already sent");
    const text = body.trim();
    if (!text) throw new Error("Write a message first");
    if (text.length > MAX_POP) throw new Error(`Keep it under ${MAX_POP} characters`);
    p.body = text;
    emit();
    return clone(p);
  },
};

/** The automatic Pop of an event, for its host. */
function autoPop(eventId: string, auto: PopAuto): Pop {
  const e = assertManage(findEvent(eventId));
  const p = S().pops[seedId(`autopop:${e.id}:${auto}`)];
  if (!p) throw new Error("Pop not found");
  return p;
}
