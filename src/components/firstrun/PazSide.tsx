"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import Mascot, { type MascotState } from "@/components/Mascot";

/**
 * Paz talking, coming in from the side: the mascot and a speech bubble at the bottom of the screen, over whatever is
 * there. It takes no more room than its words and leaves the map alone. Used for the first run's second and third layer.
 * It sits where toasts do (above the page's own bottom controls), and on a wide screen stays at the left.
 */
export default function PazSide({
  children,
  actions,
  mascot = "point",
  onClose,
  at = "bottom",
}: {
  children: ReactNode;
  actions?: ReactNode;
  mascot?: MascotState;
  /** Shows an x that closes it. */
  onClose?: () => void;
  /** Where on the screen: the bottom (over the map), or the top (in a room, where your avatar stands low). */
  at?: "bottom" | "top";
}) {
  return (
    <div
      role="dialog"
      aria-label="Paz"
      data-firstrun
      className={`pointer-events-none fixed inset-x-0 z-[42] mx-auto flex w-[min(calc(100vw-24px),440px)] gap-2 lg:inset-x-auto lg:left-[88px] lg:mx-0 lg:w-[380px] ${at === "top" ? "items-start" : "items-end"}`}
      style={
        at === "top"
          ? { top: "calc(4.4rem + env(safe-area-inset-top, 0px))" }
          : { bottom: "calc(var(--hz-nav-bottom, 5.25rem) + var(--hz-toast-lift, 0px) + env(safe-area-inset-bottom, 0px))" }
      }
    >
      <Mascot state={mascot} size={72} className="hz-side-in rig-on-raised pointer-events-auto flex-none" />
      <div className={`hz-bubble-in pointer-events-auto relative min-w-0 flex-1 rounded-[14px] border border-line bg-ink-2 px-3.5 py-3 shadow-sheet ${at === "top" ? "rounded-tl-[4px]" : "rounded-bl-[4px]"}`}>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="absolute -right-1.5 -top-1.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-ink-3 text-cream">
            <X size={14} strokeWidth={2.4} aria-hidden />
          </button>
        )}
        <p className="font-body text-[15px] leading-snug">{children}</p>
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
