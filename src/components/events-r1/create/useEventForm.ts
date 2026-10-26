"use client";

import { useEffect, useRef, useState } from "react";
import { areaByName } from "@/lib/geo";
import { useMyRooms, useR1Api, useR1Auth, useR1Now } from "@/lib/events-r1/hooks";
import type { EventDraft, EventKind, LinkType, R1Event, Visibility } from "@/lib/events-r1/types";
import { usePaidGate } from "../pay/usePay";
import { hostPayError } from "../pay/words";
import { newTicket, ticketsDraft, ticketsError } from "./Tickets";
import type { TicketForm } from "./Tickets";
import { endError, lagosIso, moveEnd } from "../dateTime";
import { bool, clearDraft, patchDraft, readDraft, str } from "./draft";
import { cleanLink, DEFAULT_LENGTH, defaultStart, detectLinkType, TIMEZONE } from "./helpers";
import type { Look } from "@/lib/events-r1/looks";

export const WA_MAX = 32;
const KIND_VALUES: EventKind[] = ["in_person", "online", "hybrid"];
const LINK_VALUES: LinkType[] = ["zoom", "meet", "whatsapp", "other"];
const WHO_VALUES: Visibility[] = ["public", "community", "invite"];

/**
 * Everything the create-an-event screen knows and does, without any layout: the draft kept as it is typed (and restored after
 * a reload or the trip out to Google), the paid gate, the sign up wall and the create call. The look (pack, colour, mood,
 * 2D room) is saved right after the event is made; a failed look never fails the event.
 * Moved here unchanged from the Release 1 EventForm so the redesigned screen (CreateEvent.tsx) keeps every rule.
 */
export function useEventForm({ cover, look }: { cover: string | null; look: Look }) {
  const api = useR1Api();
  const clock = useR1Now();
  const { user } = useR1Auth();

  const [saved] = useState(() => readDraft());
  const [d0] = useState<Record<string, unknown>>(() => saved.event ?? {});
  const resume = useRef(saved.pending === "event");
  const resumed = useRef(false);

  const [title, setTitle] = useState(() => str(d0.title));
  const [start, setStart] = useState(() => (d0.touched === true && str(d0.start) ? str(d0.start) : lagosIso(defaultStart(Date.now()))));
  const [end, setEnd] = useState(() => (d0.touched === true && str(d0.end) ? str(d0.end) : lagosIso(defaultStart(Date.now()) + DEFAULT_LENGTH)));
  const [endShown, setEndShown] = useState(() => d0.endShown === true);
  const touched = useRef(d0.touched === true);
  const [kind, setKind] = useState<EventKind>(() => (KIND_VALUES.includes(d0.kind as EventKind) ? (d0.kind as EventKind) : "in_person"));
  const [place, setPlace] = useState(() => str(d0.place));
  const [area, setArea] = useState(() => str(d0.area));
  const [linkType, setLinkType] = useState<LinkType | null>(() => (LINK_VALUES.includes(d0.linkType as LinkType) ? (d0.linkType as LinkType) : null));
  const [link, setLink] = useState(() => str(d0.link));
  const [about, setAbout] = useState(() => str(d0.about));
  const [approval, setApproval] = useState(() => bool(d0.approval));
  const [capacity, setCapacity] = useState(() => str(d0.capacity));
  const capAuto = useRef(d0.capAuto === true);
  const [waitlist, setWaitlist] = useState(() => bool(d0.waitlist));
  const [paid, setPaid] = useState(() => bool(d0.paid));
  const [tickets, setTickets] = useState<TicketForm[]>(() => {
    const t = d0.tickets;
    if (Array.isArray(t) && t.length > 0)
      return t.map((x: Record<string, unknown>) => {
        const row = newTicket(str(x?.name));
        row.price = str(x?.price);
        row.capacity = str(x?.capacity);
        return row;
      });
    return [newTicket("General")];
  });
  const [visibility, setVisibility] = useState<Visibility>(() => (WHO_VALUES.includes(d0.visibility as Visibility) ? (d0.visibility as Visibility) : "public"));
  const [addToRoom, setAddToRoom] = useState(() => bool(d0.addToRoom, true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [made, setMade] = useState<R1Event | null>(null);

  useEffect(() => {
    if (touched.current) return;
    setStart(lagosIso(defaultStart(clock)));
    setEnd(lagosIso(defaultStart(clock) + DEFAULT_LENGTH));
    // Once, when the clock first answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    patchDraft({
      mode: "event",
      event: {
        title, start, end, endShown, touched: touched.current, kind, place, area, linkType, link, about, approval, capacity,
        capAuto: capAuto.current, waitlist, paid, tickets, visibility, addToRoom,
      },
    });
  }, [title, start, end, endShown, kind, place, area, linkType, link, about, approval, capacity, waitlist, paid, tickets, visibility, addToRoom]);

  const mine = useMyRooms();
  const room = mine.data?.[0] ?? null;
  const roomOn = !!room && addToRoom;

  const online = kind !== "in_person";
  const inPerson = kind !== "online";
  const effLink: LinkType | null = online ? linkType : null;

  const syncCapacity = (t: LinkType | null) => {
    if (t === "whatsapp") {
      setCapacity(String(WA_MAX));
      capAuto.current = true;
    } else if (capAuto.current) {
      setCapacity("");
      capAuto.current = false;
    }
  };
  const pickKind = (k: EventKind) => {
    setKind(k);
    syncCapacity(k === "in_person" ? null : linkType);
  };
  const pickLink = (t: LinkType) => {
    setLinkType(t);
    syncCapacity(t);
  };
  const pasteLink = (v: string) => {
    setLink(v);
    const t = detectLinkType(v);
    if (t) pickLink(t);
  };
  const changeStart = (v: string) => {
    touched.current = true;
    setEnd(moveEnd(start, end, v));
    setStart(v);
  };
  const changeEnd = (v: string) => {
    touched.current = true;
    setEnd(v);
  };
  const changeCapacity = (v: string) => {
    capAuto.current = false;
    const d = v.replace(/\D/g, "").slice(0, 5);
    setCapacity(effLink === "whatsapp" && Number(d) > WA_MAX ? String(WA_MAX) : d);
  };
  /** Post as: yourself, or your room. Community lives in the room: leaving the room leaves Community. */
  const changeAddToRoom = (on: boolean) => {
    setAddToRoom(on);
    if (!on && visibility === "community") setVisibility("public");
  };

  const draft = (): EventDraft => {
    const a = inPerson ? areaByName(area) : undefined;
    const d: EventDraft = {
      title: title.trim(),
      starts_at: Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : undefined,
      // No end time shown: the default length still applies, as before.
      ends_at: Number.isFinite(Date.parse(end)) ? new Date(end).toISOString() : null,
      timezone: TIMEZONE,
      kind,
      description: about.trim(),
      capacity: capacity ? Number(capacity) : null,
      requires_approval: approval,
      waitlist_on: waitlist,
      visibility,
      tickets: ticketsDraft(paid, tickets),
      cover_url: cover,
    };
    if (inPerson) {
      d.place_name = place.trim();
      if (a) {
        d.area = a.name;
        d.lat = a.lat;
        d.lng = a.lng;
      }
    }
    if (online) {
      d.link_type = linkType ?? (link.trim() ? "other" : null);
      d.online_link = cleanLink(link) || null;
    }
    if (room) d.add_to_room = addToRoom;
    return d;
  };

  const create = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const ev = await api.events.create(draft());
      try {
        await api.looks.set("event", ev.id, look);
      } catch {
        /* the page falls back to the cover */
      }
      clearDraft();
      setMade(ev);
    } catch (e) {
      patchDraft({ pending: null });
      setError(paid ? hostPayError(e) : e instanceof Error ? e.message : "Try again later");
    } finally {
      setBusy(false);
    }
  };

  const gate = usePaidGate();
  const blocked = paid && gate.state !== "ready" && gate.state !== "signedout";
  const endBad = endShown ? endError(start, end) : "";

  /** What is still missing, in the order the screen asks for it. Name is the only must; the rest are nudges. */
  const missing: string[] = [];
  if (!title.trim()) missing.push("a name");
  if (inPerson && !place.trim()) missing.push("a place");
  if (online && !link.trim() && kind === "online") missing.push("a link");
  if (!cover) missing.push("a cover");

  const submit = (onTicketsError?: () => void) => {
    if (!api || busy || !title.trim() || blocked || endBad) return;
    const bad = ticketsError(paid, tickets);
    if (bad) {
      onTicketsError?.();
      setError(bad);
      return;
    }
    if (!api.auth.current()) {
      patchDraft({ pending: "event" });
      setSignIn(true);
      return;
    }
    void create();
  };

  useEffect(() => {
    if (!resume.current || resumed.current || !api) return;
    if (user) {
      resumed.current = true;
      resume.current = false;
      patchDraft({ pending: null });
      submit();
      return;
    }
    const id = window.setTimeout(() => {
      resume.current = false;
      patchDraft({ pending: null });
    }, 6000);
    return () => window.clearTimeout(id);
    // Only when the sign in state answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, user]);

  return {
    api, clock, user,
    title, setTitle, start, end, changeStart, changeEnd, endShown, setEndShown, endBad,
    kind, pickKind, place, setPlace, area, setArea, linkType, pickLink, link, pasteLink, effLink, online, inPerson,
    about, setAbout, approval, setApproval, capacity, changeCapacity, waitlist, setWaitlist,
    paid, setPaid, tickets, setTickets, visibility, setVisibility, addToRoom, changeAddToRoom, room, roomOn,
    busy, error, setError, gate, blocked, missing, submit, create,
    signIn, closeSignIn: () => {
      setSignIn(false);
      patchDraft({ pending: null });
    },
    signedIn: () => {
      setSignIn(false);
      void create();
    },
    made,
  };
}

export type EventFormState = ReturnType<typeof useEventForm>;
