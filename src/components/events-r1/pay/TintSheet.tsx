"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogFocus } from "../signin/useDialogFocus";

/**
 * A sheet in the page's tint: a bottom sheet on a phone, a card near the top on a wide screen. It is drawn in a portal (so the app's
 * bars never cover it) and takes the --t-* colours of the host page it was opened from.
 */
export default function TintSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [vars, setVars] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setVars(anchor.current?.closest(".tint-ui")?.getAttribute("style") ?? "");
  }, [open]);
  const show = open && mounted;
  useDialogFocus(show, box, onClose);

  return (
    <>
      <span ref={anchor} hidden />
      {show &&
        createPortal(
          <div className="tint-ui contents" ref={(el) => el?.setAttribute("style", vars)}>
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-start sm:px-4 sm:pt-[70px]"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
              }}
            >
              <div
                ref={box}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="t-adopt max-h-[94dvh] w-full overflow-y-auto rounded-t-[22px] bg-t-solid text-t-text shadow-[0_30px_70px_rgba(0,0,0,.5)] sm:w-[460px] sm:rounded-hz"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
              >
                <div className="flex items-center gap-2.5 border-b border-t-line px-4 py-3.5">
                  <h2 id={titleId} className="font-display text-[17px] font-extrabold leading-tight">
                    {title}
                  </h2>
                  <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-11 w-11 flex-none place-items-center rounded-hz border border-t-line">
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <div className="grid gap-3 px-4 pb-[18px] pt-3.5">{children}</div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
