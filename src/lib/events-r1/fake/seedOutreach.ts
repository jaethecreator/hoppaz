/**
 * The outreach part of the seed: the Hoppaz Listings account, six organisers (one in every stage), their listings and dormant rooms, a
 * pending transfer link, one "Is this your event?" request and a review queue of six rows. Every name, link and number is made up.
 * Self-contained on purpose: store.ts imports the seed, so nothing here may import the store.
 *
 * Demo link: open /claim/<DEMO_CLAIM_TOKEN> and sign in as DEMO_CLAIM_EMAIL (any new account with that email works).
 */
import { sha256HexSync } from "../outreach/token";
import { nameKey } from "../outreach/match";
import type { OrganiserLogEntry, OrganiserLogKind, PulledFlag, PulledStatus, ScoutEvent, OrganiserStage } from "../types";
import { listingFields } from "./listingRec";
import type { EventRec, FakeState, OrganiserRec, PulledRec, RoomRec, TransferRec } from "./store";
import { DAY, HOUR, lagosAt, seedId, slugFor } from "./util";

export const LISTINGS_USER_ID = seedId("user:hoppaz-listings");
export const TOLA_USER_ID = seedId("user:tola-ajayi");
export const DEMO_CLAIM_TOKEN = "demo-claim-afro-island-parties-0001";
export const DEMO_CLAIM_EMAIL = "bookings@afroisland.example.com";

/** A scout row with the unknowns left unknown. */
function scout(p: Partial<ScoutEvent> & Pick<ScoutEvent, "source_site" | "source_id" | "name">): ScoutEvent {
  return {
    starts_at: null, ends_at: null, venue: null, area: null, lat: null, lng: null, pin_by: null, description: "", tickets: [], sold_out: false,
    ticket_url: null, flyer_url: null, category: null, organiser_name: null, organiser_handle: null, event_handle: null, organiser_email: null,
    organiser_phone: null, lineup: [], capacity: null, last_seen: "", confidence: "confirmed",
    ...p,
  };
}

export function seedOutreach(st: FakeState, now: number): void {
  const iso = (ms: number) => new Date(ms).toISOString();
  const at = (day: number, hhmm: string) => lagosAt(now, day, hhmm);

  st.users[LISTINGS_USER_ID] = { id: LISTINGS_USER_ID, name: "Hoppaz Listings", email: "listings@hoppaz.example.com", hidden: true };
  st.users[TOLA_USER_ID] = { id: TOLA_USER_ID, name: "Tola Ajayi", email: "tola.ajayi@example.com" };
  st.listingsUserId = LISTINGS_USER_ID;

  const O = {
    lekki: seedId("organiser:lekki-social-club"),
    mic: seedId("organiser:mainland-mic-collective"),
    afro: seedId("organiser:afrobeats-island-parties"),
    detty: seedId("organiser:detty-december-collective"),
    wavy: seedId("organiser:wavy-nights-lagos"),
    sound: seedId("organiser:surulere-sound-collective"),
  };
  const R = {
    lekki: seedId("room:lekki-social-club"),
    mic: seedId("room:mainland-mic-collective"),
    afro: seedId("room:afrobeats-island-parties"),
    sound: seedId("room:surulere-sound-collective"),
  };

  /* Organisers. */
  const org = (key: keyof typeof O, name: string, ig: string | null, stage: OrganiserStage, extra: Partial<OrganiserRec> = {}) => {
    st.organisers[O[key]] = {
      id: O[key], name, name_key: nameKey(name), ig_handle: ig, handles: ig ? { instagram: ig } : {}, email: null, phone: null, room_id: null, stage,
      do_not_contact: false, last_contacted_at: null, last_contacted_by: null, notes: "", claimed_at: null, claimed_by: null, declined_at: null,
      created_at: iso(now - 14 * DAY), ...extra,
    };
  };
  org("lekki", "Lekki Social Club", "lekkisocialclub", "listed", { room_id: R.lekki, last_contacted_at: iso(now - 9 * DAY), last_contacted_by: "Jae", notes: "Sent the first message on Instagram. No reply yet." });
  org("mic", "Mainland Mic Collective", "mainlandmic", "listed", { room_id: R.mic, notes: "Price is not on their page." });
  org("afro", "Afrobeats Island Parties", "afroislandparties", "offered", {
    room_id: R.afro, email: DEMO_CLAIM_EMAIL, last_contacted_at: iso(now - 3 * DAY), last_contacted_by: "Jae", notes: "Said yes on WhatsApp. Link sent.",
  });
  org("detty", "Detty December Collective", "dettydecember", "pulled", { created_at: iso(now - 2 * DAY) });
  org("wavy", "Wavy Nights Lagos", "wavynightslagos", "declined", {
    do_not_contact: true, declined_at: iso(now - 20 * DAY), last_contacted_at: iso(now - 21 * DAY), last_contacted_by: "Jae", created_at: iso(now - 30 * DAY),
    notes: "Asked us not to list them.",
  });
  org("sound", "Surulere Sound Collective", "surulere.sound", "claimed", {
    room_id: R.sound, email: "tola.ajayi@example.com", claimed_at: iso(now - 6 * DAY), claimed_by: TOLA_USER_ID, last_contacted_at: iso(now - 9 * DAY), last_contacted_by: "Jae",
    created_at: iso(now - 25 * DAY),
  });

  /* Dormant rooms (the Listings account owns them, invite only so Discover hides them) and the claimed one (Tola owns it, open). */
  const room = (id: string, slug: string, name: string, owner: string, mode: "invite" | "open", about: string) => {
    const r: RoomRec = {
      id, slug, name, kind: "crew", logo_url: null, wallpaper_url: null, verified: false, owner_id: owner, description: about, base_members: 0, join_mode: mode,
      created_by: owner,
    };
    st.rooms[id] = r;
    st.memberships[`${owner}:${id}`] = true;
  };
  room(R.lekki, "lekki-social-club", "Lekki Social Club", LISTINGS_USER_ID, "invite", "");
  room(R.mic, "mainland-mic-collective", "Mainland Mic Collective", LISTINGS_USER_ID, "invite", "");
  room(R.afro, "afrobeats-island-parties", "Afrobeats Island Parties", LISTINGS_USER_ID, "invite", "");
  room(R.sound, "surulere-sound-collective", "Surulere Sound Collective", TOLA_USER_ID, "open", "Highlife, jazz and live sound in Surulere.");
  st.joinedAt[`${TOLA_USER_ID}:${R.sound}`] = iso(now - 6 * DAY);

  /* Listings and their pulled rows. */
  const pulled = (key: string, f: ScoutEvent, org: keyof typeof O, status: PulledStatus, extra: Partial<PulledRec> = {}) => {
    const id = seedId(`pulled:${key}`);
    st.pulled[id] = {
      id, source_site: f.source_site, source_id: f.source_id, status, flags: [], edited: [], confidence: f.confidence, fields: f, organiser_id: O[org],
      event_id: null, duplicate_of: null, also_at: [], first_seen_at: iso(now - 3 * DAY), last_seen_at: iso(now - 4 * HOUR), missing_since: null,
      decided_at: null, reject_reason: "", ...extra,
    };
    return id;
  };
  const listing = (key: string, f: ScoutEvent, org: keyof typeof O, roomId: string, host: string, createdDaysAgo: number) => {
    const id = seedId(`event:listing:${key}`);
    const rec: EventRec = {
      id, ...listingFields(f), slug: slugFor(f.name, id), host_id: host, room_id: roomId, organiser_id: O[org], created_at: iso(now - createdDaysAgo * DAY),
    };
    st.events[id] = rec;
    return id;
  };
  const flag = (...f: PulledFlag[]) => f;

  // Lekki Social Club: two listings. A range starting at 5,000, and a free one the source no longer shows (gone).
  const sundown = scout({
    source_site: "Tix", source_id: "tix-sundown-sessions", name: "Sundown Sessions at Elegushi", starts_at: iso(at(5, "16:00")), ends_at: iso(at(5, "22:00")),
    venue: "Elegushi Beach", area: "Ajah", lat: 6.4412, lng: 3.5576, pin_by: "venues", category: "beach party",
    description: "Sunset beach party with amapiano and afrobeats.",
    tickets: [{ name: "Early bird", price_naira: 5000, sold_out: false }, { name: "Regular", price_naira: 10000, sold_out: false }, { name: "VIP", price_naira: 25000, sold_out: false }],
    ticket_url: "https://tix.example.com/sundown-sessions-elegushi", organiser_name: "Lekki Social Club", organiser_handle: "lekkisocialclub", last_seen: iso(now - 4 * HOUR),
  });
  pulled("sundown", sundown, "lekki", "approved", { event_id: listing("sundown", sundown, "lekki", R.lekki, LISTINGS_USER_ID, 3) });
  const brunch = scout({
    source_site: "Luma", source_id: "luma-social-brunch", name: "Lekki Social Brunch", starts_at: iso(at(9, "11:00")), ends_at: iso(at(9, "14:00")),
    venue: "Cafe Eko, Lekki", area: "Lekki Phase 1", lat: 6.4474, lng: 3.4723, pin_by: "venues", category: "brunch",
    description: "Free brunch social. RSVP on the page.", tickets: [{ name: "RSVP", price_naira: 0, sold_out: false }],
    ticket_url: "https://luma.example.com/lekki-social-brunch", organiser_name: "Lekki Social Club", organiser_handle: "lekkisocialclub", last_seen: iso(now - 2 * DAY),
  });
  pulled("brunch", brunch, "lekki", "approved", {
    event_id: listing("brunch", brunch, "lekki", R.lekki, LISTINGS_USER_ID, 3), flags: flag("gone"), missing_since: iso(now - 2 * DAY), last_seen_at: iso(now - 2 * DAY),
  });

  // Mainland Mic Collective: the price is not on the page (Check listing), only an Instagram post. The source moved the start.
  const mic = scout({
    source_site: "Instagram", source_id: "ig-open-mic-yaba", name: "Open Mic Night Yaba", starts_at: iso(at(4, "19:00")), ends_at: iso(at(4, "22:00")),
    venue: "The Laugh Lounge, Yaba", area: "Yaba", lat: 6.5095, lng: 3.3711, pin_by: "source", category: "comedy",
    description: "Open mic. Comedy, poetry and music.", ticket_url: null, event_handle: "mainlandmic", organiser_name: "Mainland Mic Collective",
    organiser_handle: "mainlandmic", last_seen: iso(now - 4 * HOUR),
  });
  pulled("mic", mic, "mic", "approved", {
    event_id: listing("mic", mic, "mic", R.mic, LISTINGS_USER_ID, 4), flags: flag("no_price", "moved"), edited: [],
  });

  // Afrobeats Island Parties: sold out at the source. Offered, with a pending link.
  const cruise = scout({
    source_site: "Tix", source_id: "tix-afro-island-cruise", name: "Afro Island Boat Cruise", starts_at: iso(at(7, "14:00")), ends_at: iso(at(7, "19:00")),
    venue: "Victoria Island Marina", area: "Victoria Island", lat: 6.4281, lng: 3.4219, pin_by: "venues", category: "party",
    description: "Three hours on the lagoon with a live DJ.", tickets: [{ name: "Regular", price_naira: 15000, sold_out: true }], sold_out: true,
    ticket_url: "https://tix.example.com/afro-island-boat-cruise", organiser_name: "Afrobeats Island Parties", organiser_handle: "afroislandparties",
    last_seen: iso(now - 4 * HOUR),
  });
  pulled("cruise", cruise, "afro", "approved", { event_id: listing("cruise", cruise, "afro", R.afro, LISTINGS_USER_ID, 6) });

  // Surulere Sound Collective: claimed. Their listing is now hosted by Tola and still points at their ticket page.
  const highlife = scout({
    source_site: "Tix", source_id: "tix-highlife-under-the-stars", name: "Highlife Under the Stars", starts_at: iso(at(6, "19:30")), ends_at: iso(at(6, "23:00")),
    venue: "Freedom Park", area: "Lagos Island", lat: 6.4531, lng: 3.3958, pin_by: "venues", category: "live music",
    description: "An open air night of highlife.", tickets: [{ name: "Regular", price_naira: 8000, sold_out: false }],
    ticket_url: "https://tix.example.com/highlife-under-the-stars", organiser_name: "Surulere Sound Collective", organiser_handle: "surulere.sound",
    last_seen: iso(now - 4 * HOUR),
  });
  pulled("highlife", highlife, "sound", "approved", { event_id: listing("highlife", highlife, "sound", R.sound, TOLA_USER_ID, 20), first_seen_at: iso(now - 22 * DAY) });

  // The rest of the review queue. Detty December Collective is only known from the queue (stage pulled, no room).
  const warm = scout({
    source_site: "Tix", source_id: "tix-detty-warm-up", name: "Detty December Warm Up", starts_at: iso(at(12, "20:00")), ends_at: iso(at(13, "02:00")),
    venue: "Quilox Annex, Victoria Island", area: "Victoria Island", lat: 6.4291, lng: 3.4262, pin_by: "venues", category: "club night",
    description: "The warm up before the season.",
    tickets: [{ name: "Regular", price_naira: 10000, sold_out: false }, { name: "VIP", price_naira: 30000, sold_out: false }],
    ticket_url: "https://tix.example.com/detty-december-warm-up", organiser_name: "Detty December Collective", organiser_handle: "dettydecember",
    last_seen: iso(now - 4 * HOUR),
  });
  const warmId = pulled("warm", warm, "detty", "new", { first_seen_at: iso(now - 2 * DAY) });
  const warm2 = scout({
    ...warm, source_site: "Eventbrite", source_id: "eb-detty-warm-up-5521", ticket_url: "https://eventbrite.example.com/e/detty-december-warm-up-5521",
    tickets: [{ name: "General", price_naira: 10000, sold_out: false }], organiser_name: "Detty December Collective",
  });
  pulled("warm2", warm2, "detty", "new", { flags: flag("duplicate"), duplicate_of: warmId, first_seen_at: iso(now - 1 * DAY) });
  const pool = scout({
    source_site: "Instagram", source_id: "ig-island-pool-party", name: "Island Pool Party", venue: "Lekki", area: "Lekki Phase 1", category: "pool party",
    description: "Date coming soon, says the post.", event_handle: "dettydecember", organiser_name: "Detty December Collective", organiser_handle: "dettydecember",
    last_seen: iso(now - 4 * HOUR), confidence: "lead",
  });
  pulled("pool", pool, "detty", "new", { flags: flag("no_time", "no_price", "no_pin"), confidence: "lead", first_seen_at: iso(now - 1 * DAY) });
  const wavy = scout({
    source_site: "Eventbrite", source_id: "eb-wavy-beach-edition", name: "Wavy Nights Beach Edition", starts_at: iso(at(8, "15:00")), ends_at: iso(at(8, "21:00")),
    venue: "Landmark Beach", area: "Victoria Island", lat: 6.4217, lng: 3.4392, pin_by: "venues", category: "beach party",
    tickets: [{ name: "Regular", price_naira: 7000, sold_out: false }], ticket_url: "https://eventbrite.example.com/e/wavy-beach-edition",
    organiser_name: "Wavy Nights Lagos", organiser_handle: "wavynightslagos", last_seen: iso(now - 4 * HOUR),
  });
  pulled("wavy", wavy, "wavy", "blocked", { flags: flag("blocked") });

  /* The contact log. */
  const log = (key: string, o: keyof typeof O, daysAgo: number, kind: OrganiserLogKind, body: string, channel: OrganiserLogEntry["channel"] = null, by: string | null = "Jae") => {
    const id = seedId(`olog:${key}`);
    st.organiserLog[id] = { id, organiser_id: O[o], at: iso(now - daysAgo * DAY), by, kind, channel, body };
  };
  log("lekki-scrape", "lekki", 3, "scrape", "Found Sundown Sessions at Elegushi on Tix", null, null);
  log("lekki-contact", "lekki", 9, "contact", "Sent the first message. Asked who looks after tickets.", "instagram");
  log("mic-scrape", "mic", 4, "scrape", "Found Open Mic Night Yaba on Instagram", null, null);
  log("afro-contact", "afro", 8, "contact", "First message sent", "instagram");
  log("afro-reply", "afro", 5, "reply", "They replied: yes, send the link. Best email is the bookings one.", "whatsapp");
  log("afro-offer", "afro", 3, "offer", "Offer sent", "whatsapp");
  log("afro-transfer", "afro", 3, "transfer", `Link made for ${DEMO_CLAIM_EMAIL}`, null);
  log("detty-scrape", "detty", 2, "scrape", "Found Detty December Warm Up on Tix", null, null);
  log("wavy-contact", "wavy", 21, "contact", "First message sent", "instagram");
  log("wavy-reply", "wavy", 20, "reply", "They said no and asked us not to list them.", "instagram");
  log("wavy-stage", "wavy", 20, "stage", "Declined. Do not contact.");
  log("wavy-delete", "wavy", 20, "delete", "Removed their listing and room");
  log("sound-contact", "sound", 9, "contact", "First message sent", "email");
  log("sound-reply", "sound", 8, "reply", "Tola replied. Happy to take it over.", "email");
  log("sound-transfer", "sound", 7, "transfer", "Link made for tola.ajayi@example.com");
  log("sound-stage", "sound", 6, "stage", "Claimed by Tola Ajayi", null, null);

  /* Transfer links: a pending one for Afrobeats Island Parties (only the hash is kept), an accepted one for Surulere Sound Collective. */
  const tr = (key: string, o: keyof typeof O, roomId: string, roomName: string, email: string, token: string, status: TransferRec["status"], created: number, expires: number, acceptedAt: number | null) => {
    const id = seedId(`transfer:${key}`);
    st.transfers[id] = {
      id, kind: "claim", room_id: roomId, room_name: roomName, organiser_id: O[o], to_email: email, status, created_at: iso(now - created * DAY), created_by: "Jae",
      expires_at: iso(now + expires * DAY), accepted_at: acceptedAt === null ? null : iso(now - acceptedAt * DAY), token_hash: sha256HexSync(token), attempts: 0,
      accepted_by: acceptedAt === null ? null : TOLA_USER_ID,
    };
  };
  tr("afro", "afro", R.afro, "Afrobeats Island Parties", DEMO_CLAIM_EMAIL, DEMO_CLAIM_TOKEN, "pending", 3, 11, null);
  tr("sound", "sound", R.sound, "Surulere Sound Collective", "tola.ajayi@example.com", "seed-accepted-surulere-sound", "accepted", 7, 7, 6);

  /* "Is this your event?" from someone at Mainland Mic. */
  const crId = seedId("claim-request:ruth");
  st.claimRequests[crId] = {
    id: crId, event_id: seedId("event:listing:mic"), event_title: "Open Mic Night Yaba", organiser_id: O.mic, organiser_name: "Mainland Mic Collective", name: "Ruth Eze",
    email: "ruth.eze@example.com", phone: "08030000000", note: "I run the night. Please let me fix the price.", status: "new", created_at: iso(now - 5 * HOUR),
  };
  log("mic-claimreq", "mic", 0.2, "claim_request", "Ruth Eze asked about Open Mic Night Yaba", null, "Ruth Eze");
}
