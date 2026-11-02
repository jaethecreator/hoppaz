/**
 * The outreach flow's refusals as words, shared by the staff route and the client. Pure: no imports but the types, so a route handler
 * and a Node script can load it. The shared table is OUTREACH_REASONS (types.ts);
 */
import { OUTREACH_REASONS } from "../types";

type Extra = { events?: { title?: unknown; count?: unknown }[] } | null | undefined;

/** The text for a reason code. has_registrations names the events and how many people each holds. An unknown code is a plain "That did not work". */
export function outreachReason(reason: unknown, extra?: Extra): string {
  const code = String(reason ?? "");
  const base = OUTREACH_REASONS[code];
  if (!base) return "That did not work. Try again";
  if (code === "has_registrations" && Array.isArray(extra?.events) && extra.events.length) {
    const names = extra.events.slice(0, 5).map((e) => `${String(e.title ?? "An event")} (${Number(e.count) || 0})`).join(", ");
    return `${base}: ${names}`;
  }
  return base;
}

/** Reason code to HTTP status for the staff route. */
export function outreachStatus(reason: unknown): number {
  switch (String(reason ?? "")) {
    case "not_found":
      return 404;
    case "has_registrations":
    case "already_pending":
    case "paid_sales":
    case "is_claimed":
    case "handle_taken":
    case "organiser_declined":
    case "blocked":
    case "not_open":
    case "already_handled":
      return 409;
    case "no_listings_account":
      return 503;
    case "try_again_later":
      return 429;
    default:
      return 400;
  }
}
