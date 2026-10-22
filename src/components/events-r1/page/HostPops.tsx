"use client";

import { usePops } from "@/lib/events-r1/hooks";
import type { R1Event } from "@/lib/events-r1/types";
import { popWhen } from "./time";

/** "Updates from the host": the Pops this person can see, newest first. Nothing at all when there are none. */
export default function HostPops({ event }: { event: R1Event }) {
  const { data } = usePops(event.id, "visible");
  if (!data || data.length === 0) return null;

  return (
    <section className="mt-6" aria-label="Updates from the host">
      <h3 className="font-display text-[17px] font-black">Updates from the host</h3>
      <ul className="mt-2.5 space-y-2.5">
        {data.map((p) => (
          <li key={p.id} className="rounded-hz border border-line bg-ink-3 px-3.5 py-3">
            <p className="whitespace-pre-line font-body text-[14px] leading-snug">{p.body}</p>
            <p className="mt-1.5 font-body text-[12.5px] text-dim">
              {p.author_name} · {popWhen(p.sent_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
