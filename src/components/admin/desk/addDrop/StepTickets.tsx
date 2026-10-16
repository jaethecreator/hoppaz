"use client";

import clsx from "clsx";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import { useId } from "react";
import { plural, splitCodes } from "../format";
import { MAX_DROPS, MAX_TICKETS, slotLabel, writeCodes, type StepProps } from "./model";
import { Question } from "./ui";

/**
 * Step 2: how many tickets, then one empty code field per ticket. 1 ticket = 1 box = 1 winner, so a field that holds
 * several codes (or a paste of several) spills into the next fields, and codes with no field left raise the warning.
 */
export default function StepTickets({ f, d, set }: StepProps) {
  const id = useId();
  const per = f.perDrop;
  const extra = d.overflow.length > 0;
  const n = d.filled + d.overflow.length;
  // Every code staff gave, in field order: what MAKE IT and KEEP ONLY work from.
  const all = [...d.slotCodes.filter(Boolean), ...d.overflow];
  const canTickets = !d.series && all.length <= MAX_TICKETS;
  const canDrops = d.series && per === 1 && all.length <= MAX_DROPS;
  const wide = d.series && per > 1;
  // Hoppers' "N tickets left" counts the drops of a mystery series (lib/game-time/drops.ts ticketsLeft), so it is 1 per drop.
  const oneEach = d.series && f.mystery;

  const write = (i: number, value: string) => {
    const parts = splitCodes(value);
    set({ codes: writeCodes(f.codes, i, parts.length > 1 ? parts : [value], d.total) });
  };

  return (
    <div>
      <Question title="How many tickets does this drop give away?" hint="1 ticket = 1 hidden box = 1 winner." />

      <div className="mt-5 flex items-center gap-4">
        <button type="button" className="btn btn-ghost !min-h-[48px] !w-12 !p-0" aria-label="One ticket fewer" disabled={per <= 1} onClick={() => set({ perDrop: per - 1 })}>
          <Minus size={20} />
        </button>
        <span className="num w-12 text-center text-4xl" aria-live="polite">
          {per}
        </span>
        <button type="button" className="btn btn-ghost !min-h-[48px] !w-12 !p-0" aria-label="One ticket more" disabled={per >= (oneEach ? 1 : MAX_TICKETS)} onClick={() => set({ perDrop: per + 1 })}>
          <Plus size={20} />
        </button>
        <p className="font-body text-[15px] leading-snug text-dim">
          {d.series ? `${per === 1 ? "ticket" : "tickets"} per drop, so ${plural(per, "winner")} per drop` : `${per === 1 ? "ticket" : "tickets"}, so ${plural(per, "winner")}`}
        </p>
      </div>
      {d.series && (
        <p className="hint mt-3">
          {d.dropsN} drops, so {plural(d.total, "code")} in all ({d.dropsN} × {per}).{oneEach ? " A mystery series gives 1 ticket per drop, because the counter Hoppers see counts drops." : ""}
        </p>
      )}

      {extra && (
        <div role="alert" className="mt-5 rounded-hz border border-fireant bg-fireant/10 p-4">
          <p className="flex items-start gap-3 font-display text-[17px] font-black leading-snug text-fireant">
            <AlertTriangle size={22} className="mt-0.5 flex-none" aria-hidden />
            <span>
              {d.series
                ? `You pasted ${n} codes, but this series needs ${d.total} codes (${d.dropsN} drops × ${plural(per, "ticket")}).`
                : `You pasted ${n} codes, but this drop gives ${plural(d.total, "ticket")}.`}
            </span>
          </p>
          <p className="mt-2 font-body text-[15px] leading-snug">Each code hides its own box and makes its own winner. {n} codes means {n} winners.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {canTickets && (
              <button type="button" className="btn flex-1 !min-h-[48px]" onClick={() => set({ perDrop: all.length, codes: all })}>
                MAKE IT {all.length} TICKETS
              </button>
            )}
            {canDrops && (
              <button type="button" className="btn flex-1 !min-h-[48px]" onClick={() => set({ drops: String(all.length), codes: all })}>
                MAKE IT {all.length} DROPS
              </button>
            )}
            <button type="button" className="btn btn-ghost flex-1 !min-h-[48px]" onClick={() => set({ codes: all.slice(0, d.total) })}>
              KEEP ONLY THE FIRST {d.total === 1 ? "CODE" : `${d.total} CODES`}
            </button>
          </div>
        </div>
      )}

      <div className="mt-7">
        <p className="label">{d.total === 1 ? "The ticket code" : "The ticket codes"}</p>
        <div className="grid gap-3">
          {d.slotCodes.map((_, i) => {
            const err = d.codeErr[i];
            return (
              <div key={i}>
                <div className="flex items-center gap-3">
                  <label htmlFor={`${id}-${i}`} className={clsx("flex-none font-mono text-[11px] uppercase tracking-[0.1em] text-dim", wide ? "w-[100px]" : "w-[76px]")}>
                    {slotLabel(i, per, d.series)}
                  </label>
                  <input
                    id={`${id}-${i}`}
                    className={clsx("min-h-[48px] font-mono", err && "!border-fireant")}
                    value={f.codes[i] ?? ""}
                    placeholder="Paste the code from the brand"
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-invalid={err ? true : undefined}
                    onChange={(e) => write(i, e.target.value)}
                    onPaste={(e) => {
                      const parts = splitCodes(e.clipboardData.getData("text"));
                      if (!parts.length) return;
                      // One code fills this field. Several fill this one and the next ones; the rest are the extra codes.
                      e.preventDefault();
                      set({ codes: writeCodes(f.codes, i, parts, d.total) });
                    }}
                  />
                </div>
                {err && <p className={clsx("hint mt-1 !text-fireant", wide ? "pl-[112px]" : "pl-[88px]")}>{err}</p>}
              </div>
            );
          })}
        </div>
        <p className="hint mt-3">Only staff see codes. The winner gets theirs the moment they find the box.</p>
      </div>
    </div>
  );
}
