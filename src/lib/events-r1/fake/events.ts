/** Fake events: list, get, create, edit, clone, cancel, interest, the button state and the registration settings. */
import type { EventsApi } from "../api";
import type { EventDraft, EventKind, LinkType, ViewerState, Visibility } from "../types";
import { VIBES } from "../../brand";
import { areaByName, insideLagos, LAGOS_CENTER, nearestArea } from "../../geo";
import { autoPopsFor, defaultMessages, defaultQuestions } from "./defaults";
import { retimeAutoPops } from "./pops";
import {
  assertManage, canList, canOpen, canSeeLink, eventEnd, eventView, fillFromWaitlist, findEvent, hostRoom,
  isFull, isGoing, isHostOf, regOf, requireViewer, statusOf,
} from "./rules";
import { emit, now, S, subscribe, viewer } from "./store";
import type { EventRec, RegSettings, UserRec } from "./store";
import { clone, DAY, HOUR, lagosAt, newId, slugFor } from "./util";

const KINDS: EventKind[] = ["in_person", "online", "hybrid"];
const LINKS: LinkType[] = ["zoom", "meet", "whatsapp", "other"];
const VISIBILITIES: Visibility[] = ["public", "community", "invite"];
const iso = (ms: number) => new Date(ms).toISOString();

type Fields = Pick<
  EventRec,
  | "title" | "venue_name" | "area" | "lat" | "lng" | "starts_at" | "ends_at" | "timezone" | "kind" | "link_type"
  | "online_link" | "description" | "capacity" | "requires_approval" | "waitlist_on" | "visibility" | "flyer_url" | "vibe"
>;

/** Check a draft and fill every default: a name is enough. */
function normalize(d: EventDraft, roomId: string | null): Fields {
  const title = (d.title ?? "").trim();
  if (!title) throw new Error("Give your event a name");
  if (title.length > 120) throw new Error("Keep the name under 120 characters");

  const start = d.starts_at ? Date.parse(d.starts_at) : lagosAt(now(), 1, "19:00");
  if (!Number.isFinite(start)) throw new Error("Pick a start time");
  let ends: string | null = null;
  if (d.ends_at) {
    const e = Date.parse(d.ends_at);
    if (!Number.isFinite(e) || e <= start) throw new Error("The event cannot end before it starts");
    ends = iso(e);
  }

  const kind = d.kind ?? "in_person";
  if (!KINDS.includes(kind)) throw new Error("Pick In person, Online or Both");

  // Where: online has no place; a place with no coordinates stays off the map (hasVenue is false at LAGOS_CENTER).
  let venue_name = "";
  let area: string | null = null;
  let lat = LAGOS_CENTER.lat;
  let lng = LAGOS_CENTER.lng;
  if (kind !== "online") {
    venue_name = (d.place_name ?? "").trim();
    const a = areaByName(d.area);
    if (typeof d.lat === "number" && typeof d.lng === "number") {
      if (!insideLagos(d.lat, d.lng)) throw new Error("Hoppaz is Lagos only for now");
      lat = d.lat;
      lng = d.lng;
      area = d.area ?? nearestArea(d.lat, d.lng).name;
    } else if (a) {
      lat = a.lat;
      lng = a.lng;
      area = a.name;
    } else {
      area = d.area ?? null;
    }
  }

  // The online link: online and hybrid only.
  let link_type: LinkType | null = null;
  let online_link: string | null = null;
  if (kind !== "in_person") {
    online_link = (d.online_link ?? "").trim() || null;
    if (online_link && !/^https?:\/\//i.test(online_link)) throw new Error("Paste a full link that starts with https://");
    link_type = d.link_type ?? (online_link ? "other" : null);
    if (link_type && !LINKS.includes(link_type)) throw new Error("Pick Zoom, Google Meet, WhatsApp call or Other");
  }

  let capacity: number | null = d.capacity ?? null;
  if (link_type === "whatsapp" && capacity === null) capacity = 32;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) throw new Error("Capacity must be 1 or more");
  if (link_type === "whatsapp" && capacity !== null && capacity > 32) throw new Error("WhatsApp calls hold up to 32 people");

  const visibility = d.visibility ?? "public";
  if (!VISIBILITIES.includes(visibility)) throw new Error("Pick Public, Community or Invite only");
  if (visibility === "community" && !roomId) throw new Error("Community events need a room. Create a room first.");

  return {
    title,
    venue_name,
    area,
    lat,
    lng,
    starts_at: iso(start),
    ends_at: ends,
    timezone: d.timezone || "Africa/Lagos",
    kind,
    link_type,
    online_link,
    description: (d.description ?? "").trim().slice(0, 2000),
    capacity,
    requires_approval: !!d.requires_approval,
    waitlist_on: !!d.waitlist_on,
    visibility,
    flyer_url: d.cover_url ?? null,
    vibe: d.vibe && (VIBES as readonly string[]).includes(d.vibe) ? d.vibe : "culture",
  };
}

/** The silent limit: 5 new events an hour per person. The message is generic on purpose. */
function checkRateLimit(host: UserRec): void {
  const since = now() - HOUR;
  const recent = Object.values(S().events).filter((e) => e.host_id === host.id && Date.parse(e.created_at) > since);
  if (recent.length >= 5) throw new Error("Try again later");
}

function makeEvent(host: UserRec, draft: EventDraft): EventRec {
  checkRateLimit(host);
  const room = draft.add_to_room === false ? null : hostRoom(host.id);
  const f = normalize(draft, room?.id ?? null);
  const id = newId();
  let slug = slugFor(f.title, id);
  while (Object.values(S().events).some((e) => e.slug === slug)) slug = `${slug}x`;
  const rec: EventRec = {
    id,
    ...f,
    price_naira: 0,
    source: "hopper",
    ig_url: null,
    status: "live",
    room_id: room?.id ?? null,
    created_at: iso(now()),
    slug,
    host_id: host.id,
  };
  S().events[id] = rec;
  for (const p of autoPopsFor(rec, host.name)) S().pops[p.id] = p;
  return rec;
}

/** The stored event as a draft, so an edit can be "everything as it was, plus the patch". */
function asDraft(e: EventRec): EventDraft {
  const placed = Math.abs(e.lat - LAGOS_CENTER.lat) > 1e-6 || Math.abs(e.lng - LAGOS_CENTER.lng) > 1e-6;
  return {
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    timezone: e.timezone,
    kind: e.kind,
    place_name: e.venue_name,
    area: e.area,
    lat: placed ? e.lat : null,
    lng: placed ? e.lng : null,
    link_type: e.link_type,
    online_link: e.online_link,
    description: e.description,
    capacity: e.capacity,
    requires_approval: e.requires_approval,
    waitlist_on: e.waitlist_on,
    visibility: e.visibility,
    cover_url: e.flyer_url,
    vibe: e.vibe,
  };
}

const defaultSettings = (): RegSettings => ({ questions: defaultQuestions(), messages: defaultMessages() });

function visibleEvent(idOrSlug: string): EventRec {
  const e = findEvent(idOrSlug);
  if (!e || !canOpen(e)) throw new Error("Event not found");
  return e;
}

/** Upcoming first (soonest first), then past (most recent first). */
function upcomingThenPast(list: EventRec[]): EventRec[] {
  const t = now();
  const up = list.filter((e) => eventEnd(e) >= t).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = list.filter((e) => eventEnd(e) < t).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return [...up, ...past];
}

export function viewerStateFor(e: EventRec): ViewerState {
  const v = viewer();
  const reg = v ? regOf(e.id, v.id) : undefined;
  const active = reg && reg.status !== "cancelled" ? reg : null;
  const isHost = isHostOf(e);
  const see = canSeeLink(e);
  const t = now();
  const start = Date.parse(e.starts_at);
  const end = e.ends_at ? Date.parse(e.ends_at) : start + 3 * HOUR;
  const status = statusOf(e);

  let button: ViewerState["button"];
  if (status !== "live") button = "closed";
  else if (active) {
    button = isGoing(active.status) ? "going" : active.status === "requested" ? "pending" : active.status === "waitlisted" ? "waitlisted" : "declined";
  } else if (e.price_naira > 0) button = "get_ticket";
  else if (isFull(e)) button = e.waitlist_on ? "waitlist" : "closed";
  else button = e.requires_approval ? "request" : "register";

  return {
    signedIn: !!v,
    isHost,
    interested: !!S().interest[`${v?.id ?? "guest"}:${e.id}`],
    registration: active ? clone(active) : null,
    button,
    canSeeOnlineLink: see,
    // Join call: 15 minutes before the start until the end, for someone who can have the link.
    joinCallOpen: see && e.kind !== "in_person" && status === "live" && t >= start - 15 * 60_000 && t <= end,
  };
}

export const events: EventsApi = {
  async list() {
    const t = now();
    return Object.values(S().events)
      .filter((e) => {
        if (e.status === "cancelled" || !canList(e)) return false;
        const s = Date.parse(e.starts_at);
        return s >= t - 4 * HOUR && s <= t + 45 * DAY;
      })
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((e) => eventView(e));
  },

  async get(idOrSlug) {
    const e = findEvent(idOrSlug);
    return e && canOpen(e) ? eventView(e) : null;
  },

  async listMine() {
    const v = viewer();
    if (!v) return [];
    return upcomingThenPast(Object.values(S().events).filter((e) => e.host_id === v.id)).map((e) => eventView(e));
  },

  async listForRoom(roomId) {
    return upcomingThenPast(Object.values(S().events).filter((e) => e.room_id === roomId && (isHostOf(e) || (e.status !== "cancelled" && canList(e))))).map((e) => eventView(e));
  },

  async create(draft) {
    const host = requireViewer();
    const rec = makeEvent(host, draft);
    emit();
    return eventView(rec);
  },

  async update(id, patch) {
    const e = assertManage(findEvent(id));
    const merged: EventDraft = { ...asDraft(e) };
    for (const [k, val] of Object.entries(patch)) if (val !== undefined) (merged as Record<string, unknown>)[k] = val;
    // A new place name or area without coordinates: the old coordinates no longer fit.
    if (("place_name" in patch || "area" in patch) && !("lat" in patch) && !("lng" in patch)) {
      merged.lat = null;
      merged.lng = null;
    }
    const before = { start: e.starts_at, capacity: e.capacity, approval: e.requires_approval };
    Object.assign(e, normalize(merged, e.room_id));
    if (e.starts_at !== before.start) retimeAutoPops(e);
    if ((e.capacity === null || (before.capacity !== null && e.capacity > before.capacity)) || e.requires_approval !== before.approval) {
      fillFromWaitlist(e.id);
    }
    emit();
    return eventView(e);
  },

  async clone(id) {
    const src = assertManage(findEvent(id));
    const host = requireViewer();
    const draft = asDraft(src);
    draft.starts_at = iso(Date.parse(src.starts_at) + 7 * DAY);
    draft.ends_at = src.ends_at ? iso(Date.parse(src.ends_at) + 7 * DAY) : null;
    const rec = makeEvent(host, draft);
    const s = S().regSettings[src.id];
    if (s) S().regSettings[rec.id] = clone(s);
    emit();
    return eventView(rec);
  },

  async cancel(id) {
    const e = assertManage(findEvent(id));
    e.status = "cancelled";
    emit();
    return eventView(e);
  },

  async setInterested(id, on) {
    const e = visibleEvent(id);
    S().interest[`${viewer()?.id ?? "guest"}:${e.id}`] = on;
    emit();
  },

  async viewerState(id) {
    return viewerStateFor(visibleEvent(id));
  },

  async getRegistrationSettings(id) {
    const e = visibleEvent(id);
    return clone(S().regSettings[e.id] ?? defaultSettings());
  },

  async setRegistrationSettings(id, s) {
    const e = assertManage(findEvent(id));
    const cur = clone(S().regSettings[e.id] ?? defaultSettings());
    if (s.questions) {
      const ids = new Set<string>();
      for (const q of s.questions) {
        if (!q.label.trim()) throw new Error("Every question needs a label");
        if (ids.has(q.id)) throw new Error("Two questions have the same id");
        ids.add(q.id);
      }
      // Name and Email are always asked, and always required.
      const qs = s.questions.map((q) => (q.builtin === "name" || q.builtin === "email" ? { ...q, required: true, enabled: true } : q));
      for (const b of ["name", "email"] as const) if (!qs.some((q) => q.builtin === b)) throw new Error("Name and Email cannot be removed");
      cur.questions = clone(qs);
    }
    if (s.messages) cur.messages = { ...cur.messages, ...s.messages };
    S().regSettings[e.id] = cur;
    emit();
  },

  subscribe,
};
