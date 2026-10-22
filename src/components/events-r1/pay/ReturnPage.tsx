"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, MessageCircle } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { downloadIcs } from "@/components/events-r1/page/calendar";
import { useR1Api, useR1Auth, useR1Event } from "@/lib/events-r1/hooks";
import type { Order } from "@/lib/events-r1/pay";
import TicketCards from "./TicketCards";
import { usePaidOn } from "./usePay";
import { naira, ticketsWord } from "./words";

const EVERY = 2500;
const GIVE_UP = 3 * 60_000;

/**
 * The page the buyer lands on after Bachs: "Confirming your payment" until the order is paid, expired or failed.
 * It only reads the order (pay.order) and shows what it says. A ticket appears only when the order is paid.
 */
export default function ReturnPage() {
  const search = useSearchParams();
  const orderId = search.get("order");
  const api = useR1Api();
  const { user } = useR1Auth();
  const paidOn = usePaidOn();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);
  const [asked, setAsked] = useState(true);
  const signedIn = api ? !!user : null;

  // Ask every 2.5 seconds until the order leaves "open", for up to 3 minutes. Refresh starts a new round.
  useEffect(() => {
    if (!api || !orderId || !signedIn) return;
    let live = true;
    let timer: number | undefined;
    const began = Date.now();
    setSlow(false);
    setMissing(false);
    const ask = async () => {
      try {
        const o = await api.pay.order(orderId);
        if (!live) return;
        setOrder(o);
        if (o.status !== "open") return;
      } catch (e) {
        if (!live) return;
        if (e instanceof Error && /not found|not allowed|no such/i.test(e.message)) {
          setMissing(true);
          return;
        }
      }
      if (Date.now() - began >= GIVE_UP) setSlow(true);
      else timer = window.setTimeout(() => void ask(), EVERY);
    };
    void ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, orderId, signedIn, round]);

  const shell = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full min-w-0 max-w-xl">
        <PageHeader title="Your ticket" back="/" className="pb-3" />
        {children}
      </div>
    </div>
  );

  if (!paidOn && api) return shell(<p className="hint">Paid tickets are not open yet.</p>);
  if (!orderId || missing) {
    return shell(
      <>
        <p className="font-display text-[22px] font-black leading-tight">We can&apos;t find this order</p>
        <Link href="/" className="btn mt-4 px-5 normal-case">
          Back to events
        </Link>
      </>
    );
  }
  if (signedIn === null) return shell(<p className="hint">Loading</p>);
  if (!signedIn) {
    return shell(
      <>
        <p className="font-display text-[22px] font-black leading-tight">Sign in to see your ticket</p>
        <button type="button" className="btn mt-4 px-5 normal-case" onClick={() => setAsked(true)}>
          Sign in
        </button>
        <SignInSheet open={asked} reason="See your ticket" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
      </>
    );
  }
  return shell(<Body order={order} slow={slow} onRefresh={() => setRound((n) => n + 1)} />);
}

function Body({ order, slow, onRefresh }: { order: Order | null; slow: boolean; onRefresh: () => void }) {
  const { data: event } = useR1Event(order?.event_id);
  const head = useRef<HTMLParagraphElement>(null);
  const state = !order ? "wait" : order.needs_refund ? "late" : order.status === "paid" ? "paid" : order.status === "open" ? "wait" : order.status === "expired" || order.status === "failed" ? "gone" : "refund";
  const seen = useRef("");
  // Move focus to the answer when it changes, so a screen reader hears it.
  useEffect(() => {
    if (seen.current && seen.current !== state) head.current?.focus();
    seen.current = state;
  }, [state]);

  const back = useCallback(() => (order ? `/event/${encodeURIComponent(order.event_id)}` : "/"), [order]);
  const title = "font-display text-[26px] font-black leading-tight outline-none";
  const line = order ? `${order.event_title} · ${ticketsWord(order.quantity)} · ${naira(order.gross_naira)}` : "";

  if (state === "wait") {
    return (
      <div className="flex flex-col items-center pt-10 text-center" aria-live="polite">
        {slow ? (
          <>
            <p ref={head} tabIndex={-1} className={title}>
              Still confirming
            </p>
            <p className="mt-2 max-w-xs font-body text-[15px] text-dim">You will get your ticket here when the payment lands.</p>
            {line && <p className="mt-3 font-body text-[14px] text-dim">{line}</p>}
            <button type="button" onClick={onRefresh} className="btn mt-5 px-6 normal-case">
              Refresh
            </button>
          </>
        ) : (
          <>
            <span
              className="mb-5 block h-10 w-10 rounded-full border-[3px] border-line border-t-orange motion-safe:animate-spin"
              style={{ animationDuration: "1.4s" }}
              aria-hidden
            />
            <p ref={head} tabIndex={-1} className={title}>
              Confirming your payment
            </p>
            <p className="mt-2 max-w-xs font-body text-[15px] text-dim">This takes a few seconds. Keep this page open.</p>
            {line && <p className="mt-3 font-body text-[14px] text-dim">{line}</p>}
          </>
        )}
      </div>
    );
  }

  if (state === "paid" && order) {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="mt-1 grid h-8 w-8 flex-none place-items-center rounded-full border border-keke text-keke" aria-hidden>
            <Check size={17} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p ref={head} tabIndex={-1} className={title}>
              You&apos;re in
            </p>
            <p className="font-body text-[14px] text-dim">{line}</p>
          </div>
        </div>
        <TicketCards eventId={order.event_id} regKey={order.id} />
        <div className="grid grid-cols-1 gap-2">
          {event && (
            <button type="button" onClick={() => downloadIcs(event)} className="btn btn-ghost w-full justify-start gap-2.5 normal-case">
              <CalendarPlus size={16} className="flex-none text-orange" aria-hidden /> Add to calendar
            </button>
          )}
          <Link href={`/chat?c=${encodeURIComponent(order.event_id)}`} className="btn btn-ghost w-full justify-start gap-2.5 normal-case">
            <MessageCircle size={16} className="flex-none text-orange" aria-hidden /> Open event chat
          </Link>
          <Link href={back()} className="min-h-[44px] self-start py-3 font-body text-[14px] text-dim underline underline-offset-4">
            View event
          </Link>
        </div>
      </div>
    );
  }

  if (state === "late") {
    return (
      <div aria-live="polite">
        <p ref={head} tabIndex={-1} className={title}>
          Your payment arrived late
        </p>
        <p className="mt-2 font-body text-[15px] text-dim">Your payment arrived after your seats were released and no seat is left. You will be refunded.</p>
        {line && <p className="mt-3 font-body text-[14px] text-dim">{line}</p>}
        <Link href={back()} className="btn mt-5 px-6 normal-case">
          Back to the event
        </Link>
      </div>
    );
  }

  if (state === "refund" && order) {
    return (
      <div aria-live="polite">
        <p ref={head} tabIndex={-1} className={title}>
          {order.status === "refunded" ? "Refunded" : "Refund on its way"}
        </p>
        <p className="mt-2 font-body text-[15px] text-dim">
          {order.status === "refunded" ? "This payment was refunded and the tickets are no longer valid." : "Card refunds take 5 to 7 working days to reach you."}
        </p>
        {line && <p className="mt-3 font-body text-[14px] text-dim">{line}</p>}
        <Link href={back()} className="btn mt-5 px-6 normal-case">
          Back to the event
        </Link>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <p ref={head} tabIndex={-1} className={title}>
        Payment did not go through
      </p>
      <p className="mt-2 font-body text-[15px] text-dim">Your seats were released.</p>
      {line && <p className="mt-3 font-body text-[14px] text-dim">{line}</p>}
      <Link href={back()} className="btn mt-5 px-6 normal-case">
        Try again
      </Link>
    </div>
  );
}
