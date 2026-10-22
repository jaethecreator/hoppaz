"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * The Create button. While the name is empty it is dim (disabled, as before). Once the required part is filled it glows:
 * a soft, calm orange pulse. With reduced motion the glow stays on but does not move.
 */
export default function GlowButton({ ready, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { ready: boolean }) {
  return (
    <>
      <style>{`
        @keyframes hz-create-glow {
          0%, 100% { box-shadow: 0 4px 0 #B83600, 0 0 10px 1px rgba(255, 77, 0, 0.30); }
          50% { box-shadow: 0 4px 0 #B83600, 0 0 26px 6px rgba(255, 77, 0, 0.55); }
        }
        .hz-create-glow:not(:disabled) { animation: hz-create-glow 2.6s ease-in-out infinite; }
        .hz-create-glow:not(:disabled):active { animation: none; box-shadow: none; }
        @media (prefers-reduced-motion: reduce) {
          .hz-create-glow:not(:disabled) { animation: none; box-shadow: 0 4px 0 #B83600, 0 0 20px 3px rgba(255, 77, 0, 0.45); }
          .hz-create-glow:not(:disabled):active { box-shadow: none; }
        }
      `}</style>
      <button type="button" className={`${className} ${ready ? "hz-create-glow" : ""}`} {...rest} />
    </>
  );
}
