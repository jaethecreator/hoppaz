"use client";

import "@fontsource/unbounded/800.css";
import "@fontsource/fraunces/900.css";
import "./packs.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Look } from "@/lib/events-r1/looks";
import { peekTint, readTint, tintStyle } from "@/lib/tint";
import type { Mood, Tint } from "@/lib/tint";
import { mountConfetti } from "./packConfetti";

/**
 * The tint read from a picture, for a look whose colour follows its cover or logo (look.auto). A picture read before paints on
 * the first frame; while a new picture is read the last colour stays (no grey between two covers). With nothing read yet (or no
 * picture) the look's own stored tint is used, so a saved page never flashes a wrong colour.
 */
export function usePictureTint(src: string | null, look: Look): Tint {
  const [read, setRead] = useState<{ src: string; tint: Tint } | null>(null);
  useEffect(() => {
    if (!src || !look.auto) return;
    let live = true;
    void readTint(src).then((tint) => {
      if (live) setRead({ src, tint });
    });
    return () => {
      live = false;
    };
  }, [src, look.auto]);
  if (!look.auto || !src) return look.tint;
  return peekTint(src) ?? read?.tint ?? look.tint;
}

/** The title font of each pack (mock-up create-event-final.html): Poppins for the quiet two, Unbounded for the loud two, Fraunces for Owambe. */
const PACK_FONT: Record<Look["pack"], string> = {
  minimal: "var(--font-poppins)",
  glow: "var(--font-poppins)",
  confetti: '"Unbounded", var(--font-poppins)',
  detty: '"Unbounded", var(--font-poppins)',
  owambe: '"Fraunces", Georgia, serif',
};

/** The CSS variables for a look: the tint's colours and the pack's title font (--t-font, used by .t-title). */
export function useLookStyle(look: Look, tint?: Tint): CSSProperties {
  const t = tint ?? look.tint;
  return useMemo(() => ({ ...tintStyle(t, look.mood), "--t-font": PACK_FONT[look.pack] ?? PACK_FONT.minimal }) as CSSProperties, [t, look.mood, look.pack]);
}

/**
 * The pack's background behaviour, behind the content (styles in packs.css). Minimal draws nothing. The tinted root around it
 * carries data-mood (the packs' Day tuning keys on it). Confetti draws on canvas, so it remounts when the tint or mood changes.
 */
export function PackLayer({ pack, mood, tint }: { pack: Look["pack"]; mood?: Mood; tint?: Tint }) {
  if (pack === "minimal") return null;
  // Whole class names written out so Tailwind keeps them (a built-up name gets purged from the CSS).
  if (pack === "glow")
    return (
      <div aria-hidden className="pack-layer pack-glow">
        <div className="pg-stage">
          <i className="pg-key" />
          <i className="pg-two" />
          <i className="pg-haze" />
        </div>
      </div>
    );
  if (pack === "confetti") return <ConfettiLayer mood={mood} tintKey={tint ? `${tint.hue}/${tint.chroma}` : ""} />;
  if (pack === "detty")
    return (
      <div aria-hidden className="pack-layer pack-detty">
        <i className="dd-fx" />
        <i className="dd-glint" />
        <i className="dd-motifs" />
      </div>
    );
  if (pack === "owambe")
    return (
      <div aria-hidden className="pack-layer pack-owambe">
        <div className="ow-cloth">
          <i className="ow-gold" />
        </div>
      </div>
    );
  return null;
}

function ConfettiLayer({ mood, tintKey }: { mood?: Mood; tintKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    return el ? mountConfetti(el) : undefined;
  }, [mood, tintKey]);
  return (
    <div ref={ref} aria-hidden className="pack-layer pack-confetti">
      <canvas className="cf-far" />
      <canvas className="cf-near" />
      <i className="cf-grain" />
    </div>
  );
}

/** A host surface: tinted variables, the page colour, and the pack behind it. */
export default function TintShell({ look, tint, className = "", children }: { look: Look; tint?: Tint; className?: string; children: ReactNode }) {
  const style = useLookStyle(look, tint);
  return (
    <div className={`tint-ui relative isolate ${className}`} style={style} data-pack={look.pack} data-mood={look.mood}>
      <PackLayer pack={look.pack} mood={look.mood} tint={tint ?? look.tint} />
      <div className="relative">{children}</div>
    </div>
  );
}
