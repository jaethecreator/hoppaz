"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useR1Api, useR1Auth, useViewerState } from "@/lib/events-r1/hooks";
import type { Quote } from "@/lib/events-r1/pay";
import type { R1Event, RegQuestion } from "@/lib/events-r1/types";
import { buttonFromEvent, registerLabel } from "../labels";
import { MAX_QTY } from "../pay/PayQuantity";
import { usePaidOn } from "../pay/usePay";
import { buyError, naira } from "../pay/words";
import { defaultType, pickable } from "./TicketPicker";

export type Phase = "idle" | "signin" | "form" | "busy";

/** Who sent this link, from ?ref= (the inviter's own id, so the host sees who brought whom). */
const refFromUrl = (): string | null => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("ref"));

/**
 * The Register flow, inline: sign in if needed, the host's questions if there are any, then register. The result is not
 * returned: the store changes, the viewer state reloads, and every screen showing this event moves to the new state.
 *
 * A paid ticket (paid tickets on) runs the same steps, then asks for a checkout and sends the person to the hosted Bachs
 * page. It issues nothing: the ticket arrives with the verified payment, and the person comes back to /tickets/return.
 */
export function useRegisterFlow(event: R1Event, preview = false) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const { data: real } = useViewerState(event.id);
  // "View as visitor": the host's own state is swapped for a stranger's, so the buttons read as a guest sees them. They do nothing (start is a no-op below).
  const viewer = useMemo(
    () => (preview && real ? { ...real, signedIn: false, isHost: false, interested: false, registration: null, button: buttonFromEvent(event), canSeeOnlineLink: false, joinCallOpen: false } : real),
    [preview, real, event]
  );
  const paidOn = usePaidOn();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  // A payment the person started and did not finish: the hosted page can be opened again.
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  // More than one ticket type: the person picks one first. The choice stands if it can still be taken, else the default.
  const multi = (event.ticket_types?.length ?? 0) > 1;
  const chosen = event.ticket_types?.find((t) => t.id === typeId);
  const selected = multi ? (chosen && pickable(chosen, event, paidOn) ? chosen : defaultType(event, paidOn)) : null;
  const selectedId = selected?.id;
  // The paid ticket this button would buy: the chosen type, or the only type of the event.
  const wanted = selected ?? (multi ? null : (event.ticket_types?.[0] ?? null));
  const paidType = paidOn && wanted && wanted.price_naira > 0 ? wanted : null;
  const maxQty = paidType ? Math.max(1, Math.min(MAX_QTY, paidType.spots_left ?? MAX_QTY)) : 1;
  const count = Math.min(qty, maxQty);
  const total = paidType ? (quote && quote.quantity === count && quote.unit_price_naira === paidType.price_naira ? quote.gross_naira : paidType.price_naira * count) : 0;
  let label = registerLabel(viewer, event, { on: paidOn });
  // The chosen type is full and the event has a waitlist: the button joins it.
  if (selected && selected.price_naira === 0 && selected.spots_left === 0 && (label.kind === "register" || label.kind === "request")) label = registerLabel({ button: "waitlist" });
  // A paid ticket: the button says what it costs. Sold out has no waitlist.
  if (paidType && !label.status && label.kind !== "closed" && label.kind !== "declined") {
    label =
      paidType.spots_left === 0
        ? { kind: "get_ticket", text: "Sold out", disabled: true, status: false }
        : { kind: "get_ticket", text: `Get ticket · ${naira(total)}`, disabled: false, status: false };
  }
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  // Registered from this page just now: the event page shows the big "You're going" header once.
  const [justDone, setJustDone] = useState(false);
  const [questions, setQuestions] = useState<RegQuestion[]>([]);
  // Who is paying, from the checkout sheet: { name, email, phone } added to the answers (the host's Audience reads the phone from there).
  // Null on the one-tap free register, which keeps using the account's name and email.
  const contact = useRef<Record<string, string> | null>(null);
  const setContact = useCallback((c: Record<string, string> | null) => {
    contact.current = c;
  }, []);

  // What the buyer pays, from the data layer (one price: Hoppaz's fee is inside it).
  const paidId = paidType?.id;
  useEffect(() => {
    if (!api || !paidId) {
      setQuote(null);
      return;
    }
    let live = true;
    api.pay.quote(event.id, paidId, count).then(
      (q) => live && setQuote(q),
      () => live && setQuote(null)
    );
    return () => {
      live = false;
    };
  }, [api, event.id, paidId, count]);

  // An order the person left open: offer Continue to payment (seats stay held until it ends).
  const signedIn = !!viewer?.signedIn;
  const registered = !!viewer?.registration;
  const findOpen = useCallback(async () => {
    if (!api) return null;
    try {
      const mine = await api.pay.myOrders();
      return mine.find((o) => o.event_id === event.id && o.status === "open" && o.checkout_url)?.checkout_url ?? null;
    } catch {
      return null;
    }
  }, [api, event.id]);
  useEffect(() => {
    if (!paidOn || !signedIn || registered) {
      setOpenUrl(null);
      return;
    }
    let live = true;
    void findOpen().then((u) => live && setOpenUrl(u));
    return () => {
      live = false;
    };
  }, [paidOn, signedIn, registered, findOpen, viewer]);

  // Coming back with the browser's Back button from the payment page: the page is restored as it was, so unstick it.
  useEffect(() => {
    const back = (e: PageTransitionEvent) => {
      if (e.persisted) setPhase((p) => (p === "busy" ? "idle" : p));
    };
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);

  const submit = useCallback(
    async (given: Record<string, string>, asked: boolean) => {
      if (!api) return;
      const answers = contact.current ? { ...given, ...contact.current } : given;
      setPhase("busy");
      setError("");
      try {
        if (paidId) {
          // Reserve the seats and go to the hosted page. The phase stays busy: the page is leaving.
          const c = await api.pay.checkout(event.id, paidId, count, { answers, referrerId: refFromUrl() });
          window.location.assign(c.checkout_url);
          return;
        }
        await api.registrations.register(event.id, { ticketTypeId: selectedId, answers, referrerId: refFromUrl() });
        setJustDone(true);
        setPhase("idle");
      } catch (e) {
        setError(paidId ? buyError(e) : e instanceof Error ? e.message : "That did not work. Try again.");
        if (paidId) setOpenUrl(await findOpen());
        setPhase(asked ? "form" : "idle");
      }
    },
    [api, event.id, selectedId, paidId, count, findOpen]
  );

  /** Signed in: ask the questions the host switched on (Name and Email come from the account), or register at once. */
  const proceed = useCallback(async () => {
    if (!api) return;
    setPhase("busy");
    setError("");
    try {
      const s = await api.events.getRegistrationSettings(event.id);
      // The checkout asks for the phone itself, so the host's Phone question is not asked twice.
      const ask = s.questions.filter((q) => q.enabled !== false && q.builtin !== "name" && q.builtin !== "email" && !(contact.current && q.builtin === "phone"));
      if (ask.length) {
        setQuestions(ask);
        setPhase("form");
        return;
      }
    } catch {
      // No settings to read: there are no questions.
    }
    await submit({}, false);
  }, [api, event.id, submit]);

  const start = useCallback(() => {
    if (preview || !api || !viewer || label.disabled || label.status || phase === "busy") return;
    if (!viewer.signedIn) setPhase("signin");
    else void proceed();
  }, [preview, api, viewer, label.disabled, label.status, phase, proceed]);

  return {
    ready: !!api && !!viewer,
    viewer,
    label,
    user,
    phase,
    error,
    questions,
    multi,
    selected,
    selectType: setTypeId,
    paidOn,
    paid: paidType,
    qty: count,
    maxQty,
    total,
    setQty,
    openUrl: preview ? null : openUrl,
    start,
    /** The sign-up wall on its own (checkout opens after it). */
    askSignIn: () => {
      if (!preview) setPhase("signin");
    },
    setContact,
    justDone,
    proceed,
    submit,
    cancel: () => {
      setPhase("idle");
      setError("");
    },
  };
}
