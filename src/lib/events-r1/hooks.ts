"use client";

/**
 * React hooks over the Release 1 data layer. Screens use these (or loadApi() for actions) and never import the fake.
 *
 * useR1Query reloads whenever the store changes (events.subscribe), so a Register in one place updates every screen
 * showing that event. Errors are returned, never thrown: a failed read shows as `error`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventsR1Api } from "./api";
import { loadApi } from "./index";
import type { AuthUser } from "./types";

/** The data layer, or null for the first moment while it loads (it is fetched once and kept). */
export function useR1Api(): EventsR1Api | null {
  const [api, setApi] = useState<EventsR1Api | null>(null);
  useEffect(() => {
    let live = true;
    loadApi().then((a) => {
      if (live) setApi(a);
    }, () => {});
    return () => {
      live = false;
    };
  }, []);
  return api;
}

/** Listen for store changes. The real layer is not wired yet and throws: then there is simply nothing to listen to. */
function listen(api: EventsR1Api, fn: () => void): (() => void) | undefined {
  try {
    return api.events.subscribe(fn);
  } catch {
    return undefined;
  }
}

export type R1Query<T> = {
  data: T | null;
  /** True until the first answer for these deps. A reload after a store change keeps the old data and does not set it. */
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
};

/**
 * Run `fn(api)` when the api is ready and again when `deps` change or the store emits.
 * Keep `fn` pure in what it reads from: put everything it uses (ids, flags) in `deps`.
 */
export function useR1Query<T>(fn: (api: EventsR1Api) => Promise<T>, deps: ReadonlyArray<unknown>): R1Query<T> {
  const api = useR1Api();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: Error | null }>({ data: null, loading: true, error: null });
  /** Only the newest answer counts. */
  const seq = useRef(0);
  const depKey = JSON.stringify(deps);

  const run = useCallback(async () => {
    if (!api) return;
    const mine = ++seq.current;
    try {
      const data = await fnRef.current(api);
      if (mine === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ data: s.data, loading: false, error: e instanceof Error ? e : new Error(String(e)) }));
    }
  }, [api]);

  // New deps start a new query: loading again, old data cleared.
  useEffect(() => {
    setState({ data: null, loading: true, error: null });
  }, [depKey]);

  useEffect(() => {
    void run();
  }, [run, depKey]);

  useEffect(() => (api ? listen(api, () => void run()) : undefined), [api, run]);

  return { ...state, reload: run };
}

export const useR1Events = () => useR1Query((api) => api.events.list(), []);

export const useR1Event = (idOrSlug: string | null | undefined) =>
  useR1Query((api) => (idOrSlug ? api.events.get(idOrSlug) : Promise.resolve(null)), [idOrSlug]);

/** What the one button on the event page should be for this viewer, and the viewer's registration. */
export const useViewerState = (eventId: string | null | undefined) =>
  useR1Query((api) => (eventId ? api.events.viewerState(eventId) : Promise.resolve(null)), [eventId]);

export const useRooms = () => useR1Query((api) => api.rooms.list(), []);

/** One room by id or slug ("hq" is Lagos HQ). null when there is none. */
export const useRoom = (idOrSlug: string | null | undefined) =>
  useR1Query((api) => (idOrSlug ? api.rooms.get(idOrSlug) : Promise.resolve(null)), [idOrSlug]);

/** The rooms the viewer owns (create offers "Add to <room>" from this). */
export const useMyRooms = () => useR1Query((api) => api.rooms.mine(), []);

/** A room's events, upcoming first, then past. */
export const useRoomEvents = (roomId: string | null | undefined) =>
  useR1Query((api) => (roomId ? api.events.listForRoom(roomId) : Promise.resolve([])), [roomId]);

/** The event chats of a room the viewer cares about. */
export const useRoomChats = (roomId: string | null | undefined) =>
  useR1Query((api) => (roomId ? api.rooms.eventChats(roomId) : Promise.resolve([])), [roomId]);

/** One event's chat (null when the event has no room). */
export const useEventChat = (eventId: string | null | undefined) =>
  useR1Query((api) => (eventId ? api.rooms.eventChat(eventId) : Promise.resolve(null)), [eventId]);

/** Chat lines of a room: channel "general", or an event id for that event's chat. */
export const useRoomMessages = (roomId: string | null | undefined, channel: string) =>
  useR1Query((api) => (roomId ? api.rooms.messages(roomId, channel) : Promise.resolve([])), [roomId, channel]);

export const useAnnouncements = (roomId: string | null | undefined) =>
  useR1Query((api) => (roomId ? api.rooms.announcements(roomId) : Promise.resolve([])), [roomId]);

/** Host: the Audience list. Errors with "Not allowed" for anyone else. */
export const useRegistrations = (eventId: string | null | undefined) =>
  useR1Query((api) => (eventId ? api.registrations.list(eventId) : Promise.resolve([])), [eventId]);

/** "visible" (default): the sent Pops a guest sees on the event page. "host": every Pop incl. scheduled and automatic. */
export const usePops = (eventId: string | null | undefined, scope: "visible" | "host" = "visible") =>
  useR1Query(
    (api) => (!eventId ? Promise.resolve([]) : scope === "host" ? api.pops.listForEvent(eventId) : api.pops.visibleOnEvent(eventId)),
    [eventId, scope]
  );

/** Who is signed in, and the sign-in actions. `ready` is false until the data layer has loaded. */
export function useR1Auth() {
  const api = useR1Api();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!api) return;
    const read = () => setUser(api.auth.current());
    read();
    return listen(api, read);
  }, [api]);

  const need = (): EventsR1Api => {
    if (!api) throw new Error("Not ready yet");
    return api;
  };

  return {
    ready: !!api,
    user,
    sendCode: (email: string) => need().auth.sendCode(email),
    verifyCode: (email: string, code: string, name?: string) => need().auth.verifyCode(email, code, name),
    google: () => need().auth.google(),
    signOut: () => need().auth.signOut(),
  };
}

/** The clock in epoch ms (fake clock aware). Re-renders every 30 seconds and whenever the clock is moved. */
export function useR1Now(): number {
  const api = useR1Api();
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!api) return;
    const tick = () => setT(api.clock.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    const off = listen(api, tick);
    return () => {
      window.clearInterval(id);
      off?.();
    };
  }, [api]);
  return t;
}
