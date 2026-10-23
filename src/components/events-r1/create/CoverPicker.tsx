"use client";

/* eslint-disable @next/next/no-img-element -- a data URL the host just picked, sizes unknown */

import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import Wordmark from "@/components/Wordmark";
import { useR1Api } from "@/lib/events-r1/hooks";
import { coverFromFile, uploadCoverFile } from "./cover";

/**
 * Luma style cover at the top of the create page: a 16:9 box. Tap it to pick from the gallery or take a photo (no capture
 * attribute, so the phone offers both). With none, a calm dark tile with the Hoppaz mark: the event page shows its own
 * branded strip then.
 */
export default function CoverPicker({ cover, onChange }: { cover: string | null; onChange: (url: string | null) => void }) {
  const real = useR1Api()?.mode === "real";
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (f: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      onChange(await (real ? uploadCoverFile(f) : coverFromFile(f)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture won't open. Try another.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5">
      <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={busy}
        aria-label={cover ? "Change cover" : "Add cover"}
        className="relative block aspect-video w-full overflow-hidden rounded-hz border border-line bg-ink-3 disabled:opacity-70"
      >
        {cover ? (
          <>
            <img src={cover} alt="" className="h-full w-full object-cover" />
            <span className="absolute bottom-2 right-2 rounded-full bg-brand-ink/70 px-3 py-1 font-body text-[13px] text-brand-cream">{busy ? (real ? "Uploading" : "Working") : "Change"}</span>
          </>
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-3">
            <Wordmark size={15} tone="cream" className="opacity-25" />
            <span className="inline-flex items-center gap-2 font-body text-[15px] text-dim">
              <ImagePlus size={18} aria-hidden />
              {busy ? (real ? "Uploading" : "Working") : "Add cover"}
            </span>
          </span>
        )}
      </button>
      {cover && (
        <button type="button" onClick={() => onChange(null)} className="mt-1 min-h-[36px] px-1 font-body text-[14px] text-dim underline underline-offset-4">
          Remove
        </button>
      )}
      {error && (
        <p role="alert" className="px-1 pt-1 font-body text-[14px] text-fireant">
          {error}
        </p>
      )}
    </div>
  );
}
