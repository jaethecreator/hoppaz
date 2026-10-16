"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Crew, Desk, GameTimeAct } from "./types";
import { Aside, Header, PhoneBar, type Actions } from "./addDrop/Chrome";
import { STEP_NAMES, buildChecks, createBody, derive, doneMessage, initForm, makeCtx, saveLabel, shortLine, type Ctx, type Derived, type Form, type StepProps } from "./addDrop/model";
import StepCheck from "./addDrop/StepCheck";
import StepTickets from "./addDrop/StepTickets";
import StepWhen from "./addDrop/StepWhen";
import StepWhere from "./addDrop/StepWhere";
import StepWho from "./addDrop/StepWho";

export type AddDropProps = {
  /** The crew room the drop goes in. */
  crew: Crew;
  /** Every drop (to check overlaps and win rules) and each room's hiding spots. */
  desk: Desk;
  act: GameTimeAct;
  busy: boolean;
  /** Back to the room without saving. */
  onClose: () => void;
  /** Saved: back to the room, with a line to show staff ("Drop scheduled for 12:00."). */
  onSaved: (message: string) => void;
};

/**
 * Add a drop to a crew room in five steps: When, Tickets, Where, Who, Check. It asks how many tickets first and gives one
 * empty code field per ticket, because each code is its own box with its own winner (on 15 Oct two winners came out of a
 * drop that was meant to be one, from a textarea that took one code per line). The thinking is in addDrop/model.ts; each step
 * is its own file. Phone: a fixed bottom bar. Desktop (lg): a side panel with the drop so far.
 */
export default function AddDrop({ crew, desk, act, busy, onClose, onSaved }: AddDropProps) {
  const [t0] = useState(() => Date.now());
  // Time keeps moving while staff fill this in: "opens in the past" has to notice.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const liveCtx = useMemo(() => makeCtx(crew, desk, t0), [crew, desk, t0]);
  const [f, setF] = useState<Form>(() => initForm(liveCtx));
  // A patch, or a function of the latest form (so quick taps in a row each build on the one before).
  const set = useCallback((p: Partial<Form> | ((s: Form) => Partial<Form>)) => setF((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })), []);

  const [step, setStep] = useState(0);
  // The furthest step staff have been to: a step they come back from stays done while it is still fine.
  const [reached, setReached] = useState(0);
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [partial, setPartial] = useState("");
  // While a save runs (and after a series stopped half way) the screen holds still: each saved drop reloads the desk, and a
  // drop that was just saved must not show up as a clash with the next one.
  const [frozen, setFrozen] = useState<{ d: Derived; ctx: Ctx } | null>(null);

  const liveD = derive(f, liveCtx, now);
  const d = frozen?.d ?? liveD;
  const ctx = frozen?.ctx ?? liveCtx;
  const locked = saving || !!partial;

  const done = (i: number) => i < step || (i > step && i <= Math.min(reached, 3) && !d.problems[i]);
  const checks = buildChecks(f, d, step, now);
  const blocking = d.blocking(step);

  // START NOW asks twice: the first tap changes the button, the second opens the drop. It backs off after 4 seconds.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const root = useRef<HTMLElement>(null);
  const go = (i: number) => {
    if (locked || i < 0 || i > 4 || i === step) return;
    if (i > step && d.problems[step]) return;
    setArmed(false);
    setSaveError("");
    setStep(i);
    setReached((r) => Math.max(r, i));
    // A new step starts at its top, not where the last one was scrolled to.
    requestAnimationFrame(() => {
      const el = root.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    });
  };

  const save = async () => {
    if (blocking || locked || busy) return;
    if (f.mode === "now" && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setSaveError("");
    setFrozen({ d: liveD, ctx: liveCtx });
    setSaving(true);
    const count = liveD.series ? liveD.dropsN : 1;
    let ok = 0;
    let reason = "";
    let dropped = false;
    try {
      for (let i = 0; i < count; i++) {
        setProgress(i + 1);
        const r = await act(createBody(f, liveD, liveCtx, i), (m) => {
          reason = m;
        });
        if (!r) break;
        ok++;
      }
    } catch {
      // The connection dropped part way: the drop may or may not have been saved, so staff look at the room.
      dropped = true;
      reason = "the connection dropped";
    } finally {
      setSaving(false);
      setProgress(0);
    }
    if (ok === count) {
      onSaved(doneMessage(f, liveD));
      return;
    }
    const why = (reason || "that did not work").replace(/[.\s]+$/, "");
    if (ok > 0 || (liveD.series && dropped)) {
      // Some drops are in: staff must see what is there before they try again, so this ends the flow.
      setPartial(`${ok} of ${count} scheduled. Stopped: ${why}. Check Coming up in the room.`);
      return;
    }
    // Nothing saved, so staff can fix what the server said and save again.
    setFrozen(null);
    setSaveError(dropped ? "The connection dropped. Check Coming up in the room before you try again." : reason || "That did not work.");
  };

  const last = step === 4;
  const actions: Actions = {
    primaryLabel: last ? saveLabel(f, d, armed, progress) : `NEXT: ${STEP_NAMES[step + 1]}`,
    primaryDisabled: !!blocking || busy || saving || !!partial,
    armed: last && armed,
    onPrimary: last ? save : () => go(step + 1),
    onBack: step === 0 ? onClose : () => go(step - 1),
    backDisabled: locked,
  };
  const stepProps: StepProps = { f, d, ctx, set, now };

  return (
    <section ref={root} className="flex min-h-full flex-col bg-ink text-cream" aria-label="Add a drop">
      <Header crew={crew} step={step} done={done} onStep={go} onClose={onClose} closeDisabled={locked} />
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 px-4 pb-44 pt-6 lg:px-8 lg:pb-12">
          <div className={clsx("w-full", step === 2 ? "max-w-[860px]" : "max-w-[620px]")}>
            {step === 0 && <StepWhen {...stepProps} />}
            {step === 1 && <StepTickets {...stepProps} />}
            {step === 2 && <StepWhere {...stepProps} />}
            {step === 3 && <StepWho {...stepProps} />}
            {step === 4 && <StepCheck {...stepProps} go={go} checks={checks} locked={locked} saveError={saveError} partial={partial} onDone={() => onSaved(partial)} />}
          </div>
        </div>
        <Aside f={f} d={d} ctx={ctx} step={step} done={done} checks={checks} problem={blocking} actions={actions} />
      </div>
      <PhoneBar line={shortLine(f, d)} problem={blocking} actions={actions} />
    </section>
  );
}
