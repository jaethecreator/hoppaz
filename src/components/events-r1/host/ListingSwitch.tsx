"use client";

import { useState } from "react";
import Tickets, { newTicket, ticketsDraft, ticketsError } from "@/components/events-r1/create/Tickets";
import type { TicketForm } from "@/components/events-r1/create/Tickets";
import { reasonText } from "@/components/events-r1/claim/words";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import GetPaidCard from "../pay/GetPaidCard";
import { usePaidGate } from "../pay/usePay";
import { CARD, ErrorLine, Section } from "./ui";

/** The words for where the tickets are sold now. */
const siteOf = (e: R1Event) => e.listing?.source_site || "the organiser's page";

/**
 * Tickets for an event that was pulled from another ticket site (event.listing is set).
 * Unclaimed (Hoppaz still lists it): a note, never a button. Claimed (the room has an owner): the host sets real ticket types and
 * presses "Sell tickets on Hoppaz". People who already bought on the other site keep those tickets; the page says so, and says
 * not to sell the same seats twice. When the switch is saved the data layer clears event.listing and the event page shows the tickets.
 */
export default function ListingSwitch({ event }: { event: R1Event }) {
  const listing = event.listing;
  if (!listing) return null;
  if (!listing.claimed) {
    return (
      <section className={CARD} aria-label="Listed by Hoppaz" data-listing-note>
        <h2 className="font-display text-[16px] font-black">Listed by Hoppaz</h2>
        <p className="mt-2 font-body text-[14.5px] text-dim">Tickets for this event are sold on {siteOf(event)}. The organiser can set Hoppaz tickets once they have taken over the room.</p>
      </section>
    );
  }
  return <Switch event={event} />;
}

function Switch({ event }: { event: R1Event }) {
  const api = useR1Api();
  const [paid, setPaid] = useState(false);
  const [types, setTypes] = useState<TicketForm[]>(() => [newTicket("General")]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const gate = usePaidGate();
  const blocked = paid && gate.state !== "ready" && gate.state !== "signedout";
  const site = siteOf(event);

  const sell = async () => {
    if (!api || busy || blocked) return;
    const bad = ticketsError(paid, types);
    if (bad) return setError(bad);
    setBusy(true);
    setError("");
    try {
      await api.events.sellOnHoppaz(event.id, ticketsDraft(paid, types));
      setDone(true);
    } catch (e) {
      setError(reasonText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section className={CARD} aria-label="Tickets switched" data-listing-done>
        <h2 className="font-display text-[16px] font-black">You sell tickets on Hoppaz now</h2>
        <p className="mt-2 font-body text-[14.5px] text-dim">Your event page shows these tickets. Loading your ticket settings.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-listing-switch>
      <section className="t-card border-2 !border-t-accent p-4 lg:p-5" aria-label="Still sold on another site">
        <h2 className="t-title text-[18px] font-extrabold leading-tight">This event is still sold on {site}</h2>
        <p className="mt-1.5 font-body text-[14.5px] text-t-muted">Set your ticket types, then switch to Hoppaz tickets.</p>
        <ul className="mt-3 flex flex-col gap-1.5 font-body text-[14px] text-t-muted">
          <li>People who already bought on {site} keep those tickets.</li>
          <li>Do not sell the same seats twice. Give Hoppaz only the seats that are not sold on {site}.</li>
          <li>Until you switch, Get tickets on your event page keeps going to {site}.</li>
        </ul>
      </section>

      <Section title="Ticket types">
        <Tickets
          paid={paid}
          onPaid={(v) => {
            setError("");
            setPaid(v);
          }}
          types={types}
          onTypes={(t) => {
            setError("");
            setTypes(t);
          }}
        />
      </Section>

      <GetPaidCard returnPath={`/host/${encodeURIComponent(event.id)}?tab=tickets`} />

      <div className="flex flex-col gap-2 pb-2">
        <button type="button" className="lip w-full" onClick={() => void sell()} disabled={busy || !api || blocked}>
          {blocked ? PAID_UNAVAILABLE : busy ? "Switching" : "Sell tickets on Hoppaz"}
        </button>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}
