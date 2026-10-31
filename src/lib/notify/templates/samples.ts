import { renderEmail, type RenderedEmail } from "./index";
import type { Payload } from "./copy";

/**
 * One sample of every email, for the preview page (/dev/emails) and scripts/notify-emails-check.mts. Made-up people and a made-up
 * ticket token that only looks like a real one (the QR route draws it; no door would take it).
 */

export const SAMPLE_TOKEN = "eyJ0IjoiMDAwMDAwMDAiLCJlIjoiMTExMTExMTEiLCJ2IjoxfQ.U2FtcGxlU2lnbmF0dXJlRm9yUHJldmlld09ubHk";

const event: Payload = {
  event_id: "22222222-2222-4222-8222-222222222222",
  slug: "afro-soiree-4f2a",
  title: "Afro Soirée",
  starts_at: "2026-11-07T18:30:00+00:00",
  ends_at: "2026-11-07T23:30:00+00:00",
  timezone: "Africa/Lagos",
  venue_name: "Terra Kulture, Victoria Island",
  kind: "in_person",
  host_name: "Tolu Adeyemi",
  name: "Ada Okoye",
};

const one = [{ token: SAMPLE_TOKEN, code: "K7M2XQ9R" }];

export type Sample = { label: string; kind: string; payload: Payload; to: string };

const to = "ada@example.com";

export const SAMPLES: Sample[] = [
  { label: "G1 You're going", kind: "registered", payload: { ...event, tickets: one }, to },
  {
    label: "G2 Receipt and ticket",
    kind: "receipt",
    payload: { ...event, quantity: 2, ticket_name: "Early bird", gross_kobo: 1_500_000, fee_kobo: 67_500, order_ref: "ORD-7F3A91C2", tickets: [{ token: SAMPLE_TOKEN, code: "K7M2XQ9R" }, { token: SAMPLE_TOKEN, code: "P4TWN8HC" }] },
    to,
  },
  { label: "G3 Request sent", kind: "request_sent", payload: { ...event }, to },
  { label: "G4 You're in", kind: "approved", payload: { ...event, tickets: one }, to },
  { label: "G5 Not this time", kind: "declined", payload: { ...event }, to },
  { label: "G6 On the waitlist", kind: "waitlisted", payload: { ...event, waitlist_pos: 3 }, to },
  { label: "G7 A spot opened", kind: "spot_opened", payload: { ...event, tickets: one }, to },
  {
    label: "G8 Event changed (time and place)",
    kind: "event_changed",
    payload: { ...event, time_changed: true, place_changed: true, prev_starts_at: "2026-11-07T16:00:00+00:00", prev_timezone: "Africa/Lagos", prev_venue_name: "The Pent Studios, Lekki", prev_kind: "in_person" },
    to,
  },
  { label: "G9 Event cancelled (paid)", kind: "event_cancelled", payload: { ...event, paid: true }, to },
  { label: "G10 Tomorrow", kind: "reminder_day", payload: { ...event }, to },
  { label: "G11 Starting soon", kind: "reminder_hour", payload: { ...event }, to },
  { label: "G12 Host Pop", kind: "host_pop", payload: { ...event, body: "Doors are at 7. Dress code is all black and orange.\nParking is behind the building." }, to },
  { label: "G13 You cancelled", kind: "you_cancelled", payload: { ...event }, to },
  { label: "G14 Refund sent", kind: "refund_sent", payload: { ...event, amount_kobo: 1_500_000, method: "card" }, to },
  { label: "G15 Thanks for coming", kind: "thanks", payload: { ...event, room_name: "Mainland Nights", room_slug: "mainland-nights" }, to },
  { label: "H1 Your event is live", kind: "host_live", payload: { ...event }, to },
  {
    label: "Awkward text (escaping)",
    kind: "registered",
    payload: { ...event, title: `Rooftop <b>& "Friends" <script>alert(1)</script>`, venue_name: "Roof & Co <3", name: `Ada <i>O'Neil</i>`, tickets: one },
    to,
  },
];

export type RenderedSample = Sample & { email: RenderedEmail };

/** `unsubscribeUrl`: the preview passes a clearly fake address so the link can be seen; the real helper answers null until step 3. */
export function renderSamples(opts: { site?: string; now?: Date; unsubscribeUrl?: string | null } = {}): RenderedSample[] {
  return SAMPLES.map((s) => ({ ...s, email: renderEmail(s.kind, s.payload, { to: s.to, site: opts.site, now: opts.now, unsubscribeUrl: opts.unsubscribeUrl }) }));
}
