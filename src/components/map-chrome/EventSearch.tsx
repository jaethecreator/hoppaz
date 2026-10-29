"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { clockShort, dayLagos } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

/**
 * Search, from the magnifier on the map's top bar: one box over every event loaded (the whole coming 45 days, whatever day
 * or vibe the map is on), matched as you type. Every word has to appear somewhere in the title, venue, area or vibe;
 * titles that start with what you typed come first, then the soonest. Tapping a result hands it to the page, which opens it.
 */

const MAX = 40;

/** Lower case, accents off, so "cafe" finds "Café". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function searchEvents(events: EventRow[], query: string): EventRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { e: EventRow; rank: number; t: number }[] = [];
  for (const e of events) {
    const title = fold(e.title);
    const hay = `${title} ${fold(e.venue_name ?? "")} ${fold(e.area ?? "")} ${fold(e.vibe ?? "")}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const q = words.join(" ");
    const rank = title.startsWith(q) ? 0 : title.includes(q) ? 1 : words.every((w) => title.includes(w)) ? 2 : 3;
    hits.push({ e, rank, t: Date.parse(e.starts_at) });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.t - b.t)
    .slice(0, MAX)
    .map((h) => h.e);
}

export default function EventSearch({
  events,
  onPick,
  onClose,
}: {
  events: EventRow[];
  onPick: (e: EventRow) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchEvents(events, query), [events, query]);
  const typed = query.trim().length > 0;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Search events" className="absolute inset-0 z-40 flex flex-col bg-ink/95 backdrop-blur animate-rise">
      <div className="pad-top mx-auto w-full max-w-[640px] px-3.5 pb-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) onPick(results[0]);
          }}
          className="flex items-center gap-2 pt-1"
        >
          <div className="relative min-w-0 flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, venues, areas"
              aria-label="Search events"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="!pl-9"
            />
          </div>
          <button type="button" onClick={onClose} aria-label="Close search" className="grid h-11 w-10 flex-none place-items-center text-cream">
            <X size={20} aria-hidden />
          </button>
        </form>
      </div>

      <div className="mx-auto w-full max-w-[640px] min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
        {!typed ? (
          <p className="hint mt-3 px-0.5">Type an event, a venue or an area.</p>
        ) : results.length === 0 ? (
          <p className="hint mt-3 px-0.5" role="status">Nothing coming up for &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {results.map((e) => (
              <li key={e.id}>
                <button onClick={() => onPick(e)} className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left">
                  {e.flyer_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.flyer_url} alt="" loading="lazy" className="h-12 w-12 flex-none rounded-hz object-cover" />
                  ) : (
                    <span aria-hidden className="grid h-12 w-12 flex-none place-items-center rounded-hz border border-line bg-ink-2 text-dim">
                      <Search size={16} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-[15px] font-semibold text-cream">{e.title}</span>
                    <span className="block truncate font-mono text-[11px] uppercase tracking-[0.06em] text-dim">
                      {dayLagos(e.starts_at)} · {clockShort(e.starts_at)}
                      {e.venue_name || e.area ? ` · ${[e.venue_name, e.area].filter(Boolean).join(", ")}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
