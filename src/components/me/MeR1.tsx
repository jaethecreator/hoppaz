"use client";

import { useEffect, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useHostDesk } from "@/components/events-r1/workspace/useHostDesk";
import { useTickets } from "@/lib/game-time/hooks";
import type { GtTicket } from "@/lib/game-time/types";
import { useMyRegistrations, useR1Auth } from "@/lib/events-r1/hooks";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import { HostingLine, TonightStrip } from "./MeHosting";
import MeTickets from "./MeTickets";
import { demoEmpty, demoPrizeCodes } from "./demo";

/**
 * The Release 1 parts of Me (CHANGE-003). Me's own numbers (header, streak, XP, shelf, badges, nights) still come from the app's account
 * session (useSession); these read the Release 1 sign in (useR1Auth). In the real build both are the same Supabase session, so they agree.
 */

/** Signed out: "Sign in to keep all this" on top of the same Me (the page decides when, see MePage). Sign in comes back to Me. */
export function MeSignIn() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pad-top">
        <section
          aria-label="Sign in"
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-orange py-3 pl-3.5 pr-3"
          style={{ background: "color-mix(in srgb, #FF4D00 14%, rgb(var(--raised)))" }}
          data-signin-strip
        >
          <span className="min-w-0">
            <b className="block font-display text-[15px] font-extrabold">Sign in to keep all this</b>
            <span className="block font-body text-[13px] text-dim">Your XP, tickets and anything you host, on every device.</span>
          </span>
          <button type="button" className="btn px-4 text-[13.5px] tracking-[0.06em]" onClick={() => setOpen(true)}>
            Sign in
          </button>
        </section>
      </div>
      <SignInSheet open={open} reason="Keep your XP, tickets and anything you host" onClose={() => setOpen(false)} onSignedIn={() => setOpen(false)} />
    </>
  );
}

/** Tonight (on the day) and the Hosting line. Nothing while signed out or loading. Personal shows the signed in person's initial. */
export function MeHostSection() {
  const { desk } = useHostDesk();
  const { user } = useR1Auth();
  const personalName = user?.name ?? "Hopper";
  if (!desk) return null;
  return (
    <>
      {desk.tonight && <TonightStrip event={desk.tonight} />}
      <HostingLine desk={desk} personalName={personalName} />
    </>
  );
}

/**
 * Your tickets: upcoming event tickets (Release 1) then Game Time prize codes (the app session, as before). Hidden when there are none,
 * and while signed out. `codesOn` is when the prize codes may be read (an account session, not the local demo); `demo` shows the sample
 * code in development without a database.
 */
export function MeTicketsSection({ codesOn, demo, signedOut }: { codesOn: boolean; demo: boolean; signedOut: boolean }) {
  const { tickets, loaded } = useTickets(codesOn);
  const [demoCodes, setDemoCodes] = useState<GtTicket[]>([]);
  useEffect(() => setDemoCodes(demo && !demoEmpty() ? demoPrizeCodes(Date.now()) : []), [demo]);
  const codes = demo ? demoCodes : loaded ? tickets : [];
  // Drawn once both lists are in: a stub added in front later would make the snapping line jump to its end.
  const codesIn = demo || !codesOn || loaded;
  if (signedOut || !codesIn) return null;
  return EVENTS_R1 ? <WithEventTickets codes={codes} /> : <MeTickets tickets={[]} codes={codes} />;
}

function WithEventTickets({ codes }: { codes: GtTicket[] }) {
  const regs = useMyRegistrations();
  if (regs.loading) return null;
  return <MeTickets tickets={regs.data ?? []} codes={codes} />;
}
