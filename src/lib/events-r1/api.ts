/**
 * The Release 1 data layer: one small interface per need. Screens talk only to this.
 * `fake` (fake/) is in memory and seeded; `real` (real/) calls Ola's functions later.
 * Picked by getApi() in index.ts from NEXT_PUBLIC_EVENTS_R1_FAKE.
 */
import type { Lineup } from "./lineup";
import type { LooksApi } from "./looks";
import type { PayApi } from "./pay";
import type {
  AcceptOutcome, AuthUser, ClaimRequest, ContactChannel, DoorPerson, EventChat, ImportReport, Organiser, OrganiserDetail, OrganiserPatch, OrganiserStage,
  PulledEvent, PulledPatch, ScoutBatch, Transfer, TransferLink, TransferPreview, WeekSummary, EventDraft, Pop, PopAudience, PopAuto, R1Event, RegMessages, RegQuestion, Registration,
  JoinOutcome, JoinRequest, Report, ReportReason, RoomAnnouncement, RoomChannel, RoomDraft, RoomGuests, RoomMember, RoomMessage, RoomNotice,
  RoomPatch, RoomPreview, RoomRole, RoomSummary, SavedDetails, MyRegistration, ScanResult, Ticket, ViewerState,
} from "./types";

export type Unsub = () => void;

export interface AuthApi {
  /** Who is signed in, or null. */
  current(): AuthUser | null;
  /** Email step 1: send a six-digit code. The fake accepts any code. */
  sendCode(email: string): Promise<void>;
  /** Email step 2. Creates the account if it is new. */
  verifyCode(email: string, code: string, name?: string): Promise<AuthUser>;
  google(): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export interface EventsApi {
  /** Events the viewer may see, in the list window (from 4 h ago to 45 days), soonest first. Never returns Invite only. */
  list(): Promise<R1Event[]>;
  /** One event by id or slug. Invite only works by link. online_link is filled only for a registered viewer or the host. */
  get(idOrSlug: string): Promise<R1Event | null>;
  /** Events a host has made, any status. */
  listMine(): Promise<R1Event[]>;
  /** Events for one room: upcoming first, then past. */
  listForRoom(roomId: string): Promise<R1Event[]>;
  create(draft: EventDraft): Promise<R1Event>;
  update(id: string, patch: Partial<EventDraft>): Promise<R1Event>;
  /** Copies everything except the guests. Title gets no suffix; starts_at moves a week on. */
  clone(id: string): Promise<R1Event>;
  cancel(id: string): Promise<R1Event>;
  /** Swipe right. */
  setInterested(id: string, on: boolean): Promise<void>;
  /** What the button on the event page should be, for this viewer. */
  viewerState(id: string): Promise<ViewerState>;
  /** Registration questions and the three messages (Pending, Going, Declined). */
  getRegistrationSettings(id: string): Promise<{ questions: RegQuestion[]; messages: RegMessages }>;
  setRegistrationSettings(id: string, s: { questions?: RegQuestion[]; messages?: Partial<RegMessages> }): Promise<void>;
  /**
   * The lineup or programme shown on the event page: { kind, rows }. Anyone who can see the event can read it; an event with none
   * answers { kind: "lineup", rows: [] }. Real: until supabase/events_r1_lineup.sql is run this answers empty, quietly.
   */
  getLineup(id: string): Promise<Lineup>;
  /** Host or staff: replace it. Rows with no name are dropped, at most 30 rows ("Not allowed" for anyone else). Real: needs the SQL file. */
  setLineup(id: string, l: Lineup): Promise<void>;
  /**
   * Host of a claimed listing: save the real ticket types and switch the event from the organiser's page to Hoppaz tickets.
   * Refused (reason text from OUTREACH_REASONS) while the event is still listed by Hoppaz ("This event is still listed by Hoppaz") or
   * the list is empty. Real: ev_update_event with the tickets, then ev_listing_use_hoppaz.
   */
  sellOnHoppaz(id: string, tickets: NonNullable<EventDraft["tickets"]>): Promise<R1Event>;
  subscribe(fn: () => void): Unsub;
}

export interface RegistrationsApi {
  /**
   * Register. Outcome depends on approval and capacity: going, requested or waitlisted. Needs a signed-in viewer.
   * ticketTypeId picks the ticket type (default: the first free type with room). A paid type throws "Currently unavailable".
   */
  register(eventId: string, opts?: { ticketTypeId?: string; answers?: Record<string, string>; referrerId?: string | null }): Promise<Registration>;
  cancel(eventId: string): Promise<void>;
  /** Host: the Audience list. */
  list(eventId: string): Promise<Registration[]>;
  /** Host: free events only. Approving a person who fits makes them going; otherwise they go to the waitlist. */
  approve(registrationId: string): Promise<Registration>;
  decline(registrationId: string): Promise<Registration>;
  /** Host: move a waitlisted person in now. Waitlist also promotes by itself when a place opens. */
  promote(registrationId: string): Promise<Registration>;
  /** Host: CSV text for Export. */
  exportCsv(eventId: string): Promise<string>;
  ticketFor(eventId: string): Promise<Ticket | null>;
  /** Every ticket the viewer holds for the event (several when a paid order has quantity above 1), first one first. */
  ticketsFor(eventId: string): Promise<Ticket[]>;
  /** Own invite link id: use as ?ref= on shared links. */
  inviteRef(eventId: string): string;
  /**
   * The viewer's tickets for Me: registrations with status going for events that have not ended and are not cancelled, soonest first.
   * Empty when signed out. Real: ev_my_registrations (supabase/events_r1_my_registrations.sql); until it runs this answers empty, quietly.
   */
  mine(): Promise<MyRegistration[]>;
}

export interface PopsApi {
  /** Host: Pops for this event, newest first, including scheduled and automatic. */
  listForEvent(eventId: string): Promise<Pop[]>;
  /** Pops shown on the event page (sent ones, to people who can see them). */
  visibleOnEvent(eventId: string): Promise<Pop[]>;
  send(input: { eventId: string; body: string; audience: PopAudience; alsoRoom: boolean; sendAt?: string | null }): Promise<Pop>;
  /** Share to WhatsApp: text plus the event link. */
  shareText(popId: string): Promise<string>;
  /** Host: take back a scheduled Pop that has not gone yet. A sent Pop or an automatic one cannot be cancelled ("Already sent"). */
  cancelScheduled(popId: string): Promise<void>;
  /** Host: switch an automatic Pop on or off. An Off one is never sent. Default On. */
  setAuto(eventId: string, auto: PopAuto, enabled: boolean): Promise<Pop>;
  /** Host: change the text of an automatic Pop that has not gone yet. */
  editAuto(eventId: string, auto: PopAuto, body: string): Promise<Pop>;
}

export interface RoomsApi {
  /** Rooms tab: Lagos HQ first, then the viewer's rooms, then discoverable rooms. */
  list(): Promise<{ hq: RoomSummary; mine: RoomSummary[]; discover: RoomSummary[]; eventChats: EventChat[] }>;
  /** By id or slug. An invite only room opens for members, staff and a visitor holding its invite code (opts.invite); else null. */
  get(idOrSlug: string, opts?: { invite?: string }): Promise<RoomSummary | null>;
  /** The rooms the viewer owns (the create page offers "Add to <room>" from this). Empty when signed out. */
  mine(): Promise<RoomSummary[]>;
  /** The rooms the viewer owns or is an admin of: the workspace switcher and the room admin. Lagos HQ is never in it. Empty when signed out. */
  managed(): Promise<RoomSummary[]>;
  /**
   * Make a room. The signed-in person owns it. Throws plain lines: "Give your room a name", "That address is taken",
   * "Use 3 to 40 letters, numbers and dashes". The slug is unique and, left out, built from the name (a taken one gets -2, -3).
   */
  create(draft: RoomDraft): Promise<RoomSummary>;
  /** Owner or admin: change the profile (name, about, logo, links, address, who can join). Staff too. Anyone else: "Not allowed". */
  update(roomId: string, patch: RoomPatch): Promise<RoomSummary>;
  /** Is hoppaz.fun/r/<slug> free? exceptRoomId is the room being edited (its own address counts as free). A bad shape is false. */
  slugAvailable(slug: string, exceptRoomId?: string): Promise<boolean>;
  /**
   * Join by the room's join mode. open: in at once ("joined"). ask: leaves a request ("requested"; asking twice is the same request).
   * invite: needs the room's invite code (opts.invite), else "This room is invite only". A valid invite code gets into an ask room too.
   * Someone already in answers "already". Needs a signed in viewer ("Sign in first").
   * opts.forEvent: the event the viewer just got a ticket for (the "You're going" card). In an ask room the request then carries it
   * (JoinRequest.ticket_event), so the host sees they bought a ticket. Ignored unless the viewer is going to that event of this room.
   */
  join(roomId: string, opts?: { invite?: string; forEvent?: string }): Promise<JoinOutcome>;
  /**
   * A member leaves the room by themselves. Their tickets keep working (a registration is not a membership) and they can join again
   * (an ask room: ask again). The owner gets "Owners can't leave" (they hand the room over in Room admin); Lagos HQ cannot be left
   * ("Everyone is in Lagos HQ"); someone not in the room gets "You are not in this room"; signed out "Sign in first".
   */
  leave(roomId: string): Promise<void>;
  /** Who a room is, for anyone with its address, an invite only room too (the locked page). null when there is no such room. */
  preview(idOrSlug: string): Promise<RoomPreview | null>;
  /**
   * Every event chat of the room the viewer could see, whoever they are: open first, then not open yet, then closed, each with whether the
   * viewer may come in (can_enter). The room page's channel list; eventChats(roomId) is only the chats the viewer already cares about.
   */
  channels(roomId: string): Promise<EventChat[]>;
  /** Waiting requests, oldest first. Owner, admin or staff; anyone else: "Not allowed". */
  requests(roomId: string): Promise<JoinRequest[]>;
  /** Approve (the person becomes a member and gets a notice) or decline (quietly: no notice). Owner, admin or staff. */
  decideRequest(requestId: string, approve: boolean): Promise<void>;
  /** The invite code of a room, for its link (hoppaz.fun/r/<slug>?invite=<code>). Owner, admin or staff; null for anyone else. */
  inviteCode(roomId: string): Promise<string | null>;
  /** People in the room, with when each joined. Members of the room only (owner and admins first). */
  members(roomId: string): Promise<RoomMember[]>;
  /**
   * Owner: set a member's role to admin, host or member. Admin: host or member only. Nobody changes the owner. The person must be in the room.
   * Admin = runs every event of the room (dashboard, guests, door) and everything except payouts and deleting the room.
   * Host stays in the data but is hidden in the app for launch (no screen offers it) and gets nothing a member does not have.
   */
  setRole(roomId: string, userId: string, role: Exclude<RoomRole, "owner">): Promise<void>;
  /** Take a member out. Owner or staff: anyone but the owner. Admin: plain members only. Anyone else "Not allowed". */
  removeMember(roomId: string, userId: string): Promise<void>;
  /**
   * "Went but haven't joined": people with a registration (going or checked in) for any of the room's events who are not members,
   * with the full count. Owner, admin or staff; anyone else: "Not allowed".
   */
  guestsNotJoined(roomId: string): Promise<RoomGuests>;
  /** Notices for the viewer that they have not seen (a join request that was approved). */
  notices(): Promise<RoomNotice[]>;
  /** The viewer has seen these notices. */
  markNoticesSeen(ids: string[]): Promise<void>;
  /**
   * Switch the walkable 3D room on or off. The room's owner (RoomSummary.is_owner) or staff only: anyone else gets "Not allowed",
   * a viewer who is not signed in "Sign in first". Off = chat only and "Enter room" goes away (RoomSummary.three_d_on).
   */
  setThreeD(roomId: string, on: boolean): Promise<void>;
  /** The /admin list: every room, Lagos HQ first, then the biggest. Staff only ("Not allowed" for anyone else). */
  listForStaff(): Promise<RoomSummary[]>;
  /**
   * The same two for the /admin desk, which has the shared staff token and no account. Real: through /api/admin/event-rooms with
   * the desk's token ("Sign in first" with none, "Not allowed" when it is refused). Fake: the dev "Hoppaz Staff" user, as above.
   */
  listForDesk(): Promise<RoomSummary[]>;
  setThreeDFromDesk(roomId: string, on: boolean): Promise<void>;
  /** Announcements, newest first. Includes event Pops tagged with the event. */
  announcements(roomId: string): Promise<RoomAnnouncement[]>;
  /** Plain room announcement (never shows on an event). */
  postAnnouncement(roomId: string, body: string): Promise<RoomAnnouncement>;
  eventChats(roomId: string): Promise<EventChat[]>;
  eventChat(eventId: string): Promise<EventChat | null>;
  /** The viewer has seen the room's announcements: unread goes to 0. */
  markRead(roomId: string): Promise<void>;
  /**
   * Chat lines, oldest first. channel "general" is the room chat; an event id is that event's chat (host Pops come with
   * pinned_pop set). An event chat the viewer cannot enter returns nothing.
   */
  messages(roomId: string, channel: RoomChannel): Promise<RoomMessage[]>;
  /** Say something. Needs a signed in viewer ("Sign in first"). An event chat refuses when it is closed, not open yet, or the viewer cannot enter. */
  send(roomId: string, channel: RoomChannel, body: string): Promise<RoomMessage>;
  subscribe(fn: () => void): Unsub;
}

export interface ReportsApi {
  report(eventId: string, reason: ReportReason, note?: string): Promise<void>;
  /** Staff only. */
  list(): Promise<Report[]>;
  markReviewed(id: string): Promise<void>;
}

export interface DoorApi {
  /**
   * Scan a QR token or a typed ticket code. mode "express" checks in at once (kind "checked_in"); "standard" returns
   * kind "confirm" with the person, and nothing changes until confirm().
   */
  scan(eventId: string, token: string, mode: "standard" | "express"): Promise<ScanResult>;
  /** Standard mode: confirm after seeing the name. */
  confirm(eventId: string, token: string): Promise<ScanResult>;
  /** Fallback: search by name or email. */
  search(eventId: string, q: string): Promise<Registration[]>;
  checkInById(eventId: string, registrationId: string): Promise<ScanResult>;
  counts(eventId: string): Promise<{ going: number; checked_in: number; pending: number; waitlist: number }>;
  /**
   * Door staff: people added for this one event whose only job is scanning at the door (scan, search, check in, counts). They cannot
   * open the dashboard or add anyone. Listed for whoever manages the event (the host, a room owner or admin, staff); anyone else "Not allowed".
   */
  staff(eventId: string): Promise<DoorPerson[]>;
  /** Add (on) or take away (off) a door person. Up to 20 per event ("That is the most door staff"). Whoever manages the event. */
  setStaff(eventId: string, userId: string, on: boolean): Promise<void>;
}

/**
 * The buyer's own account bits that are not the sign-in. Saved checkout details: kept only when the buyer leaves
 * "Save my details for next time" on, shown and deleted in Me. Real: events_r1_saved_details.sql; until it runs, nothing is saved
 * (savedDetails answers null and the save is a quiet no-op), so checkout simply asks every time.
 */
export interface AccountApi {
  /** The signed-in person's saved checkout details, or null (none, signed out, or not available yet). */
  savedDetails(): Promise<SavedDetails | null>;
  /** Keep (or replace) the details. Needs a signed in viewer ("Sign in first"). Trims; empty first name or email is refused. */
  saveDetails(d: SavedDetails): Promise<void>;
  /** Forget them. Nothing saved is fine. */
  deleteSavedDetails(): Promise<void>;
}

/**
 * Organiser side of the flow: the claim page, "Is this your event?", and an owner handing their own room to someone.
 * Fake: in memory. Real: ev_claim_request, ev_transfer_preview, ev_transfer_accept, ev_transfer_create_owner (supabase/events_r1_transfer.sql).
 */
export interface ClaimsApi {
  /** Anyone, signed in or not: "Is this your event?". Lands in the staff tracker. Asking twice with the same email is one request. */
  requestClaim(eventId: string, who: { name: string; email: string; phone?: string; note?: string }): Promise<void>;
  /** What the claim page shows for a link. Never throws for a bad link: ok false with the reason. */
  preview(token: string): Promise<TransferPreview>;
  /**
   * Accept. Needs a signed-in viewer whose verified email is the link's ("Sign in first", "This link is for a different email"). One transaction:
   * owner set, previous owner removed, created_by updated, upcoming events moved. Works once.
   */
  accept(token: string): Promise<AcceptOutcome>;
  /** Owner of a room: start handing it to an email. The link is returned once. */
  startHandover(roomId: string, email: string): Promise<TransferLink>;
  /** Owner of a room (or staff): open and past transfers of that room, newest first. */
  transfersFor(roomId: string): Promise<Transfer[]>;
  /** Owner (or staff): cancel an open link. */
  revoke(transferId: string): Promise<void>;
}

/**
 * The staff desk (/admin): the review queue, organisers, outreach, transfers, the weekly view and the scout import.
 * The desk has the shared token and no account, so nothing here checks a viewer. Real: the token-guarded route /api/admin/outreach
 * (service role). Staff name ("who contacted") is passed by the desk; it is only a label.
 */
export interface OutreachApi {
  /* review queue */
  queue(): Promise<PulledEvent[]>;
  /** Approve a pulled row: makes (or updates) the listing, the organiser and the dormant room. A blocked row answers "blocked". */
  approve(pulledId: string, by: string, patch?: PulledPatch): Promise<{ eventId: string; organiserId: string }>;
  edit(pulledId: string, patch: PulledPatch): Promise<PulledEvent>;
  reject(pulledId: string, by: string, reason?: string): Promise<void>;
  /** Fold a duplicate into another pulled row (the other source is kept as also_at). */
  merge(pulledId: string, intoPulledId: string, by: string): Promise<void>;
  /** The scout's batch. dryRun true writes nothing and returns what would happen. */
  importBatch(batch: ScoutBatch, opts: { dryRun: boolean }): Promise<ImportReport>;
  /* organisers */
  organisers(): Promise<Organiser[]>;
  organiser(id: string): Promise<OrganiserDetail>;
  saveOrganiser(id: string, patch: OrganiserPatch): Promise<Organiser>;
  /** Log a contact or a reply. kind "contact" sets last contacted. Never changes the stage by itself. */
  logContact(id: string, input: { by: string; kind: "contact" | "reply" | "note"; channel?: ContactChannel; body: string }): Promise<void>;
  /** Move the stage by hand: offered | declined | listed (reopen). claimed is only set by accepting a transfer. declined also sets do_not_contact. */
  setStage(id: string, stage: Exclude<OrganiserStage, "claimed" | "pulled">, by: string): Promise<Organiser>;
  /**
   * Delete the organiser's events and room (they said no). confirmName must equal the organiser's name. Refused while any registration
   * (going, requested, waitlisted, checked in) or paid order exists: throws the has_registrations text naming the events. Keeps the
   * organiser row, declined and do not contact, so the next scrape does not list them again.
   */
  deleteListingAndRoom(id: string, confirmName: string, by: string): Promise<{ events: number }>;
  /* transfer */
  createTransfer(organiserId: string, email: string, by: string, days?: number): Promise<TransferLink>;
  revokeTransfer(transferId: string, by: string): Promise<void>;
  /* requests and the week */
  claimRequests(): Promise<ClaimRequest[]>;
  handleClaimRequest(id: string, by: string): Promise<void>;
  week(): Promise<WeekSummary>;
}

export interface ClockApi {
  /** Epoch ms. Real time plus an offset the fake lets a tester move (to test "Join call 15 minutes before"). */
  now(): number;
}

export interface EventsR1Api {
  mode: "fake" | "real";
  auth: AuthApi;
  events: EventsApi;
  registrations: RegistrationsApi;
  pops: PopsApi;
  rooms: RoomsApi;
  reports: ReportsApi;
  door: DoorApi;
  clock: ClockApi;
  /** Paid tickets (Bachs). Only used when paid tickets are switched on. */
  pay: PayApi;
  /** Event and room looks (pack, Day or Night, tint). */
  looks: LooksApi;
  /** Saved checkout details. */
  account: AccountApi;
  /** Claim page, "Is this your event?" and handing a room over. */
  claims: ClaimsApi;
  /** The staff desk's outreach tools. */
  outreach: OutreachApi;
}
