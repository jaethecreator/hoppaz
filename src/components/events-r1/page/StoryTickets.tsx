"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { X } from "lucide-react";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import type { R1Event, TicketType } from "@/lib/events-r1/types";
import SignInSheet from "../SignInSheet";
import { MAX_QTY } from "../pay/PayQuantity";
import { naira } from "../pay/words";
import QuestionsForm from "./QuestionsForm";
import { pickable } from "./TicketPicker";
import { useRegisterFlow } from "./useRegisterFlow";

/**
 * The tickets of the Host Story event page (build brief section 9, "Tickets under the cover"): every tier with its own − / +,
 * a running total, and one button that opens the checkout sheet. On a phone a bar follows you at the bottom.
 *
 * Everything runs on the Release 1 flow (useRegisterFlow): sign in, the host's questions, then a free registration or the
 * hosted Bachs payment. One order holds one ticket type (the payment layer sells one type per checkout), so + on another
 * tier moves the pick there. A free tier is one place per person.
 */
export type StoryTickets = ReturnType<typeof useStoryTickets>;

export function useStoryTickets(event: R1Event, preview = false) {
  const flow = useRegisterFlow(event, preview);
  const [pick, setPick] = useState<{ id: string; n: number } | null>(null);
  const [moved, setMoved] = useState(false);
  const [sheet, setSheet] = useState(false);
  const { selectType, setQty } = flow;

  useEffect(() => {
    if (!pick) return;
    selectType(pick.id);
    setQty(pick.n);
  }, [pick, selectType, setQty]);

  const types = event.ticket_types ?? [];
  const free = types.length === 1 && types[0].price_naira === 0;
  const maxFor = (t: TicketType) => (t.price_naira === 0 ? 1 : Math.max(0, Math.min(MAX_QTY, t.spots_left ?? MAX_QTY)));
  const canPick = (t: TicketType) => pickable(t, event, flow.paidOn) && maxFor(t) > 0;
  const plus = (t: TicketType) => {
    if (!canPick(t)) return;
    setMoved(!!pick && pick.id !== t.id);
    setPick((p) => (p && p.id === t.id ? { id: t.id, n: Math.min(maxFor(t), p.n + 1) } : { id: t.id, n: 1 }));
  };
  const minus = (t: TicketType) => {
    setMoved(false);
    setPick((p) => (p && p.id === t.id ? (p.n > 1 ? { id: t.id, n: p.n - 1 } : null) : p));
  };
  const chosen = pick ? types.find((t) => t.id === pick.id) ?? null : null;
  const n = pick?.n ?? 0;
  const total = chosen && chosen.price_naira > 0 ? flow.total : 0;
  const prices = types.filter((t) => t.price_naira > 0 && t.spots_left !== 0).map((t) => t.price_naira);
  const from = types.some((t) => t.price_naira === 0) || !prices.length ? 0 : Math.min(...prices);

  const host = !!flow.viewer?.isHost;
  const done = !!flow.viewer?.registration || flow.label.status;
  // Closed, ended, sold out with no waitlist, or paid tickets off: the button says so and nothing can be picked.
  const shut = flow.label.disabled && !flow.paid;
  const word = (k: number) => `${k} ticket${k === 1 ? "" : "s"}`;
  const cta =
    free || (chosen && chosen.price_naira === 0)
      ? flow.label.text
      : n
        ? `Get ${word(n)} · ${naira(total)}`
        : "Get tickets";

  /** The main button: a free event registers at once (name and email come from the account); anything else opens checkout. */
  const go = () => {
    if (preview) return;
    if (free) flow.start();
    else if (n) setSheet(true);
  };

  // Registered (or the payment page is opening): the sheet has done its job.
  const registered = !!flow.viewer?.registration;
  useEffect(() => {
    if (registered) setSheet(false);
  }, [registered]);

  return { event, flow, types, free, pick, n, chosen, total, from, moved, plus, minus, canPick, maxFor, host, done, shut, cta, go, word, sheet, setSheet, preview };
}

const qtyBtn = "grid h-8 w-8 place-items-center rounded-hz border border-t-line bg-t-bg font-body text-[18px] font-semibold leading-none shadow-[0_2px_0_var(--t-line)] active:translate-y-[2px] active:shadow-none disabled:opacity-35 disabled:shadow-none max-lg:h-[38px] max-lg:w-[38px]";

/** The ticket card under the cover. */
export function TicketCard({ t, anchor }: { t: StoryTickets; anchor: RefObject<HTMLDivElement | null> }) {
  const { flow, types, free, pick } = t;
  const busy = flow.phase === "busy";
  const resume = !t.done && flow.openUrl;
  const allPaidOff = !flow.paidOn && types.every((x) => x.price_naira > 0);

  return (
    <div ref={anchor} className="scroll-mt-4 overflow-hidden rounded-hz border border-t-line bg-t-tile">
      <div className="flex items-baseline justify-between border-b border-t-line px-4 py-3">
        <b className="font-body text-[14px]">{types.length > 1 || !free ? "Tickets" : "Registration"}</b>
        <span className="font-body text-[12px] text-t-muted">{free ? "Free" : "Card or transfer fee added at payment"}</span>
      </div>
      {types.map((x) => {
        const on = pick?.id === x.id;
        const out = x.spots_left === 0 && !(x.price_naira === 0 && t.event.waitlist_on);
        const left = x.spots_left !== null && x.spots_left > 0 && x.spots_left <= 20 ? `${x.spots_left} left` : "";
        return (
          <div key={x.id} className={`grid grid-cols-[1fr_auto] items-center gap-3 border-b border-t-line px-4 py-3 max-lg:py-4 ${on ? "bg-t-soft" : ""} ${out ? "opacity-50" : ""}`}>
            <div className="min-w-0">
              <b className="block font-body text-[14.5px] leading-tight">{x.name}</b>
              <span className="block font-body text-[12.5px] text-t-muted">{out ? "Sold out" : x.spots_left === 0 ? "Full: join the waitlist" : left}</span>
              <span className="mt-0.5 block font-display text-[16px] font-extrabold">{naira(x.price_naira)}</span>
            </div>
            {!free && (
              <div className="flex items-center gap-1 max-lg:gap-2">
                <button type="button" className={qtyBtn} aria-label={`One less ${x.name}`} disabled={!on || busy} onClick={() => t.minus(x)}>
                  −
                </button>
                <output className="min-w-[26px] text-center font-body text-[15px] font-bold tabular-nums" aria-live="polite">
                  {on ? pick.n : 0}
                </output>
                <button
                  type="button"
                  className={`${qtyBtn} ${t.canPick(x) && !(on && pick.n >= t.maxFor(x)) ? "!border-transparent !bg-t-accent !text-t-on !shadow-[0_2px_0_var(--t-ember)]" : ""}`}
                  aria-label={`One more ${x.name}`}
                  disabled={!t.canPick(x) || (on && pick.n >= t.maxFor(x)) || busy}
                  onClick={() => t.plus(x)}
                >
                  +
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="grid gap-2.5 px-4 py-3">
        {!free && (
          <div className="flex items-baseline justify-between font-body text-[13.5px] text-t-muted">
            <span>{t.n ? t.word(t.n) : "No tickets picked"}</span>
            <b className="font-display text-[18px] font-extrabold tabular-nums text-t-text">{t.chosen && t.chosen.price_naira === 0 ? "Free" : naira(t.total)}</b>
          </div>
        )}
        {t.moved && <p className="font-body text-[12.5px] text-t-muted">One ticket type per order. Your pick moved to {t.chosen?.name}.</p>}
        {resume ? (
          <div className="grid gap-2">
            <p className="font-body text-[13.5px]">You have a payment open for this event. Your seats are held for a few minutes.</p>
            <button type="button" className="lip w-full" onClick={() => window.location.assign(resume)}>
              Continue to payment
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="lip w-full"
            aria-disabled={t.shut || (!free && !t.n) || !flow.ready}
            disabled={busy}
            onClick={() => !t.shut && flow.ready && t.go()}
          >
            {busy ? "One moment" : t.shut ? flow.label.text : t.cta}
          </button>
        )}
        <span className="text-center font-body text-[11.5px] text-t-muted">
          {allPaidOff ? PAID_UNAVAILABLE : free || (t.chosen && t.chosen.price_naira === 0) ? "Your ticket comes with a QR code for the door" : "You'll pay on the next step"}
        </span>
        {t.preview && (
          <span className="text-center font-body text-[11.5px] text-t-muted" data-visitor-note>
            Preview only. This button works for guests, not for you.
          </span>
        )}
        {flow.error && !t.sheet && (
          <p role="alert" className="font-body text-[13px] text-[#E5484D]">
            {flow.error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Phone only: the bar that follows you. "Select tickets" scrolls to the card until something is picked, then opens checkout. */
export function TicketBar({ t, anchor, line }: { t: StoryTickets; anchor: RefObject<HTMLDivElement | null>; line: string }) {
  if (t.host || t.done) return null;
  const { flow } = t;
  const resume = flow.openUrl;
  if (resume)
    return (
      <div className="sticky bottom-0 z-30 flex items-center gap-3.5 border-t border-t-line bg-t-bar px-[22px] pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3.5 backdrop-blur-md lg:hidden">
        <div className="min-w-0">
          <b className="block font-display text-[17px] font-extrabold leading-tight">Payment open</b>
          <span className="block truncate font-body text-[12.5px] text-t-muted">Your seats are held for a few minutes</span>
        </div>
        <button type="button" className="lip ml-auto !px-5" onClick={() => window.location.assign(resume)}>
          Continue
        </button>
      </div>
    );
  const toCard = () => anchor.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const headline = t.n ? (t.chosen?.price_naira ? naira(t.total) : "Free") : t.free || !t.from ? "Free" : `From ${naira(t.from)}`;
  const text = t.free ? flow.label.text : t.n ? (t.chosen?.price_naira ? "Get tickets" : flow.label.text) : "Select tickets";
  return (
    <div className="sticky bottom-0 z-30 flex items-center gap-3.5 border-t border-t-line bg-t-bar px-[22px] pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3.5 backdrop-blur-md lg:hidden">
      <div className="min-w-0">
        <b className="block font-display text-[17px] font-extrabold leading-tight tabular-nums">{headline}</b>
        <span className="block truncate font-body text-[12.5px] text-t-muted">{t.n ? `${t.word(t.n)} picked` : line}</span>
      </div>
      <button
        type="button"
        className="lip ml-auto !px-5"
        aria-disabled={t.shut || !flow.ready}
        disabled={flow.phase === "busy"}
        onClick={() => {
          if (t.shut || !flow.ready) return;
          if (t.free || t.n) t.go();
          else toCard();
        }}
      >
        {t.shut ? flow.label.text : text}
      </button>
    </div>
  );
}

/** The checkout sheet: the event, what you picked, the total, then Pay (or Confirm). The host's questions open inside it. */
export function CheckoutSheet({ t, cover, when }: { t: StoryTickets; cover: string; when: string }) {
  const { flow, event } = t;
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    t.setSheet(false);
    flow.cancel();
  };
  useEffect(() => {
    if (!t.sheet) return;
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.sheet]);

  const paid = !!t.chosen && t.chosen.price_naira > 0;
  return (
    <>
      {t.sheet && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 lg:items-center lg:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div
            ref={box}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={paid ? "Checkout" : "Register"}
            className="max-h-[88dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-t-[22px] bg-t-solid text-t-text shadow-2xl outline-none lg:rounded-hz"
          >
            <div className="flex items-center gap-2.5 border-b border-t-line px-4 py-3.5">
              <b className="font-display text-[17px] font-extrabold">{paid ? "Checkout" : "Register"}</b>
              <button type="button" onClick={close} aria-label="Close" className="ml-auto grid h-8 w-8 place-items-center rounded-hz border border-t-line">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3.5">
              <div className="flex items-center gap-2.5">
                <img src={cover} alt="" className="h-11 w-11 flex-none rounded-hz object-cover" />
                <div className="min-w-0">
                  <b className="block truncate font-body text-[14px] leading-tight">{event.title}</b>
                  <span className="block truncate font-body text-[12.5px] text-t-muted">{when}</span>
                </div>
              </div>
              {t.chosen && (
                <div className="flex justify-between py-1 font-body text-[14px]">
                  <span>
                    {t.n} × {t.chosen.name}
                  </span>
                  <span className="tabular-nums">{paid ? naira(t.total) : "Free"}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-t-line pt-2.5">
                <span className="font-body text-[14px]">Total</span>
                <b className="font-display text-[20px] font-extrabold tabular-nums">{paid ? naira(t.total) : "Free"}</b>
              </div>
              {flow.phase === "form" ? (
                <div className="t-adopt">
                  <QuestionsForm
                    questions={flow.questions}
                    who={flow.user?.name ?? null}
                    busy={false}
                    submitText={paid ? `Pay ${naira(t.total)}` : "Confirm registration"}
                    onSubmit={(answers) => void flow.submit(answers, true)}
                    onCancel={flow.cancel}
                  />
                </div>
              ) : (
                <button type="button" className="lip w-full" disabled={flow.phase === "busy" || !flow.ready} onClick={flow.start}>
                  {flow.phase === "busy" ? "One moment" : paid ? `Pay ${naira(t.total)}` : "Confirm registration"}
                </button>
              )}
              {flow.error && (
                <p role="alert" className="font-body text-[13px] text-[#E5484D]">
                  {flow.error}
                </p>
              )}
              <span className="font-body text-[12px] text-t-muted">
                {paid ? "Card, bank transfer or USSD on the next page. Your tickets and QR code land in the app." : "Your ticket and QR code land in the app."}
              </span>
            </div>
          </div>
        </div>
      )}
      <SignInSheet
        open={flow.phase === "signin"}
        reason={paid ? `Buy a ticket for ${event.title}` : `Register for ${event.title}`}
        onClose={flow.cancel}
        onSignedIn={() => void flow.proceed()}
      />
    </>
  );
}
