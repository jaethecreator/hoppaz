/** Small pure helpers for the Release 1 door scan: the words on the banners, and the time a guest came in. */
import type { ScanResult } from "@/lib/events-r1/types";

type NotValid = Extract<ScanResult, { kind: "not_valid" }>["reason"];

/** Why a code is not valid, in plain words for a door person. */
export const NOT_VALID_WORDS: Record<NotValid, string> = {
  bad_signature: "This is not a real Hoppaz ticket. It may be fake or damaged.",
  wrong_event: "This ticket is for a different event.",
  void: "This ticket was cancelled.",
  unknown: "We can't find this ticket.",
  not_going: "This person is not going. They may still be waiting for approval, or on the waitlist.",
};

/** "19:42" in Lagos time (24 hour clock, like the rest of the Release 1 screens). */
export function lagosClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(d);
}

/**
 * A person with several tickets checks in one ticket at a time. The data layer may say which one this is
 * (ticket_no of ticket_of); until it does, nothing shows and the banner is the same as for one ticket.
 */
export function ticketCount(r: ScanResult): string | null {
  const x = r as { ticket_no?: number; ticket_of?: number };
  return typeof x.ticket_no === "number" && typeof x.ticket_of === "number" && x.ticket_of > 1 ? `${x.ticket_no} of ${x.ticket_of} tickets` : null;
}

/** A thrown layer error as one short line. */
export function errLine(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (m === "Sign in first") return "Sign in to check people in.";
  if (m === "Not allowed") return "Only the host and door staff can check people in.";
  return m || "That did not work. Try again.";
}
