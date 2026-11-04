import { firstName, formatWhen, naira, oneLine } from "./format";
import type { Doc, DocTicket } from "./layout";

/**
 * The words of every email, one builder per kind (docs/reminders-email-plan.md section 2: G1 to G15 and H1). Short, plain and warm,
 * never promotional. A builder gets the row's payload (what the database trigger put there, see supabase/events_r1_notify_emails.sql)
 * and answers the subject and a Doc; layout.ts draws it. Anything the payload lacks is left out, never printed as "undefined".
 */

export type Payload = Record<string, unknown>;
export type CopyContext = { payload: Payload; site: string; now: Date; unsubscribeUrl: string | null };
export type Built = { subject: string; doc: Doc };

const s = (p: Payload, k: string): string => (typeof p[k] === "string" ? (p[k] as string).trim() : typeof p[k] === "number" ? String(p[k]) : "");
const flag = (p: Payload, k: string): boolean => p[k] === true;
const num = (p: Payload, k: string): number | null => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null);

function ticketsOf(p: Payload): DocTicket[] {
  if (!Array.isArray(p.tickets)) return [];
  const out: DocTicket[] = [];
  for (const raw of p.tickets) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const token = typeof t.token === "string" && t.token ? t.token : undefined;
    const code = typeof t.code === "string" && t.code ? t.code : undefined;
    if (token || code) out.push({ token, code });
  }
  return out;
}

const ANNOUNCED = /^to be announced$/i;
const ONLINE = /^online$/i;

/** "Terra Kulture, Victoria Island", "Online", "Venue and online", "Place to be announced", or "". */
export function whereText(p: Payload, venueKey = "venue_name", kindKey = "kind"): string {
  const venue = s(p, venueKey);
  const kind = s(p, kindKey);
  const online = (kindKey === "kind" && flag(p, "online")) || kind === "online" || ONLINE.test(venue);
  if (online) return "Online";
  if (!venue) return "";
  if (ANNOUNCED.test(venue)) return "Place to be announced";
  return kind === "hybrid" ? `${venue} and online` : venue;
}

const titleOf = (p: Payload) => s(p, "title") || "your event";

function factsLine(p: Payload, now: Date): string {
  const when = formatWhen(p.starts_at, p.timezone, now);
  return [when, whereText(p)].filter(Boolean).join(" · ");
}

function eventBlock(p: Payload, now: Date): Doc["event"] {
  return { title: titleOf(p), facts: factsLine(p, now) };
}

/** The event page: it shows the ticket and everything else. Slug when there is one, else the id. */
export function eventUrl(p: Payload, site: string): string {
  const ref = s(p, "slug") || s(p, "event_id");
  return ref ? `${site}/event/${encodeURIComponent(ref)}` : site;
}

const cap1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/** "Hey Ada, you're going." with a name, "You're going." without. */
const say = (p: Payload, text: string): string => {
  const n = firstName(p.name);
  return n ? `Hey ${n}, ${text}` : cap1(text);
};

function base(c: CopyContext, d: Omit<Doc, "unsubscribeUrl" | "event"> & { event?: Doc["event"] | false }, withUnsub = false): Doc {
  const { event, ...rest } = d;
  return { ...rest, event: event === false ? undefined : (event ?? eventBlock(c.payload, c.now)), unsubscribeUrl: withUnsub ? c.unsubscribeUrl : null };
}

const subj = (t: string) => oneLine(t);

export const BUILDERS: Record<string, (c: CopyContext) => Built> = {
  // G1
  registered(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`You're going to ${t}`),
      doc: base(c, {
        preheader: `Your ticket for ${t} is inside.`,
        eyebrow: "You're going",
        headline: "You're on the list.",
        paragraphs: [say(p, `you're going to ${t}. Show this at the door.`)],
        tickets: ticketsOf(p),
        button: { label: "View ticket", url: eventUrl(p, c.site) },
        reason: `You're getting this because you registered for ${t} on Hoppaz.`,
      }),
    };
  },
  // G2
  receipt(c) {
    const p = c.payload;
    const t = titleOf(p);
    const qty = num(p, "quantity") ?? 1;
    const name = s(p, "ticket_name") || "Ticket";
    const rows: Array<[string, string]> = [];
    const gross = naira(p.gross_kobo);
    if (gross) rows.push([`${qty} x ${name}`, gross]);
    const fee = naira(p.fee_kobo);
    if (fee && Number(p.fee_kobo) > 0) rows.push(["Card or transfer fee", fee]);
    const total = typeof p.gross_kobo === "number" && typeof p.fee_kobo === "number" && p.fee_kobo > 0 ? naira(p.gross_kobo + p.fee_kobo) : null;
    if (total) rows.push(["Total paid", total]);
    const ref = s(p, "order_ref");
    if (ref) rows.push(["Order", ref]);
    return {
      subject: subj(`Your receipt and ticket for ${t}`),
      doc: base(c, {
        preheader: `Payment received for ${t}. Your ticket is inside.`,
        eyebrow: "Receipt",
        headline: "Payment received.",
        paragraphs: [say(p, `thank you. Here is your receipt and your ${qty > 1 ? "tickets" : "ticket"}.`)],
        rows,
        tickets: ticketsOf(p),
        button: { label: "View ticket", url: eventUrl(p, c.site) },
        reason: `You're getting this receipt because you bought a ticket for ${t} on Hoppaz.`,
      }),
    };
  },
  // G3
  request_sent(c) {
    const p = c.payload;
    const t = titleOf(p);
    const host = s(p, "host_name");
    return {
      subject: subj(`Your request for ${t} is in`),
      doc: base(c, {
        preheader: "Nothing to do until the host decides.",
        eyebrow: "Request sent",
        headline: "Request sent.",
        paragraphs: [say(p, `${host ? host : "the host"} has to approve guests for this one. We'll email you as soon as they decide. Nothing to do until then.`)],
        button: { label: "View event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you asked to join ${t} on Hoppaz.`,
      }),
    };
  },
  // G4
  approved(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`You're in for ${t}`),
      doc: base(c, {
        preheader: `The host said yes. Your ticket for ${t} is inside.`,
        eyebrow: "Approved",
        headline: "You're in.",
        paragraphs: [say(p, `the host said yes. Your ticket is below. Show it at the door.`)],
        tickets: ticketsOf(p),
        button: { label: "View ticket", url: eventUrl(p, c.site) },
        reason: `You're getting this because you asked to join ${t} on Hoppaz.`,
      }),
    };
  },
  // G5
  declined(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`About your request for ${t}`),
      doc: base(c, {
        preheader: "The host couldn't take you this time.",
        eyebrow: "Update",
        headline: "Not this time.",
        paragraphs: [say(p, `the host couldn't fit you in for this one. There is plenty more going on in Lagos.`)],
        button: { label: "See what's on", url: c.site },
        reason: `You're getting this because you asked to join ${t} on Hoppaz.`,
      }),
    };
  },
  // G6
  waitlisted(c) {
    const p = c.payload;
    const t = titleOf(p);
    const pos = num(p, "waitlist_pos");
    return {
      subject: subj(`You're on the waitlist for ${t}`),
      doc: base(c, {
        preheader: "We'll email you the moment a spot opens.",
        eyebrow: "Waitlist",
        headline: "You're on the waitlist.",
        paragraphs: [
          say(p, `this one is full for now.${pos ? ` You're number ${pos} in line.` : ""} If a spot opens, we'll email you straight away.`),
        ],
        button: { label: "View event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you joined the waitlist for ${t} on Hoppaz.`,
      }),
    };
  },
  // G7
  spot_opened(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`A spot opened up for ${t}`),
      doc: base(c, {
        preheader: `You're off the waitlist. Your ticket for ${t} is inside.`,
        eyebrow: "A spot opened",
        headline: "A spot opened up.",
        paragraphs: [say(p, `you're off the waitlist and you're going. Your ticket is below.`)],
        tickets: ticketsOf(p),
        button: { label: "View ticket", url: eventUrl(p, c.site) },
        reason: `You're getting this because you were on the waitlist for ${t} on Hoppaz.`,
      }),
    };
  },
  // G8
  event_changed(c) {
    const p = c.payload;
    const t = titleOf(p);
    const rows: Array<[string, string]> = [];
    const timeNow = formatWhen(p.starts_at, p.timezone, c.now);
    if (flag(p, "time_changed") && timeNow) {
      const was = formatWhen(p.prev_starts_at, p.prev_timezone ?? p.timezone, c.now);
      if (was) rows.push(["Was", was]);
      rows.push(["Now", timeNow]);
    }
    if (flag(p, "place_changed")) {
      const was = whereText({ venue_name: p.prev_venue_name, kind: p.prev_kind });
      const now = whereText(p);
      if (was) rows.push(["Was at", was]);
      if (now) rows.push(["Now at", now]);
    }
    const what = [flag(p, "time_changed") ? "time" : "", flag(p, "place_changed") ? "place" : "", flag(p, "link_changed") ? "link" : ""].filter(Boolean);
    const paragraphs = [say(p, `the ${what.length ? what.join(" and ") : "plan"} for ${t} changed.`)];
    if (flag(p, "link_changed")) paragraphs.push("The link to join changed too. You'll find the new one on the event page.");
    paragraphs.push("Your ticket still works. If the new plan doesn't suit you, you can cancel on the event page.");
    return {
      subject: subj(`${t} has changed`),
      doc: base(c, {
        preheader: what.length ? `The ${what.join(" and ")} changed.` : "The plan changed.",
        eyebrow: "Event changed",
        headline: "The plan changed.",
        paragraphs,
        rows,
        button: { label: "View event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you're signed up for ${t} on Hoppaz.`,
      }),
    };
  },
  // G9
  event_cancelled(c) {
    const p = c.payload;
    const t = titleOf(p);
    const paragraphs = [say(p, `the host has cancelled ${t}. Sorry about that.`)];
    if (flag(p, "paid")) paragraphs.push("You paid for a ticket, so you'll be refunded. We'll email you again when the refund is sent.");
    return {
      subject: subj(`${t} is cancelled`),
      doc: base(c, {
        preheader: flag(p, "paid") ? "You'll get a refund." : "The host has cancelled this event.",
        eyebrow: "Cancelled",
        headline: "This one's off.",
        paragraphs,
        button: { label: "See what's on", url: c.site },
        reason: `You're getting this because you're signed up for ${t} on Hoppaz.`,
      }),
    };
  },
  // G10
  reminder_day(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`Tomorrow: ${t}`),
      doc: base(
        c,
        {
          preheader: `${t} is tomorrow.`,
          eyebrow: "Tomorrow",
          headline: "See you tomorrow.",
          paragraphs: [say(p, `${t} is tomorrow. Your ticket is on the event page.`)],
          button: { label: "View ticket", url: eventUrl(p, c.site) },
          reason: `You're getting this reminder because you're going to ${t}.`,
        },
        true,
      ),
    };
  },
  // G11
  reminder_hour(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`Starting soon: ${t}`),
      doc: base(
        c,
        {
          preheader: `${t} starts in about an hour.`,
          eyebrow: "Starting soon",
          headline: "Starts in about an hour.",
          paragraphs: [say(p, `${t} starts in about an hour. Have your ticket ready.`)],
          button: { label: "View ticket", url: eventUrl(p, c.site) },
          reason: `You're getting this reminder because you're going to ${t}.`,
        },
        true,
      ),
    };
  },
  // G12
  host_pop(c) {
    const p = c.payload;
    const t = titleOf(p);
    const host = s(p, "host_name");
    return {
      subject: subj(host ? `${host} sent a message about ${t}` : `A message about ${t}`),
      doc: base(
        c,
        {
          preheader: oneLine(s(p, "body"), 90) || `A message about ${t}.`,
          eyebrow: host ? `From ${host}` : "From the host",
          headline: "A message from the host.",
          paragraphs: [s(p, "body") || "The host sent you a message. Open the event page to read it."],
          button: { label: "View event", url: eventUrl(p, c.site) },
          reason: `You're getting this because you're signed up for ${t} on Hoppaz.`,
        },
        true,
      ),
    };
  },
  // G13
  you_cancelled(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`You cancelled ${t}`),
      doc: base(c, {
        preheader: "You're off the list.",
        eyebrow: "Cancelled",
        headline: "You're off the list.",
        paragraphs: [say(p, `we've cancelled your spot for ${t}. If you change your mind, you can register again while there's room.`)],
        button: { label: "View event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you cancelled your spot for ${t} on Hoppaz.`,
      }),
    };
  },
  // G14
  refund_sent(c) {
    const p = c.payload;
    const t = titleOf(p);
    const amount = naira(p.amount_kobo);
    const manual = s(p, "method") === "manual";
    return {
      subject: subj(`Your refund for ${t}`),
      doc: base(c, {
        preheader: amount ? `${amount} is on its way back to you.` : "Your refund is on its way.",
        eyebrow: "Refund",
        headline: "Refund sent.",
        paragraphs: [
          say(
            p,
            `${amount ? `${amount} for` : "your refund for"} ${t} is on its way back to you.` +
              (manual ? " The host has paid it back by bank transfer." : " Card refunds can take a few days to show up."),
          ),
        ],
        button: { label: "View event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you bought a ticket for ${t} on Hoppaz.`,
      }),
    };
  },
  // G15
  thanks(c) {
    const p = c.payload;
    const t = titleOf(p);
    const room = s(p, "room_name");
    const roomSlug = s(p, "room_slug");
    const paragraphs = [say(p, `thanks for coming to ${t}. We hope it was a good one.`)];
    const after = room && roomSlug ? [`The ${room} room is still open if you want to keep talking: ${c.site}/rooms/${encodeURIComponent(roomSlug)}`] : undefined;
    return {
      subject: subj(`Thanks for coming to ${t}`),
      doc: base(
        c,
        {
          preheader: "Thanks for coming.",
          eyebrow: "Thanks",
          headline: "Thanks for coming.",
          paragraphs,
          button: { label: "See what's next", url: c.site },
          after,
          reason: `You're getting this because you came to ${t}.`,
        },
        true,
      ),
    };
  },
  // H1
  host_live(c) {
    const p = c.payload;
    const t = titleOf(p);
    return {
      subject: subj(`${t} is live`),
      doc: base(c, {
        preheader: "Share the link and people can register.",
        eyebrow: "Your event",
        headline: "Your event is live.",
        paragraphs: ["Share this link and people can register. You'll see everyone who signs up in your host page."],
        button: { label: "Open your event", url: eventUrl(p, c.site) },
        reason: `You're getting this because you published ${t} on Hoppaz.`,
      }),
    };
  },
};

/** The kinds that carry an unsubscribe link and the List-Unsubscribe headers. Tickets, receipts, changes and cancellations never do. */
export const UNSUBSCRIBE_KINDS = ["reminder_day", "reminder_hour", "host_pop", "thanks"] as const;

