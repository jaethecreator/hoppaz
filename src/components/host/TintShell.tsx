"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Look } from "@/lib/events-r1/looks";
import { readTint, tintStyle } from "@/lib/tint";
import type { Tint } from "@/lib/tint";

/**
 * The tint read from a picture, for a look whose colour follows its cover or logo (look.auto). Until it is read (or when there
 * is no picture) the look's own stored tint is used, so a page never flashes a wrong colour once it has been saved.
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
  if (look.auto && src && read?.src === src) return read.tint;
  return look.tint;
}

/** The CSS variables for a look. */
export function useLookStyle(look: Look, tint?: Tint): CSSProperties {
  const t = tint ?? look.tint;
  return useMemo(() => tintStyle(t, look.mood), [t, look.mood]);
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
