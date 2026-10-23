/** Small words for the Pops tab. Pure. */
import type { Pop, PopAudience, PopAuto, R1Event } from "@/lib/events-r1/types";

/** The longest a Pop may be (the room Announcements use the same). */
export const POP_MAX = 280;
/** The counter shows from here. */
export const COUNTER_FROM = 240;

/** The chips of "To". */
export const AUDIENCES: Array<{ value: PopAudience; label: string }> = [
  { value: "going", label: "Everyone going" },
  { value: "pending", label: "Pending" },
  { value: "waitlist", label: "Waitlist" },
];

/** "To everyone going", "To people pending", "To the waitlist". */
export function toWord(a: PopAudience): string {
  return a === "going" ? "To everyone going" : a === "pending" ? "To people pending" : a === "waitlist" ? "To the waitlist" : "To everyone";
}

export const peopleWord = (n: number) => `${n.toLocaleString("en-NG")} ${n === 1 ? "person" : "people"}`;

/** The three automatic Pops, in the order they go out. */
export const AUTO_ORDER: PopAuto[] = ["day_before", "hour_before", "doors_open"];

export function autoLabel(a: PopAuto, kind: R1Event["kind"]): string {
  return a === "day_before" ? "Day before" : a === "hour_before" ? "1 hour before" : kind === "online" ? "Call opens" : "Doors open";
}

export type AutoState = "scheduled" | "sent" | "off";
export const autoState = (p: Pop): AutoState => (p.status === "sent" ? "sent" : p.enabled === false ? "off" : "scheduled");
