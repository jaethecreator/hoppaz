"use client";

import clsx from "clsx";
import Sheet from "@/components/Sheet";
import { distanceLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";

function status(h: Hotspot) {
  if (h.status !== "open") return "Opening soon";
  switch (h.hereBand) {
    case "quiet":
      return "Quiet";
    case "few":
      return "A few here";
    default:
      return h.hereN ? `${h.hereN} here` : "Some here";
  }
}

/**
 * The hotspots in `list`, grouped Island and Mainland (the map passes the open ones; an "Opening soon" one in the list
 * can still be looked at). Your own group comes first and, once we know where you are, the nearest are on top inside each
 * group; with no position the groups follow the list's own order (Yaba, where the events are, leads it).
 *
 * With nothing to list it says why: still asking, could not load (with a way to try again), or none open.
 */
export default function HotspotsAll({
  list,
  yoursSlug,
  metres,
  onPick,
  onClose,
  loaded = true,
  failed = false,
  onRetry,
}: {
  list: Hotspot[];
  yoursSlug: string | null;
  metres: (h: Hotspot) => number | null;
  onPick: (h: Hotspot) => void;
  onClose: () => void;
  /** The list has come back at least once. */
  loaded?: boolean;
  /** The last ask for the list failed. */
  failed?: boolean;
  onRetry?: () => void;
}) {
  const shown = list.filter((h) => h.status !== "paused");
  // metres() is null for every row when we do not know where the Hopper is.
  const located = shown.length > 0 && metres(shown[0]) !== null;
  const side = (name: Hotspot["side"]) => {
    const rows = shown.filter((h) => h.side === name);
    if (located) rows.sort((a, b) => (metres(a) ?? 0) - (metres(b) ?? 0));
    return { name: name === "island" ? "Island" : "Mainland", rows };
  };
  // The side of the hotspot that is yours (or of the first one in the list) goes first.
  const lead = shown.find((h) => h.slug === yoursSlug)?.side ?? shown[0]?.side ?? "mainland";
  const groups = (lead === "island" ? [side("island"), side("mainland")] : [side("mainland"), side("island")]).filter((g) => g.rows.length);
  return (
    <Sheet open onClose={onClose} label="All hotspots">
      <div className="mx-auto max-w-[520px]">
        <h2 className="pr-9 font-display text-[22px] font-black uppercase leading-none">Hotspots</h2>
        <p className="hint mt-1.5">Open ones run all day and night. Anyone can visit any of them.</p>
        {!groups.length && (
          <div className="mt-4 rounded-hz border border-line bg-ink-3 px-3 py-3" role="status">
            {failed && !loaded ? (
              <>
                <p className="font-body text-[14px] font-semibold leading-snug">Hotspots could not load.</p>
                <p className="hint mt-1">Check your signal and try again.</p>
                {onRetry && (
                  <button type="button" className="btn mt-3 w-full" onClick={onRetry}>
                    TRY AGAIN
                  </button>
                )}
              </>
            ) : !loaded ? (
              <p className="hint">Finding hotspots…</p>
            ) : (
              <p className="font-body text-[14px] leading-snug">No hotspots are open right now.</p>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.name} className="mt-4" aria-label={g.name}>
            <span className="seclabel">{g.name}</span>
            <ul className="mt-1.5 divide-y divide-line rounded-hz border border-line bg-ink-3">
              {g.rows.map((h) => {
                const m = metres(h);
                const soon = h.status !== "open";
                return (
                  <li key={h.id}>
                    <button type="button" onClick={() => onPick(h)} className={clsx("flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-2 text-left", soon && "opacity-70")}>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[14px] font-black uppercase leading-tight">
                          {h.name}
                          {h.slug === yoursSlug && <span className="ml-2 align-middle font-mono text-[8.5px] font-medium tracking-[0.1em] text-orange">YOURS</span>}
                        </span>
                        <span className="block truncate font-body text-[12px] leading-tight text-dim">{h.zoneName}</span>
                      </span>
                      <span className="flex-none text-right font-mono text-[10px] leading-tight text-dim">
                        <span className={clsx("block", !soon && "text-cream")}>{status(h)}</span>
                        {m !== null && <span className="block">{distanceLabel(m)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
