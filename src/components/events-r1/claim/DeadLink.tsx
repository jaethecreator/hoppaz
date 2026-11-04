import Link from "next/link";
import type { ReactNode } from "react";
import { OUTREACH_REASONS } from "@/lib/events-r1/types";
import { SUPPORT_EMAIL } from "./words";

export type DeadReason = "not_found" | "expired" | "used" | "revoked";

const TEXT: Record<DeadReason, { title: string; help: string }> = {
  not_found: { title: OUTREACH_REASONS.invalid_link, help: "Check that you copied the whole link. If it still fails, ask the person who sent it for a new one." },
  expired: { title: OUTREACH_REASONS.link_expired, help: "Links only stay open for a while. Ask for a new one and it will work straight away." },
  used: { title: OUTREACH_REASONS.link_used, help: "Each link works once. If that was you, your room is waiting." },
  revoked: { title: OUTREACH_REASONS.link_revoked, help: "The person who made it took it back. Ask them for a new one if you still want the room." },
};

/** The page for a link that cannot be used: the reason in plain words, and a way to reach us. Shows nothing about the room. */
export default function DeadLink({ reason, signedIn }: { reason: DeadReason; signedIn: boolean }) {
  const t = TEXT[reason];
  const action: ReactNode =
    reason === "used" && signedIn ? (
      <Link href="/host" className="btn mt-5 px-5 normal-case">
        Open your rooms
      </Link>
    ) : (
      <Link href="/" className="btn mt-5 px-5 normal-case">
        Go to Hoppaz
      </Link>
    );
  return (
    <div className="pad-top" data-claim-dead={reason}>
      <p className="seclabel">Hoppaz</p>
      <h1 className="mt-2 font-display text-[26px] font-black leading-tight">{t.title}</h1>
      <p className="mt-2 font-body text-[15px] text-dim">{t.help}</p>
      {action}
      <p className="hint mt-6">
        Need a hand? Write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("My Hoppaz room link")}`} className="text-cream underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
