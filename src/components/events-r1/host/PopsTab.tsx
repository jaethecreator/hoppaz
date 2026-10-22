"use client";

import { useEffect } from "react";
import { useR1Event, usePops, useR1Now, useRegistrations } from "@/lib/events-r1/hooks";
import type { PopAudience } from "@/lib/events-r1/types";
import AutoPops from "./pops/AutoPops";
import Composer from "./pops/Composer";
import { ScheduledList, SentList } from "./pops/PopLists";
import { countsOf } from "./words";

/**
 * Pops: send one to the people on the event, then see what went, what is scheduled and the three automatic Pops.
 * Delivery in the real app is web push, so the hint points at Share to WhatsApp.
 */
export default function PopsTab({ eventId }: { eventId: string }) {
  const event = useR1Event(eventId);
  const regs = useRegistrations(eventId);
  const pops = usePops(eventId, "host");
  const now = useR1Now();
  const { reload } = pops;
  const list = pops.data;

  // The clock moved past a scheduled Pop: read again so it shows as sent.
  const due = !!list?.some((p) => p.status === "scheduled" && p.enabled !== false && p.send_at && Date.parse(p.send_at) <= now);
  useEffect(() => {
    if (due) void reload();
  }, [due, now, reload]);

  if (event.loading || pops.loading) return <p className="hint">Loading</p>;
  const e = event.data;
  if (!e || pops.error || !list) return <p className="hint">Could not load Pops.</p>;

  const c = countsOf(regs.data);
  const counts: Record<PopAudience, number> = { going: c.going, pending: c.pending, waitlist: c.waitlist, everyone: c.going + c.pending + c.waitlist };
  const manual = list.filter((p) => !p.auto);
  const sent = manual.filter((p) => p.status === "sent").sort((a, b) => Date.parse(b.sent_at ?? "") - Date.parse(a.sent_at ?? ""));
  const scheduled = manual.filter((p) => p.status === "scheduled").sort((a, b) => Date.parse(a.send_at ?? "") - Date.parse(b.send_at ?? ""));

  return (
    <div className="flex flex-col gap-6">
      <Composer event={e} counts={counts} now={now} />
      <SentList pops={sent} />
      <ScheduledList pops={scheduled} />
      <AutoPops event={e} pops={list} now={now} />
    </div>
  );
}
