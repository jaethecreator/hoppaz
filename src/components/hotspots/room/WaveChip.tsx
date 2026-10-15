"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hand, MessageCircle, X } from "lucide-react";
import { hotspotWave, waveCopy, type HotspotWave, type IncomingWave } from "./wave";

/**
 * "<alias> at <place> said hi": someone in this hotspot waved at you. WAVE BACK says hi to them; when that is a mutual
 * hi you are crew and the chip says whose name it is ("ADA IS IN YOUR CREW") with MESSAGE. The chip only ever has the
 * alias and the place until then (Jae, 15 Oct 2026).
 */
export default function WaveChip({ wave, onClose }: { wave: IncomingWave; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<HotspotWave | null>(null);
  const copy = out ? waveCopy(out, wave.alias) : null;

  const back = async () => {
    setBusy(true);
    setOut(await hotspotWave(wave.key));
    setBusy(false);
  };
  const message = () => {
    const dm = out && (out.status === "matched" || out.status === "already_crew") ? out.dm : undefined;
    onClose();
    router.push(dm ? `/chat/dm/${dm}` : "/chat");
  };

  return (
    <div
      role="status"
      className="absolute inset-x-3 bottom-[68px] z-30 mx-auto flex max-w-[420px] items-center gap-3 rounded-[12px] border border-orange bg-ink-2/95 px-3.5 py-2.5 shadow-sheet backdrop-blur lg:bottom-4"
    >
      <Hand size={18} className="flex-none text-orange" aria-hidden />
      <div className="min-w-0 flex-1">
        {copy?.crew ? (
          <p className="font-display text-[14px] font-black uppercase leading-tight text-danfo">{copy.text}</p>
        ) : out ? (
          <p className={`font-body text-[13px] leading-snug ${copy?.tone === "warn" ? "text-fireant" : "text-cream"}`}>{copy?.text}</p>
        ) : (
          <>
            <p className="truncate font-display text-[14px] font-black leading-tight">{wave.alias}</p>
            <p className="font-mono text-[10px] uppercase leading-snug tracking-[0.08em] text-dim">said hi at {wave.place}</p>
          </>
        )}
      </div>
      {copy?.crew ? (
        <button type="button" className="btn flex-none px-3" onClick={message}>
          <MessageCircle size={15} aria-hidden /> MESSAGE
        </button>
      ) : !out ? (
        <button type="button" className="btn flex-none px-3" onClick={back} disabled={busy}>
          {busy ? "…" : "WAVE BACK"}
        </button>
      ) : null}
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 flex-none place-items-center text-dim">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
