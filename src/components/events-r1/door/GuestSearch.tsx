"use client";

import { useEffect, useMemo, useState } from "react";
import { useR1Query } from "@/lib/events-r1/hooks";
import type { Registration, RegStatus } from "@/lib/events-r1/types";
import { lagosClock } from "./helpers";

type Filter = "all" | "going" | "checked_in" | "not_yet";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "going", label: "Going" },
  { id: "checked_in", label: "Checked in" },
  { id: "not_yet", label: "Not yet" },
];
const MATCH: Record<Filter, (s: RegStatus) => boolean> = {
  all: () => true,
  going: (s) => s === "going" || s === "checked_in",
  checked_in: (s) => s === "checked_in",
  not_yet: (s) => s === "going",
};

/** The fallback when a QR will not scan: find the guest by name or email and check them in. The list updates live. */
export default function GuestSearch({ eventId, busy, onCheckIn }: { eventId: string; busy: boolean; onCheckIn: (r: Registration) => void }) {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Wait a moment after typing before asking the layer.
  useEffect(() => {
    const id = window.setTimeout(() => setNeedle(q), 200);
    return () => window.clearTimeout(id);
  }, [q]);

  const found = useR1Query((api) => api.door.search(eventId, needle), [eventId, needle]);
  const rows = useMemo(() => (found.data ?? []).filter((r) => MATCH[filter](r.status)), [found.data, filter]);

  return (
    <section aria-label="Search guests">
      <h2 className="font-display text-[16px] font-black">Search</h2>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or email"
        autoComplete="off"
        aria-label="Search name or email"
        className="mt-2"
      />
      <div role="group" aria-label="Filter guests" className="mt-2 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className="chip min-h-[40px] flex-none !font-body !text-[13px] !normal-case !tracking-normal">
            {f.label}
          </button>
        ))}
      </div>

      <ul className="mt-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-[15px] font-medium text-cream">{r.name}</p>
              <p className="truncate font-body text-[13px] text-dim">
                {r.email} · {r.ticket_name || "General"}
              </p>
            </div>
            {r.status === "checked_in" ? (
              <span className="flex-none font-body text-[13px] text-cream">Checked in{r.checked_in_at ? ` ${lagosClock(r.checked_in_at)}` : ""}</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => onCheckIn(r)} className="btn min-h-[44px] flex-none px-4 normal-case">
                Check in
              </button>
            )}
          </li>
        ))}
      </ul>
      {found.loading && !found.data && <p className="hint mt-2">Loading</p>}
      {!found.loading && !rows.length && <p className="hint mt-2">{needle || filter !== "all" ? "No one matches." : "No guests yet."}</p>}
      {found.error && <p role="alert" className="mt-2 font-body text-[14px] text-fireant">{found.error.message}</p>}
    </section>
  );
}
