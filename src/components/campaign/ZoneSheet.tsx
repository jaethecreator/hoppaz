"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { CampaignContent } from "@/lib/campaign/layout";
import css from "./Campaign.module.css";

export type ZoneSheetKind = "awards" | "artist";

/**
 * A zone's longer story (the awards on the wall, the artist's note), opened only from the zone's pill. It slides up over
 * the lower part of the world and closes back onto it. Nothing long ever shows by itself.
 */
export default function ZoneSheet({ kind, content, link, onClose }: { kind: ZoneSheetKind; content: CampaignContent; link: string | null; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const awards = kind === "awards";
  return (
    <div className={css.sheet} role="dialog" aria-modal="true" aria-labelledby="zone-sheet-title">
      <div className={css.sheetHead}>
        <h2 id="zone-sheet-title">{awards ? "Awards Gallery" : content.artistTitle || "Artist Corner"}</h2>
        <button ref={close} type="button" className={css.iconButton} onClick={onClose} aria-label="Close">
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className={css.sheetBody}>
        {awards ? (
          <div className={css.awards}>
            {content.awards.map((award, index) => (
              <article className={css.award} key={`${award.title}-${index}`}>
                <p className={css.eyebrow}>{award.year}</p>
                <strong>{award.title}</strong>
                <p>{award.detail}</p>
                {award.sourceUrl && (
                  <a href={award.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Read the story
                    <ArrowUpRight size={14} aria-hidden />
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <>
            <p>{content.artistNote || "More about this artist will be added soon."}</p>
            {link && (
              <a className={css.action} href={link} target="_blank" rel="noopener noreferrer">
                Explore the release
                <ArrowUpRight size={15} aria-hidden />
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
