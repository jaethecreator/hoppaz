/**
 * The Release 1 data layer: one small interface per need. Screens talk only to this.
 * `fake` (fake/) is in memory and seeded; `real` (real/) calls Ola's functions later.
 * Picked by getApi() in index.ts from NEXT_PUBLIC_EVENTS_R1_FAKE.
 */
import type {
  AuthUser, EventChat, EventDraft, Pop, PopAudience, R1Event, RegMessages, RegQuestion, Registration,
  Report, ReportReason, RoomAnnouncement, RoomDraft, RoomSummary, ScanResult, Ticket, ViewerState,
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
  subscribe(fn: () => void): Unsub;
}

export interface RegistrationsApi {
  /** Register. Outcome depends on approval and capacity: going, requested or waitlisted. Needs a signed-in viewer. */
  register(eventId: string, opts?: { answers?: Record<string, string>; referrerId?: string | null }): Promise<Registration>;
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
  /** Own invite link id: use as ?ref= on shared links. */
  inviteRef(eventId: string): string;
}

export interface PopsApi {
  /** Host: Pops for this event, newest first, including scheduled and automatic. */
  listForEvent(eventId: string): Promise<Pop[]>;
  /** Pops shown on the event page (sent ones, to people who can see them). */
  visibleOnEvent(eventId: string): Promise<Pop[]>;
  send(input: { eventId: string; body: string; audience: PopAudience; alsoRoom: boolean; sendAt?: string | null }): Promise<Pop>;
  /** Share to WhatsApp: text plus the event link. */
  shareText(popId: string): Promise<string>;
}

export interface RoomsApi {
  /** Rooms tab: Hoppaz HQ first, then the viewer's rooms, then discoverable rooms. */
  list(): Promise<{ hq: RoomSummary; mine: RoomSummary[]; discover: RoomSummary[]; eventChats: EventChat[] }>;
  get(idOrSlug: string): Promise<RoomSummary | null>;
  create(draft: RoomDraft): Promise<RoomSummary>;
  join(roomId: string): Promise<void>;
  /** Announcements, newest first. Includes event Pops tagged with the event. */
  announcements(roomId: string): Promise<RoomAnnouncement[]>;
  /** Plain room announcement (never shows on an event). */
  postAnnouncement(roomId: string, body: string): Promise<RoomAnnouncement>;
  eventChats(roomId: string): Promise<EventChat[]>;
  eventChat(eventId: string): Promise<EventChat | null>;
  /** The viewer has seen the room's announcements: unread goes to 0. */
  markRead(roomId: string): Promise<void>;
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
}
