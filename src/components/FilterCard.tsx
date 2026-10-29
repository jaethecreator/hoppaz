"use client";

import { REACH } from "@/components/AreaPicker";
import Sheet from "@/components/Sheet";
import { VIBES } from "@/lib/brand";
import type { DateFilter } from "@/lib/filters";
import { useHoppaz } from "@/lib/store";

/**
 * "What kind": the map's one filter sheet. The day lives on the day rail now
 * (there is no "any day" and no date box here), so this is the vibes and, below
 * them, how far you'll go (everyone starts on My side, 8 km). Pick no vibe and
 * you see everything.
 */
export default function FilterCard({
  types,
  count,
  onTypes,
  onClear,
  onClose,
}: {
  types: string[];
  /** Events on the selected day that match the vibes picked. */
  count: number;
  onTypes: (t: string[]) => void;
  onClear: () => void;
  onClose: () => void;
  /** Older call sites passed these. The day is on the rail now, so they are ignored. */
  date?: DateFilter;
  onDate?: (d: DateFilter) => void;
}) {
  const radiusKm = useHoppaz((s) => s.radiusKm);
  const setRadius = useHoppaz((s) => s.setRadius);
  // A radius left over from the old slider (say 12 km) lights the nearest choice.
  const reach = REACH.reduce((best, r) => (Math.abs(r.km - radiusKm) < Math.abs(best.km - radiusKm) ? r : best), REACH[0]);
  const toggle = (v: string) => onTypes(types.includes(v) ? types.filter((t) => t !== v) : [...types, v]);

  return (
    <Sheet open onClose={onClose} label="What kind">
      <h2 className="text-xl font-black">What kind</h2>
      <p className="hint mt-1">Pick a vibe or two. Pick none and you see it all.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {VIBES.map((v) => (
          <button key={v} aria-pressed={types.includes(v)} onClick={() => toggle(v)} className="chip">
            {v}
          </button>
        ))}
      </div>

      <p className="seclabel mt-5">How far you&apos;ll go</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {REACH.map((r) => (
          <button
            key={r.km}
            aria-pressed={reach.km === r.km}
            aria-label={`${r.name} ${r.unit}`.trim()}
            onClick={() => setRadius(r.km)}
            className="chip w-full justify-between"
          >
            <span>{r.name}</span>
            <span>{r.unit}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <button className="btn flex-1" onClick={onClose}>
          {count ? `Show ${count} event${count === 1 ? "" : "s"}` : "Nothing on for that"}
        </button>
        {types.length > 0 && (
          <button className="btn btn-ghost flex-none" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </Sheet>
  );
}
