"use client";

/* eslint-disable @next/next/no-img-element -- the QR is a data URL made here */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useR1Query } from "@/lib/events-r1/hooks";

/**
 * The person's ticket: one QR with their name, "General" and the short code to type at the door when a scan fails.
 * Nothing else is on it. The token comes signed from the data layer (registrations.ticketFor) and is drawn as it is.
 */
export default function TicketQr({ eventId, regKey }: { eventId: string; regKey: string }) {
  // regKey changes when the registration does (cancel then register again makes a new ticket version).
  const { data: ticket } = useR1Query((api) => api.registrations.ticketFor(eventId), [eventId, regKey]);
  const [src, setSrc] = useState<string | null>(null);
  const token = ticket?.token ?? null;

  useEffect(() => {
    if (!token) {
      setSrc(null);
      return;
    }
    let live = true;
    QRCode.toDataURL(token, { width: 480, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0E0B0A", light: "#FFFFFF" } }).then(
      (url) => live && setSrc(url),
      () => live && setSrc(null)
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (!ticket) return null;

  return (
    <div className="mx-auto w-full max-w-[250px] rounded-hz border border-line bg-white p-3 text-center text-brand-ink" aria-label="Your ticket">
      {src ? (
        <img src={src} alt="Your ticket QR code" width={216} height={216} className="mx-auto h-auto w-full max-w-[216px]" />
      ) : (
        <div className="mx-auto aspect-square w-full max-w-[216px] animate-pulse rounded bg-brand-ink/10" />
      )}
      <p className="mt-2 font-display text-[16px] font-black leading-tight">{ticket.holder_name}</p>
      <p className="font-body text-[13px] text-brand-ink/70">{ticket.status === "used" ? `${ticket.ticket_name} · Checked in` : ticket.ticket_name}</p>
      <p className="mt-1 font-mono text-[13px] font-medium tracking-[0.18em]">{ticket.code}</p>
    </div>
  );
}
