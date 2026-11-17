"use client";

import { useState } from "react";
import { copyText } from "./format";
import { Btn } from "./ui";
import { useOutreach } from "./useOutreach";

/** What the link is made for: an organiser's room, or the room of one listing. */
export type ClaimTarget = { organiserId: string } | { eventId: string };

/**
 * "Copy claim link". Makes a fresh one-time link (the server keeps only a hash of its token, so an old one cannot be shown again) and copies it
 * to the clipboard. It works once, needs no email, and runs out after 14 days. If the clipboard is blocked the link is shown in the note at the
 * top of the section so it can be copied by hand. Shows nothing while the event_claims flag is off.
 */
export default function CopyClaimLink({ target, name, solid, className, onMade }: { target: ClaimTarget; name: string; solid?: boolean; className?: string; onMade?: () => void }) {
  const { api, data, by, say } = useOutreach();
  const [busy, setBusy] = useState(false);
  if (!data.claimsOn) return null;

  const make = async () => {
    setBusy(true);
    try {
      const out = await api.createClaimLink(target, by);
      const copied = await copyText(out.url);
      say(
        copied
          ? `Claim link for ${name} copied. It works once and runs out in 14 days.`
          : `Claim link for ${name}. Copy it from here, it is shown once:\n${out.url}`,
        copied ? "ok" : "error",
      );
      void data.reloadOrganisers();
      void data.reloadClaims();
      onMade?.();
    } catch (e) {
      say(e instanceof Error ? e.message : "That did not work", "error");
    }
    setBusy(false);
  };

  return (
    <Btn solid={solid} className={className} disabled={busy} onClick={() => void make()} data-copy-claim-link>
      {busy ? "Making the link" : "Copy claim link"}
    </Btn>
  );
}
