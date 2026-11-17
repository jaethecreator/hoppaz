"use client";

import { useState } from "react";
import type { R1Event } from "@/lib/events-r1/types";
import { useClaimsOn } from "../claim/useClaimsOn";
import ClaimSheet from "./ClaimSheet";

/**
 * "Is this your event? Claim it": the slim strip at the top of a listing Hoppaz listed, in the same dark band as the Manage event bar the
 * host sees. The whole strip is one 44 px tap. It is not a filled button, so the page keeps its one lip button (Get tickets). Only for visitors
 * of a listing nobody has claimed, and only while the event_claims flag is on.
 */
export default function ClaimStrip({ event }: { event: R1Event }) {
  const on = useClaimsOn();
  const [open, setOpen] = useState(false);
  if (!on || !event.listing || event.listing.claimed) return null;
  return (
    <>
      <div role="region" aria-label="Claim this event" data-claim-strip className="sticky top-0 z-40 bg-t-text text-t-bg">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto flex min-h-[44px] w-full max-w-[1100px] items-center gap-2 px-3.5 py-2 text-left font-body text-[14px] lg:px-[30px]"
        >
          <span>Is this your event?</span>
          <b className="font-extrabold underline underline-offset-4">Claim it</b>
        </button>
      </div>
      <ClaimSheet open={open} eventId={event.id} eventTitle={event.title} onClose={() => setOpen(false)} />
    </>
  );
}
