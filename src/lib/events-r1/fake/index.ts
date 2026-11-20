/**
 * The fake Release 1 data layer: in memory, seeded with Lagos events, saved to localStorage ("hz.r1.fake.v1").
 * `fakeApi` is the EventsR1Api. `fakeDev` is for the dev panel and the check script only: the fake clock, signing in
 * as anyone, a valid ticket token for a registration, a full reset.
 */
import type { EventsR1Api } from "../api";
import { CLAIMS_KEY, EVENT_CLAIMS, eventClaimsOn, OPEN_ROOMS_KEY, openOrganiserRoomsOn, PAID_KEY, PAID_TICKETS, paidTicketsOn } from "../flags";
import type { HostPayoutStatus, PayMethod } from "../pay";
import type { R1Event, Registration } from "../types";
import { account } from "./account";
import { auth, signInUser } from "./auth";
import { door } from "./door";
import { events } from "./events";
import { fakeLooks } from "./looks";
import { completeCheckout, expireCheckout, failCheckout, hostBalance, pay, peekOrder, settleRefund } from "./pay";
import { payoutFor, setPayoutStatus, statusOfHost } from "./payouts";
import { claims, faults, outreach } from "./outreach";
import { pops } from "./pops";
import { registrationCode, registrations, ticketFrom } from "./registrations";
import { reports } from "./reports";
import { eventView, isGoing, regsOf } from "./rules";
import { rooms } from "./rooms";
import { emit, now, resetAll, S, STORAGE_KEY } from "./store";
import type { UserRec } from "./store";

export const fakeApi: EventsR1Api = {
  mode: "fake",
  auth,
  events,
  registrations,
  pops,
  rooms,
  reports,
  door,
  clock: { now },
  pay,
  looks: fakeLooks,
  account,
  claims,
  outreach,
};

export type SampleTicket = { registrationId: string; name: string; code: string; token: string };

export const fakeDev = {
  storageKey: STORAGE_KEY,

  /** Fake clock. */
  getOffset: () => S().offset,
  setOffset(ms: number) {
    S().offset = ms;
    emit();
  },
  advance(ms: number) {
    S().offset += ms;
    emit();
  },
  /** Move the fake clock so now is `ms` before an absolute time. */
  jumpTo(epochMs: number) {
    S().offset = epochMs - Date.now();
    emit();
  },
  resetClock() {
    S().offset = 0;
    emit();
  },

  /** Everyone who can be signed in as: the guest, the hosts and staff. */
  users(): Array<UserRec & { role: "guest" | "host" | "staff" }> {
    const hosts = new Set(Object.values(S().events).map((e) => e.host_id));
    return Object.values(S().users).filter((u) => !u.hidden).map((u) => ({
      ...u,
      role: u.staff ? "staff" : hosts.has(u.id) ? "host" : "guest",
    }));
  },
  signInAs(userId: string) {
    const u = S().users[userId];
    if (!u || u.hidden) throw new Error("No such user");
    return signInUser(u);
  },

  /** Every event whatever its visibility or status, with the online link shown (the dev table). */
  allEvents(): R1Event[] {
    return Object.values(S().events)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((e) => eventView(e, { revealLink: true }));
  },

  /** A valid QR token for one registration (it must be going or checked in). */
  async tokenFor(registrationId: string): Promise<string | null> {
    const reg = S().regs[registrationId];
    return reg ? ((await ticketFrom(reg))?.token ?? null) : null;
  },
  codeFor(registrationId: string): string | null {
    const reg = S().regs[registrationId];
    return reg ? registrationCode(reg) : null;
  },
  /** A ticket for the first person going to the event who is not checked in yet. */
  async sampleTicket(eventId: string): Promise<SampleTicket | null> {
    const reg: Registration | undefined = regsOf(eventId).find((r) => r.status === "going") ?? regsOf(eventId).find((r) => isGoing(r.status));
    if (!reg) return null;
    const t = await ticketFrom(reg);
    return t ? { registrationId: reg.id, name: reg.name, code: t.code, token: t.token } : null;
  },

  /** Give a room a walkable 3D room (or take it away): Enter room and the HQ button follow it. */
  setHas3d(roomId: string, on: boolean) {
    const r = S().rooms[roomId];
    if (!r) throw new Error("No such room");
    r.has_3d = on;
    emit();
  },

  /** The demo switch for paid tickets (the build flag, when it is on, wins and cannot be switched off here). */
  paidOn: paidTicketsOn,
  paidLockedByBuild: PAID_TICKETS,
  /** The demo switch for "claim an event" (the build flag, when it is on, wins and cannot be switched off here). */
  claimsOn: eventClaimsOn,
  claimsLockedByBuild: EVENT_CLAIMS,
  setClaims(on: boolean) {
    try {
      if (on) window.localStorage.setItem(CLAIMS_KEY, "1");
      else window.localStorage.removeItem(CLAIMS_KEY);
    } catch {
      /* private mode: the switch cannot be kept */
    }
    emit();
  },
  /** The demo switch for open organiser rooms (CHANGE-006; the database's open_organiser_rooms). On unless switched off here. */
  openRoomsOn: openOrganiserRoomsOn,
  setOpenRooms(on: boolean) {
    try {
      if (on) window.localStorage.removeItem(OPEN_ROOMS_KEY);
      else window.localStorage.setItem(OPEN_ROOMS_KEY, "0");
    } catch {
      /* private mode: the switch cannot be kept */
    }
    emit();
  },
  setPaid(on: boolean) {
    try {
      if (on) window.localStorage.setItem(PAID_KEY, "1");
      else window.localStorage.removeItem(PAID_KEY);
    } catch {
      /* private mode: the switch cannot be kept */
    }
    emit();
  },

  /** A host's Bachs setup: what Host payouts shows, and whether paid types can be saved and bought. */
  payoutStatus: statusOfHost,
  payoutOf: payoutFor,
  setPayoutOf(userId: string, status: HostPayoutStatus) {
    if (!S().users[userId]) throw new Error("No such user");
    setPayoutStatus(userId, status);
    emit();
  },
  hostBalance,

  /** The fake Bachs: what the hosted pages and webhooks do. Used by /dev/fake-bachs/* and the check script. */
  peekOrder,
  completeCheckout: (orderId: string, method: PayMethod) => completeCheckout(orderId, method),
  failCheckout,
  expireCheckout,
  settleRefund,

  /** Test seam: make one step of accepting a transfer fail ("owner", "events", "organiser", "transfer", "others"), or null to stop. */
  failAcceptAt(step: string | null) {
    faults.acceptStep = step;
  },

  /** Start over: a fresh seed, signed out, real time. */
  resetAll,
};
