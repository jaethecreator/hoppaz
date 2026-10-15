"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hand, MessageCircle } from "lucide-react";
import Sheet from "@/components/Sheet";
import ChatFace from "@/components/chat/ChatFace";
import { blockPerson } from "@/lib/chat";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { reportHotspot } from "./api";
import { REASONS, reportCopy } from "./copy";
import { HOTSPOT_WAVES, hotspotWave, waveCopy, type HotspotWave } from "./wave";

/** Who the card is about: a head on the stage, or the author of a message (then `messageId` and `excerpt` are set). */
export type HeadPerson = { key: string; alias: string; look: unknown; messageId?: string; excerpt?: string };

/**
 * What you can do about someone in a hotspot: say hi (a mutual hi makes you crew and shows each of you the other's real
 * name: Jae, 15 Oct 2026), report them (or the message you tapped) and block them. Everything works on the opaque room
 * key, so the browser never learns who it is until they say hi back.
 */
export default function HeadCard({
  person,
  youKey,
  onClose,
  onBlocked,
}: {
  person: HeadPerson;
  /** Your own key in this room: your own face has no SAY HI. */
  youKey?: string | null;
  onClose: () => void;
  /** After a block: hide their messages and re-read the room. */
  onBlocked: (key: string) => void;
}) {
  const say = useToast((s) => s.say);
  const router = useRouter();
  const [step, setStep] = useState<"actions" | "block" | "report">("actions");
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState<HotspotWave | null>(null);
  const self = !!youKey && youKey === person.key;
  const hiCopy = hi ? waveCopy(hi, person.alias) : null;

  const sayHi = async () => {
    setBusy(true);
    const r = await hotspotWave(person.key);
    setBusy(false);
    setHi(r);
  };
  const message = () => {
    const dm = hi && (hi.status === "matched" || hi.status === "already_crew") ? hi.dm : undefined;
    onClose();
    router.push(dm ? `/chat/dm/${dm}` : "/chat");
  };

  const doBlock = async () => {
    setBusy(true);
    const ok = getSupabase() ? await blockPerson({ key: person.key }, person.alias) : true;
    setBusy(false);
    say(ok ? "Blocked." : "Could not block them. Try again.", ok ? "ok" : "error");
    if (ok) onBlocked(person.key);
    onClose();
  };

  const doReport = async (reason: string) => {
    setBusy(true);
    const r = getSupabase() ? await reportHotspot(person.messageId ?? person.key, reason) : { ok: true as const };
    setBusy(false);
    const out = reportCopy(r.ok ? null : r.reason);
    say(out.text, out.ok ? "ok" : "error");
    onClose();
  };

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={person.alias}>
        <div className="flex items-start gap-3 pr-10">
          <ChatFace look={person.look} alias={person.look ? null : person.alias} size={48} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate font-display text-base font-black leading-tight">{person.alias}</p>
            <p className="hint mt-1">
              {hiCopy?.crew
                ? "Known by an alias in a hotspot."
                : HOTSPOT_WAVES && !self
                  ? "An alias. Say hi: if they say hi back, you are crew and you see each other's names."
                  : "An alias. Nobody in a hotspot sees real names."}
            </p>
          </div>
        </div>

        {person.excerpt && <p className="mt-3 break-words border-l-2 border-line pl-3 font-body text-[14px] leading-snug text-cream/80">“{person.excerpt}”</p>}

        {step === "actions" && HOTSPOT_WAVES && !self && (
          <div className="mt-3">
            {hiCopy?.crew ? (
              <div className="rounded-hz border border-danfo bg-ink-3 p-3" role="status">
                <p className="font-display text-[15px] font-black uppercase leading-tight text-danfo">{hiCopy.text}</p>
                <button type="button" className="btn mt-2.5 w-full" onClick={message}>
                  <MessageCircle size={15} aria-hidden /> MESSAGE
                </button>
              </div>
            ) : hi ? (
              <p role="status" className={`font-body text-[14px] leading-snug ${hiCopy?.tone === "warn" ? "text-fireant" : "text-cream"}`}>
                {hiCopy?.text}
              </p>
            ) : (
              <button type="button" className="btn w-full" onClick={sayHi} disabled={busy}>
                <Hand size={15} aria-hidden /> {busy ? "SAYING HI" : "SAY HI"}
              </button>
            )}
          </div>
        )}

        {step === "actions" && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-fireant disabled:opacity-50"
              onClick={() => setStep("block")}
              disabled={busy}
            >
              Block
            </button>
            <span aria-hidden className="h-4 w-px bg-line" />
            <button
              className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-cream disabled:opacity-50"
              onClick={() => setStep("report")}
              disabled={busy}
            >
              {person.messageId ? "Report this message" : "Report"}
            </button>
          </div>
        )}

        {step === "block" && (
          <div className="mt-4 rounded-hz border border-line bg-ink-3 p-3">
            <p className="font-display text-sm font-black">Block {person.alias}?</p>
            <p className="hint mt-0.5">You will not see each other in hotspots. Blocking here does not reach anywhere else.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost border-fireant text-fireant" onClick={doBlock} disabled={busy}>
                BLOCK
              </button>
              <button className="btn btn-ghost" onClick={() => setStep("actions")} disabled={busy}>
                CANCEL
              </button>
            </div>
          </div>
        )}

        {step === "report" && (
          <div className="mt-4">
            <p className="label">What happened</p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button key={r} className="btn btn-ghost justify-start" onClick={() => doReport(r)} disabled={busy}>
                  {r}
                </button>
              ))}
            </div>
            <p className="hint mt-2">Reports go to the Hoppaz crew with what they wrote. They are not told who reported.</p>
            <button className="mt-1 min-h-[44px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim" onClick={() => setStep("actions")} disabled={busy}>
              Back
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
