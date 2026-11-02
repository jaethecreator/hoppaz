/**
 * Message drafts for staff to copy into Instagram, WhatsApp or email. Pure text: nothing here sends anything.
 * Rules the drafts keep: short lines, sentence case, plain English, never more than is true (Hoppaz only lists public details and links to
 * the organiser's own ticket page), and the opt-out line in every one.
 */

export type DraftStage = "first" | "offer" | "follow_up" | "claimed" | "declined";
export type DraftChannel = "instagram" | "whatsapp" | "email";

export type DraftInput = {
  stage: DraftStage;
  channel: DraftChannel;
  organiser: { name: string; ig_handle?: string | null };
  /** Their events on Hoppaz (or the ones being offered). Up to three are named. */
  events: { title: string; starts_at?: string | null }[];
  /** The organiser's room name on Hoppaz. */
  roomName: string;
  /** The claim link, for the offer. */
  link?: string;
  /** Who is writing. */
  staffName: string;
};

export type Draft = { subject?: string; body: string };

/** The line every draft carries. */
export const OPT_OUT = "Not for you? Reply STOP and we will take it down.";

function when(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

function eventLines(events: DraftInput["events"]): string[] {
  const shown = events.slice(0, 3).map((e) => {
    const d = when(e.starts_at);
    return d ? `${e.title}, ${d}` : e.title;
  });
  const more = events.length - shown.length;
  return more > 0 ? [...shown, `and ${more} more`] : shown;
}

function greeting(input: DraftInput): string {
  return input.channel === "instagram" ? `Hello ${input.organiser.name} team,` : `Hi ${input.organiser.name},`;
}

function signOff(input: DraftInput): string {
  return input.channel === "email" ? `${input.staffName}\nHoppaz, Lagos` : `${input.staffName}, Hoppaz`;
}

/** The message for one step of the outreach, on one channel. */
export function draftFor(input: DraftInput): Draft {
  const { stage, channel, events, roomName, link } = input;
  const list = eventLines(events);
  const plural = events.length > 1;
  const the = plural ? "your events" : "your event";
  const lines: string[] = [greeting(input), ""];
  let subject: string;

  if (stage === "first") {
    subject = `We listed ${the} on Hoppaz`;
    lines.push(
      `We run Hoppaz, an app for what is on in Lagos.`,
      `We listed ${the} so people can find ${plural ? "them" : "it"}:`,
      ...list.map((l) => `- ${l}`),
      "",
      `We only show what is already public: the name, date, place and price.`,
      `The Get tickets button goes straight to your own ticket page. Nobody buys on Hoppaz.`,
      "",
      `If you want, you can take the page over for free. You can fix any detail, and add a room for your crowd.`,
      `Reply and I will send the link.`,
      "",
      OPT_OUT,
    );
  } else if (stage === "offer") {
    subject = `Your Hoppaz page is ready to take over`;
    lines.push(
      `Thanks for replying. Your page is ready:`,
      ...list.map((l) => `- ${l}`),
      "",
      `Open this link and sign in with the email I have for you. It works once.`,
      link ?? "(the link goes here)",
      "",
      `You will get the room "${roomName}" and ${plural ? "your events" : "the event"}.`,
      `Ticket sales stay on your own page unless you choose to sell on Hoppaz.`,
      "",
      OPT_OUT,
    );
  } else if (stage === "follow_up") {
    subject = `Quick follow up about ${the} on Hoppaz`;
    lines.push(
      `Just checking you saw my last message about ${the} on Hoppaz.`,
      ...list.map((l) => `- ${l}`),
      "",
      `Nothing to do if you are happy as it is. The listing stays up and goes to your ticket page.`,
      `If you want to fix a detail or take over the page, reply and I will help.`,
      "",
      OPT_OUT,
    );
  } else if (stage === "claimed") {
    subject = `You are in: ${roomName} on Hoppaz`;
    lines.push(
      `Welcome. ${roomName} is yours now.`,
      ...(list.length ? [`${plural ? "Your events are" : "Your event is"} under your name:`, ...list.map((l) => `- ${l}`)] : []),
      "",
      `You can edit details, post updates to your crowd and, when you are ready, sell tickets on Hoppaz.`,
      `Until then, tickets stay on your own page.`,
      `Anything not right, reply to me here.`,
      "",
      `Want us to take anything down? Reply STOP and we will do it.`,
    );
  } else {
    subject = `Done: ${the} removed from Hoppaz`;
    lines.push(
      `Understood, and sorry for the bother.`,
      `We have removed ${the} from Hoppaz and we will not list you again or message you.`,
      "",
      `If you still see anything of yours, reply STOP and we will remove it straight away.`,
    );
  }

  lines.push("", signOff(input));
  return channel === "email" ? { subject, body: lines.join("\n") } : { body: lines.join("\n") };
}
