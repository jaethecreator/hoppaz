"use client";

import { usePops } from "@/lib/events-r1/hooks";
import type { PopAudience } from "@/lib/events-r1/types";
import { stampWord } from "./words";
import { CARD, Pill } from "./ui";

const WHO: Record<PopAudience, string> = { going: "Going", pending: "Pending", waitlist: "Waitlist", everyone: "Everyone" };

/** Placeholder: the event's Pops, read only. The Pops composer replaces this file; its props stay as they are. */
export default function PopsTab({ eventId }: { eventId: string }) {
  const { data, loading, error } = usePops(eventId, "host");
  if (loading) return <p className="hint">Loading</p>;
  if (error) return <p className="hint">Could not load Pops.</p>;
  const pops = data ?? [];
  if (!pops.length) return <p className="hint">No Pops yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {pops.map((p) => (
        <li key={p.id} className={CARD}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={p.status === "sent" ? "pill-keke" : "pill-danfo"}>{p.status === "sent" ? "Sent" : "Scheduled"}</Pill>
            <span className="font-body text-[13px] text-dim">
              To {WHO[p.audience].toLowerCase()}
              {p.auto ? " · Automatic" : ""}
              {" · "}
              {stampWord(p.sent_at ?? p.send_at)}
            </span>
          </div>
          <p className="mt-2 font-body text-[15px] leading-snug">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}
