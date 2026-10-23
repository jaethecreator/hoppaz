"use client";

/* eslint-disable @next/next/no-img-element -- the QR is a data URL made here */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useR1Query } from "@/lib/events-r1/hooks";
import type { Ticket } from "@/lib/events-r1/types";

/** One ticket: the QR, the name, "Ticket 1 of 2" when the order holds several, and the short code for the door. */
function TicketCard({ ticket, count }: { ticket: Ticket; count: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const token = ticket.token;
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(token, { width: 480, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0E0B0A", light: "#FFFFFF" } }).then(
      (url) => live && setSrc(url),
      () => live && setSrc(null)
    );
    return () => {
      live = false;
    };
  }, [token]);
  const seat = count > 1 ? `Ticket ${ticket.seat_no ?? 1} of ${ticket.seats ?? count}` : "";
  return (
    <li className="mx-auto w-full max-w-[250px] rounded-hz border border-line bg-white p-3 text-center text-brand-ink">
      {seat && <p className="mb-2 font-body text-[13px] font-medium text-brand-ink/70">{seat}</p>}
      {src ? (
        <img src={src} alt={seat ? `QR code, ${seat.toLowerCase()}` : "Your ticket QR code"} width={216} height={216} className="mx-auto h-auto w-full max-w-[216px]" />
      ) : (
        <div className="mx-auto aspect-square w-full max-w-[216px] animate-pulse rounded bg-brand-ink/10" />
      )}
      <p className="mt-2 font-display text-[16px] font-black leading-tight">{ticket.holder_name}</p>
      <p className="font-body text-[13px] text-brand-ink/70">{ticket.status === "used" ? `${ticket.ticket_name} · Checked in` : ticket.ticket_name}</p>
      <p className="mt-1 font-mono text-[13px] font-medium tracking-[0.18em]">{ticket.code}</p>
    </li>
  );
}

/**
 * Your tickets: every ticket the person holds for an event, one QR each (a paid order can hold up to five).
 * Tickets come signed from the data layer (registrations.ticketsFor) and are drawn as they are.
 */
export default function TicketCards({ eventId, regKey }: { eventId: string; regKey: string }) {
  const { data } = useR1Query((api) => api.registrations.ticketsFor(eventId), [eventId, regKey]);
  const list = data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-label="Your tickets">
      <p className="seclabel mb-2">Your tickets</p>
      <ul className="flex flex-col gap-3">
        {list.map((t) => (
          <TicketCard key={t.id} ticket={t} count={list.length} />
        ))}
      </ul>
    </section>
  );
}
