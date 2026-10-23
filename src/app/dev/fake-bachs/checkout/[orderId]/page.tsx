"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import type { PayMethod } from "@/lib/events-r1/pay";

type Dev = (typeof import("@/lib/events-r1/fake"))["fakeDev"];
type Peek = NonNullable<ReturnType<Dev["peekOrder"]>>;

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const btn = "w-full rounded-lg border border-neutral-300 bg-white px-4 py-3 text-[15px] font-medium text-neutral-900 disabled:opacity-50";
const btnMain = "w-full rounded-lg bg-neutral-900 px-4 py-3 text-[15px] font-medium text-white disabled:opacity-50";

/**
 * Stands in for the hosted payment page (fake data only). No real money, no real brand. A pay click does what the
 * real webhook does (fakeDev.completeCheckout): the order is paid and the tickets are made, then the buyer goes to /tickets/return.
 */
export default function FakeCheckoutPage() {
  if (!EVENTS_R1_FAKE) {
    return (
      <main className="absolute inset-0 overflow-y-auto bg-neutral-100 px-4 py-6 text-neutral-900">
        <p>The Release 1 fake data is off. Start the app with NEXT_PUBLIC_EVENTS_R1_FAKE=1.</p>
      </main>
    );
  }
  return <Page />;
}

function Page() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [dev, setDev] = useState<Dev | null>(null);
  const [order, setOrder] = useState<Peek | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    void import("@/lib/events-r1/fake").then((m) => setDev(m.fakeDev));
  }, []);

  const read = useCallback(() => {
    if (dev) setOrder(dev.peekOrder(orderId));
  }, [dev, orderId]);

  useEffect(() => {
    if (!dev) return;
    read();
    let off: (() => void) | undefined;
    void import("@/lib/events-r1/fake").then((m) => {
      off = m.fakeApi.events.subscribe(read);
    });
    // An open order runs out of time by itself: look again now and then.
    const id = window.setInterval(read, 5000);
    return () => {
      off?.();
      window.clearInterval(id);
    };
  }, [dev, read]);

  const pay = (method: PayMethod) => {
    if (!dev) return;
    setError("");
    try {
      dev.completeCheckout(orderId, method);
      router.push(`/tickets/return?order=${orderId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const act = (fn: (id: string) => unknown) => {
    setError("");
    try {
      fn(orderId);
      read();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="absolute inset-0 overflow-y-auto bg-neutral-100 px-4 py-8 text-neutral-900">
      <div className="mx-auto max-w-[420px] rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-[12px] text-neutral-500">Test payment page. No money moves.</p>
        {order === undefined && <p className="mt-4 text-[15px]">Loading</p>}
        {order === null && <p className="mt-4 text-[15px]">This payment link does not exist.</p>}
        {order && dev && (
          <>
            <h1 className="mt-3 text-[20px] font-semibold">Pay {order.host_name}</h1>
            <p className="mt-1 text-[34px] font-semibold" data-testid="amount">{naira(order.gross_naira)}</p>
            <p className="mt-1 text-[14px] text-neutral-600">
              {order.quantity} x {order.ticket_name} for {order.event_title}
            </p>

            {order.status === "open" && (
              <div className="mt-5 flex flex-col gap-2">
                <button type="button" className={btnMain} onClick={() => pay("card")}>Pay by card</button>
                <button type="button" className={btnMain} onClick={() => pay("bank_transfer")}>Pay by bank transfer</button>
                <button type="button" className={btn} onClick={() => act(dev.failCheckout)}>Fail the payment</button>
                <button type="button" className={btn} onClick={() => act(dev.expireCheckout)}>Let it expire</button>
                <p className="mt-1 text-[13px] text-neutral-500">
                  Your seats are held until{" "}
                  {new Date(Date.parse(order.expires_at)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}.
                </p>
              </div>
            )}

            {order.status === "expired" && (
              <div className="mt-5 flex flex-col gap-2">
                <p className="text-[15px]" data-testid="status">This payment ran out of time.</p>
                <button type="button" className={btn} onClick={() => pay("card")}>Pay anyway (late payment) by card</button>
                <button type="button" className={btn} onClick={() => pay("bank_transfer")}>Pay anyway (late payment) by bank transfer</button>
              </div>
            )}

            {order.status === "failed" && <p className="mt-5 text-[15px]" data-testid="status">The payment failed. Your seats were released.</p>}
            {(order.status === "paid" || order.status === "refund_pending" || order.status === "refunded") && (
              <p className="mt-5 text-[15px]" data-testid="status">This order is already paid.</p>
            )}

            {error && <p className="mt-3 text-[14px] text-red-600">{error}</p>}
            <Link href={`/tickets/return?order=${orderId}`} className="mt-4 block text-center text-[14px] underline">Back to Hoppaz</Link>
          </>
        )}
      </div>
    </main>
  );
}
