import { notFound } from "next/navigation";
import { Suspense } from "react";
import ReturnPage from "@/components/events-r1/pay/ReturnPage";
import { EVENTS_R1, EVENTS_R1_FAKE, PAID_TICKETS } from "@/lib/events-r1/flags";

/**
 * Where Bachs sends the buyer after paying: /tickets/return?order=<id>. It only reads the order and waits for the
 * verified payment to land; nothing is issued from the address. With the flags off there is no such page; with the
 * demo switch off the page says so itself.
 */
export default function Page() {
  // Paid tickets are switched on by the build, or (fake data) by the dev panel in the browser, which the page checks itself.
  if (!EVENTS_R1 || (!PAID_TICKETS && !EVENTS_R1_FAKE)) notFound();
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ReturnPage />
    </Suspense>
  );
}
