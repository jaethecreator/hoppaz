"use client";

import "@fontsource/unbounded/800.css";
import "@fontsource/fraunces/900.css";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Look } from "@/lib/events-r1/looks";
import { peekTint, readTint, tintStyle } from "@/lib/tint";
import type { Tint } from "@/lib/tint";

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

/** The pack's background behaviour, behind the content. Minimal draws nothing. */
export function PackLayer({ pack }: { pack: Look["pack"] }) {
  if (pack === "minimal") return null;
  return <div aria-hidden className={`pack-layer pack-${pack}`} />;
}

/** A host surface: tinted variables, the page colour, and the pack behind it. */
export default function TintShell({ look, tint, className = "", children }: { look: Look; tint?: Tint; className?: string; children: ReactNode }) {
  const style = useLookStyle(look, tint);
  return (
    <div className={`tint-ui relative isolate ${className}`} style={style} data-pack={look.pack}>
      <PackLayer pack={look.pack} />
      <div className="relative">{children}</div>
    </div>
  );
}
