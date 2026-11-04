/**
 * Refusals of the outreach flow. The text is what a person sees, as written. The shared codes live in OUTREACH_REASONS (types.ts);
 * 
 */
import { OUTREACH_REASONS } from "../types";

/** The line for a reason code. An unknown code is shown as it is. */
export const reasonText = (code: string): string => OUTREACH_REASONS[code] ?? code;

/** A refusal. message is the reason text; reason is the code; extra carries detail the desk can use (events and counts). */
export class OutreachError extends Error {
  reason: string;
  events?: { title: string; count: number }[];
  constructor(reason: string, detail?: string, events?: { title: string; count: number }[]) {
    super(detail ? `${reasonText(reason)}: ${detail}` : reasonText(reason));
    this.reason = reason;
    this.events = events;
  }
}

export const fail = (reason: string, detail?: string): never => {
  throw new OutreachError(reason, detail);
};
