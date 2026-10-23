/** Default texts and settings shared by the seed and the rules: automatic Pops, registration questions and messages. */
import type { Pop, PopAuto, RegMessages, RegQuestion } from "../types";
import { HOUR, seedId } from "./util";

export const AUTO_KINDS: PopAuto[] = ["day_before", "hour_before", "doors_open"];

export function autoSendAt(kind: PopAuto, startsAt: string): string {
  const t = Date.parse(startsAt);
  return new Date(kind === "day_before" ? t - 24 * HOUR : kind === "hour_before" ? t - HOUR : t).toISOString();
}

const lagosTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });

export function autoText(kind: PopAuto, title: string, startsAt: string, online: boolean): string {
  if (kind === "day_before") {
    return `Tomorrow at ${lagosTime(startsAt)}: ${title}. ${online ? "The call link is on the event page." : "See you there."}`;
  }
  if (kind === "hour_before") return `${title} starts in 1 hour.`;
  return online ? `The call for ${title} is open. Join from the event page.` : `Doors are open for ${title}.`;
}

/** The three automatic Pops of an event: scheduled rows, on, with the default text. */
export function autoPopsFor(ev: { id: string; title: string; starts_at: string; kind: string }, author: string): Pop[] {
  return AUTO_KINDS.map((auto) => ({
    id: seedId(`autopop:${ev.id}:${auto}`),
    event_id: ev.id,
    event_title: ev.title,
    author_name: author,
    body: autoText(auto, ev.title, ev.starts_at, ev.kind === "online"),
    audience: "going",
    also_room: false,
    send_at: autoSendAt(auto, ev.starts_at),
    sent_at: null,
    status: "scheduled",
    auto,
    recipients: 0,
  }));
}

export function defaultQuestions(): RegQuestion[] {
  return [
    { id: "name", label: "Name", required: true, builtin: "name", enabled: true },
    { id: "email", label: "Email", required: true, builtin: "email", enabled: true },
    { id: "phone", label: "Phone", required: false, builtin: "phone", enabled: false },
  ];
}

export function defaultMessages(): RegMessages {
  return {
    pending: "Your request is in. The host will let you know soon.",
    going: "You're in. See you there.",
    declined: "Sorry, the host can't take your request this time.",
  };
}
