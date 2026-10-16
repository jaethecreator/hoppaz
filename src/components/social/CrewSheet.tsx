"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Pointer } from "lucide-react";
import ChatFace from "@/components/chat/ChatFace";
import { sentence } from "@/components/event/copy";
import Sheet from "@/components/Sheet";
import { POKE_GAP_MS, messageCrew, pokeCrew, removeFromCrew, useSocial } from "@/lib/social";
import { useToast } from "@/lib/store";
import RemoveConfirm from "./RemoveConfirm";

/**
 * A crew friend, tapped in the CREW list on the Chat tab: their face and name, MESSAGE and POKE. Both are the same calls the room card uses (src/lib/social.ts), so the answers read the same everywhere.
 * Under them, a quiet "Remove from crew" with a question first: it removes the person and nothing more (names stay, the chat stays).
 */
export type CrewPerson = { id: string; name: string; look: unknown };

export default function CrewSheet({ person, onClose }: { person: CrewPerson; onClose: () => void }) {
  const router = useRouter();
  const say = useToast((s) => s.say);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const pokedAt = useSocial((s) => s.pokedAt[person.id] ?? 0);
  const poked = Date.now() - pokedAt < POKE_GAP_MS;

  const message = async () => {
    setBusy(true);
    const r = await messageCrew(person.id);
    setBusy(false);
    if (r.dm) {
      onClose();
      router.push(`/chat/dm/${r.dm}`);
    } else say(sentence(r.text ?? "COULD NOT OPEN THE CHAT"), "error");
  };
  const poke = async () => {
    setBusy(true);
    const r = await pokeCrew(person.id);
    setBusy(false);
    say(r.ok ? `Poked ${person.name}.` : sentence(r.text), r.ok ? "ok" : "error");
    if (r.ok) onClose();
  };
  const remove = async () => {
    setBusy(true);
    const r = await removeFromCrew(person.id);
    setBusy(false);
    say(r.ok ? `Removed ${person.name} from your crew.` : sentence(r.text), r.ok ? "ok" : "error");
    if (r.ok) onClose();
  };

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={person.name}>
        <div className="mx-auto w-full max-w-[480px]">
        <div className="flex items-center gap-3 pr-10">
          <ChatFace look={person.look} size={48} />
          <p className="min-w-0 flex-1 truncate font-display text-base font-black leading-tight">{person.name}</p>
        </div>
        {asking ? (
          <div className="mt-4">
            <RemoveConfirm name={person.name} busy={busy} onRemove={remove} onCancel={() => setAsking(false)} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="btn" onClick={message} disabled={busy}>
                <MessageCircle size={15} aria-hidden /> MESSAGE
              </button>
              <button type="button" className="btn btn-ghost" onClick={poke} disabled={busy || poked}>
                <Pointer size={15} aria-hidden /> {poked ? "POKED" : "POKE"}
              </button>
            </div>
            <div className="mt-1 flex justify-center">
              <button type="button" className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim disabled:opacity-50" onClick={() => setAsking(true)} disabled={busy}>
                Remove from crew
              </button>
            </div>
          </>
        )}
        </div>
      </Sheet>
    </>
  );
}
