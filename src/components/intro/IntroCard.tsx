"use client"

import Mascot, { type MascotState } from "@/components/Mascot"
import { X } from "lucide-react"
import { useEffect } from "react"

import s from "./intro.module.css"

/**
 * Paz and her speech card. Presentational: it is handed the words and the
 * handlers. Paz stands on the card's top edge, half tucked behind it.
 *
 * It is a labelled region, not a dialog, on purpose: other parts of the app
 * (the install sheet) wait for dialogs to close, and the tour is not one.
 */
export type CardProps = {
  mascot: MascotState
  title: string
  line: string
  /** The orange button. */
  cta?: { label: string; onClick: () => void; busy?: boolean }
  /** "3 of 14". */
  count?: { n: number; total: number }
  /** The small Skip at the top right. */
  skip?: { label: string; onClick: () => void }
  /** "End tour", for the Hopper who has had enough. Not drawn when there is a close (x), which does the same and more. */
  end?: () => void
  /** The x at the top right (and Escape): the card goes away. */
  close?: () => void
  /** No button: the Hopper does the thing. Shows "Your move". */
  yourMove?: boolean
  /** Changes when the content does, to replay the entrance. */
  stepKey: string
  /** A bigger Paz for the moments that are a party (hello, a win, the end). */
  big?: boolean
  /** A small Paz that only peeks over the card, and no "Your move" row: the screen behind needs the room. */
  compact?: boolean
  /** A picture under the words (the iPhone install cards). */
  picture?: "taps" | "home"
}

export default function IntroCard({
  mascot,
  title,
  line,
  cta,
  count,
  skip,
  end,
  close,
  yourMove,
  stepKey,
  big,
  compact,
  picture,
}: CardProps) {
  useEffect(() => {
    if (!close) return
    const onKey = (e: KeyboardEvent) => {
      // A sheet open over the screen takes its own Escape.
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])
  const pct = count ? Math.round((count.n / count.total) * 100) : 100
  return (
    <div className={s.stack} key={stepKey} data-compact={!!compact}>
      <div className={s.paz}>
        <Mascot
          state={mascot}
          size={compact ? 84 : big ? 156 : 122}
          edge="ink"
          label="Paz, your conductor"
        />
      </div>
      <section
        className={s.card}
        role="region"
        aria-label="Paz, your guide"
        aria-live="polite"
      >
        <div className={s.head}>
          <span className={s.count} aria-hidden={!count}>
            {count
              ? `${String(count.n).padStart(2, "0")} / ${String(count.total).padStart(2, "0")}`
              : "PAZ"}
          </span>
          <span className={s.headEnd}>
            {skip && (
              <button type="button" className={s.skip} onClick={skip.onClick}>
                {skip.label}
              </button>
            )}
            {close && (
              <button
                type="button"
                className={s.close}
                onClick={close}
                aria-label="Close the tour"
              >
                <X size={20} strokeWidth={2.4} aria-hidden />
              </button>
            )}
          </span>
        </div>
        <h2 className={s.title}>{title}</h2>
        <p className={s.line}>{line}</p>

        {(cta || (yourMove && !compact)) && (
          <div className={s.act}>
            {cta ? (
              <button
                type="button"
                className={`btn ${cta.busy ? s.busy : ""}`}
                onClick={cta.onClick}
                disabled={cta.busy}
              >
                {cta.label}
              </button>
            ) : (
              <span className={s.move}>
                <i className={s.moveDot} aria-hidden />
                Your move
              </span>
            )}
          </div>
        )}

        {end && !close ? (
          <div className={s.foot}>
            <button type="button" className={s.end} onClick={end}>
              End tour
            </button>
          </div>
        ) : (
          <div className={s.gap} />
        )}
        <i className={s.barTrack} aria-hidden />
        <i className={s.bar} style={{ width: `${pct}%` }} aria-hidden />
      </section>
    </div>
  )
}
