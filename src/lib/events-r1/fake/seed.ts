/**
 * The seed: about 17 Lagos events over the next 9 days, one that ended 2 hours ago and one cancelled, with hosts,
 * rooms, announcements, Pops and a crowd of fake people with Nigerian names. Every name, link and number is made up.
 *
 * It is rebuilt on every load, relative to the real time (day offsets with Lagos clock times), so there is always
 * something on this week. Ids are stable (seedId), which is how the saved user layer finds its way back to a record.
 * The fake clock offset only moves "now"; it does not move the seed.
 */
import type { EventKind, LinkType, Pop, RegStatus, Registration, Report, RoomAnnouncement, Visibility } from "../types";
import type { Vibe } from "../../brand";
import { AREAS, LAGOS_CENTER } from "../../geo";
import type { EventRec, FakeState, RoomRec, TicketRec, UserRec } from "./store";
import { autoPopsFor, defaultMessages, defaultQuestions } from "./defaults";
import { DAY, HOUR, lagosAt, rngFor, seedId, slugFor } from "./util";

/* --------------------------------------------------------------- people -- */

const FIRST = [
  "Chidi", "Ngozi", "Tunde", "Bisi", "Emeka", "Amaka", "Femi", "Zainab", "Ifeanyi", "Funke",
  "Kunle", "Yetunde", "Obinna", "Aisha", "Segun", "Folake", "Chinedu", "Halima", "Damilola", "Tolu",
  "Uche", "Sade", "Ibrahim", "Nneka", "Seyi", "Kehinde", "Temitope", "Chiamaka", "Babatunde", "Adaeze",
];
const LAST = [
  "Okafor", "Adeyemi", "Balogun", "Nwosu", "Ogunleye", "Eze", "Bello", "Adebayo", "Okonkwo", "Lawal",
  "Afolabi", "Danjuma", "Olawale", "Chukwu", "Akinola", "Mohammed", "Ojo", "Onyeka", "Salami", "Ogbu",
  "Fashola", "Umeh", "Adewale", "Musa", "Nnadi", "Alabi", "Oyedepo", "Igwe", "Sanni", "Ekwueme",
];

const U = {
  ada: seedId("user:ada"),
  kredete: seedId("user:kredete"),
  lrc: seedId("user:lagos-run-club"),
  p360: seedId("user:360playlist"),
  roof: seedId("user:rooftop-sessions"),
  hq: seedId("user:hoppaz-hq"),
  staff: seedId("user:staff"),
};

const R = {
  hq: seedId("room:hoppaz-hq"),
  p360: seedId("room:360playlist"),
  kredete: seedId("room:kredete"),
  lrc: seedId("room:lagos-run-club"),
  roof: seedId("room:rooftop-sessions"),
};

type HostKey = "hq" | "p360" | "kredete" | "lrc" | "roof";
const HOST_USER: Record<HostKey, string> = { hq: U.hq, p360: U.p360, kredete: U.kredete, lrc: U.lrc, roof: U.roof };

/* --------------------------------------------------------------- events -- */

type Crowd = { going: number; checkedIn?: number; requested?: number; waitlisted?: number; declined?: number; cancelled?: number };

type Spec = {
  key: string;
  title: string;
  host: HostKey;
  vibe: Vibe;
  kind: EventKind;
  venue?: string;
  area?: string;
  /** Small move off the area centre so pins do not stack. */
  at?: [number, number];
  /** A Lagos day and clock time, or minutes from now. */
  when: { day: number; time: string } | { fromNowMin: number };
  hours: number;
  desc: string;
  visibility?: Visibility;
  approval?: boolean;
  capacity?: number | null;
  waitlist?: boolean;
  link?: { type: LinkType; url: string };
  price?: number;
  cancelled?: boolean;
  crowd: Crowd;
  /** Ada Obi has a place (counted inside crowd.going). */
  ada?: RegStatus;
};

const SPECS: Spec[] = [
  {
    key: "sunset-rooftop", title: "Sunset Rooftop Sessions Vol. 12", host: "roof", vibe: "rooftop", kind: "in_person",
    venue: "The Terrace Rooftop", area: "Victoria Island", at: [0.003, -0.002], when: { day: 1, time: "17:30" }, hours: 5,
    desc: "Golden hour over the lagoon with house and afrobeats from three local DJs. Come early for a good spot by the rail.",
    crowd: { going: 34, cancelled: 1 },
  },
  {
    key: "run-5k", title: "Lagos Run Club 5K Social Run", host: "lrc", vibe: "culture", kind: "in_person",
    venue: "Ikoyi Park Gate", area: "Ikoyi", at: [0.002, 0.003], when: { day: 2, time: "06:30" }, hours: 2,
    desc: "An easy 5K for every pace, then coffee and fruit. Bring water. No one gets left behind.",
    crowd: { going: 38, cancelled: 2 },
  },
  {
    key: "listening-party", title: "360Playlist Listening Party", host: "p360", vibe: "afro", kind: "in_person",
    venue: "Studio 360", area: "Yaba", at: [0.002, 0.001], when: { day: 3, time: "19:00" }, hours: 4, approval: true,
    desc: "New afrobeats and amapiano, played loud, with the people who made it. Spaces are limited, so the host approves each request.",
    crowd: { going: 22, requested: 6, declined: 2 }, ada: "going",
  },
  {
    key: "open-mic", title: "Kredete Open Mic and Laughs", host: "kredete", vibe: "comedy", kind: "in_person",
    venue: "The Laugh Room", area: "Surulere", at: [-0.002, 0.002], when: { day: 3, time: "20:00" }, hours: 3,
    capacity: 10, waitlist: true,
    desc: "A small room, ten seats, and a lot of new jokes. Try your five minutes or just come and laugh.",
    crowd: { going: 9 },
  },
  {
    key: "jollof-table", title: "Jollof Tasting Table", host: "kredete", vibe: "food", kind: "in_person",
    venue: "Kredete's Kitchen", area: "Magodo", at: [0.001, 0.002], when: { day: 4, time: "18:00" }, hours: 3,
    capacity: 5, waitlist: true,
    desc: "Five seats, five pots of jollof, one winner. Come hungry and bring a strong opinion.",
    crowd: { going: 5, waitlisted: 3, cancelled: 1 },
  },
  {
    key: "founders-zoom", title: "Lagos Founders Office Hours", host: "hq", vibe: "tech", kind: "online",
    when: { day: 2, time: "18:00" }, hours: 1.5, link: { type: "zoom", url: "https://zoom.us/j/84012345678" },
    desc: "Bring one problem about your business and get a straight answer from founders who have been there. Cameras optional.",
    crowd: { going: 26 },
  },
  {
    key: "producer-class", title: "Beginner Amapiano Production Class", host: "kredete", vibe: "amapiano", kind: "online",
    when: { day: 5, time: "17:00" }, hours: 2, link: { type: "meet", url: "https://meet.google.com/hzx-demo-kred" },
    desc: "Make your first log drum loop from nothing. Any laptop works and the software is free.",
    crowd: { going: 17, cancelled: 1 },
  },
  {
    key: "run-qa-call", title: "Lagos Run Club Training Q&A Call", host: "lrc", vibe: "culture", kind: "online",
    when: { day: 4, time: "20:00" }, hours: 1, capacity: 32, waitlist: true,
    link: { type: "whatsapp", url: "https://call.whatsapp.com/video/HzDemoRunClub32" },
    desc: "Ask the coaches anything about training, shoes and race day. WhatsApp calls hold up to 32 people.",
    crowd: { going: 24 },
  },
  {
    key: "producer-live", title: "Rooftop Sessions Producer Livestream", host: "roof", vibe: "live band", kind: "online",
    when: { day: 6, time: "19:00" }, hours: 2, link: { type: "other", url: "https://www.youtube.com/live/rooftop-sessions-demo" },
    desc: "Watch three producers build a track live, then vote on the final mix in the chat.",
    crowd: { going: 15 },
  },
  {
    key: "mixer-hybrid", title: "360Playlist Mixer and Livestream", host: "p360", vibe: "afro", kind: "hybrid",
    venue: "The Lounge, Lekki", area: "Lekki Phase 1", at: [0.002, -0.004], when: { day: 5, time: "20:00" }, hours: 3,
    link: { type: "zoom", url: "https://zoom.us/j/84099887766" },
    desc: "Meet the 360Playlist team in person, or join the livestream from home. Same music, same night.",
    crowd: { going: 29, requested: 0 },
  },
  {
    key: "members-night", title: "Rooftop Sessions Members Night", host: "roof", vibe: "rooftop", kind: "in_person",
    venue: "Rooftop Sessions Lounge", area: "Ikoyi", at: [-0.003, 0.002], when: { day: 6, time: "21:00" }, hours: 4,
    visibility: "community",
    desc: "A night for people in the Rooftop Sessions room only. Surprise guest DJ.",
    crowd: { going: 18 },
  },
  {
    key: "private-dinner", title: "Kredete Private Listening Dinner", host: "kredete", vibe: "food", kind: "in_person",
    venue: "Private home", area: "Ikoyi", at: [0.004, -0.001], when: { day: 5, time: "20:30" }, hours: 3,
    visibility: "invite", approval: true, capacity: 20, waitlist: false,
    desc: "An invite-only dinner with the new record. Only people with the link can see this.",
    crowd: { going: 12, requested: 3 },
  },
  {
    key: "beach-day", title: "Afro Beach Day Party", host: "roof", vibe: "beach", kind: "in_person",
    venue: "Elegushi Beach Strip", area: "Ajah", at: [-0.004, -0.006], when: { day: 8, time: "14:00" }, hours: 7,
    price: 3000, capacity: 120,
    desc: "Sun, sand and a long afrobeats set by the water. A General ticket gets you in.",
    crowd: { going: 40 },
  },
  {
    key: "host-qa", title: "Hoppaz Host Q&A", host: "hq", vibe: "tech", kind: "online",
    when: { fromNowMin: 40 }, hours: 1, link: { type: "meet", url: "https://meet.google.com/hzx-demo-host" },
    desc: "New to hosting on Hoppaz? Ask the team anything. Starts soon, so you can try the Join call button.",
    crowd: { going: 14 },
  },
  {
    key: "welcome-hop", title: "Hoppaz Welcome Hop", host: "hq", vibe: "afro", kind: "in_person",
    venue: "Hoppaz Bus Stop", area: "Lagos Island", at: [0.002, 0.002], when: { day: 1, time: "19:00" }, hours: 4,
    desc: "New to Hoppaz? Come alone, leave with friends. We board together and go.",
    crowd: { going: 40 },
  },
  {
    key: "beach-run", title: "Lagos Run Club Sunrise Beach Run", host: "lrc", vibe: "beach", kind: "in_person",
    venue: "Lekki Beach Road", area: "Ajah", at: [0.003, 0.004], when: { day: 7, time: "06:00" }, hours: 2,
    desc: "A flat, easy run along the sea with a swim and breakfast after. All paces welcome.",
    crowd: { going: 18 },
  },
  {
    key: "game-night", title: "Hoppaz Game Night", host: "hq", vibe: "culture", kind: "in_person",
    venue: "Hoppaz Hub", area: "Yaba", at: [-0.002, -0.002], when: { day: 0, time: "20:00" }, hours: 4,
    desc: "Board games, FIFA and ludo. Bring a friend or make one at the door.",
    crowd: { going: 15 },
  },
  {
    key: "highlife-ended", title: "Highlife Live Band Night", host: "kredete", vibe: "live band", kind: "in_person",
    venue: "Palm Wine Bar", area: "Ikeja", at: [0.001, -0.002], when: { fromNowMin: -210 }, hours: 1.5,
    desc: "A live highlife band, cold drinks and a dance floor that never empties.",
    crowd: { going: 6, checkedIn: 14, cancelled: 1 },
  },
  {
    key: "techno-cancelled", title: "Warehouse Techno Night", host: "roof", vibe: "techno", kind: "in_person",
    venue: "The Warehouse", area: "Mushin", at: [0.002, 0.001], when: { day: 2, time: "22:00" }, hours: 6, cancelled: true,
    desc: "A warehouse, a big sound system and four hours of techno. Cancelled because the venue fell through.",
    crowd: { going: 18 },
  },
];

type PopSeed = { event: string; body: string; hoursAgo: number; audience: Pop["audience"]; alsoRoom: boolean };
const POPS: PopSeed[] = [
  { event: "listening-party", body: "Doors open at 7pm. Have your QR ticket ready. Street parking is free.", hoursAgo: 5, audience: "going", alsoRoom: true },
  { event: "sunset-rooftop", body: "We moved to the 12th floor. Same address, take the lift on the left.", hoursAgo: 3, audience: "everyone", alsoRoom: true },
  { event: "run-qa-call", body: "The call link will show on the event page 15 minutes before we start.", hoursAgo: 8, audience: "going", alsoRoom: false },
];

type AnnSeed = { room: HostKey; body: string; hoursAgo: number; author: string };
const ANNS: AnnSeed[] = [
  { room: "hq", body: "Welcome to Hoppaz HQ. Say hi and tell us what you are doing this week.", hoursAgo: 46, author: "Hoppaz HQ" },
  { room: "hq", body: "New: events now have a Register button. Tell your friends.", hoursAgo: 20, author: "Hoppaz HQ" },
  { room: "p360", body: "New playlist drops on Friday. Send us your requests in General.", hoursAgo: 30, author: "360Playlist" },
  { room: "kredete", body: "The next jollof table has five seats. Join the waitlist if it is full.", hoursAgo: 26, author: "Kredete" },
  { room: "lrc", body: "This week's route is up. Meet at the gate, 6:15am sharp.", hoursAgo: 10, author: "Lagos Run Club" },
  { room: "lrc", body: "Welcome to the new runners. Water stops are at 2.5K and the finish.", hoursAgo: 76, author: "Lagos Run Club" },
  { room: "roof", body: "Members night is coming. Only people in this room can see it.", hoursAgo: 15, author: "Rooftop Sessions" },
];

/* ---------------------------------------------------------------- build -- */

export function buildSeed(now: number): FakeState {
  const st: FakeState = {
    users: {}, events: {}, regs: {}, tickets: {}, pops: {}, announcements: {}, reports: {}, rooms: {},
    regSettings: {}, memberships: {}, interest: {}, reads: {},
    viewerId: null, pendingEmail: null, offset: 0, key: null,
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  /* Users: a guest, a host for each brand, staff. */
  const users: UserRec[] = [
    { id: U.ada, name: "Ada Obi", email: "ada.obi@example.com" },
    { id: U.kredete, name: "Kredete", email: "kredete@example.com" },
    { id: U.lrc, name: "Lagos Run Club", email: "hello@lagosrunclub.example.com" },
    { id: U.p360, name: "360Playlist", email: "team@360playlist.example.com" },
    { id: U.roof, name: "Rooftop Sessions", email: "crew@rooftopsessions.example.com" },
    { id: U.hq, name: "Hoppaz HQ", email: "hq@hoppaz.example.com" },
    { id: U.staff, name: "Hoppaz Staff", email: "staff@hoppaz.example.com", staff: true },
  ];
  for (const u of users) st.users[u.id] = u;

  /* Rooms. */
  const rooms: Array<[string, string, string, RoomRec["kind"], string | null, number, boolean, string | null, string]> = [
    [R.hq, "hoppaz-hq", "Hoppaz HQ", "hq", U.hq, 1200, true, null, "The home room. Say hi, ask anything, find out what is on."],
    [R.p360, "360playlist", "360Playlist", "brand", U.p360, 839, true, "/brands/360playlist.jpg", "New music, listening parties and the people behind the playlist."],
    [R.kredete, "kredete", "Kredete", "crew", U.kredete, 312, false, null, "Open mics, food tables and small nights."],
    [R.lrc, "lagos-run-club", "Lagos Run Club", "crew", U.lrc, 467, false, null, "Runs for every pace across Lagos."],
    [R.roof, "rooftop-sessions", "Rooftop Sessions", "brand", U.roof, 205, false, null, "Rooftops, sunsets and good sound."],
    [seedId("room:lagos-film-club"), "lagos-film-club", "Lagos Film Club", "crew", null, 96, false, null, "Screenings and film talk."],
    [seedId("room:naija-tech-meetup"), "naija-tech-meetup", "Naija Tech Meetup", "crew", null, 150, false, null, "Builders, founders and curious people."],
    [seedId("room:amapiano-fridays"), "amapiano-fridays", "Amapiano Fridays", "crew", null, 380, false, null, "Log drums and dance floors."],
    [seedId("room:surulere-5-a-side"), "surulere-5-a-side", "Surulere 5-a-side", "crew", null, 74, false, null, "Weekly five-a-side football."],
  ];
  for (const [id, slug, name, kind, owner, base, verified, logo, description] of rooms) {
    st.rooms[id] = {
      id, slug, name, kind, logo_url: logo, wallpaper_url: null, verified, owner_id: owner, description, base_members: base,
    };
  }
  st.memberships[`${U.ada}:${R.p360}`] = true;
  st.memberships[`${U.ada}:${R.lrc}`] = true;

  /* Events and their crowds. */
  const eventKey: Record<string, EventRec> = {};
  for (const sp of SPECS) {
    const id = seedId(`event:${sp.key}`);
    let start: number;
    if ("fromNowMin" in sp.when) start = now + sp.when.fromNowMin * 60_000;
    else {
      start = lagosAt(now, sp.when.day, sp.when.time);
      // Something earlier today would already be over: move it to tomorrow, same time.
      if (sp.when.day === 0 && start < now + 90 * 60_000) start = lagosAt(now, 1, sp.when.time);
    }
    const area = sp.area ? AREAS.find((a) => a.name === sp.area) : undefined;
    const online = sp.kind === "online";
    const lat = online || !area ? LAGOS_CENTER.lat : area.lat + (sp.at?.[0] ?? 0);
    const lng = online || !area ? LAGOS_CENTER.lng : area.lng + (sp.at?.[1] ?? 0);
    const rec: EventRec = {
      id,
      title: sp.title,
      venue_name: online ? "" : (sp.venue ?? ""),
      area: online ? null : (sp.area ?? null),
      lat,
      lng,
      starts_at: iso(start),
      price_naira: sp.price ?? 0,
      vibe: sp.vibe,
      source: sp.host === "hq" ? "hoppaz" : sp.host === "p360" ? "partner" : "hopper",
      ig_url: null,
      flyer_url: null,
      description: sp.desc,
      ends_at: iso(start + sp.hours * HOUR),
      timezone: "Africa/Lagos",
      kind: sp.kind,
      visibility: sp.visibility ?? "public",
      status: sp.cancelled ? "cancelled" : "live",
      capacity: sp.capacity ?? null,
      requires_approval: !!sp.approval,
      waitlist_on: !!sp.waitlist,
      link_type: sp.link?.type ?? null,
      online_link: sp.link?.url ?? null,
      room_id: R[sp.host],
      created_at: iso(now - (2 + Math.floor(rngFor(`created:${sp.key}`)() * 8)) * DAY),
      slug: slugFor(sp.title, id),
      host_id: HOST_USER[sp.host],
    };
    st.events[id] = rec;
    eventKey[sp.key] = rec;
    crowdFor(st, rec, sp, now);
    if (!sp.cancelled) for (const p of autoPopsFor(rec, users.find((u) => u.id === rec.host_id)!.name)) st.pops[p.id] = p;
  }

  // A custom question on the listening party, so the registration settings have one to show.
  st.regSettings[eventKey["listening-party"].id] = {
    questions: [...defaultQuestions(), { id: "q-artist", label: "Who is your favourite artist?", required: false, enabled: true }],
    messages: defaultMessages(),
  };

  /* Sent Pops (and their copy in the room's Announcements, tagged with the event). */
  for (const ps of POPS) {
    const ev = eventKey[ps.event];
    const id = seedId(`pop:${ps.event}`);
    const sentAt = iso(now - ps.hoursAgo * HOUR);
    const host = st.users[ev.host_id];
    const going = Object.values(st.regs).filter((r) => r.event_id === ev.id && (r.status === "going" || r.status === "checked_in")).length;
    const pending = Object.values(st.regs).filter((r) => r.event_id === ev.id && r.status === "requested").length;
    st.pops[id] = {
      id, event_id: ev.id, event_title: ev.title, author_name: host.name, body: ps.body, audience: ps.audience,
      also_room: ps.alsoRoom, send_at: null, sent_at: sentAt, status: "sent", auto: null,
      recipients: ps.audience === "everyone" ? going + pending : going,
    };
    if (ps.alsoRoom && ev.room_id) {
      const aid = seedId(`pop-ann:${id}`);
      st.announcements[aid] = {
        id: aid, room_id: ev.room_id, body: ps.body, created_at: sentAt, author_name: host.name, event_id: ev.id, event_title: ev.title,
      };
    }
  }

  /* Plain room announcements. */
  ANNS.forEach((a, i) => {
    const id = seedId(`ann:${a.room}:${i}`);
    st.announcements[id] = {
      id, room_id: R[a.room], body: a.body, created_at: iso(now - a.hoursAgo * HOUR), author_name: a.author, event_id: null, event_title: null,
    } satisfies RoomAnnouncement;
  });

  /* Reports for the staff list. */
  const reports: Array<[string, Report["reason"], string, number, Report["status"]]> = [
    ["beach-day", "fake_or_scam", "I cannot find the organiser anywhere online.", 20, "open"],
    ["techno-cancelled", "wrong_place", "The address on the page is a shop, not a warehouse.", 30, "open"],
    ["open-mic", "other", "Time on the page looks wrong.", 70, "reviewed"],
  ];
  reports.forEach(([key, reason, note, hoursAgo, status], i) => {
    const ev = eventKey[key];
    const id = seedId(`report:${i}`);
    st.reports[id] = {
      id, event_id: ev.id, event_title: ev.title, reporter_id: seedId(`person:${FIRST[i]} ${LAST[i]}`), reason, note,
      created_at: iso(now - hoursAgo * HOUR), status,
    };
  });

  return st;
}

/** The registrations and tickets for one event, from its crowd. */
function crowdFor(st: FakeState, ev: EventRec, sp: Spec, now: number): void {
  const rng = rngFor(`crowd:${sp.key}`);
  const c = sp.crowd;
  const plan: Array<[RegStatus, number]> = [
    ["checked_in", c.checkedIn ?? 0],
    ["going", c.going - (sp.ada === "going" ? 1 : 0)],
    ["requested", c.requested ?? 0],
    ["waitlisted", c.waitlisted ?? 0],
    ["declined", c.declined ?? 0],
    ["cancelled", c.cancelled ?? 0],
  ];
  const start = Date.parse(ev.starts_at);
  const made: Registration[] = [];
  const used = new Set<string>();
  let waitPos = 0;

  const add = (name: string, userId: string, email: string, status: RegStatus) => {
    const created = Math.min(now, start) - HOUR - Math.floor(rng() * 5 * DAY);
    const ref = made.length > 2 && rng() < 0.3 ? made[Math.floor(rng() * made.length)] : null;
    const reg: Registration = {
      id: seedId(`reg:${sp.key}:${userId}`),
      event_id: ev.id,
      user_id: userId,
      name,
      email,
      phone: null,
      status,
      answers: {},
      referrer_id: ref ? ref.user_id : null,
      referrer_name: ref ? ref.name : null,
      created_at: new Date(created).toISOString(),
      checked_in_at: status === "checked_in" ? new Date(start + Math.floor(rng() * 40) * 60_000).toISOString() : null,
      waitlist_pos: status === "waitlisted" ? ++waitPos : null,
    };
    made.push(reg);
    st.regs[reg.id] = reg;
    if (status === "going" || status === "checked_in") {
      const t: TicketRec = {
        id: seedId(`ticket:${reg.id}`), event_id: ev.id, reg_id: reg.id, version: 1, status: status === "checked_in" ? "used" : "valid",
      };
      st.tickets[t.id] = t;
    }
  };

  if (sp.ada === "going") add("Ada Obi", U.ada, "ada.obi@example.com", "going");

  for (const [status, n] of plan) {
    for (let i = 0; i < n; i++) {
      let first: string, last: string;
      do {
        first = FIRST[Math.floor(rng() * FIRST.length)];
        last = LAST[Math.floor(rng() * LAST.length)];
      } while (used.has(`${first} ${last}`));
      used.add(`${first} ${last}`);
      add(`${first} ${last}`, seedId(`person:${first} ${last}`), `${first}.${last}`.toLowerCase() + "@example.com", status);
    }
  }
}
