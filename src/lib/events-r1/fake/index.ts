/**
 * The fake Release 1 data layer: in memory, seeded with Lagos events, saved to localStorage ("hz.r1.fake.v1").
 * `fakeApi` is the EventsR1Api. `fakeDev` is for the dev panel and the check script only: the fake clock, signing in
 * as anyone, a valid ticket token for a registration, a full reset.
 */
import type { EventsR1Api } from "../api";
import type { R1Event, Registration } from "../types";
import { auth, signInUser } from "./auth";
import { door } from "./door";
import { events } from "./events";
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
    return Object.values(S().users).map((u) => ({
      ...u,
      role: u.staff ? "staff" : hosts.has(u.id) ? "host" : "guest",
    }));
  },
  signInAs(userId: string) {
    const u = S().users[userId];
    if (!u) throw new Error("No such user");
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

  /** Start over: a fresh seed, signed out, real time. */
  resetAll,
};
