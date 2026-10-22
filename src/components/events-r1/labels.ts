/**
 * The one button on an event, as words. Pure, so the map panel, the Events sheet and the event page say the same thing.
 * With a viewer state (useViewerState) the label follows what the person has done; without one (not loaded yet, or a
 * build with no data layer) it is worked out from the event alone, as if nobody had registered.
 */
import type { R1Event, TicketType, ViewerState } from "@/lib/events-r1/types";

export type ButtonKind = ViewerState["button"];

export type RegisterLabel = {
  kind: ButtonKind;
  text: string;
  /** Nothing to tap: paid events while paid tickets are off, and closed ones. */
  disabled: boolean;
  /** The person is already in the loop (in, pending, on the waitlist): shown as a status, not a call to act. */
  status: boolean;
};

const TEXT: Record<ButtonKind, string> = {
  register: "Register",
  request: "Request to join",
  waitlist: "Join waitlist",
  get_ticket: "Get ticket",
  going: "You're in",
  pending: "Pending",
  waitlisted: "On the waitlist",
  declined: "Closed",
  closed: "Closed",
};

/** What the button would be with no viewer state: the event's own rules. */
export function buttonFromEvent(
  e: Pick<R1Event, "status" | "price_naira" | "capacity" | "spots_left" | "waitlist_on" | "requires_approval"> & { ticket_types?: Pick<TicketType, "price_naira" | "spots_left">[] }
): ButtonKind {
  if (e.status !== "live") return "closed";
  // With ticket types, only the free ones can be taken: every one paid is Get ticket, every free one full is the waitlist or closed.
  const free = e.ticket_types?.filter((t) => t.price_naira === 0);
  if (free ? free.length === 0 : e.price_naira > 0) return "get_ticket";
  if (free ? free.every((t) => t.spots_left === 0) : e.capacity !== null && e.spots_left === 0) return e.waitlist_on ? "waitlist" : "closed";
  return e.requires_approval ? "request" : "register";
}

/** `pay.on` is paidTicketsOn(): with it off Get ticket stays disabled (Currently unavailable); with it on a paid ticket can be bought. */
export function registerLabel(
  state: Pick<ViewerState, "button"> | null | undefined,
  event?: Parameters<typeof buttonFromEvent>[0] | null,
  pay?: { on: boolean }
): RegisterLabel {
  const kind: ButtonKind = state?.button ?? (event ? buttonFromEvent(event) : "register");
  return {
    kind,
    text: TEXT[kind],
    disabled: (kind === "get_ticket" && !pay?.on) || kind === "closed" || kind === "declined",
    status: kind === "going" || kind === "pending" || kind === "waitlisted",
  };
}
