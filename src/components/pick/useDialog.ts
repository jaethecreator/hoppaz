"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focus for a small pop-up that mounts when it opens and unmounts when it closes (the NEXT 20 card, the month
 * pop-up): focus moves into the box, Tab stays inside it, Escape closes it, and focus goes back to whatever
 * opened it.
 */
export function useDialog(box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const node = box.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      } else if (!node.contains(at)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Only hand focus back if it is still inside the box (or nowhere): a tap that moved it elsewhere keeps it.
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || node?.contains(document.activeElement))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [box]);
}
