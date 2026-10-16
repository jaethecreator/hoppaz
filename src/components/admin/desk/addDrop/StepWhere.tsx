"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { plural, spotLabel } from "../format";
import RoomPicker from "../RoomPicker";
import type { StepProps } from "./model";
import { ChipRow, Question } from "./ui";

const RELOCATE = [
  { value: "0", label: "NEVER" },
  { value: "5", label: "5 MIN" },
  { value: "10", label: "10 MIN" },
  { value: "20", label: "20 MIN" },
];

/** Step 3: tap the objects where a box may hide (the room's real picture), then how often an unfound box moves. */
export default function StepWhere({ f, d, ctx, set }: StepProps) {
  const spots = ctx.spots;
  const picked = useMemo(() => new Set(f.picked), [f.picked]);
  const toggle = (id: string) => set((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : [...s.picked, id] }));
  const per = f.perDrop;

  return (
    <div>
      <Question title="Where can it hide?" hint="Tap the objects where the box may hide. Each box hides in one of them at random. More spots make it harder to find." />

      <div className="mt-5">
        <RoomPicker layout={ctx.layout} brand={ctx.crew.name} spots={spots} picked={picked} onToggle={toggle} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <p className="mr-1 font-body text-[16px] text-dim">
          <b className="font-display font-black text-cream">{plural(f.picked.length, "spot")}</b> for {plural(per, "ticket")}
        </p>
        {f.picked.map((id, i) => (
          <span key={id} className="inline-flex min-h-[40px] items-center gap-2 rounded-hz border border-line bg-ink-2 pl-3 font-mono text-[13px]">
            <span className="text-orange">{i + 1}</span>
            <span>{spotLabel(id)}</span>
            <button type="button" aria-label={`Remove ${spotLabel(id)}`} className="grid h-10 w-9 place-items-center text-dim hover:text-cream" onClick={() => toggle(id)}>
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost !min-h-[44px] px-4 py-2" disabled={!spots.length} onClick={() => set({ picked: spots.map((s) => s.id) })}>
          PICK ALL {spots.length}
        </button>
        <button type="button" className="btn btn-ghost !min-h-[44px] px-4 py-2" disabled={!f.picked.length} onClick={() => set({ picked: [] })}>
          CLEAR
        </button>
      </div>

      <details className="mt-4 rounded-hz border border-line bg-ink-2">
        <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em]">Show every spot as a list</summary>
        <ul className="grid grid-cols-2 gap-x-3 px-4 pb-3">
          {spots.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 font-body text-[14px]">
                <input type="checkbox" className="!h-5 !w-5 flex-none !p-0 accent-orange" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="min-w-0 break-words">{spotLabel(s.id)}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-8">
        <p className="label">If nobody finds it, move the box every</p>
        <ChipRow label="Move the box every" value={String(f.relocate)} options={RELOCATE} onChange={(v) => set({ relocate: Number(v) })} />
      </div>

      <details className="mt-6 rounded-hz border border-line bg-ink-2">
        <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em]">Hint rings</summary>
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="label">
              Hot up to (tiles)
              <input type="number" inputMode="decimal" step="0.5" min={0.5} max={100} value={d.hotS} onChange={(e) => set({ hot: e.target.value })} />
            </label>
            <label className="label">
              Warm up to (tiles)
              <input type="number" inputMode="decimal" step="0.5" min={0.5} max={200} value={d.warmS} onChange={(e) => set({ warm: e.target.value })} />
            </label>
          </div>
          <p className="hint mt-2">
            A search says hot when the nearest unfound box is within the first distance of the object searched, warm within the second, cold
            beyond. One ticket: 5 and 10 is a useful hint. Three or more tickets in a drop: 3 and 6, or hot is the answer a third of the time.
          </p>
        </div>
      </details>
    </div>
  );
}
