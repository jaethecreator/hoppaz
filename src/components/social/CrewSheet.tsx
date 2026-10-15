"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Pointer } from "lucide-react";
import ChatFace from "@/components/chat/ChatFace";
import { sentence } from "@/components/event/copy";
import Sheet from "@/components/Sheet";
import { POKE_GAP_MS, messageCrew, pokeCrew, useSocial } from "@/lib/social";
import { useToast } from "@/lib/store";

/**
 * A crew friend, tapped in the CREW list on the Chat tab: their face and name, MESSAGE and POKE. Both are the same calls the room card uses (src/lib/social.ts), so the answers read the same everywhere.
 */
export type CrewPerson = { id: string; name: string; look: unknown };

export default function CrewSheet({ person, onClose }: { person: CrewPerson; onClose: () => void }) {
  const router = useRouter();
  const say = useToast((s) => s.say);
  const [busy, setBusy] = useState(false);
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

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={person.name}>
        <div className="flex items-center gap-3 pr-10">
          <ChatFace look={person.look} size={48} />
          <p className="min-w-0 flex-1 truncate font-display text-base font-black leading-tight">{person.name}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn" onClick={message} disabled={busy}>
            <MessageCircle size={15} aria-hidden /> MESSAGE
          </button>
          <button type="button" className="btn btn-ghost" onClick={poke} disabled={busy || poked}>
            <Pointer size={15} aria-hidden /> {poked ? "POKED" : "POKE"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
