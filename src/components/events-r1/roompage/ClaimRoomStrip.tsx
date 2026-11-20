"use client";

import { useState } from "react";
import type { RoomListing } from "@/lib/events-r1/types";
import ClaimSheet from "../page/ClaimSheet";

/**
 * "Hoppaz built this room for [name]. Is this your community? Claim it" (CHANGE-006): the slim strip at the top of an unclaimed room Hoppaz
 * made for a listed organiser, in the same dark band as the listing's claim strip (page/ClaimStrip). The whole strip is one 44 px tap and
 * opens the CHANGE-005 claim sheet on the organiser's latest event, so a claim from the room lands in the same staff list. After an ask it
 * says "We're checking". Gone once the room is claimed (the listing is null then).
 */
export default function ClaimRoomStrip({ listing }: { listing: RoomListing }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const pending = listing.my_claim === "pending" || sent;
  const band = "relative z-[9] bg-t-text text-t-bg";
  const row = "mx-auto flex min-h-[44px] w-full max-w-[1100px] flex-wrap items-center gap-x-2 gap-y-0.5 px-3.5 py-2 text-left font-body text-[14px] lg:px-[30px]";

  const sheet = listing.claim_event_id ? (
    <ClaimSheet open={open} eventId={listing.claim_event_id} eventTitle={listing.name} onClose={() => setOpen(false)} onSent={() => setSent(true)} />
  ) : null;

  let strip;
  if (pending) {
    strip = (
      <div role="status" aria-label="Your claim" data-claim-room-strip="pending" className={band}>
        <p className={row}>
          <b className="font-extrabold">We&apos;re checking.</b>
          <span>We got your claim for {listing.name} and will get back to you soon.</span>
        </p>
      </div>
    );
  } else if (!listing.claim_event_id) {
    strip = (
      <div role="region" aria-label="Claim this room" data-claim-room-strip className={band}>
        <p className={row}>Hoppaz built this room for {listing.name}. Is this your community?</p>
      </div>
    );
  } else {
    strip = (
      <div role="region" aria-label="Claim this room" data-claim-room-strip className={band}>
        <button type="button" onClick={() => setOpen(true)} className={row}>
          <span>Hoppaz built this room for {listing.name}. Is this your community?</span>
          <b className="font-extrabold underline underline-offset-4">Claim it</b>
        </button>
      </div>
    );
  }
  return (
    <>
      {strip}
      {sheet}
    </>
  );
}
