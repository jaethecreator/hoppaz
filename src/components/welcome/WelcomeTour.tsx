"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Mascot from "@/components/Mascot";
import AskPaz from "./AskPaz";
import { WELCOME_ENABLED, useWelcome } from "@/lib/welcome";

type TourStep = {
  /** The control it points at: a data-tour value. The first that is on the screen wins. */
  targets: string[];
  title: string;
  line: string;
  /** Said instead when the control is not there (no location set, so no home base yet). */
  fallbackLine?: string;
};

/** Four steps, under a minute (docs/UI-UPGRADE.md section 8). The last one is the way out, and it is the loud one. */
const STEPS: ReadonlyArray<TourStep> = [
  {
    targets: ["hotspots"],
    title: "The map",
    line: "Events and your people, live. Signs are events. The crosshairs are hotspots: open rooms you can walk into.",
  },
  { targets: ["events"], title: "Events", line: "Swipe right if we outside." },
  {
    targets: ["home", "hotspots"],
    title: "Your home base",
    line: "This is your turf. Bring your people.",
    fallbackLine: "Set your location and your home base shows up here. This is your turf. Bring your people.",
  },
  { targets: [], title: "Stuck? Ask Paz.", line: "Ask about anything, any time." },
];

type Box = { x: number; y: number; w: number; h: number };
const PAD = 6;

/**
 * The first-run tour on the map: four cards that point at the real controls, with dots and Skip. It shows once, after the
 * room part of the welcome (or straight away for someone who already has an account), and it ends for good on Done or Skip.
 * `enabled` is false while something else has the screen (an event's card, a sheet): the tour waits.
 */
export default function WelcomeTour({ enabled }: { enabled: boolean }) {
  const { step: saved, ready, hydrate, finish } = useWelcome();
  useEffect(() => hydrate(), [hydrate]);
  const active = WELCOME_ENABLED && ready && saved === "tour" && enabled;
  const [at, setAt] = useState(0);
  const [asking, setAsking] = useState(false);
  const step = STEPS[at];
  const last = at === STEPS.length - 1;

  // Where the control is, now and as the page settles (the chrome measures itself after the first paint).
  const [box, setBox] = useState<{ box: Box | null; which: string | null }>({ box: null, which: null });
  useLayoutEffect(() => {
    if (!active) return;
    const find = () => {
      for (const t of step.targets) {
        const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`);
        const r = el?.getBoundingClientRect();
        if (el && r && r.width > 0 && r.height > 0) return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, which: t };
      }
      return { box: null, which: null };
    };
    const measure = () =>
      setBox((b) => {
        const n = find();
        const same = b.which === n.which && b.box?.x === n.box?.x && b.box?.y === n.box?.y && b.box?.w === n.box?.w && b.box?.h === n.box?.h;
        return same ? b : n;
      });
    measure();
    const t = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, [active, step]);

  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) next.current?.focus({ preventScroll: true });
  }, [active, at]);

  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const place = useMemo(() => {
    if (!box.box) return { bottom: 24 } as const;
    const below = box.box.y + box.box.h / 2 < vh * 0.5;
    return below ? ({ top: box.box.y + box.box.h + PAD + 14 } as const) : ({ bottom: vh - box.box.y + PAD + 14 } as const);
  }, [box.box, vh]);

  if (!active) return null;
  const line = step.fallbackLine && box.which !== "home" ? step.fallbackLine : step.line;

  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome tour" className="fixed inset-0 z-[70]">
      {/* The dim layer: with a control to point at, the control is cut out of it. */}
      {box.box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[14px] ring-2 ring-orange"
          style={{ left: box.box.x - PAD, top: box.box.y - PAD, width: box.box.w + PAD * 2, height: box.box.h + PAD * 2, boxShadow: "0 0 0 100vmax rgb(14 11 10 / 0.74)" }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-ink/75" />
      )}

      <div
        className={clsx(
          "absolute left-1/2 w-[min(92vw,420px)] -translate-x-1/2 rounded-[18px] border border-line bg-ink-2 shadow-sheet",
          last ? "px-5 pb-5 pt-4" : "px-4 pb-4 pt-3.5"
        )}
        style={{ ...place, marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-start gap-3">
          <Mascot state={last ? "celebrate" : "point"} size={last ? 84 : 56} className="flex-none" />
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className={clsx("font-display font-black uppercase leading-[1.05]", last ? "text-[30px]" : "text-[22px]")}>{step.title}</h2>
            <p className="mt-1 font-body text-[15px] leading-snug text-cream/90">{line}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5" role="img" aria-label={`Step ${at + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => (
            <i key={i} aria-hidden className={clsx("h-1.5 rounded-full transition-all", i === at ? "w-6 bg-orange" : "w-1.5 bg-line")} />
          ))}
        </div>

        {last ? (
          <div className="mt-4">
            <button type="button" className="btn btn-ghost w-full" onClick={() => setAsking(true)}>
              ASK PAZ
            </button>
            <button ref={next} type="button" className="btn mt-2 min-h-[60px] w-full text-[18px] tracking-[0.06em]" onClick={finish}>
              DONE
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="min-h-[48px] flex-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim" onClick={finish}>
              Skip
            </button>
            <button ref={next} type="button" className="btn flex-[1.6]" onClick={() => setAt((n) => n + 1)}>
              NEXT
            </button>
          </div>
        )}
      </div>

      {asking && <AskPaz onClose={() => setAsking(false)} />}
    </div>
  );
}
